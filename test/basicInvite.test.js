'use strict';
// The Basic Caregiver invite (7 Oct 2026): the two template buttons, the review
// alert line, and who the send script picks. No Firestore, no WhatsApp.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const OWNER = '919446600809';
process.env.WHATSAPP_DRY_RUN = 'true';
process.env.OWNER_NOTIFICATION_PHONE = OWNER;
process.env.AGENT_HELP_WHATSAPP_NUMBER = OWNER;
process.env.NO_CERTIFICATE_REVIEWER_PHONE = '+91 62383 78859';
process.env.PUBLIC_BASE_URL = 'https://whatsapp.pulso.co.in';
process.env.SESSION_SECRET = 'test-secret';

// ---- fakes -----------------------------------------------------------------
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
stub('metaClient', {
  sendText: async (to, body) => { sent.push({ to, kind: 'text', body }); return { messages: [{ id: 'w' }] }; },
  sendButtons: async (to, body, buttons) => { sent.push({ to, kind: 'buttons', body, buttons }); return { messages: [{ id: 'w' }] }; },
  sendList: async (to, body) => { sent.push({ to, kind: 'list', body }); return { messages: [{ id: 'w' }] }; },
  sendTemplate: async (to, name, lang, components) => { sent.push({ to, kind: 'template', name, components }); return { messages: [{ id: 'w' }] }; },
  isAppMediaId: () => false
});
stub('providerService', {
  getProvider: async (phone) => records.get(phone) || null,
  getOrCreateProvider: async (phone) => records.get(phone) || null,
  updateProvider: async (phone, patch) => { records.set(phone, deepMerge(records.get(phone), patch)); return records.get(phone); },
  appendHistory: async (phone, event) => {
    const r = records.get(phone) || { phone };
    records.set(phone, { ...r, history: [...(r.history || []), { at: 'now', ...event }] });
    return records.get(phone);
  },
  listReviewerWorkflowProviders: async () => [...records.values()],
  listPendingVerificationNotificationProviders: async () => [...records.values()]
});
stub('providerTiersConfig', { getProviderTiers: async () => ({ basicTierAgeThreshold: 50 }) });

const ops = require('../src/services/opsNotifications');
const flow = require('../src/services/onboardingFlow');
const { STATUS, FLOWS, BUTTON_IDS } = require('../src/flow');
const invite = require('../src/scripts/sendBasicInvite');

let seq = 0;
const tapInvite = (payload, text = 'x') => ({ id: `wamid.${++seq}`, type: 'button', button: { payload, text } });
const typed = (body) => ({ id: `wamid.${++seq}`, type: 'text', text: { body } });
const toHer = (phone) => sent.filter((m) => m.to === phone);
const events = (phone) => (records.get(phone).history || []).filter((e) => e.type === 'system').map((e) => e.event);
const ML = FLOWS.kerala_malayalam.MESSAGES;
const EN = FLOWS.kerala_english.MESSAGES;

function rejected(phone, extra = {}) {
  return {
    phone, region: 'kerala', flowId: 'kerala_malayalam', fullName: 'Test', age: 53, qualification: 'gnm',
    interestConfirmed: true, status: STATUS.AGE_REJECTED, currentStep: 10,
    verification: { status: 'rejected', notes: 'Reason: Age limit exceeded', reviewedBy: OWNER, reviewedAt: '2026-10-01' },
    history: [], ...extra
  };
}

// ---- Interested -------------------------------------------------------------

test('age group, Interested: rejection cleared and kept, age asked again, history', async () => {
  const phone = '919000000701';
  records.set(phone, rejected(phone, { basicInviteGroup: 'age', history: [{ type: 'system', event: 'basic_invite_sent', group: 'age' }] }));
  sent.length = 0;
  await flow.processIncomingMessage(phone, tapInvite('basic_invite_yes'));
  const r = records.get(phone);
  assert.equal(r.status, STATUS.AWAITING_AGE);
  assert.equal(r.currentStep, 3);
  assert.equal(r.age, null);
  assert.equal(r.qualification, 'gnm', 'her claim is kept; over 50 puts her on Basic');
  assert.equal(r.verification.status, 'not_started');
  assert.equal(r.verification.notes, '');
  assert.equal(r.verification.previousRejection.status, 'rejected');
  assert.match(r.verification.previousRejection.notes, /Age limit/);
  assert.ok(r.basicInviteAt);
  assert.ok(events(phone).includes('basic_invite_accepted'));
  assert.deepEqual(toHer(phone).map((m) => m.body), [ML.ageQuestion]);

  // Everything after is the ordinary chat: an age over 50 goes on to the rates
  // (Basic notice first), not to the old refusal and not straight to "sex".
  sent.length = 0;
  await flow.processIncomingMessage(phone, typed('53'));
  assert.equal(records.get(phone).age, 53);
  assert.equal(records.get(phone).status, STATUS.AWAITING_INTEREST);
});

test('nursing group, Interested: No certificate, and the same next message as picking it in the chat', async () => {
  // What the chat does after a tap on "No certificate".
  const chat = '919000000702';
  records.set(chat, { phone: chat, region: 'kerala', flowId: 'kerala_malayalam', status: STATUS.AWAITING_QUALIFICATION, currentStep: 2, verification: {}, history: [] });
  sent.length = 0;
  await flow.processIncomingMessage(chat, {
    id: `wamid.${++seq}`, type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: BUTTON_IDS.QUALIFICATION_NO_CERTIFICATE, title: 'x' } }
  });
  const chatReplies = toHer(chat).map((m) => m.body);
  const chatAfter = records.get(chat);

  const phone = '919000000703';
  records.set(phone, rejected(phone, {
    age: 30, status: STATUS.CERTIFICATE_REJECTED_PERMANENT, basicInviteGroup: 'nursing',
    verification: { status: 'rejected', notes: 'Reason: Nursing certificate not produced' }
  }));
  sent.length = 0;
  await flow.processIncomingMessage(phone, tapInvite('basic_invite_yes'));
  const r = records.get(phone);
  assert.equal(r.qualification, 'no_certificate');
  assert.equal(r.status, chatAfter.status);
  assert.equal(r.currentStep, chatAfter.currentStep);
  assert.deepEqual(toHer(phone).map((m) => m.body), chatReplies);
  assert.equal(r.verification.status, 'not_started');
  assert.equal(r.verification.previousRejection.notes, 'Reason: Nursing certificate not produced');
  assert.ok(events(phone).includes('basic_invite_accepted'));
});

test('no group on file: age_rejected is the age group, otherwise nursing', async () => {
  const a = '919000000704';
  records.set(a, rejected(a));
  await flow.processIncomingMessage(a, tapInvite('basic_invite_yes'));
  assert.equal(records.get(a).basicInviteGroup, 'age');
  assert.equal(records.get(a).qualification, 'gnm');

  const n = '919000000705';
  records.set(n, rejected(n, { status: STATUS.NEEDS_HUMAN_REVIEW, verification: { status: 'rejected', notes: 'not finished' } }));
  await flow.processIncomingMessage(n, tapInvite('basic_invite_yes'));
  assert.equal(records.get(n).basicInviteGroup, 'nursing');
  assert.equal(records.get(n).qualification, 'no_certificate');
});

// ---- No thanks ----------------------------------------------------------------

test('No thanks: declined, thanked in her language, status unchanged', async () => {
  const phone = '919000000706';
  records.set(phone, rejected(phone, { basicInviteGroup: 'age' }));
  sent.length = 0;
  await flow.processIncomingMessage(phone, tapInvite('basic_invite_no'));
  assert.equal(records.get(phone).status, STATUS.AGE_REJECTED);
  assert.equal(records.get(phone).verification.status, 'rejected');
  assert.ok(events(phone).includes('basic_invite_declined'));
  assert.deepEqual(toHer(phone).map((m) => m.body), ['ശരി, നന്ദി. ഇനി ഇതിനെക്കുറിച്ച് ഞങ്ങൾ message അയക്കില്ല.']);

  const en = '919000000707';
  records.set(en, rejected(en, { basicInviteGroup: 'nursing', flowId: 'kerala_english', status: STATUS.CERTIFICATE_REJECTED_PERMANENT }));
  sent.length = 0;
  await flow.processIncomingMessage(en, tapInvite('basic_invite_no'));
  assert.deepEqual(toHer(en).map((m) => m.body), ["Okay, thank you. We won't message you about this again."]);
  assert.equal(EN.basicInviteDeclined, "Okay, thank you. We won't message you about this again.");
  assert.equal(records.get(en).status, STATUS.CERTIFICATE_REJECTED_PERMANENT);
});

// ---- Twice, and never invited ---------------------------------------------------

test('a second Interested once she is moving again re-asks her step, no second reset', async () => {
  const phone = '919000000708';
  records.set(phone, rejected(phone, { basicInviteGroup: 'age' }));
  await flow.processIncomingMessage(phone, tapInvite('basic_invite_yes'));
  await flow.processIncomingMessage(phone, typed('52'));
  const before = records.get(phone);
  assert.equal(before.status, STATUS.AWAITING_INTEREST);
  sent.length = 0;
  await flow.processIncomingMessage(phone, tapInvite('basic_invite_yes'));
  const after = records.get(phone);
  assert.equal(after.status, STATUS.AWAITING_INTEREST);
  assert.equal(after.age, 52, 'age not wiped again');
  assert.equal(after.basicInviteAt, before.basicInviteAt);
  assert.equal(events(phone).filter((e) => e === 'basic_invite_accepted').length, 1);
  assert.equal(toHer(phone).length, 1);
  assert.equal(toHer(phone)[0].kind, 'buttons', 'the interest buttons again');
});

test('a tap from someone never invited, mid-chat, is left to the normal flow', async () => {
  const phone = '919000000709';
  records.set(phone, { phone, region: 'kerala', flowId: 'kerala_malayalam', status: STATUS.AWAITING_SEX, currentStep: 11, age: 30, qualification: 'gda', verification: {}, history: [] });
  sent.length = 0;
  await flow.processIncomingMessage(phone, tapInvite('basic_invite_yes', 'താൽപര്യമുണ്ട്'));
  const r = records.get(phone);
  assert.equal(r.status, STATUS.AWAITING_SEX);
  assert.equal(r.basicInviteAt, undefined);
  assert.ok(!events(phone).some((e) => e.startsWith('basic_invite')));
  assert.ok(!toHer(phone).some((m) => m.body === ML.ageQuestion));
});

// ---- the reviewer's alert -------------------------------------------------------

test('the call-review alert says she came back from the Basic invite', async () => {
  const p = { phone: '919000000710', fullName: 'Back Again', age: 30, district: 'Kannur', qualification: 'no_certificate', status: STATUS.VERIFICATION_PENDING, basicInviteAt: '2026-10-07T05:00:00Z' };
  assert.equal(ops.basicInviteLine(p), 'Came back from the Basic invite');
  assert.equal(ops.basicInviteLine({ ...p, basicInviteAt: null }), null);
  sent.length = 0;
  await ops.notifyCertificateUploaded(p, []);
  const alerts = sent.filter((m) => m.kind === 'buttons');
  assert.ok(alerts.length);
  for (const a of alerts) assert.match(a.body, /\nCame back from the Basic invite\n/);
  // And in the template's name value, which crosses the 24-hour window.
  assert.equal(ops.buildNoCertificateTemplateComponents(p)[0].parameters[0].text, 'Back Again (Basic invite)');
  assert.equal(ops.buildBasicAgeTemplateComponents({ ...p, age: 53, qualification: 'gnm' })[0].parameters[0].text, 'Back Again (Basic invite)');

  sent.length = 0;
  await ops.notifyCertificateUploaded({ ...p, basicInviteAt: null }, []);
  assert.ok(!sent.some((m) => /Basic invite/.test(m.body || '')));
});

// ---- the send script ------------------------------------------------------------

const CSV = [
  'reason,phone,name,age,district,qualification,rejected_on,rejected_by',
  '"Nursing certificate not produced","919100000001","A, B","27","Ernakulam","gnm","2026-09-30","reviewer"',
  '"Age above 50","919100000002","","55","","no_certificate","2026-10-03","bot"',
  '"Age above 50","919100000003","","56","","gda","2026-10-03","bot"',
  '"Age above 50","919100000004","","","","gda","2026-10-03","bot"',
  '"Age above 50","919100000002","","55","","no_certificate","2026-10-03","bot"',
  '"Something else","919100000005","","30","","gda","2026-10-03","bot"'
].join('\n');

test('the CSV: age 55 and under (blank kept), nursing, repeats and others left out', () => {
  const rows = invite.groupRows(invite.parseCsv(CSV));
  assert.deepEqual(rows.map((r) => [r.phone, r.group]), [
    ['919100000001', 'nursing'],
    ['919100000002', 'age'],
    ['919100000004', 'age']
  ]);
  assert.equal(rows[0].name, 'A, B');
});

test('selectRecipients skips the already sent, the declined, and anyone who moved on', () => {
  const c = (phone, group = 'age') => ({ phone, group });
  const out = invite.selectRecipients(
    [c('1'), c('2'), c('3'), c('4'), c('5', 'nursing'), c('6'), c('7', 'nursing')],
    {
      1: { status: 'age_rejected', history: [] },
      2: { status: 'age_rejected', history: [{ type: 'system', event: 'basic_invite_sent' }] },
      3: { status: 'needs_human_review', history: [{ type: 'system', event: 'basic_invite_declined' }] },
      4: { status: 'completed', history: [] },
      5: { status: 'awaiting_certificate', history: [] },
      7: { status: 'verification_pending', history: [] }
    }
  );
  assert.deepEqual(out.map((r) => r.skip), [null, 'already_sent', 'declined', 'status_completed', null, 'not_a_provider', 'status_verification_pending']);
  assert.equal(out[0].template, 'basic_invite_age_ml');
  assert.equal(out[4].template, 'basic_invite_nursing_ml');
  for (const s of ['age_rejected', 'needs_human_review', 'certificate_rejected_permanent', 'awaiting_certificate', 'additional_document_requested']) {
    assert.equal(invite.selectRecipients([c('9')], { 9: { status: s } })[0].skip, null, s);
  }
});

function fakeDeps(store) {
  const calls = { sends: [], history: [], updates: [], sleeps: [] };
  return {
    calls,
    deps: {
      getProvider: async (p) => store[p] || null,
      sendTemplate: async (...args) => { calls.sends.push(args); return { messages: [{ id: 'x' }] }; },
      appendHistory: async (p, e) => { calls.history.push([p, e]); },
      updateProvider: async (p, patch) => { calls.updates.push([p, patch]); },
      sleep: async (ms) => { calls.sleeps.push(ms); },
      log: () => {},
      phoneNumberId: 'PNID'
    }
  };
}

test('runSend is a dry run by default: nothing sent, nothing written', async () => {
  const { calls, deps } = fakeDeps({ a: { status: 'age_rejected' }, b: { status: 'completed' } });
  const { summary } = await invite.runSend([{ phone: 'a', group: 'age' }, { phone: 'b', group: 'age' }], deps);
  assert.equal(summary.mode, 'dry_run');
  assert.equal(summary.toSend, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(calls.sends.length + calls.history.length + calls.updates.length, 0);
});

test('runSend --send: the template with both payloads, from the bot number, 3 s apart, logged', async () => {
  const { calls, deps } = fakeDeps({ a: { status: 'age_rejected' }, b: { status: 'certificate_rejected_permanent' }, c: { status: 'completed' } });
  const { summary } = await invite.runSend(
    [{ phone: 'a', group: 'age' }, { phone: 'c', group: 'age' }, { phone: 'b', group: 'nursing' }],
    deps,
    { send: true }
  );
  assert.deepEqual([summary.sent, summary.skipped, summary.failed], [2, 1, 0]);
  assert.deepEqual(summary.byGroup, { age: 1, nursing: 1 });
  const [to, name, lang, components, options] = calls.sends[0];
  assert.deepEqual([to, name, lang, options], ['a', 'basic_invite_age_ml', 'ml', { phoneNumberId: 'PNID' }]);
  assert.deepEqual(components.map((x) => [x.type, x.sub_type, x.index, x.parameters[0].payload]), [
    ['button', 'quick_reply', '0', 'basic_invite_yes'],
    ['button', 'quick_reply', '1', 'basic_invite_no']
  ]);
  assert.equal(calls.sends[1][1], 'basic_invite_nursing_ml');
  assert.deepEqual(calls.sleeps, [3000]);
  assert.deepEqual(calls.history[1], ['b', { type: 'system', event: 'basic_invite_sent', group: 'nursing', template: 'basic_invite_nursing_ml' }]);
  assert.equal(calls.updates[0][1].basicInviteGroup, 'age');
  assert.ok(calls.updates[0][1].basicInviteSentAt);
});
