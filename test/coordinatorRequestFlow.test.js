'use strict';
// Care coordinator booking requests (docs/coordinator_booking_request_plan.md,
// founder, 6 Oct 2026): the coordinator's chat, the request, the reviewers'
// note and buttons, and the booking a reviewer makes from it. A fake Pulso Hub,
// in-memory stores, no WhatsApp.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WHATSAPP_DRY_RUN = 'true';

const adminBooking = require('../src/services/adminBookingFlow');
const coord = require('../src/services/coordinatorRequestFlow');

const SANJU = '917736108778'; // coordinator, reviewer and admin
const AFIQ = '916238378859'; // coordinator only
const REVIEWER_A = '919446600809';
const REVIEWER_B = '918714105666';
const NOT_ADMIN = '919000000001'; // a reviewer Pulso Hub has no admin login for
// Tuesday 6 Oct 2026, 10:00 IST.
const NOW = Date.UTC(2026, 9, 6, 4, 30);

const AGENCIES = [
  { id: 'b1', name: 'Grace Home Nursing', district: 'ernakulam', hasPhone: true },
  { id: 'b2', name: 'Empty Agency', district: 'kollam', hasPhone: true }
];
const DISTRICTS = ['thiruvananthapuram', 'kollam', 'alappuzha', 'kottayam', 'idukki', 'ernakulam', 'thrissur', 'palakkad', 'malappuram', 'kozhikode', 'wayanad', 'kannur']
  .map((key) => ({ key, label: key[0].toUpperCase() + key.slice(1) }));
const COORDINATOR_ACTIONS = new Set(['whoami', 'listAgencies', 'listDistricts', 'checkLocation', 'listAgencyPatients']);

function harness({ templateEnabled = false, reviewerPhones = [REVIEWER_A, REVIEWER_B, SANJU], overrides = {} } = {}) {
  const sent = [];
  const calls = [];
  let clock = NOW;

  function checkLimits(entry) {
    if (entry.kind === 'buttons') {
      assert.ok(entry.buttons.length >= 1 && entry.buttons.length <= 3, `buttons: ${entry.buttons.length}`);
      for (const b of entry.buttons) assert.ok(b.title.length <= 20, `button title too long: "${b.title}"`);
      assert.ok(entry.body.length <= 1024, 'button body too long');
    }
    if (entry.kind === 'list') {
      assert.ok(entry.buttonText.length <= 20);
      const rows = entry.sections.flatMap((s) => s.rows);
      assert.ok(rows.length >= 1 && rows.length <= 10, `list rows: ${rows.length}`);
      for (const r of rows) {
        assert.ok(r.title.length <= 24, `row title too long: "${r.title}"`);
        if (r.description) assert.ok(r.description.length <= 72);
      }
    }
  }
  const record = (entry) => {
    checkLimits(entry);
    sent.push(entry);
  };
  const send = {
    text: async (to, body) => record({ kind: 'text', to, body }),
    buttons: async (to, body, buttons) => record({ kind: 'buttons', to, body, buttons }),
    list: async (to, body, buttonText, sections) => record({ kind: 'list', to, body, buttonText, sections }),
    template: async (to, name, language, components) => record({ kind: 'template', to, name, language, components })
  };

  const handlers = {
    whoami: (data, phone) => {
      if (phone === AFIQ) return { ok: true, role: 'coordinator', coordinator: { name: 'Afiq', viaPhone: AFIQ } };
      if (phone === SANJU) return { ok: true, role: 'admin', admin: { uid: 'u-sanju', name: 'Sanju', viaPhone: SANJU } };
      if (phone === REVIEWER_A || phone === REVIEWER_B) return { ok: true, role: 'admin', admin: { uid: `u-${phone}`, name: 'Admin', viaPhone: '917777722222' } };
      return { ok: false, error: 'not-allowed', message: 'This number has no admin login in Pulso Hub.' };
    },
    listAgencies: (data) => ({
      ok: true,
      agencies: data.query ? AGENCIES.filter((a) => a.name.toLowerCase().includes(data.query.toLowerCase())) : AGENCIES
    }),
    listDistricts: () => ({ ok: true, districts: DISTRICTS }),
    listAgencyPatients: (data) =>
      data.bureauId === 'b1'
        ? {
            ok: true,
            familyId: 'fam_b1',
            patients: [
              { memberId: 'm1', name: 'Patient 1', agencyLabel: 'Amma', gender: 'female', ageYears: 78 },
              { memberId: 'm2', name: 'Patient 2', agencyLabel: '', gender: 'male', ageYears: 81 }
            ],
            nextName: 'Patient 3'
          }
        : { ok: true, familyId: '', patients: [], nextName: 'Patient 1' },
    checkLocation: (data) =>
      data.lat > 20
        ? { ok: true, inServiceArea: false }
        : { ok: true, inServiceArea: true, addressSummary: 'Kakkanad, Ernakulam', city: 'Kochi', district: 'ernakulam', serviceCityKey: 'kochi' },
    createAgency: (data) => ({ ok: true, agency: { id: 'new1', name: data.name, district: data.district } }),
    ensureClient: (data) => ({ ok: true, familyId: `fam_${data.bureauId}`, name: 'Agency client' }),
    listPatients: () => ({ ok: true, patients: [], nextName: 'Patient 1' }),
    addPatient: () => ({ ok: true, memberId: 'm3', name: 'Patient 3' }),
    setAgencyPhone: () => ({ ok: true }),
    rates: (data) => ({ ok: true, tier: data.tier, pay: 900, agencyCharge: 1000, markup: 100 }),
    create: () => ({ ok: true, requestId: 'REQ9', adminUrl: 'https://admin.pulso.co.in/requests/REQ9' }),
    ...overrides
  };
  const hub = {
    call: async (phone, action, data) => {
      calls.push({ phone, action, data });
      const coordinatorOnly = phone === AFIQ;
      if (coordinatorOnly && !COORDINATOR_ACTIONS.has(action)) return { ok: false, error: 'not-allowed', message: 'Not allowed.' };
      const h = handlers[action];
      return h ? h(data || {}, phone) : { ok: false, error: 'unknown_action', message: 'Unknown' };
    }
  };

  const now = () => clock;
  const adminStore = adminBooking.memoryDraftStore();
  const adminFlow = adminBooking.createAdminBookingFlow({
    hub,
    store: adminStore,
    send,
    now,
    adminPhones: [REVIEWER_A, REVIEWER_B, SANJU]
  });
  const requests = coord.memoryRequestStore();
  const chats = coord.memoryChatStore();
  const draftStore = adminBooking.memoryDraftStore();
  const flow = coord.createCoordinatorRequests({
    hub,
    requests,
    chats,
    draftStore,
    send,
    now,
    adminFlow,
    coordinatorPhones: [SANJU, AFIQ],
    reviewerPhones,
    adminPhones: [REVIEWER_A, REVIEWER_B, SANJU],
    templateEnabled
  });

  return {
    sent,
    calls,
    requests,
    chats,
    adminStore,
    draftStore,
    flow,
    advance: (ms) => {
      clock += ms;
    },
    /** One inbound message on the support number, routed as live. */
    async say(phone, message) {
      const before = sent.length;
      let handled = await flow.maybeHandlePriority(phone, message);
      if (!handled) handled = await flow.maybeHandleChats(phone, message);
      return { handled, replies: sent.slice(before) };
    },
    to: (phone) => sent.filter((m) => m.to === phone),
    lastTo: (phone) => sent.filter((m) => m.to === phone).slice(-1)[0],
    callsOf: (action) => calls.filter((c) => c.action === action)
  };
}

const text = (body) => ({ type: 'text', text: { body } });
const btn = (id, title = id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });
const row = (id, title = id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title } } });
const quick = (payload) => ({ type: 'button', button: { payload, text: payload } });
const pin = (latitude, longitude) => ({ type: 'location', location: { latitude, longitude } });

/** Afiq: agency b1, Patient 1 (F, 78), 58 kg, bedridden + catheter, 24 h,
    female caregiver, tomorrow, 10 days, Kakkanad, GDA and above. */
async function happyToSummary(h, phone = AFIQ) {
  await h.say(phone, text('Request'));
  await h.say(phone, row('cr_ag_b1'));
  await h.say(phone, row('cr_pt_m1'));
  await h.say(phone, text('58 kg'));
  await h.say(phone, btn('cr_yes')); // bedridden
  await h.say(phone, btn('cr_no')); // ryles
  await h.say(phone, btn('cr_yes')); // catheter
  await h.say(phone, btn('cr_no')); // stoma
  await h.say(phone, btn('cr_no')); // trach
  await h.say(phone, btn('cr_svc_24h'));
  await h.say(phone, btn('cr_g_female'));
  await h.say(phone, btn('cr_date_1'));
  await h.say(phone, text('10'));
  await h.say(phone, pin(10.01, 76.34));
  return h.say(phone, btn('cr_tier_gda'));
}

const NOTE_1001 = [
  'Booking request R-1001 from Afiq (care coordinator)',
  'Agency: Grace Home Nursing',
  'Patient: Patient 1 · "Amma" · F · 78 · 58 kg · bedridden · catheter',
  'Service: 24 hours · female caregiver',
  'Dates: 7 Oct to 16 Oct · 10 days',
  'Location: Kakkanad, Ernakulam https://maps.google.com/?q=10.01,76.34',
  'Who: GDA and above'
].join('\n');

test('coordinator happy path: no rates, no push/assign, no notes; Send for review saves R-1001 and notes all three reviewers', async () => {
  const h = harness();
  const first = await h.say(AFIQ, text('request'));
  assert.equal(first.handled, true);
  assert.match(first.replies[0].body, /^New booking request\. Which agency is it for\?/);
  const agencyRows = first.replies[0].sections[0].rows;
  assert.deepEqual(agencyRows.map((r) => r.title), ['Grace Home Nursing', 'Empty Agency', 'Not in the list']);

  const patients = await h.say(AFIQ, row('cr_ag_b1'));
  assert.deepEqual(h.callsOf('listAgencyPatients').map((c) => c.data), [{ bureauId: 'b1' }]);
  const rows = patients.replies[0].sections[0].rows;
  assert.deepEqual(rows.map((r) => r.title), ['Patient 1', 'Patient 2', 'New patient']);
  assert.equal(rows[0].description, 'F · 78 yrs · "Amma"');

  const summary = await happyToSummary(h);
  const last = summary.replies[summary.replies.length - 1];
  assert.equal(last.kind, 'buttons');
  assert.deepEqual(last.buttons.map((b) => b.title), ['Send for review', 'Change something', 'Cancel']);
  assert.match(last.body, /^Check the request\n\nAgency: Grace Home Nursing\nPatient: Patient 1/);
  assert.doesNotMatch(last.body, /₹|rate|Push|Then:/i);

  const everything = h.to(AFIQ).map((m) => m.body).join('\n');
  assert.doesNotMatch(everything, /₹|Suggested rates|Push online|Assign manually|After the booking|note/i);
  assert.ok(h.to(AFIQ).every((m) => !(m.buttons || []).some((b) => /Keep|Change pay|Push/.test(b.title))));

  const sentNow = await h.say(AFIQ, btn('cr_create'));
  assert.equal(sentNow.replies[0].to, AFIQ);
  assert.equal(sentNow.replies[0].body, "Sent for review as R-1001. You'll get the answer here.");
  assert.deepEqual(sentNow.replies[0].buttons, [{ id: 'coordreq_change_R-1001', title: 'Change something' }]);

  // Nothing was written to Pulso Hub from the coordinator's side.
  assert.deepEqual([...new Set(h.calls.filter((c) => c.phone === AFIQ).map((c) => c.action))].sort(), ['checkLocation', 'listAgencies', 'listAgencyPatients', 'whoami']);

  const doc = await h.requests.get('R-1001');
  assert.equal(doc.status, 'pending');
  assert.equal(doc.coordinatorPhone, AFIQ);
  assert.equal(doc.coordinatorName, 'Afiq');
  assert.deepEqual(doc.thread, []);
  assert.equal(doc.pendingAgency, undefined);
  assert.equal(doc.pendingPatient, undefined);
  assert.equal(doc.answers.agency.id, 'b1');
  assert.equal(doc.answers.patient.memberId, 'm1');
  assert.equal(doc.answers.weight, 58);
  assert.equal(doc.answers.tier, 'gda');
  assert.equal(doc.answers.startDate, '2026-10-07');
  assert.equal(doc.answers.rates, undefined);
  assert.equal(doc.answers.afterCreate, undefined);
  assert.ok(doc.createdAtMillis > 0);
  assert.equal(await h.draftStore.get(AFIQ), null, 'the draft is gone');

  for (const reviewer of [REVIEWER_A, REVIEWER_B, SANJU]) {
    const note = h.to(reviewer).find((m) => m.body && m.body.startsWith('Booking request R-1001'));
    assert.ok(note, `note to ${reviewer}`);
    assert.equal(note.body, NOTE_1001);
    assert.deepEqual(note.buttons, [
      { id: 'coordreq_book_R-1001', title: 'Book it' },
      { id: 'coordreq_ask_R-1001', title: 'Ask coordinator' },
      { id: 'coordreq_reject_R-1001', title: 'Reject' }
    ]);
  }
});

test('the coordinator can type to search agencies, go back, and cancel', async () => {
  const h = harness();
  await h.say(AFIQ, text('request'));
  const search = await h.say(AFIQ, text('grace'));
  assert.match(search.replies[0].body, /Agencies matching "grace"/);
  await h.say(AFIQ, row('cr_ag_b1'));
  const back = await h.say(AFIQ, text('back'));
  assert.match(back.replies[0].body, /Which agency is it for\?/);
  const cancel = await h.say(AFIQ, text('cancel'));
  assert.equal(cancel.replies[0].body, 'Request cancelled. Type request to start again.');
  assert.equal(h.requests.docs.size, 0);
});

test('out of area pin: "We do not serve this location yet. Send another pin."', async () => {
  const h = harness();
  await h.say(AFIQ, text('request'));
  await h.say(AFIQ, row('cr_ag_b1'));
  await h.say(AFIQ, row('cr_pt_m1'));
  for (const m of [text('58'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_svc_8h'), btn('cr_g_any'), btn('cr_date_2'), text('5')]) {
    await h.say(AFIQ, m);
  }
  const far = await h.say(AFIQ, pin(28.6, 77.2));
  assert.equal(far.replies[0].body, 'We do not serve this location yet. Send another pin.');
  const typed = await h.say(AFIQ, text('Kakkanad'));
  assert.match(typed.replies[0].body, /Send the location pin/);
});

test('pending agency path: name, owner number, district as text; then straight to a new patient; nothing created', async () => {
  const h = harness();
  await h.say(AFIQ, text('request'));
  const name = await h.say(AFIQ, row('cr_ag_new'));
  assert.equal(name.replies[0].body, "Agency not in the list. What is the agency's name?");
  await h.say(AFIQ, text('CarePlus Manpower'));
  const short = await h.say(AFIQ, text('98765'));
  assert.equal(short.replies[0].body, 'That needs at least 10 digits.');
  const district = await h.say(AFIQ, text('98765 43210'));
  assert.equal(district.replies[0].kind, 'list');
  // 12 districts: 9 and More, then the rest.
  assert.equal(district.replies[0].sections[0].rows.length, 10);
  const more = await h.say(AFIQ, row('cr_dist_more'));
  assert.deepEqual(more.replies[0].sections[0].rows.map((r) => r.title), ['Kozhikode', 'Wayanad', 'Kannur']);
  await h.say(AFIQ, text('back'));
  const age = await h.say(AFIQ, row('cr_dist_ernakulam'));
  assert.equal(age.replies[0].body, "New patient. Patient's age in years?");
  assert.equal(h.callsOf('listAgencyPatients').length, 0);
  assert.equal((await h.say(AFIQ, text('12'))).replies[0].body, 'Type the age in years, 18 to 110.');
  await h.say(AFIQ, text('40'));
  await h.say(AFIQ, btn('cr_g_female'));
  for (const m of [text('55'), btn('cr_no'), btn('cr_yes'), btn('cr_no'), btn('cr_no')]) await h.say(AFIQ, m);
  const nurse = await h.say(AFIQ, btn('cr_yes')); // tracheostomy
  assert.equal(nurse.replies[0].body, 'This needs a nurse, so the tier is set to Nurse.');
  assert.match(nurse.replies[1].body, /under 45/i);
  const short2 = await h.say(AFIQ, text('ok'));
  assert.equal(short2.replies[0].body, 'Please give a reason of at least 5 characters.');
  await h.say(AFIQ, text('Recovering from surgery'));
  await h.say(AFIQ, btn('cr_svc_24h'));
  await h.say(AFIQ, btn('cr_g_any'));
  await h.say(AFIQ, btn('cr_date_other'));
  await h.say(AFIQ, text('20 Oct'));
  await h.say(AFIQ, text('30'));
  const summary = await h.say(AFIQ, pin(10.01, 76.34));
  // Nurse is forced, so "Who should do this work?" is skipped.
  const s = summary.replies[0];
  assert.deepEqual(s.buttons.map((b) => b.title), ['Send for review', 'Change something', 'Cancel']);
  assert.match(s.body, /Agency: New: CarePlus Manpower · owner \+91 98765 43210 · Ernakulam/);
  assert.match(s.body, /Patient: New patient · F · 40 · 55 kg · Ryles tube · tracheostomy/);
  assert.match(s.body, /Under 45, because: Recovering from surgery/);
  assert.match(s.body, /Who: Nurse/);

  await h.say(AFIQ, btn('cr_create'));
  const doc = await h.requests.get('R-1001');
  assert.deepEqual(doc.pendingAgency, { name: 'CarePlus Manpower', ownerPhone: '919876543210', district: { key: 'ernakulam', label: 'Ernakulam' } });
  assert.deepEqual(doc.pendingPatient, { ageYears: 40, gender: 'female' });
  assert.equal(doc.answers.ageReason, 'Recovering from surgery');
  assert.equal(h.callsOf('createAgency').length + h.callsOf('addPatient').length + h.callsOf('ensureClient').length, 0);
});

test('pending patient path: an agency with no client record goes straight to a new patient', async () => {
  const h = harness();
  await h.say(AFIQ, text('request'));
  const age = await h.say(AFIQ, row('cr_ag_b2'));
  assert.deepEqual(h.callsOf('listAgencyPatients').map((c) => c.data), [{ bureauId: 'b2' }]);
  assert.equal(age.replies[0].body, "New patient. Patient's age in years?");
  // And "New patient" from a list goes to the same questions.
  await h.say(AFIQ, text('back'));
  await h.say(AFIQ, row('cr_ag_b1'));
  const fromList = await h.say(AFIQ, row('cr_pt_new'));
  assert.equal(fromList.replies[0].body, "New patient. Patient's age in years?");
  await h.say(AFIQ, text('82'));
  const g = await h.say(AFIQ, btn('cr_g_male'));
  assert.equal(g.replies[0].body, 'Weight in kg?');
  assert.equal(h.callsOf('addPatient').length, 0);
});

test('review note: template outside the 24-hour window when switched on, buttons inside it; payloads and limits', async () => {
  const h = harness({ templateEnabled: true });
  // REVIEWER_A wrote to the support number an hour ago; the others did not.
  await h.say(REVIEWER_A, text('hi'));
  h.advance(60 * 60 * 1000);
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  const a = h.to(REVIEWER_A).filter((m) => m.kind === 'buttons' || m.kind === 'template');
  assert.equal(a.length, 1);
  assert.equal(a[0].kind, 'buttons');
  for (const reviewer of [REVIEWER_B]) {
    const t = h.to(reviewer).find((m) => m.kind === 'template');
    assert.ok(t, `template to ${reviewer}`);
    assert.equal(t.name, 'coordinator_booking_review');
    assert.equal(t.language, 'en');
    const body = t.components[0];
    assert.deepEqual(body.parameters.map((p) => p.text), [
      'R-1001',
      'Afiq',
      'Grace Home Nursing',
      'Patient 1 · "Amma" · F · 78 · 58 kg · bedridden · catheter',
      '24 hours · female caregiver',
      '7 Oct to 16 Oct · 10 days',
      'Kakkanad, Ernakulam https://maps.google.com/?q=10.01,76.34',
      'GDA and above'
    ]);
    for (const p of body.parameters) assert.doesNotMatch(p.text, /\n/);
    assert.deepEqual(
      t.components.slice(1).map((c) => [c.sub_type, c.index, c.parameters[0].payload]),
      [['quick_reply', '0', 'coordreq_book_R-1001'], ['quick_reply', '1', 'coordreq_ask_R-1001'], ['quick_reply', '2', 'coordreq_reject_R-1001']]
    );
    assert.equal(h.to(reviewer).filter((m) => m.kind === 'buttons' && /^Booking request/.test(m.body)).length, 0);
  }
  const doc = await h.requests.get('R-1001');
  assert.deepEqual(doc.deliveries.map((x) => [x.to, x.via]), [[REVIEWER_A, 'buttons'], [REVIEWER_B, 'template'], [SANJU, 'template']]);
});

test('review note: template off and outside the window, the buttons are still tried and the delivery logged', async () => {
  const h = harness({ templateEnabled: false });
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  assert.equal(h.sent.filter((m) => m.kind === 'template').length, 0);
  const doc = await h.requests.get('R-1001');
  assert.deepEqual(doc.deliveries.map((x) => [x.via, x.inWindow]), [['buttons', false], ['buttons', false], ['buttons', false]]);
});

test('Book it: first tap wins; the reviewer lands on the rates step; create carries the request; coordinator told', async () => {
  const h = harness();
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));

  const book = await h.say(REVIEWER_A, btn('coordreq_book_R-1001'));
  assert.equal(book.handled, true);
  assert.equal((await h.requests.get('R-1001')).status, 'booking');
  assert.deepEqual(h.callsOf('ensureClient').map((c) => [c.phone, c.data.bureauId]), [[REVIEWER_A, 'b1']]);
  const rates = book.replies[book.replies.length - 1];
  assert.deepEqual(rates.buttons.map((b) => b.title), ['Keep', 'Change pay', 'Change agency']);
  assert.match(rates.body, /Suggested rates for GDA, per day\nCaregiver gets ₹900/);
  assert.deepEqual(h.callsOf('rates').map((c) => c.data), [{ tier: 'gda', shift: '24h', hasStoma: false, hasTracheostomy: false }]);

  // A second reviewer, by template quick reply this time.
  const second = await h.say(REVIEWER_B, quick('coordreq_book_R-1001'));
  assert.equal(second.replies[0].body, 'R-1001: already being booked by 9446600809 (since 10:00 am, 6 Oct).');
  assert.equal(h.callsOf('whoami').filter((c) => c.phone === REVIEWER_B).length, 0);

  await h.say(REVIEWER_A, btn('ab_rates_keep'));
  const summary = await h.say(REVIEWER_A, btn('ab_after_manual'));
  assert.deepEqual(summary.replies[0].buttons.map((b) => b.title), ['Create booking', 'Change something', 'Cancel']);
  h.advance(2 * 60 * 1000);
  const created = await h.say(REVIEWER_A, btn('ab_create'));
  const create = h.callsOf('create');
  assert.equal(create.length, 1);
  assert.equal(create[0].phone, REVIEWER_A);
  assert.equal(create[0].data.coordinatorRequestId, 'R-1001');
  assert.equal(create[0].data.coordinatorPhone, AFIQ);
  assert.equal(create[0].data.memberId, 'm1');
  assert.equal(create[0].data.familyId, 'fam_b1');
  assert.equal(create[0].data.partnerProviderRate, 900);
  assert.equal(create[0].data.isBedridden, true);
  assert.equal(create[0].data.hasCatheter, true);
  assert.match(created.replies[0].body, /^✅ Booking created for Grace Home Nursing · Patient 1 · starts 7 Oct\./);

  const doc = await h.requests.get('R-1001');
  assert.equal(doc.status, 'booked');
  assert.equal(doc.requestId, 'REQ9');
  assert.equal(doc.bookedBy, REVIEWER_A);
  assert.equal(h.lastTo(AFIQ).body, '✅ R-1001 booked for Grace Home Nursing, starts 7 Oct.');

  const late = await h.say(SANJU, btn('coordreq_book_R-1001'));
  assert.equal(late.replies[0].body, 'R-1001: already booked by 9446600809 at 10:02 am, 6 Oct.');
  const lateReject = await h.say(REVIEWER_B, btn('coordreq_reject_R-1001'));
  assert.match(lateReject.replies[0].body, /already booked/);
});

test('Book it with a pending agency and patient: Add and continue → createAgency, ensureClient, addPatient, then rates', async () => {
  const h = harness();
  await h.say(AFIQ, text('request'));
  await h.say(AFIQ, row('cr_ag_new'));
  await h.say(AFIQ, text('CarePlus Manpower'));
  await h.say(AFIQ, text('9876543210'));
  await h.say(AFIQ, row('cr_dist_ernakulam'));
  await h.say(AFIQ, text('78'));
  await h.say(AFIQ, btn('cr_g_female'));
  for (const m of [text('58'), btn('cr_yes'), btn('cr_no'), btn('cr_yes'), btn('cr_no'), btn('cr_no'), btn('cr_svc_24h'), btn('cr_g_female'), btn('cr_date_1'), text('10'), pin(10.01, 76.34), btn('cr_tier_basic'), btn('cr_create')]) {
    await h.say(AFIQ, m);
  }
  const note = h.to(REVIEWER_B).find((m) => /^Booking request R-1001/.test(m.body || ''));
  assert.match(note.body, /\nAgency: New: CarePlus Manpower · owner \+91 98765 43210 · Ernakulam\nPatient: New patient · F · 78 · 58 kg · bedridden · catheter\n/);

  const ask = await h.say(REVIEWER_B, btn('coordreq_book_R-1001'));
  assert.equal(ask.replies[0].body, 'R-1001: Add CarePlus Manpower (owner 9876543210, Ernakulam) as a new manpower agency?');
  assert.deepEqual(ask.replies[0].buttons.map((b) => [b.id, b.title]), [['coordreq_addag_R-1001', 'Add and continue'], ['coordreq_drop_R-1001', 'Cancel']]);
  assert.equal(h.callsOf('createAgency').length, 0);

  const go = await h.say(REVIEWER_B, btn('coordreq_addag_R-1001'));
  const order = h.calls.filter((c) => c.phone === REVIEWER_B).map((c) => c.action);
  assert.deepEqual(order, ['whoami', 'createAgency', 'ensureClient', 'addPatient', 'rates']);
  assert.deepEqual(h.callsOf('createAgency')[0].data, { name: 'CarePlus Manpower', ownerPhone: '919876543210', district: 'ernakulam' });
  assert.deepEqual(h.callsOf('addPatient')[0].data, { familyId: 'fam_new1', gender: 'female', ageYears: 78 });
  const rates = go.replies[go.replies.length - 1];
  assert.deepEqual(rates.buttons.map((b) => b.title), ['Keep', 'Change pay', 'Change agency']);
  assert.match(rates.body, /Suggested rates for Basic/);

  await h.say(REVIEWER_B, btn('ab_rates_keep'));
  await h.say(REVIEWER_B, btn('ab_after_push'));
  await h.say(REVIEWER_B, btn('ab_aud_all'));
  await h.say(REVIEWER_B, btn('ab_create'));
  const create = h.callsOf('create')[0].data;
  assert.equal(create.bureauId, 'new1');
  assert.equal(create.memberId, 'm3');
  assert.equal(create.coordinatorRequestId, 'R-1001');
  assert.equal(create.offlinePostCreateAction, 'push_online');
  assert.equal(h.lastTo(AFIQ).body, '✅ R-1001 booked for CarePlus Manpower, starts 7 Oct.');
});

test('Book it, then Cancel at the agency question or in the booking: the request goes back to pending', async () => {
  const h = harness();
  await h.say(AFIQ, text('request'));
  await h.say(AFIQ, row('cr_ag_new'));
  await h.say(AFIQ, text('CarePlus'));
  await h.say(AFIQ, text('9876543210'));
  await h.say(AFIQ, row('cr_dist_kollam'));
  for (const m of [text('70'), btn('cr_g_male'), text('60'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_svc_8h'), btn('cr_g_any'), btn('cr_date_1'), text('7'), pin(10, 76), btn('cr_tier_gda'), btn('cr_create')]) {
    await h.say(AFIQ, m);
  }
  await h.say(REVIEWER_A, btn('coordreq_book_R-1001'));
  const drop = await h.say(REVIEWER_A, btn('coordreq_drop_R-1001'));
  assert.equal(drop.replies[0].body, 'OK. R-1001 is back to waiting for review.');
  assert.equal((await h.requests.get('R-1001')).status, 'pending');

  // Now someone else books it and cancels the admin draft.
  await h.say(REVIEWER_B, btn('coordreq_book_R-1001'));
  await h.say(REVIEWER_B, btn('coordreq_addag_R-1001'));
  assert.ok(await h.adminStore.get(REVIEWER_B));
  const cancel = await h.say(REVIEWER_B, text('cancel'));
  assert.equal(cancel.replies[0].body, 'Booking cancelled. R-1001 is back to waiting for review.');
  const doc = await h.requests.get('R-1001');
  assert.equal(doc.status, 'pending');
  assert.equal(doc.bookingBy, null);
  assert.equal(doc.createdAgency.id, 'new1', 'the added agency is remembered; it is not added twice');
  await h.say(REVIEWER_A, btn('coordreq_book_R-1001'));
  assert.equal(h.callsOf('createAgency').length, 1);
});

test('hub refusals: a reviewer without an admin login, a refused createAgency, an unknown coordinator', async () => {
  const h = harness({
    reviewerPhones: [REVIEWER_A, NOT_ADMIN],
    overrides: { createAgency: () => ({ ok: false, error: 'duplicate', message: 'An agency with this number exists.' }) }
  });
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  const refused = await h.say(NOT_ADMIN, btn('coordreq_book_R-1001'));
  assert.equal(refused.replies[0].body, 'This number has no admin login in Pulso Hub.');
  assert.equal((await h.requests.get('R-1001')).status, 'pending');

  // An unknown coordinator number (in the list, not in Pulso Hub).
  const h2 = harness();
  const unknown = await h2.say('919999999999', text('request'));
  assert.equal(unknown.handled, false, 'not a coordinator: not ours');

  // createAgency refused: the claim is kept and the reviewer may try again.
  const h3 = harness({ overrides: { createAgency: () => ({ ok: false, error: 'duplicate', message: 'An agency with this number exists.' }) } });
  await h3.say(AFIQ, text('request'));
  await h3.say(AFIQ, row('cr_ag_new'));
  await h3.say(AFIQ, text('CarePlus'));
  await h3.say(AFIQ, text('9876543210'));
  await h3.say(AFIQ, row('cr_dist_kollam'));
  for (const m of [text('70'), btn('cr_g_male'), text('60'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_no'), btn('cr_svc_8h'), btn('cr_g_any'), btn('cr_date_1'), text('7'), pin(10, 76), btn('cr_tier_gda'), btn('cr_create')]) {
    await h3.say(AFIQ, m);
  }
  await h3.say(REVIEWER_A, btn('coordreq_book_R-1001'));
  const fail = await h3.say(REVIEWER_A, btn('coordreq_addag_R-1001'));
  assert.equal(fail.replies[0].body, 'An agency with this number exists. Tap Add and continue to try again, or Cancel.');
  assert.equal((await h3.requests.get('R-1001')).status, 'booking');
  assert.equal(await h3.adminStore.get(REVIEWER_A), null);
});

test('a coordinator Pulso Hub does not know is refused with its words', async () => {
  const h = harness({ overrides: { whoami: () => ({ ok: false, error: 'not-allowed', message: 'Pulso Hub does not allow this number to do that.' }) } });
  const r = await h.say(AFIQ, text('request'));
  assert.equal(r.replies[0].body, 'Pulso Hub does not allow this number to do that.');
  assert.equal(await h.draftStore.get(AFIQ), null);
});

test('a create refused because the request was decided meanwhile is not sent to Pulso Hub', async () => {
  const h = harness();
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  await h.say(REVIEWER_A, btn('coordreq_book_R-1001'));
  await h.say(REVIEWER_A, btn('ab_rates_keep'));
  await h.say(REVIEWER_A, btn('ab_after_manual'));
  // Meanwhile the claim passed to another reviewer (it lapses after a day).
  h.requests.docs.set('R-1001', { ...h.requests.docs.get('R-1001'), bookingBy: REVIEWER_B, bookingAtMillis: NOW });
  const r = await h.say(REVIEWER_A, btn('ab_create'));
  assert.equal(r.replies[0].body, 'R-1001: already being booked by 8714105666 (since 10:00 am, 6 Oct).');
  assert.equal(h.callsOf('create').length, 0);
  assert.equal(await h.adminStore.get(REVIEWER_A), null);
});

test('Ask coordinator: the question goes to the coordinator, the next message comes back; the request stays pending', async () => {
  const h = harness();
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  const ask = await h.say(REVIEWER_B, btn('coordreq_ask_R-1001'));
  assert.equal(ask.replies[0].body, 'Type your question for Afiq about R-1001.');
  const q = await h.say(REVIEWER_B, text('Is she on oxygen at night?'));
  const toCoordinator = q.replies.find((m) => m.to === AFIQ);
  assert.match(toCoordinator.body, /^About R-1001: Is she on oxygen at night\?/);
  assert.deepEqual(toCoordinator.buttons.map((b) => b.id), ['coordreq_change_R-1001']);
  assert.equal(q.replies.find((m) => m.to === REVIEWER_B).body, 'Sent to Afiq. The answer will come here.');

  const a = await h.say(AFIQ, text('No oxygen. Only at times a nebuliser.'));
  assert.equal(a.replies.find((m) => m.to === REVIEWER_B).body, 'R-1001 · Afiq: No oxygen. Only at times a nebuliser.');
  assert.equal(a.replies.find((m) => m.to === AFIQ).body, 'Sent to the reviewer (R-1001).');

  // Only the one message is relayed; the next is the coordinator's own.
  const after = await h.say(AFIQ, text('hello'));
  assert.equal(after.handled, false);

  const doc = await h.requests.get('R-1001');
  assert.equal(doc.status, 'pending');
  assert.deepEqual(doc.thread.map((t) => [t.from, t.kind, t.text]), [
    [REVIEWER_B, 'question', 'Is she on oxygen at night?'],
    [AFIQ, 'reply', 'No oxygen. Only at times a nebuliser.']
  ]);
});

test('Reject: a reason of at least 3 characters; the coordinator is told; later taps answer "already rejected"', async () => {
  const h = harness();
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  const r = await h.say(REVIEWER_A, btn('coordreq_reject_R-1001'));
  assert.equal(r.replies[0].body, 'Why is R-1001 not booked? Type a short reason; Afiq will get it.');
  const short = await h.say(REVIEWER_A, text('no'));
  assert.equal(short.replies[0].body, 'Please type a reason of at least 3 characters.');
  const done = await h.say(REVIEWER_A, text('Agency has unpaid dues'));
  assert.equal(done.replies.find((m) => m.to === AFIQ).body, 'R-1001 not booked: Agency has unpaid dues.');
  assert.equal(done.replies.find((m) => m.to === REVIEWER_A).body, 'R-1001 rejected. Afiq has been told.');
  const doc = await h.requests.get('R-1001');
  assert.equal(doc.status, 'rejected');
  assert.equal(doc.rejectReason, 'Agency has unpaid dues');
  const late = await h.say(REVIEWER_B, btn('coordreq_book_R-1001'));
  assert.equal(late.replies[0].body, 'R-1001: already rejected by 9446600809 at 10:00 am, 6 Oct.');
  const change = await h.say(AFIQ, btn('coordreq_change_R-1001'));
  assert.match(change.replies[0].body, /already rejected/);
});

test('a reviewer typing another bot\'s word, or cancel, instead of the reason sends nothing', async () => {
  const h = harness();
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  await h.say(REVIEWER_A, btn('coordreq_reject_R-1001'));
  const c = await h.say(REVIEWER_A, text('cancel'));
  assert.equal(c.replies[0].body, 'OK, nothing sent.');
  await h.say(REVIEWER_A, btn('coordreq_ask_R-1001'));
  const b = await h.say(REVIEWER_A, text('booking'));
  assert.match(b.replies[0].body, /^New booking\. Which agency/);
  assert.equal((await h.requests.get('R-1001')).thread.length, 0);
});

test('Change something after sending: a replacement R-1002; R-1001 marked replaced; reviewers told', async () => {
  const h = harness();
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  const change = await h.say(AFIQ, btn('coordreq_change_R-1001'));
  assert.equal(change.replies[0].kind, 'list');
  const rows = change.replies[0].sections[0].rows;
  assert.ok(rows.every((r) => r.id.startsWith('cr_chg_')));
  assert.ok(!rows.some((r) => /rates|After creation/i.test(`${r.title} ${r.description || ''}`)));
  const days = await h.say(AFIQ, row('cr_chg_days'));
  assert.match(days.replies[0].body, /How many days/);
  const summary = await h.say(AFIQ, text('15'));
  assert.match(summary.replies[0].body, /Dates: 7 Oct to 21 Oct · 15 days/);
  const sentNow = await h.say(AFIQ, btn('cr_create'));
  assert.equal(sentNow.replies[0].body, "Sent for review as R-1002. You'll get the answer here.");
  const old = await h.requests.get('R-1001');
  assert.equal(old.status, 'replaced');
  assert.equal(old.replacedBy, 'R-1002');
  assert.equal((await h.requests.get('R-1002')).replaces, 'R-1001');
  for (const reviewer of [REVIEWER_A, REVIEWER_B, SANJU]) {
    const msgs = h.to(reviewer).map((m) => m.body);
    const told = msgs.indexOf('R-1001 replaced by R-1002.');
    const note = msgs.findIndex((b) => /^Booking request R-1002/.test(b || ''));
    assert.ok(told >= 0 && note > told, `${reviewer} told, then the new note`);
  }
  const tap = await h.say(REVIEWER_A, btn('coordreq_book_R-1001'));
  assert.equal(tap.replies[0].body, 'R-1001 was replaced by R-1002.');
  // Cancel during a change leaves the request as it was.
  await h.say(AFIQ, btn('coordreq_change_R-1002'));
  const c = await h.say(AFIQ, btn('cr_cancel'));
  assert.equal(c.replies[0].body, 'Change cancelled. R-1002 stays as it was sent.');
  assert.equal((await h.requests.get('R-1002')).status, 'pending');
});

test('routing: 7736108778 has "booking", "request" and its drafts apart; Afiq has no "booking"; others untouched', async () => {
  const h = harness();
  const req = await h.say(SANJU, text('request'));
  assert.match(req.replies[0].body, /^New booking request\./);
  h.advance(1000);
  const bk = await h.say(SANJU, text('booking'));
  assert.match(bk.replies[0].body, /^New booking\. Which agency/);
  assert.ok(await h.draftStore.get(SANJU));
  assert.ok(await h.adminStore.get(SANJU));
  // Typed text goes to the draft touched last (the booking), a button to its own chat.
  h.advance(1000);
  const typed = await h.say(SANJU, text('grace'));
  assert.match(typed.replies[0].body, /Agencies matching "grace"/);
  assert.equal(typed.replies[0].sections[0].rows.slice(-1)[0].title, '+ New agency');
  const tap = await h.say(SANJU, row('cr_ag_b1'));
  assert.equal(tap.replies[0].sections[0].rows.slice(-1)[0].title, 'New patient');
  // Now the request draft is the newer one.
  h.advance(1000);
  const next = await h.say(SANJU, row('cr_pt_m1'));
  assert.equal(next.replies[0].body, 'Weight in kg?');
  const weight = await h.say(SANJU, text('60'));
  assert.equal(weight.replies[0].body, 'Bedridden?');
  assert.deepEqual(weight.replies[0].buttons.map((b) => b.id), ['cr_yes', 'cr_no']);

  // Afiq is not an admin: "booking" is not his.
  const afiq = await h.say(AFIQ, text('booking'));
  assert.equal(afiq.handled, false);
  // A reviewer who is not a coordinator: "request" is not his.
  const rev = await h.say(REVIEWER_A, text('request'));
  assert.equal(rev.handled, false);
  // Strangers: nothing, no hub call, no store read.
  const before = h.calls.length;
  for (const m of [text('request'), text('booking'), btn('coordreq_book_R-1001'), text('hi')]) {
    assert.equal((await h.say('919876543210', m)).handled, false);
  }
  assert.equal(h.calls.length, before);
  assert.equal(h.chats.docs.has('919876543210'), false);
  // "call" from a reviewer without a pending action is left for the calling bot.
  assert.equal(await h.flow.maybeHandlePriority(SANJU, text('call')), false);
});

test('a coordinator\'s note tap from a non-reviewer, or a reviewer\'s from a non-coordinator, is ignored', async () => {
  const h = harness();
  await happyToSummary(h);
  await h.say(AFIQ, btn('cr_create'));
  assert.equal(await h.flow.maybeHandlePriority(AFIQ, btn('coordreq_book_R-1001')), false);
  assert.equal(await h.flow.maybeHandlePriority(REVIEWER_A, btn('coordreq_change_R-1001')), false);
  assert.equal((await h.requests.get('R-1001')).status, 'pending');
});

test('parsePayload, decidedText and timeLabel', () => {
  assert.deepEqual(coord.parsePayload('coordreq_book_R-1042'), { action: 'book', requestId: 'R-1042' });
  assert.deepEqual(coord.parsePayload('coordreq_addag_R-1'), { action: 'addag', requestId: 'R-1' });
  assert.equal(coord.parsePayload('coordreq_book_1042'), null);
  assert.equal(coord.parsePayload('ab_create'), null);
  assert.equal(coord.timeLabel(Date.UTC(2026, 9, 6, 10, 42)), '4:12 pm, 6 Oct');
  assert.equal(coord.timeLabel(Date.UTC(2026, 9, 5, 18, 35)), '12:05 am, 6 Oct');
  assert.equal(coord.decidedText({ id: 'R-1', status: 'replaced', replacedBy: 'R-2' }), 'R-1 was replaced by R-2.');
});
