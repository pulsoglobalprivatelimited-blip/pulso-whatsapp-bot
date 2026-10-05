'use strict';
/* Care coordinator booking requests (docs/coordinator_booking_request_plan.md,
   founder, 5-6 Oct 2026).

   A care coordinator (COORDINATOR_PHONES) types "request" on the support
   number (+91 77361 29809) and answers the admin booking bot's questions,
   without rates or anything after creation. Nothing is written to Pulso Hub
   from the coordinator's side: Send for review saves the answers as
   coordinatorBookingRequests/R-1042 and sends a note with Book it / Ask
   coordinator / Reject to every reviewer (COORDINATOR_REVIEWER_PHONES). The
   first tap decides, through a transaction on the request's status.

   Book it adds a new agency (after asking) and opens an admin booking draft
   for that reviewer, prefilled with the answers, at the rates step; the admin
   bot does the rest (rates, push or assign, Create), carrying the request
   number into `create`. Ask coordinator relays one question and one answer.
   Reject takes a reason and tells the coordinator.

   The chat itself is adminBookingFlow in 'coordinator' mode, so both chats ask
   the same questions in the same way. This module holds the requests, the
   note, the reviewers' buttons and the routing between the bots on the support
   number. Stores, hub and sender are injectable; tests run in memory. */
const config = require('../config');
const { getInteractiveReplyId } = require('./messageParser');
const adminBooking = require('./adminBookingFlow');

const { normalizePhone, adminPhoneSet, requestLines, cut, dayLabel, LIMITS } = adminBooking;

const REQUESTS = 'coordinatorBookingRequests';
const COUNTERS = 'appCounters';
const COUNTER_DOC = 'coordinatorBookingRequests';
const CHATS = 'coordinatorRequestChats';
const FIRST_NUMBER = 1001;
const DAY_MS = 24 * 60 * 60 * 1000;
// Stay clear of the 24-hour edge: a note sent at 23h59m may land after it.
const WINDOW_MS = 23 * 60 * 60 * 1000;
const INBOUND_WRITE_EVERY_MS = 10 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const MIN_REJECT_REASON = 3;

const PAYLOAD_PREFIX = 'coordreq_';
const PAYLOAD = {
  BOOK: 'coordreq_book_',
  ASK: 'coordreq_ask_',
  REJECT: 'coordreq_reject_',
  ADD_AGENCY: 'coordreq_addag_',
  DROP: 'coordreq_drop_',
  CHANGE: 'coordreq_change_'
};

const OTHER_START_WORDS = new Set(['booking', 'book', 'request', 'call']);

/* ------------------------------------------------------------ helpers --- */

function messageText(message) {
  return message && message.text && typeof message.text.body === 'string' ? message.text.body.trim() : '';
}

function command(message) {
  return messageText(message).toLowerCase().replace(/[.!?]+$/, '').trim();
}

/** A button reply, list reply or template quick reply. */
function replyId(message) {
  const id = getInteractiveReplyId(message);
  if (id) return id;
  if (message && message.type === 'button' && message.button) return String(message.button.payload || '');
  return '';
}

function parsePayload(id) {
  const match = String(id || '').match(/^coordreq_(book|ask|reject|addag|drop|change)_(R-\d+)$/);
  return match ? { action: match[1], requestId: match[2] } : null;
}

function shortPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "4:12 pm, 6 Oct" in India time. */
function timeLabel(ms) {
  if (!(Number(ms) > 0)) return 'an earlier time';
  const d = new Date(Number(ms) + IST_OFFSET_MS);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${m} ${h < 12 ? 'am' : 'pm'}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/* Meta refuses a template value with a newline, a tab or more than four
   spaces in a row. */
function templateValue(value, max = 300) {
  const s = String(value == null ? '' : value).replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
  return cut(s || '-', max);
}

/* ------------------------------------------------------------- stores --- */

function memoryRequestStore() {
  const docs = new Map();
  let last = FIRST_NUMBER - 1;
  return {
    docs,
    async create(build) {
      last += 1;
      const id = `R-${last}`;
      const doc = clone(build(id));
      docs.set(id, doc);
      return clone(doc);
    },
    async get(id) {
      return docs.has(id) ? clone(docs.get(id)) : null;
    },
    /** fn(current) → { patch, result }; the patch is merged, atomically. */
    async transact(id, fn) {
      const current = docs.has(id) ? clone(docs.get(id)) : null;
      const { patch, result } = fn(current) || {};
      if (patch && current) docs.set(id, { ...docs.get(id), ...clone(patch) });
      return result;
    }
  };
}

function firestoreRequestStore() {
  const { getFirestore } = require('./storage');
  const db = () => getFirestore();
  const ref = (id) => db().collection(REQUESTS).doc(id);
  return {
    async create(build) {
      const counterRef = db().collection(COUNTERS).doc(COUNTER_DOC);
      return db().runTransaction(async (tx) => {
        const snap = await tx.get(counterRef);
        const last = snap.exists && Number(snap.data().last) >= FIRST_NUMBER - 1 ? Number(snap.data().last) : FIRST_NUMBER - 1;
        const n = last + 1;
        const id = `R-${n}`;
        const doc = clone(build(id));
        tx.set(counterRef, { last: n, updatedAt: new Date() }, { merge: true });
        tx.set(ref(id), { ...doc, createdAt: new Date(doc.createdAtMillis || Date.now()) });
        return doc;
      });
    },
    async get(id) {
      const snap = await ref(id).get();
      return snap.exists ? snap.data() : null;
    },
    async transact(id, fn) {
      return db().runTransaction(async (tx) => {
        const snap = await tx.get(ref(id));
        const current = snap.exists ? snap.data() : null;
        const { patch, result } = fn(current ? clone(current) : null) || {};
        if (patch && current) tx.set(ref(id), { ...clone(patch), updatedAt: new Date() }, { merge: true });
        return result;
      });
    }
  };
}

/* Per number: what a reviewer is about to type (a question or a reason), the
   question a coordinator is about to answer, and when the number last wrote
   to the support number (for the 24-hour window). */
function memoryChatStore() {
  const docs = new Map();
  return {
    docs,
    async get(phone) {
      return docs.has(phone) ? clone(docs.get(phone)) : {};
    },
    async set(phone, patch) {
      const next = { ...(docs.get(phone) || {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = clone(v);
      }
      docs.set(phone, next);
    }
  };
}

function firestoreChatStore() {
  const { getFirestore } = require('./storage');
  const ref = (phone) => getFirestore().collection(CHATS).doc(phone);
  return {
    async get(phone) {
      const snap = await ref(phone).get();
      return snap.exists ? snap.data() || {} : {};
    },
    async set(phone, patch) {
      // null clears a field; merge keeps the rest.
      await ref(phone).set({ ...patch, updatedAt: new Date() }, { merge: true });
    }
  };
}

function metaSender() {
  const metaClient = require('./metaClient');
  // Everything here leaves from the support number, where the taps come back.
  const options = () =>
    config.providerSupportPhoneNumberId ? { phoneNumberId: config.providerSupportPhoneNumberId } : undefined;
  return {
    text: (to, body) => metaClient.sendText(to, body, options()),
    buttons: (to, body, buttons) => metaClient.sendButtons(to, body, buttons, options()),
    list: (to, body, buttonText, sections) => metaClient.sendList(to, body, buttonText, sections, options()),
    template: (to, name, language, components) => metaClient.sendTemplate(to, name, language, components, options())
  };
}

/* ------------------------------------------------------------ the note --- */

/** "Patient: …" → { Patient: '…' }, from the shared request lines. */
function noteFields(answers) {
  const fields = {};
  for (const line of requestLines(answers || {}, { mapLink: true })) {
    const at = line.indexOf(': ');
    if (at > 0) fields[line.slice(0, at)] = line.slice(at + 2);
  }
  return fields;
}

function fromLabel(doc) {
  return doc.coordinatorName ? doc.coordinatorName : shortPhone(doc.coordinatorPhone);
}

function reviewNoteText(doc) {
  return [
    `Booking request ${doc.id} from ${fromLabel(doc)} (care coordinator)`,
    ...requestLines(doc.answers || {}, { mapLink: true })
  ].join('\n');
}

function reviewButtons(id) {
  return [
    { id: `${PAYLOAD.BOOK}${id}`, title: 'Book it' },
    { id: `${PAYLOAD.ASK}${id}`, title: 'Ask coordinator' },
    { id: `${PAYLOAD.REJECT}${id}`, title: 'Reject' }
  ];
}

/* Body values of coordinator_booking_review, in the order of
   src/scripts/createCoordinatorReviewTemplate.js. */
function reviewTemplateValues(doc) {
  const f = noteFields(doc.answers);
  const patient = f['Under 45, because'] ? `${f.Patient} · under 45: ${f['Under 45, because']}` : f.Patient;
  return [doc.id, fromLabel(doc), f.Agency, patient, f.Service, f.Dates, f.Location, f.Who].map((v) => templateValue(v));
}

function reviewTemplateComponents(doc) {
  return [
    { type: 'body', parameters: reviewTemplateValues(doc).map((text) => ({ type: 'text', text })) },
    ...reviewButtons(doc.id).map((b, index) => ({
      type: 'button',
      sub_type: 'quick_reply',
      index: String(index),
      parameters: [{ type: 'payload', payload: b.id }]
    }))
  ];
}

/** "Already booked by 9446600809 at 4:12 pm, 6 Oct." and the like. */
function decidedText(doc) {
  if (!doc) return 'That request was not found.';
  switch (doc.status) {
    case 'booked':
      return `${doc.id}: already booked by ${shortPhone(doc.bookedBy)} at ${timeLabel(doc.bookedAtMillis)}.`;
    case 'rejected':
      return `${doc.id}: already rejected by ${shortPhone(doc.rejectedBy)} at ${timeLabel(doc.rejectedAtMillis)}.`;
    case 'booking':
      return `${doc.id}: already being booked by ${shortPhone(doc.bookingBy)} (since ${timeLabel(doc.bookingAtMillis)}).`;
    case 'replaced':
      return `${doc.id} was replaced by ${doc.replacedBy || 'a newer request'}.`;
    default:
      return `${doc.id} is ${doc.status}.`;
  }
}

/* --------------------------------------------------------------- flow --- */

function createCoordinatorRequests(deps = {}) {
  const hub = deps.hub || require('./adminBookingHubClient').createHubClient();
  const requests = deps.requests || firestoreRequestStore();
  const chats = deps.chats || firestoreChatStore();
  const sender = deps.send || metaSender();
  const now = deps.now || (() => Date.now());
  const adminFlow = deps.adminFlow || adminBooking.getDefaultFlow();
  const coordinators = () => adminPhoneSet(deps.coordinatorPhones || config.coordinatorPhones);
  const reviewers = () => adminPhoneSet(deps.reviewerPhones || config.coordinatorReviewerPhones);
  const admins = () => adminPhoneSet(deps.adminPhones || config.adminBookingBotPhones);
  const template = () => ({
    enabled: deps.templateEnabled !== undefined ? Boolean(deps.templateEnabled) : config.coordinatorReviewTemplateEnabled,
    name: deps.templateName || config.coordinatorReviewTemplateName,
    language: deps.templateLanguage || config.coordinatorReviewTemplateLanguage
  });

  const say = (to, body) => sender.text(to, String(body).slice(0, 4096));
  const buttons = (to, body, list) =>
    sender.buttons(
      to,
      String(body).slice(0, LIMITS.body),
      list.slice(0, LIMITS.buttons).map((b) => ({ id: b.id, title: cut(b.title, LIMITS.buttonTitle) }))
    );

  const coordinatorFlow = adminBooking.createAdminBookingFlow({
    mode: 'coordinator',
    hub,
    store: deps.draftStore || adminBooking.firestoreDraftStore('coordinatorRequestDrafts'),
    send: { text: sender.text, buttons: sender.buttons, list: sender.list },
    now,
    adminPhones: deps.coordinatorPhones || config.coordinatorPhones,
    onSubmit: submit
  });

  adminFlow.setHooks({ beforeCreate, onCreated, onReleased });

  /* ---- the coordinator sends ---- */

  async function submit(draft) {
    const d = clone(draft.data);
    const answers = { ...d };
    delete answers.client;
    const coordinatorPhone = draft.phone;
    const createdAtMillis = now();
    const doc = await requests.create((id) => ({
      id,
      status: 'pending',
      coordinatorPhone,
      coordinatorName: (draft.coordinator && draft.coordinator.name) || '',
      answers,
      ...(d.newAgency && !d.agency
        ? {
            pendingAgency: {
              name: d.newAgency.name || '',
              ownerPhone: d.newAgency.phone || '',
              district: d.newAgency.district || null
            }
          }
        : {}),
      ...(d.newPatient && !d.patient
        ? { pendingPatient: { ageYears: Number(d.newPatient.ageYears) || 0, gender: d.newPatient.gender || '' } }
        : {}),
      ...(draft.replaces ? { replaces: draft.replaces } : {}),
      createdAtMillis,
      createdAt: new Date(createdAtMillis).toISOString(),
      thread: []
    }));

    let replaced = false;
    if (draft.replaces) {
      replaced = await requests.transact(draft.replaces, (old) => {
        if (!old || old.status !== 'pending' || old.coordinatorPhone !== coordinatorPhone) return { result: false };
        return { patch: { status: 'replaced', replacedBy: doc.id, replacedAtMillis: now() }, result: true };
      });
    }

    await buttons(coordinatorPhone, `Sent for review as ${doc.id}. You'll get the answer here.`, [
      { id: `${PAYLOAD.CHANGE}${doc.id}`, title: 'Change something' }
    ]);
    if (draft.replaces && !replaced) {
      await say(coordinatorPhone, `${draft.replaces} was already decided, so ${doc.id} is a new request.`);
    }

    for (const to of reviewers()) {
      if (replaced) {
        await say(to, `${draft.replaces} replaced by ${doc.id}.`).catch((error) =>
          console.error('[COORDINATOR_REQUEST_REPLACED_NOTICE_FAILED]', to, error && error.message)
        );
      }
    }
    await sendReviewNote(doc);
    return { ok: true, id: doc.id };
  }

  async function inWindow(phone) {
    const state = await chats.get(phone).catch(() => ({}));
    return Number(state.lastInboundAtMillis) > 0 && now() - Number(state.lastInboundAtMillis) < WINDOW_MS;
  }

  /* To each reviewer: the buttons while their 24-hour window is open; outside
     it the approved template (when switched on), else the buttons anyway and
     a log line, as the certificate alerts do before their template is live. */
  async function sendReviewNote(doc) {
    const t = template();
    const deliveries = [];
    for (const to of reviewers()) {
      const open = await inWindow(to);
      if (!open && t.enabled && t.name) {
        try {
          await sender.template(to, t.name, t.language, reviewTemplateComponents(doc));
          deliveries.push({ to, via: 'template', ok: true, atMillis: now() });
          continue;
        } catch (error) {
          deliveries.push({ to, via: 'template', ok: false, error: cut(error && error.message, 200), atMillis: now() });
          console.error('[COORDINATOR_REVIEW_TEMPLATE_FAILED]', JSON.stringify({ to, id: doc.id, message: error && error.message }));
        }
      }
      if (!open) {
        console.warn('[COORDINATOR_REVIEW_OUTSIDE_WINDOW]', JSON.stringify({ to, id: doc.id, templateEnabled: t.enabled }));
      }
      try {
        await buttons(to, reviewNoteText(doc), reviewButtons(doc.id));
        deliveries.push({ to, via: 'buttons', ok: true, inWindow: open, atMillis: now() });
      } catch (error) {
        deliveries.push({ to, via: 'buttons', ok: false, inWindow: open, error: cut(error && error.message, 200), atMillis: now() });
        console.error('[COORDINATOR_REVIEW_NOTE_FAILED]', JSON.stringify({ to, id: doc.id, message: error && error.message }));
      }
    }
    await requests
      .transact(doc.id, (current) => ({ patch: current ? { deliveries } : null }))
      .catch((error) => console.error('[COORDINATOR_REVIEW_DELIVERY_LOG_FAILED]', doc.id, error && error.message));
    return deliveries;
  }

  /* ---- the reviewer's buttons ---- */

  function claimable(doc, phone) {
    if (!doc) return false;
    if (doc.status === 'pending') return true;
    if (doc.status !== 'booking') return false;
    // The claimer may start again; a claim older than a day (the admin draft's
    // own life) has lapsed and anyone may take it.
    return doc.bookingBy === phone || now() - Number(doc.bookingAtMillis) > DAY_MS;
  }

  function adminFrom(who) {
    if (!who || who.ok === false || who.role === 'coordinator') return null;
    const admin = who.admin && who.admin.uid ? who.admin : who;
    return admin && admin.uid ? { uid: admin.uid, name: admin.name || '', viaPhone: admin.viaPhone || '' } : null;
  }

  async function bookIt(phone, id) {
    const doc = await requests.get(id);
    if (!claimable(doc, phone)) {
      await say(phone, decidedText(doc));
      return;
    }
    const who = await hub.call(phone, 'whoami', {});
    const admin = adminFrom(who);
    if (!admin) {
      await say(phone, (who && who.message) || "This number can't make bookings. Ask the owner to add it as an admin.");
      return;
    }
    const claimed = await requests.transact(id, (current) => {
      if (!claimable(current, phone)) return { result: { ok: false, doc: current } };
      return {
        patch: { status: 'booking', bookingBy: phone, bookingAtMillis: now(), bookingAdmin: admin },
        result: { ok: true }
      };
    });
    if (!claimed.ok) {
      await say(phone, decidedText(claimed.doc));
      return;
    }
    const fresh = await requests.get(id);
    if (fresh.pendingAgency && !fresh.createdAgency) {
      const a = fresh.pendingAgency;
      const district = a.district && (a.district.label || a.district.key);
      await buttons(
        phone,
        `${id}: Add ${a.name} (owner ${shortPhone(a.ownerPhone)}${district ? `, ${district}` : ''}) as a new manpower agency?`,
        [
          { id: `${PAYLOAD.ADD_AGENCY}${id}`, title: 'Add and continue' },
          { id: `${PAYLOAD.DROP}${id}`, title: 'Cancel' }
        ]
      );
      return;
    }
    await openDraft(phone, fresh);
  }

  async function addAgency(phone, id) {
    const doc = await requests.get(id);
    if (!doc || doc.status !== 'booking' || doc.bookingBy !== phone) {
      await say(phone, doc && doc.status === 'pending' ? `${id}: tap Book it first.` : decidedText(doc));
      return;
    }
    if (!doc.createdAgency) {
      const a = doc.pendingAgency || {};
      const district = a.district && (a.district.key || a.district);
      const result = await hub.call(phone, 'createAgency', { name: a.name, ownerPhone: a.ownerPhone, district });
      if (!result || result.ok === false || !result.agency) {
        await say(phone, `${(result && result.message) || 'Could not add the agency.'} Tap Add and continue to try again, or Cancel.`);
        return;
      }
      const createdAgency = {
        id: result.agency.id,
        name: result.agency.name || a.name,
        district: result.agency.district || district || ''
      };
      await requests.transact(id, (current) => ({ patch: current ? { createdAgency } : null }));
      doc.createdAgency = createdAgency;
    }
    await openDraft(phone, doc);
  }

  async function drop(phone, id) {
    const released = await requests.transact(id, (current) => {
      if (!current || current.status !== 'booking' || current.bookingBy !== phone) return { result: false };
      return { patch: { status: 'pending', bookingBy: null, bookingAtMillis: null, bookingAdmin: null }, result: true };
    });
    if (released) {
      await adminFlow.discardRequestDraft(phone, id);
      await say(phone, `OK. ${id} is back to waiting for review.`);
    } else {
      await say(phone, decidedText(await requests.get(id)));
    }
  }

  /* The admin draft: the coordinator's answers, the agency (as added), and a
     new patient still to be added by the admin flow itself (ensureClient, then
     addPatient), landing on the rates step. */
  async function openDraft(phone, doc) {
    const data = clone(doc.answers) || {};
    delete data.client;
    delete data.newAgency;
    if (doc.createdAgency) data.agency = { ...doc.createdAgency, hasPhone: true };
    if (doc.pendingPatient && !data.patient) {
      data.newPatient = { name: 'New patient', ageYears: doc.pendingPatient.ageYears, gender: doc.pendingPatient.gender };
    }
    await say(phone, `Booking ${doc.id} from ${fromLabel(doc)}. The answers are filled in; set the rates.`);
    await adminFlow.openPrefilled(phone, data, {
      admin: doc.bookingAdmin || {},
      coordinatorRequest: { id: doc.id, coordinatorPhone: doc.coordinatorPhone }
    });
  }

  async function startAsk(phone, id) {
    const doc = await requests.get(id);
    if (!doc || ['booked', 'rejected', 'replaced'].includes(doc.status)) {
      await say(phone, decidedText(doc));
      return;
    }
    await chats.set(phone, { reviewerAction: { kind: 'ask', requestId: id, atMillis: now() } });
    await say(phone, `Type your question for ${fromLabel(doc)} about ${id}.`);
  }

  async function startReject(phone, id) {
    const doc = await requests.get(id);
    if (!doc || ['booked', 'rejected', 'replaced'].includes(doc.status) || (doc.status === 'booking' && !claimable(doc, phone))) {
      await say(phone, decidedText(doc));
      return;
    }
    await chats.set(phone, { reviewerAction: { kind: 'reject', requestId: id, atMillis: now() } });
    await say(phone, `Why is ${id} not booked? Type a short reason; ${fromLabel(doc)} will get it.`);
  }

  /* ---- what a reviewer types after Ask coordinator / Reject ---- */

  async function sendQuestion(phone, id, question) {
    const doc = await requests.get(id);
    if (!doc) {
      await say(phone, decidedText(doc));
      return;
    }
    const at = now();
    await requests.transact(id, (current) => ({
      patch: current ? { thread: [...(current.thread || []), { from: phone, kind: 'question', text: question, atMillis: at }] } : null
    }));
    await chats.set(doc.coordinatorPhone, { relay: { requestId: id, reviewerPhone: phone, atMillis: at } });
    await buttons(doc.coordinatorPhone, `About ${id}: ${cut(question, 800)}\n\nType your answer; your next message goes to the reviewer.`, [
      { id: `${PAYLOAD.CHANGE}${id}`, title: 'Change something' }
    ]);
    await say(phone, `Sent to ${fromLabel(doc)}. The answer will come here.`);
  }

  async function reject(phone, id, reason) {
    const at = now();
    const outcome = await requests.transact(id, (current) => {
      if (!current) return { result: { ok: false, doc: current } };
      const allowed = current.status === 'pending' || (current.status === 'booking' && claimable(current, phone));
      if (!allowed) return { result: { ok: false, doc: current } };
      return {
        patch: {
          status: 'rejected',
          rejectedBy: phone,
          rejectedAtMillis: at,
          rejectReason: reason,
          thread: [...(current.thread || []), { from: phone, kind: 'reject', text: reason, atMillis: at }]
        },
        result: { ok: true, doc: current }
      };
    });
    if (!outcome.ok) {
      await say(phone, decidedText(outcome.doc));
      return;
    }
    await adminFlow.discardRequestDraft(phone, id);
    await say(outcome.doc.coordinatorPhone, `${id} not booked: ${reason.replace(/[.!]+$/, '')}.`);
    await say(phone, `${id} rejected. ${fromLabel(outcome.doc)} has been told.`);
  }

  async function handleReviewerText(phone, action, message) {
    const text = messageText(message);
    if (action.kind === 'ask') {
      if (!text) return false;
      await chats.set(phone, { reviewerAction: null });
      await sendQuestion(phone, action.requestId, text.slice(0, 1000));
      return true;
    }
    if (action.kind === 'reject') {
      if (!text) return false;
      if (text.length < MIN_REJECT_REASON) {
        await say(phone, `Please type a reason of at least ${MIN_REJECT_REASON} characters.`);
        return true;
      }
      await chats.set(phone, { reviewerAction: null });
      await reject(phone, action.requestId, text.slice(0, 500));
      return true;
    }
    return false;
  }

  /* ---- the coordinator's answer to a question ---- */

  async function relayReply(phone, relay, text) {
    const doc = await requests.get(relay.requestId);
    const at = now();
    await chats.set(phone, { relay: null });
    if (doc) {
      await requests.transact(relay.requestId, (current) => ({
        patch: current ? { thread: [...(current.thread || []), { from: phone, kind: 'reply', text, atMillis: at }] } : null
      }));
    }
    const name = doc ? fromLabel(doc) : shortPhone(phone);
    await say(relay.reviewerPhone, `${relay.requestId} · ${name}: ${text}`);
    await say(phone, `Sent to the reviewer (${relay.requestId}).`);
  }

  /* ---- Change something, after sending ---- */

  async function changeRequest(phone, id) {
    const doc = await requests.get(id);
    if (!doc || doc.coordinatorPhone !== phone) {
      await say(phone, 'That request was not found.');
      return;
    }
    if (doc.status !== 'pending') {
      await say(phone, doc.status === 'booking' ? `${id} is being booked by ${shortPhone(doc.bookingBy)} now. Ask them directly.` : decidedText(doc));
      return;
    }
    await coordinatorFlow.reopenRequest(phone, doc.answers, { replaces: id, coordinator: { name: doc.coordinatorName || '' } });
  }

  /* ---- hooks from the admin flow ---- */

  async function beforeCreate(draft) {
    const id = draft.coordinatorRequest.id;
    const doc = await requests.get(id);
    if (doc && doc.status === 'booking' && doc.bookingBy === draft.phone) return { ok: true };
    return { ok: false, message: decidedText(doc) };
  }

  async function onCreated(draft, result) {
    const id = draft.coordinatorRequest.id;
    const at = now();
    const doc = await requests.transact(id, (current) => ({
      patch: current
        ? { status: 'booked', requestId: result.requestId, bookedBy: draft.phone, bookedAtMillis: at, bookingAdmin: null }
        : null,
      result: current
    }));
    const d = draft.data;
    const coordinatorPhone = (doc && doc.coordinatorPhone) || draft.coordinatorRequest.coordinatorPhone;
    if (coordinatorPhone) {
      await say(coordinatorPhone, `✅ ${id} booked for ${d.agency.name}, starts ${dayLabel(d.startDate)}.`);
    }
  }

  async function onReleased(draft) {
    const id = draft.coordinatorRequest.id;
    await requests.transact(id, (current) => {
      if (!current || current.status !== 'booking' || current.bookingBy !== draft.phone) return { result: false };
      return { patch: { status: 'pending', bookingBy: null, bookingAtMillis: null, bookingAdmin: null }, result: true };
    });
  }

  /* ---- routing ---- */

  async function noteInbound(phone) {
    const state = await chats.get(phone);
    if (!(now() - Number(state.lastInboundAtMillis || 0) < INBOUND_WRITE_EVERY_MS)) {
      await chats.set(phone, { lastInboundAtMillis: now() });
    }
    return state;
  }

  /** Turns that go before every other bot: the note's buttons, the question or
      reason a reviewer was asked to type, a coordinator's answer to a question. */
  async function maybeHandlePriority(phone, message) {
    const p = normalizePhone(phone);
    const isReviewer = reviewers().has(p);
    const isCoordinator = coordinators().has(p);
    if (!isReviewer && !isCoordinator) return false;

    let state = {};
    try {
      state = isReviewer ? await noteInbound(p) : await chats.get(p);
    } catch (error) {
      console.error('[COORDINATOR_REQUEST_STATE_READ_FAILED]', p, error && error.message);
    }

    const payload = parsePayload(replyId(message));
    if (payload) {
      if (payload.action === 'change') {
        if (!isCoordinator) return false;
        await changeRequest(p, payload.requestId);
        return true;
      }
      if (!isReviewer) return false;
      await chats.set(p, { reviewerAction: null });
      if (payload.action === 'book') await bookIt(p, payload.requestId);
      else if (payload.action === 'addag') await addAgency(p, payload.requestId);
      else if (payload.action === 'drop') await drop(p, payload.requestId);
      else if (payload.action === 'ask') await startAsk(p, payload.requestId);
      else if (payload.action === 'reject') await startReject(p, payload.requestId);
      return true;
    }

    const cmd = command(message);
    const action = isReviewer && state.reviewerAction;
    if (action && now() - Number(action.atMillis) < DAY_MS && message && message.type === 'text') {
      if (OTHER_START_WORDS.has(cmd)) {
        await chats.set(p, { reviewerAction: null });
        return false; // another bot's start word: let it through
      }
      if (cmd === 'cancel') {
        await chats.set(p, { reviewerAction: null });
        await say(p, 'OK, nothing sent.');
        return true;
      }
      if (await handleReviewerText(p, action, message)) return true;
    }

    const relay = isCoordinator && state.relay;
    if (relay && now() - Number(relay.atMillis) < DAY_MS && message && message.type === 'text') {
      const text = messageText(message);
      if (!text || OTHER_START_WORDS.has(cmd) || cmd === 'cancel' || cmd === 'back') return false;
      // A request half-filled after the question arrived keeps its answers.
      const draft = await coordinatorFlow.peekDraft(p).catch(() => null);
      if (draft && Number(draft.updatedAtMillis) > Number(relay.atMillis)) return false;
      await relayReply(p, relay, text.slice(0, 1000));
      return true;
    }
    return false;
  }

  /* The booking chat and the request chat. For a coordinator who is also an
     admin (7736108778), "booking" opens the admin bot and "request" this one;
     a button goes to the chat it came from (ab_ / cr_); anything else goes to
     whichever draft was touched last. Everyone else: the admin bot as before. */
  async function maybeHandleChats(phone, message) {
    const p = normalizePhone(phone);
    if (!coordinators().has(p)) return adminFlow.maybeHandle(phone, message);
    if (coordinatorFlow.isStartWord(message)) return coordinatorFlow.maybeHandle(p, message);
    const isAdmin = admins().has(p);
    if (!isAdmin) return coordinatorFlow.maybeHandle(p, message);
    if (adminFlow.isStartWord(message)) return adminFlow.maybeHandle(p, message);
    const id = getInteractiveReplyId(message) || '';
    if (id.startsWith('cr_')) return coordinatorFlow.maybeHandle(p, message);
    if (id.startsWith('ab_')) return adminFlow.maybeHandle(p, message);
    let mine = null;
    let theirs = null;
    try {
      [mine, theirs] = await Promise.all([coordinatorFlow.peekDraft(p), adminFlow.peekDraft(p)]);
    } catch (error) {
      console.error('[COORDINATOR_REQUEST_ROUTE_READ_FAILED]', p, error && error.message);
      return adminFlow.maybeHandle(p, message);
    }
    if (mine && (!theirs || Number(mine.updatedAtMillis) >= Number(theirs.updatedAtMillis))) {
      return coordinatorFlow.maybeHandle(p, message);
    }
    return adminFlow.maybeHandle(p, message);
  }

  return {
    maybeHandlePriority,
    maybeHandleChats,
    coordinatorFlow,
    sendReviewNote,
    reviewNoteText,
    isKnownPhone: (phone) => {
      const p = normalizePhone(phone);
      return coordinators().has(p) || reviewers().has(p);
    }
  };
}

/* ------------------------------------------------------- live entries --- */

let defaultRequests = null;

function knownPhone(phone) {
  const p = normalizePhone(phone);
  return adminPhoneSet(config.coordinatorPhones).has(p) || adminPhoneSet(config.coordinatorReviewerPhones).has(p);
}

function getDefault() {
  if (!defaultRequests) defaultRequests = createCoordinatorRequests();
  return defaultRequests;
}

/** First thing on the support number. No read at all for other numbers. */
async function maybeHandleCoordinatorPriority(phone, message) {
  if (!knownPhone(phone)) return false;
  try {
    return await getDefault().maybeHandlePriority(phone, message);
  } catch (error) {
    // A fault here must never swallow a real support message.
    console.error('[COORDINATOR_REQUEST_PRIORITY_FAILED]', phone, error && error.message);
    return false;
  }
}

/** In place of the admin booking bot's entry point on the support number. */
async function maybeHandleBookingChats(phone, message) {
  // Not a coordinator or reviewer: exactly the admin bot, untouched.
  if (!knownPhone(phone)) return adminBooking.maybeHandleAdminBooking(phone, message);
  return getDefault().maybeHandleChats(phone, message);
}

module.exports = {
  createCoordinatorRequests,
  maybeHandleCoordinatorPriority,
  maybeHandleBookingChats,
  memoryRequestStore,
  memoryChatStore,
  firestoreRequestStore,
  firestoreChatStore,
  reviewNoteText,
  reviewButtons,
  reviewTemplateValues,
  reviewTemplateComponents,
  decidedText,
  parsePayload,
  timeLabel,
  PAYLOAD,
  PAYLOAD_PREFIX,
  _setDefault: (value) => {
    defaultRequests = value;
  }
};
