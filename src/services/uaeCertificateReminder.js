'use strict';
/* UAE certificate step (founder approved, 2 Nov 2026).
   18 UAE caregivers sat at "send your certificate": they wrote "Ok", "I send
   it tomorrow", "my certificate is not yet out", and the bot only repeated
   the request; nothing reminded them later. Now:
   - an "I'll send it later" button with the repeated request;
   - "later / tomorrow / not yet" gets "Okay, send it when you have it";
   - a reminder 20 hours after her last message (free text, the 24-hour
     WhatsApp window is still open), and a second one 48 hours after that by
     the template caregiver_uae_certificate_reminder (window closed).
   The template half stays off until UAE_CERT_REMINDER_TEMPLATE_APPROVED=true.
   Pure decision here; sending and storage are injected. */

const LATER_ID = 'cert_send_later';
const TEMPLATE_NAME = 'caregiver_uae_certificate_reminder';
const HOUR = 60 * 60 * 1000;
const FIRST_AFTER_MS = 20 * HOUR;
const SECOND_AFTER_MS = 48 * HOUR;
const WINDOW_MS = 23.5 * HOUR;

const LATER_WORDS = /\b(later|tomorrow|tmrw|tomorow|not\s+yet|not\s+ready|not\s+out|not\s+with\s+me|don'?t\s+have|do\s+not\s+have|dont\s+have|will\s+send|i'?ll\s+send|send\s+(it\s+)?(later|soon|tomorrow)|soon|waiting|processing|pending|at\s+home|in\s+my\s+room|after\s+duty|finished\s+my\s+class)/i;

function enabled(env = process.env) {
  return String(env.UAE_CERT_REMINDERS_ENABLED || 'true') !== 'false';
}

function templateApproved(env = process.env) {
  return String(env.UAE_CERT_REMINDER_TEMPLATE_APPROVED || '') === 'true';
}

function isLaterText(text) {
  return LATER_WORDS.test(String(text || ''));
}

function toMs(value) {
  if (!value) return NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && Number.isFinite(value._seconds)) return value._seconds * 1000;
  return Date.parse(String(value));
}

function isSandbox(phone) {
  return /^9715000001\d\d$/.test(String(phone || ''));
}

/** { which: 1|2, mode: 'text'|'template' } when a reminder is due, else null. */
function certReminderDue(provider, now, { template = templateApproved() } = {}) {
  if (!provider || isSandbox(provider.phone)) return null;
  if (String(provider.region || '').toLowerCase() !== 'uae') return null;
  if (provider.status !== 'awaiting_certificate') return null;
  const docs = provider.documents || {};
  if ((docs.certificateAttachments || []).length) return null;
  const last = toMs(provider.lastInboundAt);
  if (!Number.isFinite(last)) return null;
  const quiet = now - last;
  const mode = quiet < WINDOW_MS ? 'text' : (template ? 'template' : null);
  if (!provider.uaeCertReminder1At) {
    if (quiet < FIRST_AFTER_MS || !mode) return null;
    return { which: 1, mode };
  }
  if (provider.uaeCertReminder2At) return null;
  const since = Math.max(last, toMs(provider.uaeCertReminder1At) || 0);
  if (now - since < SECOND_AFTER_MS || !mode) return null;
  return { which: 2, mode };
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

/* deps: listAwaiting(), markSent(phone, field, iso), sendText(provider),
   sendTemplate(phone, body), log(phone, which, mode) */
async function runCertReminderSweep(deps, now = Date.now(), options = {}) {
  const result = { scanned: 0, text: 0, template: 0, errors: 0 };
  const providers = await deps.listAwaiting();
  for (const provider of providers) {
    try {
      result.scanned += 1;
      const due = certReminderDue(provider, now, options);
      if (!due) continue;
      // Marked first: one reminder each, even if the send fails.
      await deps.markSent(provider.phone, due.which === 1 ? 'uaeCertReminder1At' : 'uaeCertReminder2At', new Date(now).toISOString());
      if (due.mode === 'text') await deps.sendText(provider);
      else await deps.sendTemplate(provider.phone, templateBody(provider));
      await deps.log(provider.phone, due.which, due.mode);
      result[due.mode] += 1;
    } catch (error) {
      result.errors += 1;
      console.error('[UAE_CERT_REMINDER_ERROR]', provider && provider.phone, error && error.message);
    }
  }
  return result;
}

module.exports = {
  LATER_ID,
  TEMPLATE_NAME,
  FIRST_AFTER_MS,
  SECOND_AFTER_MS,
  enabled,
  templateApproved,
  isLaterText,
  certReminderDue,
  templateBody,
  runCertReminderSweep
};
