#!/usr/bin/env node
/**
 * Care partner support: a transcript-level dry run.
 *
 * The bot has no test runner, so this script stands in for one. It replaces the
 * Meta client, Firestore and the pulso-hub lookup with fakes, drives whole
 * conversations through processProviderSupportMessage, prints each transcript
 * and asserts the parts that must not regress.
 *
 *   node src/scripts/dryRunCarePartnerSupport.js
 *   node src/scripts/dryRunCarePartnerSupport.js --quiet
 */

const config = require('../config');

/* --------------------------------------------------------------- fakes --- */

const sent = [];

function recordOutbound(kind, to, payload) {
  sent.push({ kind, to, ...payload });
}

const metaClient = require('../services/metaClient');
metaClient.sendText = async (to, body) => recordOutbound('text', to, { body });
metaClient.sendButtons = async (to, body, buttons) => recordOutbound('buttons', to, { body, buttons });
metaClient.sendList = async (to, body, buttonText, sections) =>
  recordOutbound('list', to, { body, buttonText, sections });

function createFakeFirestore() {
  const docs = new Map();
  const subCollections = new Map();

  function docRef(collectionName, id) {
    const key = `${collectionName}/${id}`;
    return {
      get: async () => ({ exists: docs.has(key), data: () => docs.get(key) }),
      set: async (payload, options) => {
        const previous = options && options.merge ? docs.get(key) || {} : {};
        docs.set(key, { ...previous, ...payload });
      },
      collection: (subName) => ({
        add: async (value) => {
          const subKey = `${key}/${subName}`;
          subCollections.set(subKey, [...(subCollections.get(subKey) || []), value]);
        }
      })
    };
  }

  return {
    collection: (name) => ({ doc: (id) => docRef(name, id) }),
    _docs: docs,
    _events: subCollections
  };
}

let fakeDb = createFakeFirestore();
const storage = require('../services/storage');
storage.getFirestore = () => fakeDb;

let registeredProviders = new Set();
const providerService = require('../services/providerService');
providerService.getProvider = async (phone) =>
  registeredProviders.has(phone) ? { phone, status: 'completed' } : null;

let partnerLookup = { kind: 'unknown' };
let lookupCalls = 0;
const carePartnerService = require('../services/carePartnerService');
carePartnerService.resolveCarePartner = async () => {
  lookupCalls += 1;
  return { ...partnerLookup, checkedAt: new Date().toISOString() };
};

const alerts = [];
const notifications = require('../services/providerSupportNotifications');
notifications.notifyProviderSupportHelpRequested = async (session, reason) => {
  alerts.push({ audience: 'provider', reason, phone: session.phone });
};
notifications.notifyCarePartnerHelpRequested = async (session, reason) => {
  alerts.push({
    audience: 'care_partner',
    reason,
    phone: session.phone,
    agency: (session.partner && session.partner.name) || null
  });
};

config.partnerHelpEnabled = true;

// Required last: it destructures everything faked above.
const { processProviderSupportMessage } = require('../services/providerSupportFlow');

/* ------------------------------------------------------------- driving --- */

const quiet = process.argv.includes('--quiet');
let failures = 0;
let checks = 0;

function check(label, condition) {
  checks += 1;
  if (!condition) {
    failures += 1;
    console.error(`   FAIL  ${label}`);
    return;
  }
  if (!quiet) console.log(`   ok    ${label}`);
}

function textMessage(body) {
  return { id: `m${Date.now()}${Math.random()}`, type: 'text', text: { body } };
}

function buttonReply(id, title) {
  return {
    id: `m${Date.now()}${Math.random()}`,
    type: 'interactive',
    interactive: { button_reply: { id, title } }
  };
}

function listReply(id, title) {
  return {
    id: `m${Date.now()}${Math.random()}`,
    type: 'interactive',
    interactive: { list_reply: { id, title } }
  };
}

function describe(entry) {
  if (entry.kind === 'buttons') {
    return `${entry.body}\n      [${entry.buttons.map((b) => b.title).join('] [')}]`;
  }
  if (entry.kind === 'list') {
    const rows = entry.sections.flatMap((section) => section.rows.map((row) => row.title));
    return `${entry.body}\n      (${entry.buttonText}) ${rows.join(' | ')}`;
  }
  return entry.body;
}

async function scenario(title, steps) {
  fakeDb = createFakeFirestore();
  sent.length = 0;
  alerts.length = 0;
  lookupCalls = 0;

  console.log(`\n=== ${title}`);
  await steps({
    async say(phone, message) {
      const before = sent.length;
      await processProviderSupportMessage(phone, message);
      const replies = sent.slice(before);
      if (!quiet) {
        const inbound = message.text ? message.text.body : (message.interactive.button_reply || message.interactive.list_reply).title;
        console.log(`   > ${inbound}`);
        replies.forEach((reply) => console.log(`   < ${describe(reply)}`));
      }
      return replies;
    },
    session: async (phone) => fakeDb._docs.get(`providerSupportSessions/${phone}`)
  });
}

const PHONE = '919847012345';
const ACTIVE_PARTNER = {
  kind: 'partner',
  bureauId: 'bR7k2xQ',
  name: 'Sneha Home Care',
  status: 'active',
  role: 'owner',
  district: 'bengaluru',
  billingDay: 5,
  partnerPct: 50,
  gstRegistered: true
};

async function main() {
  await scenario('1. Caregiver: audience question, then the unchanged provider menu', async ({ say, session }) => {
    registeredProviders = new Set([PHONE]);
    const first = await say(PHONE, textMessage('hi'));
    check('first contact asks who they are', first[0].kind === 'buttons' && /who you are/.test(first[0].body));
    check('both audiences offered', first[0].buttons.length === 2);

    const afterAudience = await say(PHONE, buttonReply('ps_audience_provider', 'Caregiver / Nurse'));
    check('caregiver goes to the region question', /Provider Support/.test(afterAudience[0].body));

    const afterRegion = await say(PHONE, buttonReply('ps_region_kerala', 'Kerala'));
    check('provider menu is a list', afterRegion[0].kind === 'list');
    check('provider menu unchanged (6 rows)', afterRegion[0].sections[0].rows.length === 6);
    check('Kerala switched the session to Malayalam', (await session(PHONE)).language === 'ml');
  });

  await scenario('2. Verified partner: greeted by brand, lands on the partner menu', async ({ say, session }) => {
    partnerLookup = ACTIVE_PARTNER;
    await say(PHONE, textMessage('hello'));
    const afterAudience = await say(PHONE, buttonReply('ps_audience_partner', 'Home care agency'));
    check('greeted by brand name', /Sneha Home Care/.test(afterAudience[0].body));
    check('greeted as partner support', /Partner Support/.test(afterAudience[0].body));

    const afterRegion = await say(PHONE, buttonReply('ps_region_karnataka', 'Karnataka'));
    check('partner menu is a list', afterRegion[0].kind === 'list');
    check('partner menu has the four topics plus manager and escape hatch',
      afterRegion[0].sections[0].rows.length === 6);
    check('no provider wording reached the partner',
      !sent.some((entry) => /Provider Support|Duty availability/.test(entry.body || '')));
    check('the session is marked as a partner', (await session(PHONE)).audience === 'partner');
  });

  await scenario('3. Payout answered from the bureau record, then a human ticket', async ({ say }) => {
    partnerLookup = ACTIVE_PARTNER;
    await say(PHONE, textMessage('hi'));
    await say(PHONE, buttonReply('ps_audience_partner', 'Home care agency'));
    await say(PHONE, buttonReply('ps_region_karnataka', 'Karnataka'));

    const payout = await say(PHONE, listReply('pp_topic_payout', 'Payout & settlement'));
    check('settlement day comes from billingDay', /5th of each month/.test(payout[0].body));
    check('share comes from partnerPct', /50%/.test(payout[0].body));
    check('GST line reflects gstRegistered', /includes GST/.test(payout[0].body));

    await say(PHONE, buttonReply('pp_topic_talk', 'Talk to manager'));
    check('alert goes to the partner manager, not provider ops', alerts[0].audience === 'care_partner');
    check('alert carries the agency name', alerts[0].agency === 'Sneha Home Care');

    const second = await say(PHONE, buttonReply('pp_topic_talk', 'Talk to manager'));
    check('same reason inside 12h is held', /already been informed/.test(second[0].body));

    await say(PHONE, listReply('pp_topic_duty', 'Caregiver / duty issue'));
    check('a different reason is NOT blocked by that cooldown', alerts.length === 2);
    check('duty issue reported as its own reason', alerts[1].reason === 'partner_duty_issue');
  });

  await scenario('4. Unknown agency: pitched, with both escape hatches', async ({ say }) => {
    partnerLookup = { kind: 'unknown' };
    await say(PHONE, textMessage('hi'));
    const pitch = await say(PHONE, buttonReply('ps_audience_partner', 'Home care agency'));
    check('join link offered', /admin\.pulso\.co\.in\/join/.test(pitch[0].body));
    check('two escape hatches', pitch[0].buttons.length === 2);

    const back = await say(PHONE, buttonReply('pp_pitch_caregiver', 'I am a caregiver'));
    check('caregiver hatch reaches the provider region question', /Provider Support/.test(back[0].body));
  });

  await scenario('5. Unknown agency who says they are already a partner', async ({ say }) => {
    partnerLookup = { kind: 'unknown' };
    await say(PHONE, textMessage('hi'));
    await say(PHONE, buttonReply('ps_audience_partner', 'Home care agency'));
    await say(PHONE, buttonReply('pp_pitch_talk', 'Talk to support'));
    check('the lead reaches the partner manager', alerts[0].audience === 'care_partner');
    check('tagged as an unmatched partner', alerts[0].reason === 'partner_not_found');
  });

  await scenario('6. Prospect: held, and ops told once', async ({ say }) => {
    partnerLookup = { ...ACTIVE_PARTNER, kind: 'prospect', status: 'prospect', billingDay: 0, partnerPct: null };
    await say(PHONE, textMessage('hi'));
    await say(PHONE, buttonReply('ps_audience_partner', 'Home care agency'));
    const afterRegion = await say(PHONE, buttonReply('ps_region_kerala', 'Kerala'));
    check('told their account is still being set up', /set up/.test(afterRegion[0].body));
    check('partner team alerted without a duplicate reply', alerts.length === 1);
    check('still offered the partner menu', afterRegion[afterRegion.length - 1].kind === 'list');
  });

  await scenario('7. Hub lookup unreachable: pitched, never dead-ended', async ({ say }) => {
    partnerLookup = { kind: 'unknown', lookupFailed: true };
    await say(PHONE, textMessage('hi'));
    const pitch = await say(PHONE, buttonReply('ps_audience_partner', 'Home care agency'));
    check('a failed lookup still answers', pitch.length > 0);
    check('and still offers a way out', pitch[0].kind === 'buttons' && pitch[0].buttons.length === 2);
    check('a failed lookup is never cached as an answer', lookupCalls === 1);
  });

  await scenario('8. Existing provider session is never re-asked who they are', async ({ say }) => {
    registeredProviders = new Set([PHONE]);
    fakeDb._docs.set(`providerSupportSessions/${PHONE}`, {
      phone: PHONE,
      region: 'kerala',
      language: 'ml',
      status: 'main_menu'
    });
    const replies = await say(PHONE, textMessage('menu'));
    check('a legacy session goes straight to the provider menu', replies[0].kind === 'list');
    check('and it is the provider menu', replies[0].sections[0].title === 'Provider Support');
  });

  await scenario('9. Flag off: today\'s behaviour exactly', async ({ say }) => {
    config.partnerHelpEnabled = false;
    const first = await say(PHONE, textMessage('hi'));
    check('no audience question when the branch is off', /Provider Support/.test(first[0].body));
    config.partnerHelpEnabled = true;
  });

  await scenario('10. Provider branch still works end to end', async ({ say }) => {
    registeredProviders = new Set([PHONE]);
    await say(PHONE, textMessage('hi'));
    await say(PHONE, buttonReply('ps_audience_provider', 'Caregiver / Nurse'));
    await say(PHONE, buttonReply('ps_region_karnataka', 'Karnataka'));

    const dutyPrompt = await say(PHONE, listReply('ps_main_duty', 'Check Duty availability'));
    check('duty type is still asked', /duty type/i.test(dutyPrompt[0].body));

    const duty = await say(PHONE, buttonReply('ps_duty_8h', '8-hour duty'));
    check('duty answer still points at the Offer Inbox', /Offer Inbox/.test(duty[0].body));

    await say(PHONE, listReply('ps_main_app', 'App/Login/OTP'));
    await say(PHONE, listReply('ps_app_otp', 'OTP issue'));
    check('provider ticket still goes to provider ops', alerts[0].audience === 'provider');
    check('provider reason unchanged', alerts[0].reason === 'app_otp');
  });

  await scenario('11. Unregistered caregiver is still asked to register first', async ({ say }) => {
    registeredProviders = new Set();
    await say(PHONE, textMessage('hi'));
    await say(PHONE, buttonReply('ps_audience_provider', 'Caregiver / Nurse'));
    await say(PHONE, buttonReply('ps_region_karnataka', 'Karnataka'));
    const replies = await say(PHONE, listReply('ps_main_payment', 'Payment help'));
    check('registration gate intact', /not registered/i.test(replies[0].body));
  });

  await scenario('12. A partner who is really a caregiver can switch sides', async ({ say, session }) => {
    registeredProviders = new Set([PHONE]);
    partnerLookup = ACTIVE_PARTNER;
    await say(PHONE, textMessage('hi'));
    await say(PHONE, buttonReply('ps_audience_partner', 'Home care agency'));
    await say(PHONE, buttonReply('ps_region_kerala', 'Kerala'));
    const switched = await say(PHONE, listReply('pp_topic_caregiver', 'I am a caregiver'));
    check('lands on the provider menu', switched[0].sections[0].title === 'Provider Support');
    check('session is no longer a partner', (await session(PHONE)).audience === 'provider');
  });

  console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
