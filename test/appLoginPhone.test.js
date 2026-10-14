'use strict';
// App login number (founder, 14 Oct 2026): after the district she says which
// number she will log in to the Pulso app with; it shows in the details check,
// goes to the Pulso app, and every "same number as WhatsApp" line names it.
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
  const phone = `91900000${String(8000 + seq)}`;
  records.set(phone, {
    phone, region: 'kerala', flowId: 'kerala_malayalam', status: STATUS.AWAITING_DISTRICT, currentStep: 12,
    qualification: 'gda', age: 34, sex: 'Female', fullName: 'Sindhu Sajeev', interestConfirmed: true, dutyHourPreference: '24_hour',
    documents: { certificateAttachments: [{ id: `cert-${seq}`, type: 'image', cloudArchiveStatus: 'dry_run' }] },
    verification: { status: 'not_started' }, history: [], ...extra
  });
  return phone;
}
const say = (phone, message) => bot.processIncomingMessage(phone, message);
const tapB = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id } } });
const typed = (body) => ({ type: 'text', text: { body } });

test('after the district: the login-number question with two buttons', async () => {
  const phone = atDistrict();
  await say(phone, row('district_ernakulam', 'എറണാകുളം'));
  const p = records.get(phone);
  assert.equal(p.status, STATUS.AWAITING_LOGIN_PHONE);
  assert.equal(p.district, 'Ernakulam');
  const q = lastToHer(phone);
  assert.equal(q.kind, 'buttons');
  assert.equal(q.body, 'Pulso app-ൽ login ചെയ്യാൻ ഏത് mobile number ആണ് ഉപയോഗിക്കുക?\nLogin ചെയ്യുമ്പോൾ OTP ഈ number-ലേക്ക് ആണ് വരുക.');
  assert.deepEqual(q.buttons.map((b) => b.title), ['ഈ WhatsApp number', 'വേറെ number']);
  assert.equal(reviewAlerts().length, 0);
});

test('"This WhatsApp number": saved as her own number, then the check', async () => {
  const phone = atDistrict();
  await say(phone, row('district_ernakulam', 'എറണാകുളം'));
  await say(phone, tapB(BUTTON_IDS.LOGIN_PHONE_SAME));
  const p = records.get(phone);
  assert.equal(p.appLoginPhone, phone);
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.match(lastToHer(phone).body, new RegExp(`App login number: \\+91 ${phone.slice(2, 7)} ${phone.slice(7)}$`));
});

test('"Another number": she types it; a wrong one is asked again', async () => {
  const phone = atDistrict();
  await say(phone, row('district_ernakulam', 'എറണാകുളം'));
  await say(phone, tapB(BUTTON_IDS.LOGIN_PHONE_OTHER));
  assert.equal(lastToHer(phone).body, 'ദയവായി 10 അക്ക mobile number type ചെയ്യുക.');
  await say(phone, typed('12345'));
  assert.equal(records.get(phone).status, STATUS.AWAITING_LOGIN_PHONE);
  assert.equal(lastToHer(phone).body, 'ദയവായി 10 അക്ക mobile number type ചെയ്യുക (ഉദാ: 9876543210).');
  await say(phone, typed('+91 98765 43210'));
  const p = records.get(phone);
  assert.equal(p.appLoginPhone, '919876543210');
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.match(lastToHer(phone).body, /App login number: \+91 98765 43210$/);
});

test('Change at the check can re-ask the login number', async () => {
  const phone = atDistrict();
  await say(phone, row('district_ernakulam', 'എറണാകുളം'));
  await say(phone, tapB(BUTTON_IDS.LOGIN_PHONE_SAME));
  await say(phone, tapB(BUTTON_IDS.DETAILS_CHANGE));
  await say(phone, row(BUTTON_IDS.DETAILS_EDIT_LOGIN_PHONE));
  assert.equal(records.get(phone).detailsEditing, 'loginPhone');
  assert.deepEqual(lastToHer(phone).buttons.map((b) => b.id), [BUTTON_IDS.LOGIN_PHONE_SAME, BUTTON_IDS.LOGIN_PHONE_OTHER]);
  await say(phone, tapB(BUTTON_IDS.LOGIN_PHONE_OTHER));
  await say(phone, typed('9447012345'));
  const p = records.get(phone);
  assert.equal(p.appLoginPhone, '919447012345');
  assert.equal(p.status, STATUS.AWAITING_DETAILS_CONFIRMATION);
  assert.equal(p.detailsEditing, null);
  assert.ok((p.detailsChanged || []).some((c) => c.field === 'loginPhone' && c.to === '919447012345'));
});

test('"താൽപര്യമില്ല" typed at the login-number question stops the chat', async () => {
  const phone = atDistrict();
  await say(phone, row('district_ernakulam', 'എറണാകുളം'));
  await say(phone, typed('താൽപര്യമില്ല'));
  assert.equal(records.get(phone).status, STATUS.NOT_INTERESTED_RESTARTABLE);
});

test('"same number as WhatsApp" lines name her login number only when it differs', () => {
  const ml = 'Install ചെയ്ത ശേഷം WhatsApp onboarding-ൽ ഉപയോഗിച്ച അതേ phone number ഉപയോഗിച്ച് login ചെയ്യുക.';
  const en = 'Please install the app using the same phone number used for WhatsApp onboarding.';
  const other = { phone: '919000001111', appLoginPhone: '919876543210' };
  assert.equal(bot.withLoginNumber(ml, other), 'Install ചെയ്ത ശേഷം +91 98765 43210 എന്ന phone number ഉപയോഗിച്ച് login ചെയ്യുക.');
  assert.equal(bot.withLoginNumber(en, other), 'Please install the app using the phone number +91 98765 43210.');
  assert.equal(bot.withLoginNumber(ml, { phone: '919000001111', appLoginPhone: '919000001111' }), ml);
  assert.equal(bot.withLoginNumber(ml, { phone: '919000001111' }), ml);
});

test('the login number goes to the Pulso app; her WhatsApp number when none was given', () => {
  const { buildProviderSyncPayload } = require('../src/services/pulsoHubSyncService');
  assert.equal(buildProviderSyncPayload({ phone: '919000001111', appLoginPhone: '919876543210' }).appLoginPhone, '919876543210');
  assert.equal(buildProviderSyncPayload({ phone: '919000001111' }).appLoginPhone, '919000001111');
});

test('typed numbers: +91, 91, 0 and spaces accepted; short, long or 1-5 start refused', () => {
  const { parseIndianMobile } = require('../src/services/messageParser');
  const p = (body) => parseIndianMobile(typed(body));
  assert.equal(p('9876543210'), '919876543210');
  assert.equal(p('+91 98765 43210'), '919876543210');
  assert.equal(p('919876543210'), '919876543210');
  assert.equal(p('09876543210'), '919876543210');
  assert.equal(p('98765'), null);
  assert.equal(p('5876543210'), null);
  assert.equal(p('98765432101'), null);
  assert.equal(parseIndianMobile(tapB('login_phone_same')), null);
});

test('desk: App login number field, sent with Approve, Save route, list carries it', () => {
  const fs = require('fs');
  const root = path.join(__dirname, '..', 'src');
  const html = fs.readFileSync(path.join(root, 'public/admin/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'public/assets/dashboard.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const storage = fs.readFileSync(path.join(root, 'services/storage.js'), 'utf8');
  assert.match(html, /id="review-login-phone-input"/);
  assert.match(html, /id="save-login-phone-button"/);
  assert.match(js, /appLoginPhone \} : \{\}\)/);
  assert.match(js, /\/login-phone`/);
  assert.match(server, /app\.post\('\/admin\/providers\/:phone\/login-phone'/);
  assert.match(server, /deskLoginPhone\(req\.body && req\.body\.appLoginPhone\)/);
  assert.match(storage, /'appLoginPhone',/);
});
