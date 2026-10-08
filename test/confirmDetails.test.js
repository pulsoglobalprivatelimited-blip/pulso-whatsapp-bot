'use strict';
// She checks her name, age, sex, district and qualification before review
// (docs/confirm_details_before_review_plan.md, 8 Oct 2026). The district no
// longer sends her to review: a check message does, on Correct; Change re-asks
// one answer through the same handler and comes back to the check.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
const SECOND = '916238378859';
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.NO_CERTIFICATE_REVIEWER_PHONE = '+91 62383 78859';
process.env.NO_CERTIFICATE_REVIEWER_NAME = 'Mohamed Afiq';
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';

// ---- fakes: no Firestore, no WhatsApp ---------------------------------------
const sent = [];
const records = new Map();
function deepMerge(target, patch) {
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object'
      ? deepMerge(out[k], v)
      : v;
  }
  return out;
}
function stub(rel, impl) {
  const file = require.resolve(path.join('../src/services', rel));
  const fallback = async () => null;
  require.cache[file] = {
    id: file, filename: file, loaded: true,
    exports: new Proxy(impl, { get: (t, k) => (k in t ? t[k] : fallback) })
  };
}
const ok = { messages: [{ id: 'w' }] };
stub('metaClient', {
  sendText: async (to, body) => { sent.push({ to, kind: 'text', body }); return ok; },
  sendButtons: async (to, body, buttons) => { sent.push({ to, kind: 'buttons', body, buttons }); return ok; },
  sendList: async (to, body, buttonText, sections) => { sent.push({ to, kind: 'list', body, buttonText, sections }); return ok; },
  sendTemplate: async (to, name, lang, components) => { sent.push({ to, kind: 'template', name, components }); return ok; },
  isAppMediaId: () => false,
  currentChannel: () => null
});
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => records.get(phone) || null,
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone), patch)); return records.get(phone); },
  appendHistory: async (phone, event) => {
    const p = records.get(phone);
    if (!p) return null;
    p.history = [...(p.history || []), { at: new Date().toISOString(), ...event }];
    return p;
  },
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()],
  listProvidersByStatus: async (status) => [...records.values()].filter((p) => p.status === status)
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 45 }) });
stub('reviewAlertEscalation', {
  buildVerificationNotificationPatch: (result) => (result && result.sent ? { notificationSentAt: new Date().toISOString() } : null),
  recordReviewAlertSend: async () => null
});
stub('mediaStorage', {
  archiveIncomingMedia: async (phone, message) => ({
    id: (message.image || message.document).id,
    type: message.type,
    cloudArchiveStatus: 'dry_run'
  })
});

const flow = require('../src/flow');
const { STATUS, BUTTON_IDS, FLOWS } = flow;
const ops = require('../src/services/opsNotifications');
const bot = require('../src/services/onboardingFlow');

const tap = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const row = (id, title = 'x') => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const text = (body) => ({ type: 'text', text: { body } });
const image = (id) => ({ type: 'image', image: { id } });
const utf16 = (s) => Buffer.from(String(s), 'utf16le').length / 2;

const toHer = (phone) => sent.filter((m) => m.to === phone);
const lastToHer = (phone) => toHer(phone)[toHer(phone).length - 1];
const reviewAlerts = () => sent.filter((m) => [OWNER, SECOND].includes(m.to) && m.kind === 'buttons' && /approve/i.test(m.body));
const events = (phone) => (records.get(phone).history || []).filter((h) => h.type === 'system').map((h) => h.event);

let seq = 0;
function atDistrict(extra = {}) {
  seq += 1;
  const phone = `91900000${String(7000 + seq)}`;
  records.set(phone, {
    phone,
    region: 'kerala',
    flowId: 'kerala_malayalam',
    status: STATUS.AWAITING_DISTRICT,
    currentStep: 12,
    qualification: 'gda',
    age: 34,
    sex: 'Female',
    fullName: 'Sindhu Sajeev',
    interestConfirmed: true,
    dutyHourPreference: '24_hour',
    documents: { certificateAttachments: [{ id: `cert-${seq}`, type: 'image', cloudArchiveStatus: 'dry_run' }] },
    verification: { status: 'not_started' },
    history: [{ at: new Date().toISOString(), type: 'inbound_message', payload: {} }],
    ...extra
  });
  return phone;
}
async function atCheck(extra = {}) {
  const phone = atDistrict(extra);
  await bot.processIncomingMessage(phone, row('district_ernakulam', 'എറണാകുളം'));
  return phone;
}
const say = (phone, message) => bot.processIncomingMessage(phone, message);

// ---- the check after the district -------------------------------------------

test('the district answer shows the check, and nothing goes to review', async () => {
  sent.length = 0;
  const phone = await atCheck();
  const p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.equal(p.district, 'Ernakulam');
  assert.deepEqual(p.detailsChanged, []);
  assert.ok(p.detailsCheckShownAt);
  assert.equal(reviewAlerts().length, 0, 'no review alert before Correct');
  const check = lastToHer(phone);
  assert.equal(check.kind, 'buttons');
  assert.equal(
    check.body,
    '*താങ്കൾ നൽകിയ വിവരങ്ങൾ ഒന്ന് പരിശോധിക്കുക:*\n\nപേര്: Sindhu Sajeev\nവയസ്: 34\nസ്ത്രീ / പുരുഷൻ: സ്ത്രീ\nജില്ല: Ernakulam\nയോഗ്യത: GDA'
  );
  assert.deepEqual(check.buttons.map((b) => b.title), ['ശരിയാണ്', 'മാറ്റണം']);
  assert.ok(events(phone).includes('details_check_sent'));
});

test('qualification on the check reads as the chat list shows it', async () => {
  const phone = await atCheck({ qualification: 'nursing_student', sex: 'Male' });
  const body = lastToHer(phone).body;
  assert.match(body, /യോഗ്യത: നഴ്സിംഗ് വിദ്യാർത്ഥി/);
  assert.match(body, /സ്ത്രീ \/ പുരുഷൻ: പുരുഷൻ/);
});

test('Correct sends for review exactly once, however often it is tapped', async () => {
  const phone = await atCheck();
  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.VERIFICATION_PENDING);
  assert.equal(p.verification.status, 'pending');
  assert.ok(p.detailsConfirmedAt);
  assert.equal(p.detailsNotChecked, false);
  const alerts = reviewAlerts();
  assert.equal(alerts.length, 1, 'one alert to the owner');
  assert.match(alerts[0].body, /^New certificate uploaded for review\.\nDetails checked by her ✓\n/);
  assert.equal(lastToHer(phone).body, FLOWS.kerala_malayalam.MESSAGES.verificationPending);
  assert.deepEqual(events(phone).slice(-2), ['details_confirmed', 'verification_queue_created']);

  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  assert.equal(reviewAlerts().length, 1, 'a second tap sends nothing more to review');
  assert.equal(lastToHer(phone).body, FLOWS.kerala_malayalam.MESSAGES.verificationStillPending);
});

test('two Correct taps landing together still make one review', async () => {
  const phone = await atCheck();
  sent.length = 0;
  await Promise.all([
    say(phone, { id: 'a', ...tap(BUTTON_IDS.DETAILS_CORRECT) }),
    say(phone, { id: 'b', ...tap(BUTTON_IDS.DETAILS_CORRECT) })
  ]);
  assert.equal(reviewAlerts().length, 1);
  assert.equal(events(phone).filter((e) => e === 'verification_queue_created').length, 1);
});

test('typed ശരിയാണ് counts as Correct; anything else shows the check again', async () => {
  const phone = await atCheck();
  sent.length = 0;
  await say(phone, text('hello'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.equal(lastToHer(phone).kind, 'buttons');
  await say(phone, text('ശരിയാണ്'));
  assert.equal(records.get(phone).status, STATUS.VERIFICATION_PENDING);
});

// ---- Change -------------------------------------------------------------------

test('Change shows the five fields as a list', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  const list = lastToHer(phone);
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.sections[0].rows.map((r) => r.title), ['പേര്', 'വയസ്', 'സ്ത്രീ / പുരുഷൻ', 'ജില്ല', 'യോഗ്യത']);
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
});

test('name: asked again, then back to the check with the new name', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_NAME));
  assert.equal(lastToHer(phone).body, FLOWS.kerala_malayalam.MESSAGES.nameQuestion);
  assert.equal(records.get(phone).detailsEditing, 'name');
  await say(phone, text('Sindhu S'));
  const p = records.get(phone);
  assert.equal(p.fullName, 'Sindhu S');
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.equal(p.detailsEditing, null);
  assert.deepEqual(p.detailsChanged, [{ field: 'name', from: 'Sindhu Sajeev', to: 'Sindhu S' }]);
  assert.match(lastToHer(phone).body, /പേര്: Sindhu S\n/);
  assert.equal(lastToHer(phone).kind, 'buttons');
});

test('sex: the same buttons, back to the check', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_SEX));
  assert.deepEqual(lastToHer(phone).buttons.map((b) => b.id), [BUTTON_IDS.SEX_MALE, BUTTON_IDS.SEX_FEMALE]);
  await say(phone, tap(BUTTON_IDS.SEX_MALE));
  assert.equal(records.get(phone).sex, 'Male');
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.match(lastToHer(phone).body, /സ്ത്രീ \/ പുരുഷൻ: പുരുഷൻ/);
});

test('district: the same list (with its pages), back to the check', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_DISTRICT));
  assert.equal(lastToHer(phone).kind, 'list');
  await say(phone, row(BUTTON_IDS.DISTRICT_PAGE_NEXT));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION, 'paging stays in the edit');
  assert.equal(lastToHer(phone).kind, 'list');
  await say(phone, row('district_kannur', 'കണ്ണൂർ'));
  assert.equal(records.get(phone).district, 'Kannur');
  assert.match(lastToHer(phone).body, /ജില്ല: Kannur/);
  assert.deepEqual(records.get(phone).detailsChanged, [{ field: 'district', from: 'Ernakulam', to: 'Kannur' }]);
});

test('age: validated the same way; over 45 gets the Basic notice, once', async () => {
  const phone = await atCheck();
  const ML = FLOWS.kerala_malayalam.MESSAGES;
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_AGE));
  sent.length = 0;
  await say(phone, text('ok'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION, '"ok" is not the old stop-here button here');
  assert.equal(lastToHer(phone).body, ML.ageRetry);

  await say(phone, text('47'));
  const toHerNow = toHer(phone);
  assert.match(toHerNow[toHerNow.length - 2].body, /45 വയസ്സിന് മുകളിലുള്ള caregivers-ന് Pulso duty നൽകുന്നത് Basic നിരക്കിലാണ്/);
  assert.match(lastToHer(phone).body, /വയസ്: 47/);

  // Again, to 53: no second notice; the original "from" is kept.
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_AGE));
  sent.length = 0;
  await say(phone, text('53'));
  assert.equal(toHer(phone).length, 1, 'only the check, no repeated notice');
  assert.deepEqual(records.get(phone).detailsChanged, [{ field: 'age', from: 34, to: 53 }]);

  // Over 50: a call review, to both reviewers, with the change on it.
  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  const toSecond = sent.find((m) => m.to === SECOND && m.kind === 'buttons');
  assert.ok(toSecond, 'the second reviewer gets the call review');
  assert.match(toSecond.body, /^Age 53 — above 50/);
  assert.match(toSecond.body, /\nDetails checked by her ✓ · changed: age 34 → 53\n/);
  assert.equal(lastToHer(phone).body, ML.verificationPendingBasicAge);
});

test('age changed below 45 says nothing about rates', async () => {
  const phone = await atCheck({ age: 47 });
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_AGE));
  sent.length = 0;
  await say(phone, text('43'));
  assert.equal(toHer(phone).length, 1);
  assert.equal(lastToHer(phone).kind, 'buttons');
});

test('changing a field back to what it was leaves no change on record', () => {
  let changes = bot.recordDetailsChange([], 'district', 'Ernakulam', 'Kannur');
  changes = bot.recordDetailsChange(changes, 'district', 'Kannur', 'Thrissur');
  assert.deepEqual(changes, [{ field: 'district', from: 'Ernakulam', to: 'Thrissur' }]);
  changes = bot.recordDetailsChange(changes, 'district', 'Thrissur', 'Ernakulam');
  assert.deepEqual(changes, []);
  assert.deepEqual(bot.recordDetailsChange([], 'name', 'A', 'A'), []);
});

test('qualification to another certificate asks for that certificate, then back to the check', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_QUALIFICATION));
  assert.equal(lastToHer(phone).kind, 'list');
  await say(phone, row(BUTTON_IDS.QUALIFICATION_GNM, 'GNM'));
  let p = records.get(phone);
  assert.equal(p.qualification, 'gnm');
  assert.equal(p.status, STATUS.AWAITING_CERTIFICATE);
  assert.equal(p.detailsEditing, 'qualification');
  assert.match(lastToHer(phone).body, /GNM course certificate/);
  assert.deepEqual(p.documents.certificateAttachments, []);
  assert.equal(p.documents.previousCertificateAttachments.length, 1, 'the GDA file is kept on record');
  assert.equal(p.documents.previousCertificateAttachments[0].supersededQualification, 'gda');

  await say(phone, { id: 'img-gnm', ...image('media-gnm') });
  await say(phone, tap(BUTTON_IDS.CERTIFICATE_CONTINUE));
  p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION, 'back to the check, not to the name');
  assert.equal(p.detailsEditing, null);
  assert.ok(!toHer(phone).some((m) => m.body === FLOWS.kerala_malayalam.MESSAGES.nameQuestion));
  assert.match(lastToHer(phone).body, /യോഗ്യത: GNM/);
  assert.deepEqual(p.detailsChanged, [{ field: 'qualification', from: 'gda', to: 'gnm' }]);

  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  assert.match(reviewAlerts()[0].body, /Details checked by her ✓ · changed: qualification\n/);
  assert.deepEqual(records.get(phone).documents.certificateAttachments.map((a) => a.id), ['media-gnm']);
});

test('qualification to No certificate asks for nothing, gives the Basic notice, back to the check', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_QUALIFICATION));
  sent.length = 0;
  await say(phone, row(BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE));
  const p = records.get(phone);
  assert.equal(p.qualification, 'no_certificate');
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  const msgs = toHer(phone);
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].body, /Basic നിരക്കിലാണ്/);
  assert.match(msgs[0].body, /₹650/);
  assert.ok(!msgs.some((m) => /certificate-ന്റെ വ്യക്തമായ ഫോട്ടോ|ഫോട്ടോ അയയ്ക്കുക/.test(m.body || '')), 'no certificate asked for');
  assert.match(msgs[1].body, /യോഗ്യത: സർട്ടിഫിക്കറ്റ് ഇല്ല/);

  sent.length = 0;
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  assert.ok(sent.some((m) => m.to === SECOND), 'a call review, to the second reviewer too');
  assert.equal(lastToHer(phone).body, FLOWS.kerala_malayalam.MESSAGES.verificationPendingNoCertificate);
});

test('a typed "no" while changing the qualification is not a refusal', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_QUALIFICATION));
  await say(phone, text('no'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.equal(records.get(phone).qualification, 'gda');
  assert.equal(lastToHer(phone).kind, 'list');
});

test('a tap on Correct while a field is being re-asked is Correct, not the answer', async () => {
  const phone = await atCheck();
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_NAME));
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT, 'ശരിയാണ്'));
  const p = records.get(phone);
  assert.equal(p.fullName, 'Sindhu Sajeev');
  assert.equal(p.status, STATUS.VERIFICATION_PENDING);
});

// ---- English -------------------------------------------------------------------

test('English chat: the same check in English', async () => {
  const phone = await atCheck({ flowId: 'kerala_english', sex: 'Male', qualification: 'no_certificate' });
  const check = lastToHer(phone);
  assert.equal(
    check.body,
    '*Please check your details:*\n\nName: Sindhu Sajeev\nAge: 34\nMale or female: Male\nDistrict: Ernakulam\nQualification: No certificate'
  );
  assert.deepEqual(check.buttons.map((b) => b.title), ['Correct', 'Change']);
  await say(phone, tap(BUTTON_IDS.DETAILS_CHANGE));
  assert.deepEqual(lastToHer(phone).sections[0].rows.map((r) => r.title), ['Name', 'Age', 'Male or female', 'District', 'Qualification']);
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_AGE));
  assert.equal(lastToHer(phone).body, FLOWS.kerala_english.MESSAGES.ageQuestion);
  await say(phone, text('36'));
  assert.match(lastToHer(phone).body, /^\*Please check your details:\*/);
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  assert.equal(lastToHer(phone).body, FLOWS.kerala_english.MESSAGES.verificationPendingNoCertificate);
});

// ---- WhatsApp limits -----------------------------------------------------------

test('every flow fits WhatsApp: button ≤20, row ≤24, ≤10 rows, list button ≤20, body ≤1024', async () => {
  for (const id of Object.keys(FLOWS)) {
    await flow.runWithFlow(id, async () => {
      const buttons = bot.buildDetailsCheckButtons();
      assert.equal(buttons.length, 2);
      for (const b of buttons) assert.ok(b.title && utf16(b.title) <= 20, `${id} button: ${b.title}`);
      const list = bot.buildDetailsChangeList();
      assert.ok(utf16(list.buttonText) <= 20, `${id} list button: ${list.buttonText}`);
      assert.ok(utf16(list.sections[0].title) <= 24, `${id} section: ${list.sections[0].title}`);
      const rows = list.sections[0].rows;
      assert.equal(rows.length, 5);
      assert.ok(rows.length <= 10);
      for (const r of rows) {
        assert.ok(r.title && utf16(r.title) <= 24, `${id} row: ${r.title}`);
        assert.ok(utf16(r.id) <= 200);
      }
      const longest = bot.buildDetailsCheckBody({
        fullName: 'x'.repeat(200), age: 99, sex: 'Female', district: 'Thiruvananthapuram', qualification: 'nursing_student'
      }, FLOWS[id].MESSAGES.detailsCheckReminder);
      assert.ok(utf16(longest) <= 1024, `${id} body too long`);
    });
  }
});

// ---- certificate sent again ------------------------------------------------------

function reupload(extra) {
  seq += 1;
  const phone = `91900000${String(7000 + seq)}`;
  records.set(phone, {
    phone, region: 'kerala', flowId: 'kerala_malayalam', status: STATUS.AWAITING_CERTIFICATE, currentStep: 8,
    qualification: 'gda', age: 30, sex: 'Female', fullName: 'Anu', district: 'Kollam',
    documents: { certificateAttachments: [] }, verification: { status: 'rejected' }, history: [], ...extra
  });
  return phone;
}

test('certificate sent again, details checked before: straight to review', async () => {
  const phone = reupload({ detailsConfirmedAt: '2026-10-01T10:00:00.000Z', detailsChanged: [] });
  sent.length = 0;
  await say(phone, image('again-1'));
  await say(phone, tap(BUTTON_IDS.CERTIFICATE_CONTINUE));
  assert.equal(records.get(phone).status, STATUS.VERIFICATION_PENDING);
  assert.equal(reviewAlerts().length, 1);
  assert.match(reviewAlerts()[0].body, /Details checked by her ✓/);
  assert.equal(lastToHer(phone).body, FLOWS.kerala_malayalam.MESSAGES.verificationPending);
});

test('certificate sent again, details never checked: the check first', async () => {
  const phone = reupload({});
  sent.length = 0;
  await say(phone, image('again-2'));
  await say(phone, tap(BUTTON_IDS.CERTIFICATE_CONTINUE));
  assert.equal(records.get(phone).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.equal(reviewAlerts().length, 0);
  assert.match(lastToHer(phone).body, /ജില്ല: Kollam/);
  await say(phone, tap(BUTTON_IDS.DETAILS_CORRECT));
  assert.equal(reviewAlerts().length, 1);
});

test('finalizeCertificateCollection itself follows detailsConfirmedAt', async () => {
  const checked = reupload({ detailsConfirmedAt: '2026-10-01T10:00:00.000Z', documents: { certificateAttachments: [{ id: 'f1', cloudArchiveStatus: 'dry_run' }] } });
  const unchecked = reupload({ documents: { certificateAttachments: [{ id: 'f2', cloudArchiveStatus: 'dry_run' }] } });
  await flow.runWithFlow('kerala_malayalam', async () => {
    await bot.finalizeCertificateCollection(checked);
    await bot.finalizeCertificateCollection(unchecked);
  });
  assert.equal(records.get(checked).status, STATUS.VERIFICATION_PENDING);
  assert.equal(records.get(unchecked).status, STATUS.AWAITING_DETAILS_CONFIRMATION);
});

// ---- she never taps: reminder at 2 hours, review at 24 -------------------------------

const HOUR = 60 * 60 * 1000;
function waitingAtCheck(shownAgoMs, now, extra = {}) {
  seq += 1;
  const phone = `91900000${String(7000 + seq)}`;
  const shownAt = new Date(now - shownAgoMs).toISOString();
  records.set(phone, {
    phone, region: 'kerala', flowId: 'kerala_malayalam', status: STATUS.AWAITING_DETAILS_CONFIRMATION, currentStep: 13,
    qualification: 'gda', age: 30, sex: 'Female', fullName: 'Reshma', district: 'Kollam',
    detailsCheckShownAt: shownAt, detailsCheckFirstShownAt: shownAt, detailsChanged: [], detailsConfirmedAt: null,
    documents: { certificateAttachments: [{ id: `w-${seq}`, cloudArchiveStatus: 'dry_run' }] },
    verification: { status: 'not_started' },
    history: [{ at: shownAt, type: 'inbound_message', payload: {} }],
    ...extra
  });
  return phone;
}
const only = (phone) => [records.get(phone)];

test('under 2 hours: nothing', async () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  const phone = waitingAtCheck(1.5 * HOUR, now);
  sent.length = 0;
  const result = await bot.runDetailsCheckSweep({ now, providers: only(phone) });
  assert.equal(result.reminded, 0);
  assert.equal(toHer(phone).length, 0);
});

test('at 2 hours: one reminder with the check, and only one', async () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  const phone = waitingAtCheck(2 * HOUR + 1000, now);
  sent.length = 0;
  const first = await bot.runDetailsCheckSweep({ now, providers: only(phone) });
  assert.equal(first.reminded, 1);
  const reminder = lastToHer(phone);
  assert.equal(reminder.kind, 'buttons');
  assert.match(reminder.body, /^താങ്കളുടെ വിവരങ്ങൾ പരിശോധിച്ച് 'ശരിയാണ്' അമർത്തുക\.\n\n\*താങ്കൾ നൽകിയ വിവരങ്ങൾ ഒന്ന് പരിശോധിക്കുക:\*/);
  assert.deepEqual(reminder.buttons.map((b) => b.id), [BUTTON_IDS.DETAILS_CORRECT, BUTTON_IDS.DETAILS_CHANGE]);
  assert.ok(records.get(phone).detailsReminderSentAt);
  assert.ok(events(phone).includes('details_check_reminder_sent'));

  const second = await bot.runDetailsCheckSweep({ now: now + HOUR, providers: only(phone) });
  assert.equal(second.reminded, 0);
  assert.equal(toHer(phone).length, 1);
});

test('the English reminder is in English', async () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  const phone = waitingAtCheck(3 * HOUR, now, { flowId: 'kerala_english' });
  await bot.runDetailsCheckSweep({ now, providers: only(phone) });
  assert.match(lastToHer(phone).body, /^Please check your details and tap Correct\.\n\n\*Please check your details:\*/);
});

test('no reminder outside her 24-hour window', async () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  const phone = waitingAtCheck(3 * HOUR, now, { history: [{ at: new Date(now - 30 * HOUR).toISOString(), type: 'inbound_message' }] });
  sent.length = 0;
  const result = await bot.runDetailsCheckSweep({ now, providers: only(phone) });
  assert.equal(result.skippedOutsideWindow, 1);
  assert.equal(toHer(phone).length, 0);
});

test('at 24 hours: to review anyway, marked not checked, nothing sent to her', async () => {
  const now = Date.parse('2026-10-08T12:00:00.000Z');
  const phone = waitingAtCheck(24 * HOUR + 1000, now, { detailsReminderSentAt: new Date(now - 22 * HOUR).toISOString() });
  sent.length = 0;
  const result = await bot.runDetailsCheckSweep({ now, providers: only(phone) });
  assert.equal(result.sentForReview, 1);
  const p = records.get(phone);
  assert.equal(p.status, STATUS.VERIFICATION_PENDING);
  assert.equal(p.detailsNotChecked, true);
  assert.equal(p.detailsConfirmedAt, null);
  assert.equal(toHer(phone).length, 0, 'her window has closed: nothing to her');
  assert.equal(reviewAlerts().length, 1);
  assert.match(reviewAlerts()[0].body, /^New certificate uploaded for review\.\nDetails not checked by her\n/);
  assert.ok(events(phone).includes('details_check_timeout'));

  const again = await bot.runDetailsCheckSweep({ now: now + HOUR, providers: only(phone) });
  assert.equal(again.sentForReview, 0);
  assert.equal(reviewAlerts().length, 1);
});

test('the sweep finds its own candidates by status', async () => {
  const now = Date.now();
  const phone = waitingAtCheck(25 * HOUR, now, { history: [] });
  await bot.runDetailsCheckSweep({ now });
  assert.equal(records.get(phone).status, STATUS.VERIFICATION_PENDING);
});

// ---- the alert line ------------------------------------------------------------------

test('the alert line: checked, changed, not checked, or nothing for older records', () => {
  assert.equal(ops.detailsCheckLine({}), null);
  assert.equal(ops.detailsCheckLine({ detailsConfirmedAt: 'x', detailsChanged: [] }), 'Details checked by her ✓');
  assert.equal(
    ops.detailsCheckLine({
      detailsConfirmedAt: 'x',
      detailsChanged: [
        { field: 'age', from: 43, to: 53 },
        { field: 'district', from: 'Kollam', to: 'Kannur' },
        { field: 'sex', from: 'Female', to: 'Male' },
        { field: 'name', from: 'A', to: 'B' },
        { field: 'qualification', from: 'gda', to: 'gnm' }
      ]
    }),
    'Details checked by her ✓ · changed: age 43 → 53, district, sex Female → Male, name, qualification'
  );
  assert.equal(ops.detailsCheckLine({ detailsNotChecked: true }), 'Details not checked by her');
});

test('the desk names the new status', () => {
  const fs = require('fs');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'assets', 'desk-ui.js'), 'utf8');
  assert.match(ui, /awaiting_details_confirmation: 'Checking her details'/);
});
