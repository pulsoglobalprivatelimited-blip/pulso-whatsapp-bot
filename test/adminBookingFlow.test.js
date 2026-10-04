'use strict';
// Admin booking bot (docs/admin_booking_bot_plan.md, founder, 4 Oct 2026):
// the chat, step by step, against a fake Pulso Hub and an in-memory draft
// store. Nothing here reaches WhatsApp, Firestore or Pulso Hub.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WHATSAPP_DRY_RUN = 'true';
process.env.ADMIN_BOOKING_BOT_PHONES = '8714105666,9446600809,7736108778';

const flowModule = require('../src/services/adminBookingFlow');
const { createAdminBookingFlow, memoryDraftStore, LIMITS } = flowModule;

const ADMIN = '919446600809';
// Sunday 4 Oct 2026, 10:00 IST.
const NOW = Date.UTC(2026, 9, 4, 4, 30);

const AGENCIES = [
  { id: 'b1', name: 'Grace Home Nursing', district: 'ernakulam', status: 'active', mode: 'manpower', hasPhone: true },
  { id: 'b2', name: 'Carewell Manpower', district: 'kollam', status: 'pilot', mode: 'manpower', hasPhone: false }
];
const DISTRICTS = [
  'thiruvananthapuram', 'kollam', 'pathanamthitta', 'alappuzha', 'kottayam', 'idukki', 'ernakulam',
  'thrissur', 'palakkad', 'malappuram', 'kozhikode', 'wayanad', 'kannur', 'kasaragod'
].map((key) => ({ key, label: key[0].toUpperCase() + key.slice(1) }));

const RATES = {
  basic: { '8h': 650, '24h': 750 },
  gda: { '8h': 800, '24h': 700 },
  nurse: { '8h': 1200, '24h': 1400 }
};

function harness(overrides = {}) {
  const sent = [];
  const calls = [];
  let clock = NOW;

  function checkLimits(entry) {
    if (entry.kind === 'buttons') {
      assert.ok(entry.buttons.length >= 1 && entry.buttons.length <= LIMITS.buttons, `buttons: ${entry.buttons.length}`);
      for (const b of entry.buttons) assert.ok(b.title.length <= 20, `button title too long: "${b.title}"`);
      assert.ok(entry.body.length <= 1024, 'button body too long');
    }
    if (entry.kind === 'list') {
      assert.ok(entry.buttonText.length <= 20, `list button too long: "${entry.buttonText}"`);
      const rows = entry.sections.flatMap((s) => s.rows);
      assert.ok(rows.length >= 1 && rows.length <= 10, `list rows: ${rows.length}`);
      for (const r of rows) {
        assert.ok(r.title.length <= 24, `row title too long: "${r.title}"`);
        if (r.description) assert.ok(r.description.length <= 72, `row description too long: "${r.description}"`);
      }
      assert.ok(entry.body.length <= 1024, 'list body too long');
    }
    if (entry.kind === 'text') assert.ok(entry.body.length <= 4096);
  }
  const record = (entry) => {
    checkLimits(entry);
    sent.push(entry);
  };
  const send = {
    text: async (to, body) => record({ kind: 'text', to, body }),
    buttons: async (to, body, buttons) => record({ kind: 'buttons', to, body, buttons }),
    list: async (to, body, buttonText, sections) => record({ kind: 'list', to, body, buttonText, sections })
  };

  const handlers = {
    whoami: () => ({ ok: true, admin: { uid: 'u1', name: 'Anu' } }),
    listAgencies: (data) => ({
      ok: true,
      agencies: data.query ? AGENCIES.filter((a) => a.name.toLowerCase().includes(data.query.toLowerCase())) : AGENCIES
    }),
    listDistricts: () => ({ ok: true, districts: DISTRICTS }),
    createAgency: (data) => ({ ok: true, agency: { id: 'new1', name: data.name, district: data.district } }),
    setAgencyPhone: () => ({ ok: true }),
    ensureClient: (data) => ({ ok: true, familyId: `fam_${data.bureauId}`, name: 'Agency client', phone: '', city: 'Kochi' }),
    listPatients: () => ({
      ok: true,
      patients: [
        { memberId: 'm1', name: 'Patient 1', agencyLabel: 'Amma', gender: 'female', ageYears: 78 },
        { memberId: 'm2', name: 'Patient 2', agencyLabel: '', gender: 'male', ageYears: 0 }
      ],
      nextName: 'Patient 3'
    }),
    addPatient: () => ({ ok: true, memberId: 'm3', name: 'Patient 3' }),
    checkLocation: (data) =>
      data.lat > 20
        ? { ok: true, inServiceArea: false, addressSummary: 'Somewhere far' }
        : { ok: true, inServiceArea: true, addressSummary: 'Kakkanad, Ernakulam', city: 'Kochi', district: 'ernakulam', serviceCityKey: 'kochi' },
    rates: (data) => ({ ok: true, tier: data.tier, pay: RATES[data.tier][data.shift], agencyCharge: RATES[data.tier][data.shift] + 100, markup: 100 }),
    create: () => ({ ok: true, requestId: 'REQ123', adminUrl: 'https://admin.pulso.co.in/requests/REQ123' }),
    ...overrides
  };
  const hub = {
    call: async (phone, action, data) => {
      calls.push({ phone, action, data });
      const h = handlers[action];
      return h ? h(data || {}) : { ok: false, error: 'unknown_action', message: 'Unknown' };
    }
  };
  const store = memoryDraftStore();
  const flow = createAdminBookingFlow({ hub, store, send, now: () => clock });

  return {
    sent,
    calls,
    store,
    flow,
    handlers,
    advance: (ms) => {
      clock += ms;
    },
    async say(message, phone = ADMIN) {
      const before = sent.length;
      const handled = await flow.maybeHandle(phone, message);
      return { handled, replies: sent.slice(before) };
    },
    last: () => sent[sent.length - 1],
    callsOf: (action) => calls.filter((c) => c.action === action)
  };
}

const text = (body) => ({ type: 'text', text: { body } });
const btn = (id, title = id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const row = (id, title = id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const pin = (latitude, longitude, name, address) => ({ type: 'location', location: { latitude, longitude, name, address } });

/** Agency b1, Patient 1 (F, 78), up to the weight question. */
async function toWeight(h) {
  await h.say(text('booking'));
  await h.say(row('ab_ag_b1'));
  await h.say(row('ab_pt_m1'));
}

/** From the weight question to the tier question, with every detail "No". */
async function detailsToLocation(h, { stoma = false } = {}) {
  await h.say(text('62'));
  await h.say(btn('ab_yes')); // bedridden
  await h.say(btn('ab_no')); // ryles
  await h.say(btn('ab_yes')); // catheter
  await h.say(btn(stoma ? 'ab_yes' : 'ab_no')); // stoma
  await h.say(btn('ab_no')); // trach
  await h.say(btn('ab_svc_24h'));
  await h.say(btn('ab_g_female'));
  await h.say(btn('ab_date_2'));
  await h.say(text('10'));
}

test('the full happy path sends the exact create payload', async () => {
  const h = harness();
  let r = await h.say(text('Booking'));
  assert.equal(r.handled, true);
  assert.equal(h.callsOf('whoami').length, 1);
  assert.equal(h.calls[0].phone, ADMIN);
  assert.equal(r.replies[0].kind, 'list');
  assert.match(r.replies[0].body, /^New booking\. Which agency is it for\? Type part of a name to search\.$/);
  const rows = r.replies[0].sections[0].rows;
  assert.equal(rows[rows.length - 1].title, '+ New agency');

  r = await h.say(row('ab_ag_b1'));
  assert.deepEqual(h.callsOf('ensureClient')[0].data, { bureauId: 'b1' });
  assert.equal(
    r.replies[0].body,
    "Grace Home Nursing · manpower supply. The patient stays the agency's client; Pulso provides the caregiver."
  );
  assert.equal(r.replies[1].kind, 'list');
  assert.deepEqual(h.callsOf('listPatients')[0].data, { familyId: 'fam_b1' });
  const patientRows = r.replies[1].sections[0].rows;
  assert.equal(patientRows[0].title, 'Patient 1');
  assert.equal(patientRows[0].description, 'F · 78 yrs · "Amma"');
  assert.equal(patientRows[2].title, '+ New patient');

  r = await h.say(row('ab_pt_m1'));
  assert.equal(r.replies[0].body, 'Weight in kg?');
  r = await h.say(text('62 kg'));
  assert.equal(r.replies[0].body, 'Bedridden?');
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['Yes', 'No']);
  r = await h.say(btn('ab_yes'));
  assert.equal(r.replies[0].body, 'Feeding tube (Ryles)?');
  r = await h.say(btn('ab_no'));
  assert.equal(r.replies[0].body, 'Urine tube (catheter)?');
  r = await h.say(btn('ab_yes'));
  assert.equal(r.replies[0].body, 'Stoma?');
  r = await h.say(btn('ab_no'));
  assert.equal(r.replies[0].body, 'Tracheostomy?');
  r = await h.say(btn('ab_no'));
  // 78: no age reason.
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['8 hours a day', '24 hours a day']);
  r = await h.say(btn('ab_svc_24h'));
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['Any', 'Female', 'Male']);
  r = await h.say(btn('ab_g_female'));
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['Tomorrow, 5 Oct', 'Tuesday, 6 Oct', 'Another date']);
  r = await h.say(btn('ab_date_2'));
  assert.equal(r.replies[0].body, 'How many days? At least 5.');
  r = await h.say(text('10'));
  assert.equal(r.replies[0].body, 'Where is the care? Send the location pin: tap 📎, then Location, then Send.');
  r = await h.say(pin(10.0159, 76.3419, 'Kakkanad', 'Kakkanad, Kochi, Kerala'));
  assert.deepEqual(h.callsOf('checkLocation')[0].data, { lat: 10.0159, lng: 76.3419, name: 'Kakkanad', address: 'Kakkanad, Kochi, Kerala' });
  assert.equal(r.replies[0].body, 'Who should do this work?');
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['Basic', 'GDA and above', 'Nurse']);
  r = await h.say(btn('ab_tier_gda'));
  assert.deepEqual(h.callsOf('rates')[0].data, { tier: 'gda', shift: '24h', hasStoma: false, hasTracheostomy: false });
  assert.equal(r.replies[0].body, 'Suggested rates for GDA, per day\nCaregiver gets ₹700\nAgency is charged ₹800\nPulso keeps ₹100');
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['Keep', 'Change pay', 'Change agency']);
  r = await h.say(btn('ab_rates_keep'));
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['Push online', 'Assign manually']);
  r = await h.say(btn('ab_after_push'));
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['All caregivers', 'Nurses only']);
  r = await h.say(btn('ab_aud_all'));
  const summary = r.replies[0];
  assert.deepEqual(summary.buttons.map((b) => b.title), ['Create booking', 'Change something', 'Cancel']);
  for (const line of [
    'Agency: Grace Home Nursing',
    'Patient: Patient 1 · F · 78 · 62 kg · bedridden, catheter',
    'Service: 24 hours a day · female caregiver',
    'Dates: 6 Oct to 15 Oct · 10 days',
    'Location: Kakkanad, Ernakulam',
    'Who: GDA and above',
    'Agency charged: ₹800/day · ₹8,000',
    'Caregiver gets: ₹700/day · ₹7,000',
    'Pulso keeps: ₹100/day · ₹1,000',
    'Payment: agency pays week by week',
    'Then: push online to all caregivers'
  ]) {
    assert.ok(summary.body.split('\n').includes(line), `summary is missing "${line}"\n${summary.body}`);
  }

  r = await h.say(btn('ab_create'));
  const created = h.callsOf('create');
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].data, {
    bureauId: 'b1',
    familyId: 'fam_b1',
    memberId: 'm1',
    service: 'senior_care_24h',
    days: 10,
    desiredStartMillis: Date.UTC(2026, 9, 6, 2, 30), // 6 Oct, 8:00 IST
    caregiverGender: 'female',
    memberGender: 'female',
    memberAgeYears: 78,
    patientWeightKg: 62,
    isBedridden: true,
    hasRylesTube: false,
    hasCatheter: true,
    hasStoma: false,
    hasTracheostomy: false,
    addressLat: 10.0159,
    addressLng: 76.3419,
    addressSummary: 'Kakkanad, Ernakulam',
    city: 'Kochi',
    providerTier: 'gda',
    partnerProviderRate: 700,
    partnerCustomerRate: 800,
    offlinePostCreateAction: 'push_online',
    dispatchAudience: 'all'
  });
  assert.equal(
    r.replies[0].body,
    '✅ Booking created for Grace Home Nursing · Patient 1 · starts 6 Oct.\nOffers are going to caregivers now.\nhttps://admin.pulso.co.in/requests/REQ123\nType booking for another one.'
  );
  assert.equal(h.store.docs.size, 0, 'the draft is gone once the booking exists');
  // Back to the normal chat afterwards.
  r = await h.say(text('hello'));
  assert.equal(r.handled, false);
});

test('typing a name searches the agencies', async () => {
  const h = harness();
  await h.say(text('book'));
  const r = await h.say(text('care'));
  assert.deepEqual(h.callsOf('listAgencies')[1].data, { query: 'care' });
  assert.equal(r.replies[0].kind, 'list');
  assert.deepEqual(r.replies[0].sections[0].rows.map((x) => x.title), ['Carewell Manpower', '+ New agency']);
});

test('an agency with no phone: the owner number is asked and saved', async () => {
  const h = harness();
  await h.say(text('booking'));
  let r = await h.say(row('ab_ag_b2'));
  assert.equal(r.replies[0].body, "Carewell Manpower has no phone on file. Owner's WhatsApp number?");
  r = await h.say(text('12345'));
  assert.equal(h.callsOf('setAgencyPhone').length, 0);
  assert.match(r.replies[0].body, /at least 10 digits/);
  r = await h.say(text('98470 00000'));
  assert.deepEqual(h.callsOf('setAgencyPhone')[0].data, { bureauId: 'b2', phone: '919847000000' });
  assert.deepEqual(h.callsOf('ensureClient')[0].data, { bureauId: 'b2' });
  assert.match(r.replies[0].body, /^Carewell Manpower · manpower supply\./);
});

test('a new agency: name, owner number, district (paged), then createAgency', async () => {
  const h = harness();
  await h.say(text('booking'));
  let r = await h.say(row('ab_ag_new'));
  assert.equal(r.replies[0].body, "New agency. What is the agency's name?");
  r = await h.say(text('Sunrise Care'));
  assert.equal(r.replies[0].body, "Owner's WhatsApp number?");
  r = await h.say(text('+91 98470 12345'));
  assert.equal(r.replies[0].kind, 'list');
  let rows = r.replies[0].sections[0].rows;
  assert.equal(rows.length, 10);
  assert.equal(rows[9].title, 'More');
  r = await h.say(row('ab_dist_more'));
  rows = r.replies[0].sections[0].rows;
  assert.deepEqual(rows.map((x) => x.title), ['Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod']);
  r = await h.say(row('ab_dist_kasaragod'));
  assert.deepEqual(h.callsOf('createAgency')[0].data, { name: 'Sunrise Care', ownerPhone: '919847012345', district: 'kasaragod' });
  assert.deepEqual(h.callsOf('ensureClient')[0].data, { bureauId: 'new1' });
  assert.equal(r.replies[0].body, "Sunrise Care · manpower supply. The patient stays the agency's client; Pulso provides the caregiver.");
  assert.equal(r.replies[1].kind, 'list');
  // Back from the patient list returns to the agency list (the new agency is made already).
  r = await h.say(text('back'));
  assert.equal(r.replies[0].kind, 'list');
  assert.match(r.replies[0].body, /Which agency is it for\?/);
});

test('a new patient: age, then gender, then addPatient; under 45 asks a reason', async () => {
  const h = harness();
  await h.say(text('booking'));
  await h.say(row('ab_ag_b1'));
  let r = await h.say(row('ab_pt_new'));
  assert.equal(r.replies[0].body, "New patient: Patient 3. The agency can give a name in its app.\n\nPatient's age in years?");
  r = await h.say(text('17'));
  assert.match(r.replies[0].body, /18 to 110/);
  r = await h.say(text('40'));
  assert.equal(r.replies[0].body, "Patient's gender?");
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['Female', 'Male']);
  r = await h.say(btn('ab_g_male'));
  assert.deepEqual(h.callsOf('addPatient')[0].data, { familyId: 'fam_b1', gender: 'male', ageYears: 40 });
  assert.equal(r.replies[0].body, 'Weight in kg?');
  for (const m of [text('70'), btn('ab_no'), btn('ab_no'), btn('ab_no'), btn('ab_no')]) await h.say(m);
  r = await h.say(btn('ab_no'));
  assert.equal(r.replies[0].body, 'Age is under 45. Why is this booking allowed?');
  r = await h.say(text('ok'));
  assert.match(r.replies[0].body, /at least 5 characters/);
  r = await h.say(text('Stroke recovery, doctor advised'));
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['8 hours a day', '24 hours a day']);
  await h.say(btn('ab_svc_8h'));
  await h.say(btn('ab_g_any'));
  await h.say(btn('ab_date_1'));
  await h.say(text('5'));
  await h.say(pin(10.0, 76.3));
  await h.say(btn('ab_tier_basic'));
  await h.say(btn('ab_rates_keep'));
  await h.say(btn('ab_after_manual'));
  r = await h.say(btn('ab_create'));
  const payload = h.callsOf('create')[0].data;
  assert.equal(payload.memberId, 'm3');
  assert.equal(payload.memberGender, 'male');
  assert.equal(payload.memberAgeYears, 40);
  assert.equal(payload.ageOverrideReason, 'Stroke recovery, doctor advised');
  assert.equal(payload.service, 'senior_care_8h');
  assert.equal(payload.caregiverGender, 'any');
  assert.equal(payload.desiredStartMillis, Date.UTC(2026, 9, 5, 2, 30));
  assert.equal(payload.offlinePostCreateAction, 'manual_assign');
  assert.equal(payload.partnerProviderRate, 650);
  assert.equal(payload.partnerCustomerRate, 750);
  assert.match(r.replies[0].body, /Assign the caregiver in the admin panel\./);
});

test('an existing patient with no age on file is asked for it', async () => {
  const h = harness();
  await h.say(text('booking'));
  await h.say(row('ab_ag_b1'));
  const r = await h.say(row('ab_pt_m2'));
  assert.equal(r.replies[0].body, "Patient's age in years?");
  const r2 = await h.say(text('81'));
  assert.equal(r2.replies[0].body, 'Weight in kg?');
});

test('a stoma forces Nurse and skips the tier question', async () => {
  const h = harness();
  await toWeight(h);
  await h.say(text('62'));
  await h.say(btn('ab_no'));
  await h.say(btn('ab_no'));
  await h.say(btn('ab_no'));
  const r = await h.say(btn('ab_yes')); // stoma
  assert.equal(r.replies[0].body, 'This needs a nurse, so the tier is set to Nurse.');
  assert.equal(r.replies[1].body, 'Tracheostomy?');
  await h.say(btn('ab_no'));
  await h.say(btn('ab_svc_24h'));
  await h.say(btn('ab_g_female'));
  await h.say(btn('ab_date_2'));
  await h.say(text('10'));
  const after = await h.say(pin(10.0, 76.3));
  assert.ok(!h.sent.some((m) => m.body === 'Who should do this work?'), 'the tier question was asked');
  assert.deepEqual(h.callsOf('rates')[0].data, { tier: 'nurse', shift: '24h', hasStoma: true, hasTracheostomy: false });
  assert.match(after.replies[0].body, /^Suggested rates for Nurse, per day\nCaregiver gets ₹1,400\nAgency is charged ₹1,500/);
  await h.say(btn('ab_rates_keep'));
  await h.say(btn('ab_after_push'));
  const s = await h.say(btn('ab_aud_nurse'));
  assert.ok(s.replies[0].body.includes('Who: Nurse'));
  assert.ok(s.replies[0].body.includes('Then: push online to nurses only'));
  await h.say(btn('ab_create'));
  const payload = h.callsOf('create')[0].data;
  assert.equal(payload.providerTier, 'nurse');
  assert.equal(payload.hasStoma, true);
  assert.equal(payload.dispatchAudience, 'nurse');
});

test('rates: change pay moves the agency charge; an agency charge under the pay is refused, then accepted', async () => {
  const h = harness();
  await toWeight(h);
  await detailsToLocation(h);
  await h.say(pin(10.0, 76.3));
  await h.say(btn('ab_tier_gda'));

  let r = await h.say(btn('ab_rates_pay'));
  assert.equal(r.replies[0].body, "Caregiver's pay per day? At least ₹500.");
  r = await h.say(text('400'));
  assert.match(r.replies[0].body, /can't be under ₹500/);
  r = await h.say(text('₹750'));
  assert.equal(r.replies[0].body, 'Rates for GDA, per day\nCaregiver gets ₹750\nAgency is charged ₹850\nPulso keeps ₹100 · ₹1,000 for 10 days');

  r = await h.say(btn('ab_rates_agency'));
  assert.equal(r.replies[0].body, "What is the agency charged per day? At least ₹750, the caregiver's pay.");
  r = await h.say(text('700'));
  assert.equal(r.replies[0].body, "₹700 is under the caregiver's pay (₹750). Pulso would pay the difference. Type ₹750 or more.");
  r = await h.say(text('900'));
  assert.equal(r.replies[0].body, 'Rates for GDA, per day\nCaregiver gets ₹750\nAgency is charged ₹900\nPulso keeps ₹150 · ₹1,500 for 10 days');

  // The agency charge was typed, so a new pay leaves it alone.
  r = await h.say(btn('ab_rates_pay'));
  r = await h.say(text('800'));
  assert.match(r.replies[0].body, /Caregiver gets ₹800\nAgency is charged ₹900\nPulso keeps ₹100 · ₹1,000 for 10 days/);
  assert.ok(!h.sent.some((m) => /reason/i.test(m.body)), 'a reason was asked for rates');

  await h.say(btn('ab_rates_keep'));
  await h.say(btn('ab_after_manual'));
  r = await h.say(btn('ab_create'));
  const payload = h.callsOf('create')[0].data;
  assert.equal(payload.partnerProviderRate, 800);
  assert.equal(payload.partnerCustomerRate, 900);
});

test('location: text is not a pin, and an out-of-area pin is refused', async () => {
  const h = harness();
  await toWeight(h);
  await detailsToLocation(h);
  let r = await h.say(text('Kakkanad, near the church'));
  assert.equal(h.callsOf('checkLocation').length, 0);
  assert.equal(r.replies[0].body, 'Where is the care? Send the location pin: tap 📎, then Location, then Send.');
  r = await h.say(pin(28.6, 77.2, 'Delhi'));
  assert.equal(r.replies[0].body, 'We do not serve this location yet. Send another pin.');
  r = await h.say(pin(10.0, 76.3));
  assert.equal(r.replies[0].body, 'Who should do this work?');
});

test('another date: typed dates, past dates and far dates', async () => {
  const h = harness();
  await toWeight(h);
  for (const m of [text('62'), btn('ab_no'), btn('ab_no'), btn('ab_no'), btn('ab_no'), btn('ab_no'), btn('ab_svc_24h'), btn('ab_g_any')]) await h.say(m);
  let r = await h.say(btn('ab_date_other'));
  assert.equal(r.replies[0].body, 'Type the start date, like 15-10-2026 or 15 Oct.');
  r = await h.say(text('4 Oct 2026'));
  assert.match(r.replies[0].body, /after today/);
  r = await h.say(text('01-01-2028'));
  assert.match(r.replies[0].body, /more than a year/);
  r = await h.say(text('31-02-2026'));
  assert.match(r.replies[0].body, /could not read/);
  r = await h.say(text('15 Oct'));
  assert.equal(r.replies[0].body, 'How many days? At least 5.');
  r = await h.say(text('4'));
  assert.match(r.replies[0].body, /5 to 90/);
  await h.say(text('20'));
  await h.say(pin(10.0, 76.3));
  await h.say(btn('ab_tier_gda'));
  await h.say(btn('ab_rates_keep'));
  await h.say(btn('ab_after_manual'));
  await h.say(btn('ab_create'));
  assert.equal(h.callsOf('create')[0].data.desiredStartMillis, Date.UTC(2026, 9, 15, 2, 30));
});

test('unknown input at a button step repeats the question', async () => {
  const h = harness();
  await toWeight(h);
  await h.say(text('62'));
  const r = await h.say(text('maybe'));
  assert.equal(r.replies.length, 1);
  assert.equal(r.replies[0].body, 'Bedridden?');
});

test('back goes one step back; cancel drops the draft', async () => {
  const h = harness();
  await toWeight(h);
  await h.say(text('62'));
  let r = await h.say(text('back'));
  assert.equal(r.replies[0].body, 'Weight in kg?');
  r = await h.say(text('Back'));
  assert.equal(r.replies[0].kind, 'list');
  assert.deepEqual(r.replies[0].sections[0].rows.map((x) => x.title), ['Patient 1', 'Patient 2', '+ New patient']);
  r = await h.say(row('ab_pt_m1'));
  assert.equal(r.replies[0].body, 'Weight in kg?');

  r = await h.say(text('cancel'));
  assert.equal(r.replies[0].body, 'Booking cancelled. Type booking to start again.');
  assert.equal(h.store.docs.size, 0);
  r = await h.say(text('62'));
  assert.equal(r.handled, false, 'after cancel the chat is the normal one');
});

test('change something reopens one field and comes back to the summary', async () => {
  const h = harness();
  await toWeight(h);
  await detailsToLocation(h);
  await h.say(pin(10.0, 76.3));
  await h.say(btn('ab_tier_gda'));
  await h.say(btn('ab_rates_keep'));
  await h.say(btn('ab_after_manual'));
  let r = await h.say(btn('ab_change'));
  assert.equal(r.replies[0].kind, 'list');
  assert.equal(r.replies[0].sections[0].rows.length, 10);
  r = await h.say(row('ab_chg_days'));
  assert.equal(r.replies[0].body, 'How many days? At least 5.');
  r = await h.say(text('12'));
  assert.ok(r.replies[0].body.includes('Dates: 6 Oct to 17 Oct · 12 days'));
  assert.ok(r.replies[0].body.includes('Agency charged: ₹800/day · ₹9,600'));

  r = await h.say(btn('ab_change'));
  r = await h.say(row('ab_chg_service'));
  assert.deepEqual(r.replies[0].buttons.map((b) => b.title), ['8 hours a day', '24 hours a day']);
  r = await h.say(btn('ab_svc_8h'));
  // The shift changed, so the rates are fetched again and shown.
  assert.match(r.replies[0].body, /^Suggested rates for GDA, per day\nCaregiver gets ₹800/);
  r = await h.say(btn('ab_rates_keep'));
  assert.ok(r.replies[0].body.includes('Service: 8 hours a day · female caregiver'));
});

test('a refusal from create shows the reason and reopens that step', async () => {
  const h = harness({
    create: () => ({ ok: false, error: 'overlapping_booking', message: 'Patient 1 already has a booking from 6 Oct.' })
  });
  await toWeight(h);
  await detailsToLocation(h);
  await h.say(pin(10.0, 76.3));
  await h.say(btn('ab_tier_gda'));
  await h.say(btn('ab_rates_keep'));
  await h.say(btn('ab_after_manual'));
  let r = await h.say(btn('ab_create'));
  assert.equal(r.replies[0].body, 'Patient 1 already has a booking from 6 Oct.');
  assert.deepEqual(r.replies[1].buttons.map((b) => b.title), ['Tomorrow, 5 Oct', 'Tuesday, 6 Oct', 'Another date']);
  h.handlers.create = () => ({ ok: true, requestId: 'REQ9' });
  r = await h.say(text('20 Oct'));
  assert.ok(r.replies[0].body.includes('Dates: 20 Oct to 29 Oct · 10 days'));
  r = await h.say(btn('ab_create'));
  assert.match(r.replies[0].body, /starts 20 Oct\.\nAssign the caregiver in the admin panel\.\nType booking for another one\.$/);
});

test('an unrecognised refusal goes back to the summary', async () => {
  const h = harness({ create: () => ({ ok: false, error: 'internal', message: 'Something broke.' }) });
  await toWeight(h);
  await detailsToLocation(h);
  await h.say(pin(10.0, 76.3));
  await h.say(btn('ab_tier_gda'));
  await h.say(btn('ab_rates_keep'));
  await h.say(btn('ab_after_manual'));
  const r = await h.say(btn('ab_create'));
  assert.equal(r.replies[0].body, 'Something broke.');
  assert.deepEqual(r.replies[1].buttons.map((b) => b.title), ['Create booking', 'Change something', 'Cancel']);
});

test('a draft older than 24 hours is treated as none', async () => {
  const h = harness();
  await toWeight(h);
  h.advance(23 * 60 * 60 * 1000);
  let r = await h.say(text('62'));
  assert.equal(r.handled, true);
  assert.equal(r.replies[0].body, 'Bedridden?');
  h.advance(24 * 60 * 60 * 1000 + 1000);
  r = await h.say(btn('ab_no'));
  assert.equal(r.handled, false);
  assert.equal(h.store.docs.size, 0);
});

test('a number Pulso Hub does not know as an admin is refused and left in the normal chat', async () => {
  const h = harness({ whoami: () => ({ ok: false, error: 'not_admin', message: 'Not an admin' }) });
  let r = await h.say(text('booking'));
  assert.equal(r.handled, true);
  assert.equal(r.replies[0].body, "This number can't make bookings. Ask the owner to add it as an admin.");
  assert.equal(h.store.docs.size, 0);
  r = await h.say(text('hello'));
  assert.equal(r.handled, false);
});

test('whoami in the endpoint\'s flat shape { uid, name, viaPhone } is accepted; no uid is refused', async () => {
  const h = harness({ whoami: () => ({ ok: true, uid: 'u9', name: 'Anu', viaPhone: '919446600809' }) });
  let r = await h.say(text('booking'));
  assert.match(r.replies[0].body, /^New booking\./);
  assert.deepEqual(h.store.docs.get(ADMIN).admin, { uid: 'u9', name: 'Anu', viaPhone: '919446600809' });
  const h2 = harness({ whoami: () => ({ ok: true, name: 'Nobody' }) });
  r = await h2.say(text('booking'));
  assert.equal(r.replies[0].body, "This number can't make bookings. Ask the owner to add it as an admin.");
});

test('only listed admins, and only on the start word or a draft', async () => {
  const h = harness();
  let r = await h.say(text('booking'), '919000000001');
  assert.equal(r.handled, false);
  assert.equal(h.calls.length, 0);
  r = await h.say(text('hello'), '918714105666');
  assert.equal(r.handled, false);
  assert.equal(h.calls.length, 0);
  r = await h.say(text('BOOKING'), '918714105666');
  assert.equal(r.handled, true);
});
