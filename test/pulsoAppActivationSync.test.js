'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';
process.env.PULSO_APP_ACTIVATION_SWEEP_INTERVAL_MINUTES = '15';
process.env.PULSO_APP_ACTIVATION_RECHECK_HOURS = '6';
process.env.PULSO_APP_ACTIVATION_FRESH_DAYS = '7';
process.env.PULSO_APP_ACTIVATION_SWEEP_MAX_PER_SWEEP = '500';

/* Jomish Joseph completed onboarding on WhatsApp at 12:04, was sent the app
   link, signed straight into the app and was activated by the hub at 12:05:44
   — 76 seconds later — without ever tapping "installed" on WhatsApp. The bot's
   record still said pending_verification, and would have for ever, because the
   only thing that moved it was an admin's button.

   These pin the bridge: the hub's mirror document is read, a yes flips the
   bot record, and the sweep decides who gets asked about and how often —
   all without a network. */

/* ---- in-memory stand-ins for the two Firestores ------------------------- */

const providers = new Map();
const hubDocs = new Map(); // 'botOnboarding/918281183038' -> data
// A phone whose hub document read fails, standing in for a hub that is down.
const HUB_DOWN = '919000000404';

function stubModule(relPath, exportsObject) {
  const p = require.resolve(relPath);
  const m = new Module(p);
  m.filename = p;
  m.loaded = true;
  m.exports = exportsObject;
  require.cache[p] = m;
}

stubModule('../src/services/storage', {
  initializeStorage: async () => {},
  getFirestore: () => {
    throw new Error('real Firestore is not available in this test');
  },
  getStorageBucket: () => null,
  getProvider: async (phone) => (providers.has(phone) ? JSON.parse(JSON.stringify(providers.get(phone))) : null),
  saveProvider: async (phone, provider) => {
    providers.set(phone, JSON.parse(JSON.stringify(provider)));
    return provider;
  },
  listProviders: async () => [...providers.values()],
  listProviderSummaries: async () => [...providers.values()],
  listProviderTermsReminderCandidates: async () => [],
  listPendingVerificationNotificationProviders: async () => [],
  listReviewerWorkflowProviders: async () => [],
  listPendingAppActivationProviders: async () =>
    [...providers.values()].filter((p) =>
      ['pending_verification', 'link_sent', 'help_requested', 'later_selected', 'required', 'manual_registration'].includes(
        p.pulsoAppActivationStatus
      )
    ),
  PENDING_APP_ACTIVATION_STATUSES: [],
  saveWhatsappMessageStatus: async () => null
});

const hubFirestore = {
  collection: (name) => ({
    doc: (id) => ({
      get: async () => {
        const key = `${name}/${id}`;
        if (key === `botOnboarding/${HUB_DOWN}`) {
          throw new Error('hub unavailable');
        }
        const data = hubDocs.get(key);
        return { exists: Boolean(data), data: () => data };
      }
    })
  })
};
stubModule('../src/services/hubStorage', {
  getHubFirestore: () => hubFirestore,
  getHubApp: () => null
});

const { getHubAppActivation } = require('../src/services/hubAppActivationService');
const metaClient = require('../src/services/metaClient');
const flow = require('../src/services/onboardingFlow');
const sweep = require('../src/services/pulsoAppActivationSweep');

const JOMISH = '918281183038';
const UID = '2u02dwleyYYpoBbRZ8rdYFjgWFg1';
const ACTIVATED_AT = '2026-09-28T06:35:44.962Z';

function seedProvider(phone, overrides = {}) {
  providers.set(phone, {
    phone,
    fullName: 'JOMISH JOSEPH',
    status: 'completed',
    termsAccepted: true,
    region: 'kerala',
    flowId: 'kerala_english',
    pulsoAppRequired: true,
    pulsoAppActivationStatus: 'pending_verification',
    pulsoAppLinkSentAt: '2026-09-28T06:34:28.000Z',
    history: [],
    documents: {},
    verification: {},
    updatedAt: '2026-09-28T06:34:28.000Z',
    ...overrides
  });
}

function seedHubActivated(phone, uid = UID) {
  hubDocs.set(`botOnboarding/${phone}`, {
    normalizedPhone: phone,
    status: 'completed',
    appProviderUid: uid,
    sync: { matchStatus: 'activated', matchedUserId: uid, role: 'caregiver' }
  });
  hubDocs.set(`users/${uid}`, { role: 'caregiver', status: 'active', activatedFromBotAt: ACTIVATED_AT });
}

function reset() {
  providers.clear();
  hubDocs.clear();
}

/* ---- reading the hub ------------------------------------------------------ */

test('an activated mirror reads as activated, with the uid and the moment the hub did it', async () => {
  reset();
  seedHubActivated(JOMISH);
  const hub = await getHubAppActivation(JOMISH);
  assert.deepEqual(hub, {
    ok: true,
    found: true,
    activated: true,
    matchStatus: 'activated',
    uid: UID,
    activatedAt: ACTIVATED_AT
  });
});

test('the phone is looked up by digits, however it was written', async () => {
  reset();
  seedHubActivated(JOMISH);
  assert.equal((await getHubAppActivation('+91 82811 83038')).activated, true);
});

// The hub refuses to match a user who has not chosen a role yet; that is the
// state a phone sits in between "opened the app" and "chose caregiver".
test('a mirror still waiting for the app sign-up is not activated', async () => {
  reset();
  hubDocs.set(`botOnboarding/${JOMISH}`, { status: 'completed', sync: { matchStatus: 'waiting_for_app_signup' } });
  const hub = await getHubAppActivation(JOMISH);
  assert.equal(hub.found, true);
  assert.equal(hub.activated, false);
  assert.equal(hub.matchStatus, 'waiting_for_app_signup');
  assert.equal(hub.uid, null);
});

test('no mirror at all is a clean "not found", not an error', async () => {
  reset();
  const hub = await getHubAppActivation('919000000000');
  assert.equal(hub.ok, true);
  assert.equal(hub.found, false);
  assert.equal(hub.activated, false);
});

test('activated without a uid is not trusted as activated', async () => {
  reset();
  hubDocs.set(`botOnboarding/${JOMISH}`, { status: 'completed', sync: { matchStatus: 'activated' } });
  assert.equal((await getHubAppActivation(JOMISH)).activated, false);
});

/* ---- flipping the bot record ---------------------------------------------- */

test("Jomish's case: hub says activated, the bot record flips to verified and says so", async () => {
  reset();
  seedProvider(JOMISH, {
    history: [{ at: new Date().toISOString(), type: 'inbound_message', payload: { type: 'text', text: { body: 'Yes, I accept' } } }]
  });
  seedHubActivated(JOMISH);

  const { replies, result } = await metaClient.runCollected(() =>
    flow.syncPulsoAppActivationFromHub(JOMISH, { source: 'sweep', notify: 'window' })
  );

  assert.equal(result.result, 'verified');
  assert.equal(result.notified, true);
  assert.equal(result.uid, UID);
  const after = providers.get(JOMISH);
  assert.equal(after.pulsoAppActivationStatus, 'verified');
  assert.equal(after.pulsoAppActivationVerifiedBy, flow.PULSO_APP_HUB_SYNC_ACTOR);
  assert.equal(after.pulsoAppHubUid, UID);
  assert.equal(after.pulsoAppHubActivatedAt, ACTIVATED_AT);
  assert.equal(after.mobileAppCampaignStatus, 'app_verified');
  assert.ok(after.history.some((h) => h.event === 'pulso_app_activation_verified' && h.hubUid === UID));
  assert.ok(after.history.some((h) => h.event === 'pulso_app_activation_synced_from_hub' && h.source === 'sweep'));
  assert.equal(replies.length, 1);
  assert.match(replies[0].text.body, /Pulso app profile is active/);
});

// Free-form text only reaches someone within 24 hours of their last WhatsApp
// message. Past that the send would fail loudly and help nobody; the record
// still flips, quietly.
test('outside the 24-hour reply window the record flips but nothing is sent', async () => {
  reset();
  seedProvider(JOMISH, {
    history: [{ at: '2026-09-20T06:00:00.000Z', type: 'inbound_message', payload: { type: 'text', text: { body: 'Hi' } } }]
  });
  seedHubActivated(JOMISH);

  const { replies, result } = await metaClient.runCollected(() =>
    flow.syncPulsoAppActivationFromHub(JOMISH, { source: 'sweep', notify: 'window' })
  );

  assert.equal(result.result, 'verified');
  assert.equal(result.notified, false);
  assert.equal(providers.get(JOMISH).pulsoAppActivationStatus, 'verified');
  assert.equal(replies.length, 0);
  assert.ok(providers.get(JOMISH).history.some((h) => h.event === 'pulso_app_activation_verified' && h.notified === false));
});

test('a message that came through the app does not open the WhatsApp window', () => {
  const provider = {
    history: [
      { at: '2026-09-20T06:00:00.000Z', type: 'inbound_message', payload: {} },
      { at: new Date().toISOString(), type: 'inbound_message', channel: 'app', payload: {} }
    ]
  };
  assert.equal(flow.lastWhatsappInboundAt(provider), '2026-09-20T06:00:00.000Z');
  assert.equal(flow.isWithinWhatsappReplyWindow(provider), false);
});

test('the "installed" tap itself asks to be told, window or not', async () => {
  reset();
  seedProvider(JOMISH, { history: [] });
  seedHubActivated(JOMISH);

  const { replies, result } = await metaClient.runCollected(() =>
    flow.syncPulsoAppActivationFromHub(JOMISH, { source: 'installed_tap', notify: true })
  );
  assert.equal(result.result, 'verified');
  assert.equal(result.notified, true);
  assert.equal(replies.length, 1);
});

test('not activated yet: only the check is recorded, nothing is sent, status is untouched', async () => {
  reset();
  seedProvider(JOMISH);
  hubDocs.set(`botOnboarding/${JOMISH}`, { status: 'completed', sync: { matchStatus: 'waiting_for_app_signup' } });

  const { replies, result } = await metaClient.runCollected(() => flow.syncPulsoAppActivationFromHub(JOMISH));

  assert.equal(result.result, 'not_activated');
  assert.equal(replies.length, 0);
  const after = providers.get(JOMISH);
  assert.equal(after.pulsoAppActivationStatus, 'pending_verification');
  assert.equal(after.pulsoAppHubMatchStatus, 'waiting_for_app_signup');
  assert.ok(after.pulsoAppHubCheckedAt);
});

test('no mirror yet is recorded as not_mirrored so the desk can tell the two apart', async () => {
  reset();
  seedProvider(JOMISH);
  const result = await flow.syncPulsoAppActivationFromHub(JOMISH);
  assert.equal(result.result, 'not_mirrored');
  assert.equal(providers.get(JOMISH).pulsoAppHubMatchStatus, 'not_mirrored');
});

test('already verified is left alone and the hub is not even asked', async () => {
  reset();
  seedProvider(JOMISH, { pulsoAppActivationStatus: 'verified', pulsoAppHubUid: UID });
  const result = await flow.syncPulsoAppActivationFromHub(JOMISH);
  assert.equal(result.result, 'already_verified');
  assert.equal(result.uid, UID);
  assert.equal(providers.get(JOMISH).pulsoAppHubCheckedAt, undefined);
});

// This runs inside a WhatsApp turn and inside a sweep of hundreds; a hub that
// is down must be a line in the log, never a crashed turn.
test('a hub that cannot be reached is recorded on the provider, not thrown', async () => {
  reset();
  seedProvider(HUB_DOWN);
  const result = await flow.syncPulsoAppActivationFromHub(HUB_DOWN);
  assert.equal(result.result, 'hub_error');
  assert.equal(providers.get(HUB_DOWN).pulsoAppHubCheckError, 'hub unavailable');
  assert.equal(providers.get(HUB_DOWN).pulsoAppActivationStatus, 'pending_verification');
});

test('an unknown phone is reported, not thrown', async () => {
  reset();
  assert.deepEqual(await flow.syncPulsoAppActivationFromHub('919999999999'), { phone: '919999999999', result: 'not_found' });
});

/* ---- who the sweep asks about, and when --------------------------------- */

const NOW = Date.parse('2026-09-28T09:00:00.000Z');
const minutesAgo = (m) => new Date(NOW - m * 60 * 1000).toISOString();
const hoursAgo = (h) => minutesAgo(h * 60);
const daysAgo = (d) => hoursAgo(d * 24);

test('never checked is always due', () => {
  assert.equal(sweep.isDue({ pulsoAppActivationStatus: 'link_sent' }, NOW), true);
  assert.equal(sweep.isDue({ pulsoAppActivationStatus: 'pending_verification' }, NOW), true);
});

test('someone who tapped "installed" this week is asked about every sweep', () => {
  const fresh = {
    pulsoAppActivationStatus: 'pending_verification',
    pulsoAppInstalledConfirmedAt: daysAgo(2),
    pulsoAppHubCheckedAt: minutesAgo(16)
  };
  assert.equal(sweep.isFresh(fresh, NOW), true);
  assert.equal(sweep.isDue(fresh, NOW), true);
  assert.equal(sweep.isDue({ ...fresh, pulsoAppHubCheckedAt: minutesAgo(5) }, NOW), false);
});

test('everyone else waits six hours between asks', () => {
  const stale = {
    pulsoAppActivationStatus: 'pending_verification',
    pulsoAppInstalledConfirmedAt: daysAgo(30),
    pulsoAppHubCheckedAt: hoursAgo(5)
  };
  assert.equal(sweep.isFresh(stale, NOW), false);
  assert.equal(sweep.isDue(stale, NOW), false);
  assert.equal(sweep.isDue({ ...stale, pulsoAppHubCheckedAt: hoursAgo(7) }, NOW), true);

  const linkOnly = { pulsoAppActivationStatus: 'link_sent', pulsoAppHubCheckedAt: hoursAgo(1) };
  assert.equal(sweep.isDue(linkOnly, NOW), false);
});

test('a backlog drains never-checked first, then the longest-unchecked', () => {
  const due = sweep.pickDue(
    [
      { phone: 'a', pulsoAppActivationStatus: 'link_sent', pulsoAppHubCheckedAt: hoursAgo(8) },
      { phone: 'b', pulsoAppActivationStatus: 'link_sent' },
      { phone: 'c', pulsoAppActivationStatus: 'link_sent', pulsoAppHubCheckedAt: hoursAgo(20) },
      { phone: 'd', pulsoAppActivationStatus: 'link_sent', pulsoAppHubCheckedAt: hoursAgo(1) }
    ],
    NOW
  );
  assert.deepEqual(due.map((p) => p.phone), ['b', 'c', 'a']);
});

test('the sweep asks about the pending, flips the activated, and counts what it did', async () => {
  reset();
  seedProvider(JOMISH, {
    history: [{ at: new Date().toISOString(), type: 'inbound_message', payload: { type: 'text', text: { body: 'ok' } } }]
  });
  seedHubActivated(JOMISH);
  seedProvider('919111111111', { pulsoAppActivationStatus: 'link_sent', history: [] });
  hubDocs.set('botOnboarding/919111111111', { status: 'completed', sync: { matchStatus: 'waiting_for_app_signup' } });
  seedProvider('919222222222', { pulsoAppActivationStatus: 'help_requested', history: [] });
  seedProvider('919333333333', { pulsoAppActivationStatus: 'verified', history: [] });
  seedProvider(HUB_DOWN, { pulsoAppActivationStatus: 'pending_verification', history: [] });

  const { replies, result } = await metaClient.runCollected(() => sweep.runPulsoAppActivationSweep());

  assert.equal(result.candidates, 4);
  assert.equal(result.checked, 4);
  assert.equal(result.verified, 1);
  assert.equal(result.notified, 1);
  assert.equal(result.notActivated, 1);
  assert.equal(result.notMirrored, 1);
  assert.equal(result.errors, 1);
  assert.equal(replies.length, 1);
  assert.equal(providers.get(JOMISH).pulsoAppActivationStatus, 'verified');
  assert.equal(providers.get('919111111111').pulsoAppActivationStatus, 'link_sent');
  assert.equal(providers.get('919333333333').pulsoAppHubCheckedAt, undefined);
});

test('a second run straight after finds nothing due', async () => {
  const result = await sweep.runPulsoAppActivationSweep();
  // Jomish is verified now; the other three were checked seconds ago.
  assert.equal(result.candidates, 3);
  assert.equal(result.checked, 0);
});
