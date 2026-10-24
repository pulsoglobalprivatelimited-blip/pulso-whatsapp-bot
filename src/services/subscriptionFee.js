'use strict';

// The ₹499 one-time subscription fee (founder, 22 Oct 2026; plan in pulso_hub
// docs/provider_subscription_fee_plan.md).
//
//  - Kerala only, and only people whose chat STARTED on or after the start
//    date. Everyone verified before it, app installed or not, pays nothing.
//  - The bot's part: the terms carry two extra points in front (the fee and
//    "duties depend on market requirements"), the working model loses its
//    "no registration fee" line, Accept is answered with "install the app and
//    pay", the provider is marked `subscriptionFee: {status: 'due'}`, and she
//    is reminded on day 1 and day 3. The money itself is taken inside the
//    Pulso app; the hub tells this bot through /internal/subscription-fee-paid.
//
// Pure where it can be: who the fee applies to, the texts, the reminder
// schedule. Sending lives in onboardingFlow.js and server.js.

const config = require('../config');
const { FLOWS, DEFAULT_FLOW_ID } = require('../flow');
const { inferProviderRegion } = require('./regionService');

const DEFAULT_REGIONS = ['kerala'];
const NO_FEE_LINES = Object.freeze([
  '- ഇതിനായി പ്രത്യേക registration fee ഒന്നും നൽകേണ്ടതില്ല',
  '- There is no registration fee to join Pulso',
]);

function settings() {
  const regions = String(config.subscriptionFeeRegions || '')
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  const startAtMs = Date.parse(String(config.subscriptionFeeStartAt || ''));
  return {
    enabled: config.subscriptionFeeEnabled === true,
    regions: regions.length ? regions : DEFAULT_REGIONS,
    startAtMs: Number.isFinite(startAtMs) ? startAtMs : null,
    amount: Number(config.subscriptionFeeAmount || 499),
    reminderHours: [config.subscriptionFeeFirstReminderHours, config.subscriptionFeeSecondReminderHours]
      .map(Number)
      .filter((h) => Number.isFinite(h) && h > 0)
      .sort((a, b) => a - b),
    reminderTemplateName: String(config.subscriptionFeeReminderTemplateName || '').trim(),
    paidTemplateName: String(config.subscriptionFeePaidTemplateName || '').trim(),
    // 7-day free trial (24 Oct 2026); see config.js.
    trialDays: Math.max(0, Math.floor(Number(config.subscriptionFeeTrialDays) || 0)),
    trialReminderHours: String(config.subscriptionFeeTrialReminderHours || '')
      .split(',')
      .map(Number)
      .filter((h) => Number.isFinite(h) && h > 0)
      .sort((a, b) => a - b),
    trialReminderTemplateName: String(config.subscriptionFeeTrialReminderTemplateName || '').trim(),
    trialOverTemplateName: String(config.subscriptionFeeTrialOverTemplateName || '').trim(),
    trialTemplatesApproved: config.subscriptionFeeTrialTemplatesApproved === true,
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 08:00–20:59 IST: reminders never go out at night. */
function withinSendHours(now = Date.now()) {
  const istHour = Math.floor(((now + 5.5 * HOUR_MS) % DAY_MS) / HOUR_MS);
  return istHour >= 8 && istHour < 21;
}

/** A record of the trial kind (new joiner after 24 Oct 2026), whatever its status now. */
function isTrialRecord(fee) {
  return Boolean(fee && typeof fee === 'object' && Number(fee.trialDays) > 0);
}

/** Whether this caregiver pays. Decided once: a record with `required` wins. */
function feeAppliesTo(provider, now = Date.now(), s = settings()) {
  if (!provider) return false;
  // Never in the UAE (contract, 26 Oct 2026): not by config, not by a stray
  // `required` on the record. The fee is an India-only thing.
  if (inferProviderRegion(provider) === 'uae') return false;
  const fee = provider.subscriptionFee;
  if (fee && typeof fee === 'object') {
    if (fee.exempt === true) return false;
    if (fee.required === true) return true;
  }
  if (!s.enabled || !s.startAtMs) return false;
  const region = inferProviderRegion(provider);
  if (!region || !s.regions.includes(region)) return false;
  const createdMs = Date.parse(String(provider.createdAt || ''));
  if (!Number.isFinite(createdMs)) return false;
  return createdMs >= s.startAtMs && createdMs <= now + 24 * 60 * 60 * 1000;
}

/**
 * The terms with the two fee points in front. The existing points move down:
 * each paragraph that starts "N. " becomes "N+2. ". Sub-paragraphs (the kit
 * details, the payment option) start with no number, so they stay as they are.
 */
function withFeePoints(baseText, feePoints) {
  const points = Array.isArray(feePoints) ? feePoints.filter(Boolean) : [];
  if (!points.length) return baseText;
  const paragraphs = String(baseText || '').split('\n\n');
  const head = paragraphs.shift() || '';
  const shifted = paragraphs.map((p) => p.replace(/^(\d+)\. /, (m, n) => `${Number(n) + points.length}. `));
  const inserted = points.map((text, i) => `${i + 1}. ${text}`);
  return [head, ...inserted, ...shifted].join('\n\n');
}

/** The terms text this caregiver should read, in the active flow's language. */
function termsIntroFor(provider, messages, now = Date.now()) {
  if (!messages) return '';
  if (!feeAppliesTo(provider, now)) return messages.termsIntro;
  return withFeePoints(messages.termsIntro, messages.termsFeePoints);
}

/** Every text the intro may have been sent as (to see whether it went already). */
function termsIntroVariants(messages) {
  if (!messages) return [];
  return [messages.termsIntro, withFeePoints(messages.termsIntro, messages.termsFeePoints)];
}

/**
 * The working model for a fee-payer: its "no registration fee" line is taken
 * OUT, and nothing is put in its place. The fee itself is said only with the
 * terms, after the certificate is approved or a Basic caregiver is approved on
 * the call (founder, 24 Oct 2026: "The fee only should be showed with terms
 * and conditions message. Not before that"). The line still comes out because
 * telling a future fee-payer "no registration fee" would be untrue.
 * `messages` is kept in the signature for the callers; it is not needed now.
 */
function applyWorkingModelFeeLine(text, provider, messages, now = Date.now()) {
  void messages;
  if (!feeAppliesTo(provider, now)) return text;
  let out = String(text || '');
  for (const line of NO_FEE_LINES) out = out.split(`\n${line}`).join('').split(line).join('');
  return out;
}

/**
 * The record written at Accept; an existing decision (paid, waived, a running
 * trial) is kept. With a trial configured she starts as `trial` with no
 * dates: the hub stamps trialStartsAt at her first app sign-in
 * (/internal/subscription-fee-trial-started) and flips her to `due` when it
 * runs out (/internal/subscription-fee-locked). With trialDays 0 the old
 * pay-first record is written, as before 24 Oct 2026.
 */
function dueRecord(provider, now = new Date().toISOString(), s = settings()) {
  const existing = provider && provider.subscriptionFee && typeof provider.subscriptionFee === 'object'
    ? provider.subscriptionFee
    : null;
  if (existing && existing.status && existing.status !== 'due') return existing;
  if (existing && existing.status === 'due' && isTrialRecord(existing)) return existing;
  if (s.trialDays > 0) {
    return {
      required: true,
      status: 'trial',
      amount: s.amount,
      trialDays: s.trialDays,
      acceptedAt: (existing && existing.acceptedAt) || now,
      trialStartsAt: null,
      trialEndsAt: null,
      remindersSent: 0,
    };
  }
  return {
    required: true,
    status: 'due',
    amount: s.amount,
    dueSince: (existing && existing.dueSince) || now,
    remindersSent: Number(existing && existing.remindersSent) || 0,
  };
}

/**
 * What the sweep should send this caregiver now, or null:
 *   {kind:'trial_reminder', daysLeft, index}  at trialReminderHours after the start
 *   {kind:'trial_over'}                        once, after the hub locked her
 * Pay-first records (no trialDays) are not handled here; see isReminderDue.
 */
function trialStage(provider, now = Date.now(), s = settings()) {
  const fee = provider && provider.subscriptionFee;
  if (!isTrialRecord(fee)) return null;
  if (fee.status === 'trial') {
    const startMs = Date.parse(String(fee.trialStartsAt || ''));
    if (!Number.isFinite(startMs)) return null;
    const index = reminderCount(provider);
    const nextHours = s.trialReminderHours[index];
    if (!nextHours || now - startMs < nextHours * HOUR_MS) return null;
    const endMs = Date.parse(String(fee.trialEndsAt || '')) || startMs + Number(fee.trialDays) * DAY_MS;
    if (now >= endMs) return null; // the lock message covers it
    return { kind: 'trial_reminder', index, daysLeft: Math.max(1, Math.ceil((endMs - now) / DAY_MS)) };
  }
  if (fee.status === 'due' && fee.lockedAt && !fee.trialOverSentAt) return { kind: 'trial_over' };
  return null;
}

function validateTrialStarted(body = {}) {
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (phone.length < 11 || phone.length > 15) throw new Error('phone is required');
  const startsAt = String(body.trialStartsAt || new Date().toISOString());
  if (Number.isNaN(Date.parse(startsAt))) throw new Error('trialStartsAt must be a date');
  const endsAt = String(body.trialEndsAt || new Date(Date.parse(startsAt) + settings().trialDays * DAY_MS).toISOString());
  if (Number.isNaN(Date.parse(endsAt))) throw new Error('trialEndsAt must be a date');
  return { phone, uid: String(body.uid || ''), trialStartsAt: startsAt, trialEndsAt: endsAt };
}

/** The hub: her first app sign-in started the clock. Dates stored, nothing sent (the app shows the countdown). */
async function markTrialStarted(body, deps) {
  const t = validateTrialStarted(body);
  const provider = await deps.getProvider(t.phone);
  if (!provider) return { ok: true, known: false, phone: t.phone };
  const fee = provider.subscriptionFee && typeof provider.subscriptionFee === 'object' ? provider.subscriptionFee : {};
  if (fee.status && fee.status !== 'trial' && fee.status !== 'due') return { ok: true, known: true, ignored: fee.status };
  if (fee.trialStartsAt) return { ok: true, known: true, repeated: true };
  await deps.updateProvider(t.phone, {
    subscriptionFee: {
      ...fee,
      required: true,
      status: 'trial',
      amount: Number(fee.amount) || settings().amount,
      trialDays: Number(fee.trialDays) || settings().trialDays || Math.round((Date.parse(t.trialEndsAt) - Date.parse(t.trialStartsAt)) / DAY_MS),
      trialStartsAt: t.trialStartsAt,
      trialEndsAt: t.trialEndsAt,
      remindersSent: 0,
    },
  });
  await deps.appendHistory(t.phone, { type: 'system', event: 'subscription_fee_trial_started', trialStartsAt: t.trialStartsAt, trialEndsAt: t.trialEndsAt });
  return { ok: true, known: true };
}

function validateLocked(body = {}) {
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (phone.length < 11 || phone.length > 15) throw new Error('phone is required');
  const lockedAt = String(body.lockedAt || new Date().toISOString());
  if (Number.isNaN(Date.parse(lockedAt))) throw new Error('lockedAt must be a date');
  return { phone, uid: String(body.uid || ''), lockedAt };
}

/** The hub: the trial ran out unpaid, the inbox is locked. The sweep sends the message in daytime. */
async function markLocked(body, deps) {
  const t = validateLocked(body);
  const provider = await deps.getProvider(t.phone);
  if (!provider) return { ok: true, known: false, phone: t.phone };
  const fee = provider.subscriptionFee && typeof provider.subscriptionFee === 'object' ? provider.subscriptionFee : {};
  if (fee.status === 'paid' || fee.status === 'waived') return { ok: true, known: true, ignored: fee.status };
  if (fee.status === 'due' && fee.lockedAt) return { ok: true, known: true, repeated: true };
  await deps.updateProvider(t.phone, {
    subscriptionFee: {
      ...fee,
      required: true,
      status: 'due',
      amount: Number(fee.amount) || settings().amount,
      trialDays: Number(fee.trialDays) || settings().trialDays,
      lockedAt: t.lockedAt,
      dueSince: t.lockedAt,
    },
  });
  await deps.appendHistory(t.phone, { type: 'system', event: 'subscription_fee_locked', lockedAt: t.lockedAt });
  return { ok: true, known: true };
}

/** The plain-text forms (logged in her chat; the templates carry the same words). */
function trialReminderText(provider, daysLeft) {
  const messages = messagesForProvider(provider);
  return String(messages.subscriptionFeeTrialReminder || '').replace('{{days}}', String(daysLeft));
}

function trialOverText(provider) {
  const messages = messagesForProvider(provider);
  return String(messages.subscriptionFeeTrialOver || '');
}

function reminderCount(provider) {
  const n = Number(provider && provider.subscriptionFee && provider.subscriptionFee.remindersSent);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Day 1 and day 3 after Accept, while still unpaid: the pay-first records only. */
function isReminderDue(provider, now = Date.now(), s = settings()) {
  const fee = provider && provider.subscriptionFee;
  if (!fee || fee.status !== 'due') return false;
  if (isTrialRecord(fee)) return false; // trialStage() decides for these
  const sinceMs = Date.parse(String(fee.dueSince || ''));
  if (!Number.isFinite(sinceMs)) return false;
  const nextHours = s.reminderHours[reminderCount(provider)];
  if (!nextHours) return false;
  return now - sinceMs >= nextHours * 60 * 60 * 1000;
}

function messagesForProvider(provider) {
  const flow = (provider && provider.flowId && FLOWS[provider.flowId]) || FLOWS[DEFAULT_FLOW_ID];
  return flow.MESSAGES;
}

function firstName(provider) {
  return (String((provider && provider.fullName) || '').trim().split(/\s+/)[0] || 'Caregiver').slice(0, 60);
}

/** What the paid confirmation says; `{{receiptNo}}` filled in. */
function paidMessage(provider, receiptNo) {
  const messages = messagesForProvider(provider);
  return String(messages.subscriptionFeePaid || '').replace('{{receiptNo}}', String(receiptNo || '-'));
}

function validatePaid(body = {}) {
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (phone.length < 11 || phone.length > 15) throw new Error('phone is required');
  const paidAt = String(body.paidAt || new Date().toISOString());
  if (Number.isNaN(Date.parse(paidAt))) throw new Error('paidAt must be a date');
  return {
    phone,
    uid: String(body.uid || ''),
    paymentId: String(body.paymentId || ''),
    receiptNo: String(body.receiptNo || ''),
    receiptUrl: String(body.receiptUrl || ''),
    amount: Number(body.amount) || settings().amount,
    paidAt,
  };
}

/**
 * The hub says she paid. Marks the record (reminders stop), logs it, and
 * tells her, with the receipt when there is one. deps: getProvider,
 * updateProvider, appendHistory, sendText, sendDocumentByUrl, sendTemplate.
 */
async function markPaid(body, deps) {
  // Ops let her in without paying: reminders stop, nothing is sent to her.
  if (body && body.waived === true) {
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (phone.length < 11 || phone.length > 15) throw new Error('phone is required');
    const provider = await deps.getProvider(phone);
    if (!provider) return { ok: true, known: false, phone };
    await deps.updateProvider(phone, {
      subscriptionFee: {
        ...(provider.subscriptionFee && typeof provider.subscriptionFee === 'object' ? provider.subscriptionFee : {}),
        required: true,
        status: 'waived',
        waivedAt: new Date().toISOString(),
        waiveNote: String(body.note || '').slice(0, 300),
      },
    });
    await deps.appendHistory(phone, { type: 'system', event: 'subscription_fee_waived', note: String(body.note || '').slice(0, 300) });
    return { ok: true, known: true, waived: true };
  }
  const paid = validatePaid(body);
  const provider = await deps.getProvider(paid.phone);
  if (!provider) return { ok: true, known: false, phone: paid.phone };
  const already = provider.subscriptionFee && provider.subscriptionFee.status === 'paid';
  await deps.updateProvider(paid.phone, {
    subscriptionFee: {
      ...(provider.subscriptionFee && typeof provider.subscriptionFee === 'object' ? provider.subscriptionFee : {}),
      required: true,
      status: 'paid',
      amount: paid.amount,
      paidAt: paid.paidAt,
      paymentId: paid.paymentId,
      receiptNo: paid.receiptNo,
    },
  });
  if (already) return { ok: true, known: true, repeated: true };
  await deps.appendHistory(paid.phone, {
    type: 'system',
    event: 'subscription_fee_paid',
    amount: paid.amount,
    paymentId: paid.paymentId,
    receiptNo: paid.receiptNo,
  });
  const text = paidMessage(provider, paid.receiptNo);
  let delivered = 'text';
  try {
    await deps.sendText(paid.phone, text);
    if (paid.receiptUrl) {
      await deps.sendDocumentByUrl(paid.phone, paid.receiptUrl, `Pulso-receipt-${paid.receiptNo || 'subscription'}.pdf`, '');
    }
  } catch (error) {
    // Outside the 24-hour window only a template reaches her.
    const s = settings();
    if (!s.paidTemplateName) throw error;
    delivered = 'template';
    const language = provider.language === 'en' ? 'en' : 'ml';
    const components = [{ type: 'body', parameters: [{ type: 'text', text: firstName(provider) }, { type: 'text', text: paid.receiptNo || '-' }] }];
    if (paid.receiptUrl) {
      components.unshift({ type: 'header', parameters: [{ type: 'document', document: { link: paid.receiptUrl, filename: `Pulso-receipt-${paid.receiptNo || 'subscription'}.pdf` } }] });
    }
    await deps.sendTemplate(paid.phone, s.paidTemplateName, language, components);
  }
  await deps.appendHistory(paid.phone, {
    type: 'outbound_message',
    sender: 'pulso',
    payload: { kind: delivered, body: delivered === 'text' ? text : { name: settings().paidTemplateName, receiptNo: paid.receiptNo } },
  });
  return { ok: true, known: true, delivered };
}

module.exports = {
  NO_FEE_LINES,
  settings,
  feeAppliesTo,
  withFeePoints,
  termsIntroFor,
  termsIntroVariants,
  applyWorkingModelFeeLine,
  dueRecord,
  reminderCount,
  isReminderDue,
  withinSendHours,
  isTrialRecord,
  trialStage,
  validateTrialStarted,
  markTrialStarted,
  validateLocked,
  markLocked,
  trialReminderText,
  trialOverText,
  messagesForProvider,
  paidMessage,
  validatePaid,
  markPaid,
};
