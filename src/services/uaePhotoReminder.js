'use strict';
/* UAE Emirates ID photo reminder (founder, 29 Oct 2026).
   7 Dubai caregivers signed in to the Pulso app and none sent the photos; the
   app reminders stop at sign-in, so nothing told them again. This sends the
   approved template caregiver_uae_id_photos (English, {{1}} = first name) to a
   UAE caregiver who signed in but whose licence is still pending_photos:
   once 24 hours after sign-in, once more at 72 hours, then never again.
   Never to a visit / maid / cancelled visa (cannot work). Switched off until
   UAE_PHOTO_REMINDERS_ENABLED=true (the template must be approved first).
   Pure decision here; the sweep's sending and storage are injected. */

const TEMPLATE_NAME = 'caregiver_uae_id_photos';
const HOUR = 60 * 60 * 1000;
const FIRST_AFTER_MS = 24 * HOUR;
const SECOND_AFTER_MS = 72 * HOUR;
const NO_WORK_VISAS = ['visit', 'maid', 'cancelled'];

function enabled(env = process.env) {
  return String(env.UAE_PHOTO_REMINDERS_ENABLED || '') === 'true';
}

function toMs(value) {
  if (!value) return NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  return Date.parse(String(value));
}

/** 1 or 2 when that reminder is due now, else null. */
function photoReminderDue(provider, hubUser, now) {
  if (!provider || !hubUser) return null;
  if (String(provider.region || '').toLowerCase() !== 'uae') return null;
  if (provider.status !== 'completed') return null;
  const licence = hubUser.uaeLicence || {};
  if (licence.status !== 'pending_photos') return null;
  if (NO_WORK_VISAS.includes(String(hubUser.uaeVisaType || provider.uaeVisaType || '').toLowerCase())) return null;
  const signedIn = toMs(hubUser.activatedFromBotAt);
  if (!Number.isFinite(signedIn)) return null;
  const waited = now - signedIn;
  if (!provider.uaePhotoReminder1At) return waited >= FIRST_AFTER_MS ? 1 : null;
  if (!provider.uaePhotoReminder2At && waited >= SECOND_AFTER_MS) return 2;
  return null;
}

/* Reply when she writes or sends a photo on WhatsApp while the app still
   waits for her photos (founder approved, 31 Oct 2026): the bot used to say
   "Your onboarding is already complete", which did not tell her where to go,
   and one caregiver sent her ID papers on WhatsApp. */
const PHOTO_NUDGE_TEXT =
  'Please open the Pulso app. On the first screen, "Documents before your first duty", take the photos of your Emirates ID and a selfie.\n' +
  'Please do not send ID photos on WhatsApp.';
const NUDGE_QUIET_MS = 10 * 60 * 1000;

function needsPhotoNudge(provider, hubUser) {
  if (!provider || !hubUser) return false;
  if (String(provider.region || '').toLowerCase() !== 'uae') return false;
  if (provider.status !== 'completed') return false;
  const status = (hubUser.uaeLicence || {}).status;
  return status === 'pending_photos' || status === 'rejected';
}

/* An album arrives as several messages: one reply, then quiet for 10 minutes
   for further photos. Typed words always get the reply. */
function nudgeQuiet(provider, isMedia, now) {
  if (!isMedia) return false;
  const last = toMs(provider && provider.uaePhotoNudgeAt);
  return Number.isFinite(last) && now - last < NUDGE_QUIET_MS;
}

function firstName(value) {
  return String(value || '').trim().split(/\s+/)[0] || 'there';
}

function templateBody(provider) {
  return {
    name: TEMPLATE_NAME,
    languageCode: 'en',
    components: [{ type: 'body', parameters: [{ type: 'text', text: firstName(provider.fullName) }] }]
  };
}

/* deps: listUaeCompleted(), hubUserFor(phone) -> users doc data | null,
   markSent(phone, field, iso), send(phone, body), log(phone, which) */
async function runPhotoReminderSweep(deps, now = Date.now()) {
  const result = { scanned: 0, sent1: 0, sent2: 0, errors: 0 };
  const providers = await deps.listUaeCompleted();
  for (const provider of providers) {
    try {
      const hubUser = await deps.hubUserFor(provider.phone);
      const which = photoReminderDue(provider, hubUser, now);
      result.scanned += 1;
      if (!which) continue;
      // Marked first: one reminder each, even if the send fails.
      await deps.markSent(provider.phone, which === 1 ? 'uaePhotoReminder1At' : 'uaePhotoReminder2At', new Date(now).toISOString());
      await deps.send(provider.phone, templateBody(provider));
      await deps.log(provider.phone, which);
      result[which === 1 ? 'sent1' : 'sent2'] += 1;
    } catch (error) {
      result.errors += 1;
      console.error('[UAE_PHOTO_REMINDER_ERROR]', provider.phone, error && error.message);
    }
  }
  return result;
}

module.exports = {
  TEMPLATE_NAME,
  PHOTO_NUDGE_TEXT,
  needsPhotoNudge,
  nudgeQuiet,
  FIRST_AFTER_MS,
  SECOND_AFTER_MS,
  enabled,
  photoReminderDue,
  templateBody,
  runPhotoReminderSweep
};
