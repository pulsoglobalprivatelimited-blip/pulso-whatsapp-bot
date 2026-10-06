'use strict';
/* Admin booking bot (docs/admin_booking_bot_plan.md, founder, 4 Oct 2026).

   On the support number (+91 77361 29809) an admin types "booking" and books
   care for a manpower agency in the chat, with the steps, rules and result of
   New offline booking → A partner agency in the Pulso app. Every read and
   write goes to Pulso Hub's `adminBookingFromBot` (adminBookingHubClient),
   which runs the app's own code as that admin; this module only asks the
   questions, keeps the answers and builds the `create` payload.

   Routing: only the admin phones, and only when they type the start word or
   already have a draft. Any other message from an admin, and every message
   from anyone else, goes to the support chat exactly as before.

   How the steps work: the answers live in `draft.data`, and the next question
   is always the first step whose answer is missing (nextStep). So "back"
   (undo the last answer), "Change something" (clear one group of answers) and
   a refusal from Pulso Hub (clear the step it names) all reopen one step and
   then come back to the summary by themselves, once nothing else is missing.

   Drafts: Firestore adminBookingDrafts/{phone}, kept 24 hours from the last
   message. The store, the hub client and the sender are injectable so tests
   run with an in-memory store, a fake hub and no WhatsApp at all. */
const config = require('../config');
const { getInteractiveReplyId } = require('./messageParser');

const DRAFTS = 'adminBookingDrafts';
const COORDINATOR_DRAFTS = 'coordinatorRequestDrafts';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const START_HOUR_IST = 8; // senior care starts at 8 am
const MIN_DAYS = 5;
const MAX_DAYS = 90;
const MIN_AGE = 18;
const MAX_AGE = 110;
const AGE_REASON_BELOW = 45;
const MIN_PAY = 500;
const MAX_DATE_AHEAD_DAYS = 365;

// WhatsApp limits (Meta Cloud API): enforced on every send below as well.
const LIMITS = { listRows: 10, rowTitle: 24, rowDescription: 72, buttons: 3, buttonTitle: 20, body: 1024 };

const START_WORDS = new Set(['booking', 'book']);
// The care coordinator's request chat (docs/coordinator_booking_request_plan.md)
// runs on this same machine in 'coordinator' mode, started by its own word.
const COORDINATOR_START_WORDS = new Set(['request']);

const TIER_LABEL = { basic: 'Basic', gda: 'GDA', nurse: 'Nurse', all: 'All three' };
const TIER_LONG_LABEL = { basic: 'Basic', gda: 'GDA and above', nurse: 'Nurse', all: 'All three (Basic, GDA, Nurse)' };
// "All three" (6 Oct 2026, as the app's tick boxes): offered to every tier;
// the lowest is the booking's tier and the pay is typed, as the app asks.
const ALL_TIERS = ['basic', 'gda', 'nurse'];
const GENDER_SHORT = { female: 'F', male: 'M', other: 'Other' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ADMIN_ID = {
  GENDER: 'ab_g_',
  NEW_AGENCY: 'ab_ag_new',
  AGENCY: 'ab_ag_',
  DISTRICT: 'ab_dist_',
  DISTRICT_MORE: 'ab_dist_more',
  NEW_PATIENT: 'ab_pt_new',
  PATIENT: 'ab_pt_',
  YES: 'ab_yes',
  NO: 'ab_no',
  FEMALE: 'ab_g_female',
  MALE: 'ab_g_male',
  OTHER: 'ab_g_other',
  ANY: 'ab_g_any',
  SERVICE_8H: 'ab_svc_8h',
  SERVICE_24H: 'ab_svc_24h',
  DATE_1: 'ab_date_1',
  DATE_2: 'ab_date_2',
  DATE_OTHER: 'ab_date_other',
  TIER: 'ab_tier_',
  RATES_KEEP: 'ab_rates_keep',
  RATES_PAY: 'ab_rates_pay',
  RATES_AGENCY: 'ab_rates_agency',
  PUSH: 'ab_after_push',
  MANUAL: 'ab_after_manual',
  AUD_ALL: 'ab_aud_all',
  AUD_NURSE: 'ab_aud_nurse',
  CREATE: 'ab_create',
  CHANGE: 'ab_change',
  CANCEL: 'ab_cancel',
  CHANGE_FIELD: 'ab_chg_'
};

/* The coordinator chat's buttons carry their own prefix, so a tap on an old
   message from one chat can never be read as an answer in the other (one
   number, 7736108778, has both). */
const ID = ADMIN_ID;
const COORDINATOR_ID = Object.fromEntries(Object.entries(ADMIN_ID).map(([k, v]) => [k, v.replace(/^ab_/, 'cr_')]));

const YES_NO_STEPS = {
  bedridden: 'Bedridden?',
  ryles: 'Feeding tube (Ryles)?',
  catheter: 'Urine tube (catheter)?',
  stoma: 'Stoma?',
  trach: 'Tracheostomy?'
};

const PATIENT_DETAIL_FIELDS = ['weight', 'bedridden', 'ryles', 'catheter', 'stoma', 'trach'];

/* ------------------------------------------------------------ helpers --- */

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function adminPhoneSet(list) {
  return new Set((list || []).map(normalizePhone).filter((p) => p.length >= 12));
}

function messageText(message) {
  return message && message.text && typeof message.text.body === 'string' ? message.text.body.trim() : '';
}

function command(message) {
  return messageText(message).toLowerCase().replace(/[.!?]+$/, '').trim();
}

function isStartWord(message, words = START_WORDS) {
  return words.has(command(message));
}

function isCoordinatorStartWord(message) {
  return COORDINATOR_START_WORDS.has(command(message));
}

function money(n) {
  return `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
}

function cut(text, max) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function parseAmount(message) {
  const raw = messageText(message).toLowerCase().replace(/₹|rs\.?|inr|,|\/-|per day|\/day|\s/g, '');
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function parseInteger(message) {
  const raw = messageText(message).replace(/\s|years?|yrs?|days?/gi, '');
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

function parseWeight(message) {
  const raw = messageText(message).toLowerCase().replace(/kgs?|kilos?|\s/g, '');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  return n > 0 && n < 1000 ? n : null;
}

function parseYesNo(message, ids = ID) {
  const id = getInteractiveReplyId(message);
  if (id === ids.YES) return true;
  if (id === ids.NO) return false;
  const t = command(message);
  if (['yes', 'y', 'yeah', 'haan', 'ok'].includes(t)) return true;
  if (['no', 'n', 'nope', 'illa'].includes(t)) return false;
  return null;
}

function parseGender(message, { allowAny = false, allowOther = true } = {}, ids = ID) {
  const id = getInteractiveReplyId(message);
  const t = id ? id.replace(ids.GENDER, '') : command(message);
  const map = { female: 'female', f: 'female', woman: 'female', male: 'male', m: 'male', man: 'male', other: 'other', any: 'any' };
  const g = map[t];
  if (!g) return null;
  if (g === 'any' && !allowAny) return null;
  if (g === 'other' && !allowOther) return null;
  return g;
}

/* IST calendar days as 'YYYY-MM-DD' keys. */
function istDayKey(ms) {
  const d = new Date(ms + IST_OFFSET_MS);
  return keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function keyOf(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.toISOString().slice(0, 10);
}

function keyParts(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m: m - 1, d };
}

function addDays(key, n) {
  const { y, m, d } = keyParts(key);
  return keyOf(y, m, d + n);
}

function daysBetween(a, b) {
  const pa = keyParts(a);
  const pb = keyParts(b);
  return Math.round((Date.UTC(pb.y, pb.m, pb.d) - Date.UTC(pa.y, pa.m, pa.d)) / 86400000);
}

function dayLabel(key) {
  const { m, d } = keyParts(key);
  return `${d} ${MONTHS[m]}`;
}

function weekdayOf(key) {
  const { y, m, d } = keyParts(key);
  return WEEKDAYS[new Date(Date.UTC(y, m, d)).getUTCDay()];
}

function startMillisOf(key) {
  const { y, m, d } = keyParts(key);
  return Date.UTC(y, m, d, START_HOUR_IST, 0, 0) - IST_OFFSET_MS;
}

function validDate(y, m, d) {
  if (!(m >= 0 && m < 12 && d >= 1 && d <= 31 && y >= 2000)) return null;
  const key = keyOf(y, m, d);
  const p = keyParts(key);
  return p.y === y && p.m === m && p.d === d ? key : null;
}

/** DD-MM-YYYY (or / .), or "15 Oct" / "15 October" with an optional year.
    Without a year, the next such date after today. */
function parseTypedDate(text, todayKey) {
  const s = String(text || '').trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  let match = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/);
  if (match) {
    let y = Number(match[3]);
    if (y < 100) y += 2000;
    return validDate(y, Number(match[2]) - 1, Number(match[1]));
  }
  match = s.match(/^(\d{1,2})(?:st|nd|rd|th)? ?([a-z]{3,})\.?(?: (\d{4}))?$/);
  if (!match) return null;
  const m = MONTHS.findIndex((name) => name.toLowerCase() === match[2].slice(0, 3));
  if (m < 0) return null;
  const d = Number(match[1]);
  if (match[3]) return validDate(Number(match[3]), m, d);
  const thisYear = keyParts(todayKey).y;
  const key = validDate(thisYear, m, d);
  if (key && key > todayKey) return key;
  return validDate(thisYear + 1, m, d);
}

/* ----------------------------------------------------------- the steps --- */

function nurseForced(d) {
  return d.stoma === true || d.trach === true;
}

function effectiveTier(d) {
  return nurseForced(d) ? 'nurse' : d.tier;
}

function shiftOf(d) {
  return d.service === 'senior_care_8h' ? '8h' : '24h';
}

/** The patient's age, whether picked from the list or still to be added. */
function patientAgeOf(d) {
  if (d.patient) return Number(d.patient.ageYears);
  if (d.newPatient) return Number(d.newPatient.ageYears);
  return NaN;
}

function ratesValid(d) {
  return Boolean(d.rates && d.rates.requestedTier === effectiveTier(d) && d.rates.shift === shiftOf(d));
}

/* In order. `applies` false → skipped; `done` true → already answered. The
   first step that applies and is not done is the one asked. */
const STEPS = [
  { key: 'newAgencyName', applies: (d) => Boolean(d.newAgency) && !d.agency, done: (d) => Boolean(d.newAgency.name) },
  { key: 'newAgencyPhone', applies: (d) => Boolean(d.newAgency) && !d.agency, done: (d) => Boolean(d.newAgency.phone) },
  { key: 'newAgencyDistrict', applies: (d) => Boolean(d.newAgency) && !d.agency, done: (d) => Boolean(d.newAgency.district) },
  { key: 'agency', applies: (d) => !d.newAgency, done: (d) => Boolean(d.agency) },
  { key: 'agencyPhone', applies: (d) => Boolean(d.agency), done: (d) => Boolean(d.agency.hasPhone) },
  { key: 'newPatientAge', applies: (d) => Boolean(d.newPatient) && !d.patient, done: (d) => Boolean(d.newPatient.ageYears) },
  { key: 'newPatientGender', applies: (d) => Boolean(d.newPatient) && !d.patient, done: (d) => Boolean(d.newPatient.gender) },
  { key: 'patient', applies: (d) => !d.newPatient, done: (d) => Boolean(d.patient) },
  { key: 'patientAge', applies: (d) => Boolean(d.patient), done: (d) => Number(d.patient.ageYears) > 0 },
  { key: 'patientGender', applies: (d) => Boolean(d.patient), done: (d) => Boolean(d.patient.gender) },
  { key: 'weight', done: (d) => Number(d.weight) > 0 },
  { key: 'bedridden', done: (d) => typeof d.bedridden === 'boolean' },
  { key: 'ryles', done: (d) => typeof d.ryles === 'boolean' },
  { key: 'catheter', done: (d) => typeof d.catheter === 'boolean' },
  { key: 'stoma', done: (d) => typeof d.stoma === 'boolean' },
  { key: 'trach', done: (d) => typeof d.trach === 'boolean' },
  { key: 'ageReason', applies: (d) => patientAgeOf(d) < AGE_REASON_BELOW, done: (d) => Boolean(d.ageReason) },
  { key: 'service', done: (d) => Boolean(d.service) },
  { key: 'cgGender', done: (d) => Boolean(d.cgGender) },
  { key: 'startDate', done: (d) => Boolean(d.startDate) },
  { key: 'days', done: (d) => Number(d.days) >= MIN_DAYS },
  { key: 'location', done: (d) => Boolean(d.location) },
  { key: 'tier', applies: (d) => !nurseForced(d), done: (d) => Boolean(d.tier) },
  { key: 'rates', done: (d) => Boolean(d.ratesConfirmed) && ratesValid(d) },
  { key: 'afterCreate', done: (d) => Boolean(d.afterCreate) },
  // All three already says who is offered the work.
  { key: 'audience', applies: (d) => d.afterCreate === 'push_online' && effectiveTier(d) !== 'all', done: (d) => Boolean(d.audience) },
  { key: 'summary', done: () => false }
];

/* The coordinator gives the note only: no agency phone to save, no rates and
   nothing about what happens after creation. The reviewer does those. */
const ADMIN_ONLY_STEPS = new Set(['agencyPhone', 'rates', 'afterCreate', 'audience']);
const COORDINATOR_STEPS = STEPS.filter((s) => !ADMIN_ONLY_STEPS.has(s.key));

function nextStepIn(d, steps = STEPS) {
  for (const step of steps) {
    if (step.applies && !step.applies(d)) continue;
    if (!step.done(d)) return step.key;
  }
  return 'summary';
}

function nextStep(d) {
  return nextStepIn(d, STEPS);
}

const AGENCY_FIELDS = ['agency', 'newAgency', 'client'];
const PATIENT_FIELDS = ['patient', 'newPatient', 'ageReason', ...PATIENT_DETAIL_FIELDS];

/** What clearing one step's answer also clears. */
function clearStep(d, key) {
  switch (key) {
    case 'agency':
      for (const f of [...AGENCY_FIELDS, ...PATIENT_FIELDS]) delete d[f];
      break;
    case 'newAgencyName':
    case 'newAgencyPhone':
    case 'newAgencyDistrict':
      if (d.newAgency) delete d.newAgency[{ newAgencyName: 'name', newAgencyPhone: 'phone', newAgencyDistrict: 'district' }[key]];
      break;
    case 'agencyPhone':
      if (d.agency) d.agency.hasPhone = false;
      delete d.client;
      break;
    case 'patient':
      for (const f of PATIENT_FIELDS) delete d[f];
      break;
    case 'newPatientAge':
      if (d.newPatient) delete d.newPatient.ageYears;
      break;
    case 'newPatientGender':
      if (d.newPatient) delete d.newPatient.gender;
      break;
    case 'patientAge':
      if (d.patient) delete d.patient.ageYears;
      delete d.ageReason;
      break;
    case 'patientGender':
      if (d.patient) delete d.patient.gender;
      break;
    case 'details':
      for (const f of PATIENT_DETAIL_FIELDS) delete d[f];
      break;
    case 'whoRates':
      delete d.tier;
      delete d.rates;
      delete d.ratesConfirmed;
      break;
    case 'tier':
      delete d.tier;
      delete d.ratesConfirmed;
      break;
    case 'rates':
      delete d.ratesConfirmed;
      break;
    case 'afterCreate':
      delete d.afterCreate;
      delete d.audience;
      break;
    default:
      delete d[key];
  }
}

/* "Change something": each row reopens one group, then the summary returns. */
const CHANGE_FIELDS = [
  { key: 'agency', title: 'Agency', clear: ['agency'] },
  { key: 'patient', title: 'Patient', clear: ['patient'] },
  { key: 'details', title: 'Patient details', description: 'Weight, bedridden, tubes', clear: ['details'] },
  { key: 'service', title: 'Service', description: '8 or 24 hours a day', clear: ['service'] },
  { key: 'cgGender', title: 'Caregiver gender', clear: ['cgGender'] },
  { key: 'startDate', title: 'Start date', clear: ['startDate'] },
  { key: 'days', title: 'Days', clear: ['days'] },
  { key: 'location', title: 'Location', clear: ['location'] },
  { key: 'whoRates', title: 'Who and rates', description: 'Tier, caregiver pay, agency charge', clear: ['whoRates'] },
  { key: 'afterCreate', title: 'After creation', description: 'Push online or assign manually', clear: ['afterCreate'] }
];

const COORDINATOR_CHANGE_FIELDS = [
  ...CHANGE_FIELDS.filter((f) => !['whoRates', 'afterCreate'].includes(f.key)),
  { key: 'tier', title: 'Who should do it', description: 'Basic, GDA, Nurse or all three', clear: ['tier'] }
];

/* Which step a refusal from `create` sends the admin back to. Pulso Hub may
   name it (`step`/`field`); otherwise the error code is read for a hint. */
function stepForRefusal(result) {
  const named = String((result && (result.step || result.field)) || '');
  const known = CHANGE_FIELDS.find((f) => f.key === named);
  if (known) return known;
  const code = String((result && result.error) || '').toLowerCase();
  const rules = [
    [/caregiver_gender/, 'cgGender'],
    [/agency|bureau|partner/, 'agency'],
    [/location|service_area|address|area|city|lat|lng/, 'location'],
    [/overlap|start|date|same_day/, 'startDate'],
    [/days|duration/, 'days'],
    [/rate|pay|charge|tier|floor|markup/, 'whoRates'],
    [/member|patient|age|gender|weight/, 'patient']
  ];
  for (const [re, key] of rules) {
    if (re.test(code)) return CHANGE_FIELDS.find((f) => f.key === key);
  }
  return null;
}

/* ----------------------------------------------------------- storage --- */

function firestoreDraftStore(collection = DRAFTS) {
  const { getFirestore } = require('./storage');
  const ref = (phone) => getFirestore().collection(collection).doc(phone);
  return {
    async get(phone) {
      const snap = await ref(phone).get();
      return snap.exists ? snap.data() : null;
    },
    async set(phone, draft) {
      await ref(phone).set({ ...draft, updatedAt: new Date(draft.updatedAtMillis) });
    },
    async delete(phone) {
      await ref(phone).delete();
    }
  };
}

function memoryDraftStore() {
  const docs = new Map();
  return {
    docs,
    async get(phone) {
      return docs.has(phone) ? JSON.parse(JSON.stringify(docs.get(phone))) : null;
    },
    async set(phone, draft) {
      docs.set(phone, JSON.parse(JSON.stringify(draft)));
    },
    async delete(phone) {
      docs.delete(phone);
    }
  };
}

function metaSender() {
  const metaClient = require('./metaClient');
  // Replies on the support number must leave from the support number.
  const options = () =>
    config.providerSupportPhoneNumberId ? { phoneNumberId: config.providerSupportPhoneNumberId } : undefined;
  return {
    text: (to, body) => metaClient.sendText(to, body, options()),
    buttons: (to, body, buttons) => metaClient.sendButtons(to, body, buttons, options()),
    list: (to, body, buttonText, sections) => metaClient.sendList(to, body, buttonText, sections, options())
  };
}

/* ------------------------------------------------------- request note --- */

function phoneLabel(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  return digits ? `+${digits}` : '';
}

/* The lines of a care coordinator's request (docs/coordinator_booking_request_plan.md),
   shared by the coordinator's own summary and the reviewers' note, so the two
   always say the same thing. `mapLink` adds a Google Maps link to the pin. */
function requestLines(d, { mapLink = false } = {}) {
  const lines = [];
  if (d.agency) {
    lines.push(`Agency: ${d.agency.name}`);
  } else if (d.newAgency) {
    const district = d.newAgency.district && (d.newAgency.district.label || d.newAgency.district.key || d.newAgency.district);
    lines.push(
      `Agency: ${[`New: ${d.newAgency.name || '?'}`, d.newAgency.phone ? `owner ${phoneLabel(d.newAgency.phone)}` : '', district || '']
        .filter(Boolean)
        .join(' · ')}`
    );
  }
  const flags = [
    d.bedridden ? 'bedridden' : '',
    d.ryles ? 'Ryles tube' : '',
    d.catheter ? 'catheter' : '',
    d.stoma ? 'stoma' : '',
    d.trach ? 'tracheostomy' : ''
  ].filter(Boolean);
  const p = d.patient || d.newPatient || {};
  const name = d.patient ? d.patient.name || 'Patient' : 'New patient';
  const label = d.patient && d.patient.agencyLabel ? `"${d.patient.agencyLabel}"` : '';
  const patientParts = [
    name,
    label,
    GENDER_SHORT[p.gender] || '',
    Number(p.ageYears) > 0 ? String(p.ageYears) : '',
    Number(d.weight) > 0 ? `${d.weight} kg` : '',
    ...(Number(d.weight) > 0 ? (flags.length ? flags : ['not bedridden, no tubes']) : [])
  ].filter(Boolean);
  lines.push(`Patient: ${patientParts.join(' · ')}`);
  if (d.ageReason) lines.push(`Under 45, because: ${d.ageReason}`);
  if (d.service) {
    const service = d.service === 'senior_care_8h' ? '8 hours' : '24 hours';
    const caregiver = d.cgGender === 'any' || !d.cgGender ? 'any caregiver' : `${d.cgGender} caregiver`;
    lines.push(`Service: ${service} · ${caregiver}`);
  }
  if (d.startDate && Number(d.days) > 0) {
    lines.push(`Dates: ${dayLabel(d.startDate)} to ${dayLabel(addDays(d.startDate, d.days - 1))} · ${d.days} days`);
  }
  if (d.location) {
    const where = d.location.addressSummary || 'pin sent';
    const link = mapLink ? ` https://maps.google.com/?q=${d.location.lat},${d.location.lng}` : '';
    lines.push(`Location: ${where}${link}`);
  }
  const tier = effectiveTier(d);
  if (tier) lines.push(`Who: ${TIER_LONG_LABEL[tier] || tier}`);
  return lines;
}

/* -------------------------------------------------------------- flow --- */

/* deps.mode 'coordinator' is the care coordinator's request chat
   (docs/coordinator_booking_request_plan.md): the same questions, without the
   agency phone, rates and after-creation steps; nothing is written to Pulso
   Hub, and the summary's button sends the answers to deps.onSubmit instead of
   creating a booking.

   deps.hooks (admin mode) lets the coordinator requests follow a booking the
   reviewer makes from one: beforeCreate(draft) → { ok, message },
   onCreated(draft, result), onReleased(draft) when such a draft is cancelled
   or replaced. Only drafts carrying `coordinatorRequest` call them. */
function createAdminBookingFlow(deps = {}) {
  const coordinatorMode = deps.mode === 'coordinator';
  const ID = coordinatorMode ? COORDINATOR_ID : ADMIN_ID;
  const steps = coordinatorMode ? COORDINATOR_STEPS : STEPS;
  const changeFields = coordinatorMode ? COORDINATOR_CHANGE_FIELDS : CHANGE_FIELDS;
  const startWords = coordinatorMode ? COORDINATOR_START_WORDS : START_WORDS;
  const hooks = deps.hooks || {};
  const hub = deps.hub || require('./adminBookingHubClient').createHubClient();
  const store = deps.store || firestoreDraftStore(coordinatorMode ? COORDINATOR_DRAFTS : DRAFTS);
  const sender = deps.send || metaSender();
  const now = deps.now || (() => Date.now());
  const admins = () =>
    adminPhoneSet(deps.adminPhones || (coordinatorMode ? config.coordinatorPhones : config.adminBookingBotPhones));
  const nextStep = (d) => nextStepIn(d, steps);

  /* Sends, trimmed to WhatsApp's limits so a long agency name can never make
     Meta refuse the whole message. */
  const say = (to, body) => sender.text(to, String(body).slice(0, 4096));
  const buttons = (to, body, list) =>
    sender.buttons(
      to,
      String(body).slice(0, LIMITS.body),
      list.slice(0, LIMITS.buttons).map((b) => ({ id: b.id, title: cut(b.title, LIMITS.buttonTitle) }))
    );
  const list = (to, body, buttonText, rows) =>
    sender.list(to, String(body).slice(0, LIMITS.body), cut(buttonText, LIMITS.buttonTitle), [
      {
        title: cut(buttonText, LIMITS.rowTitle),
        rows: rows.slice(0, LIMITS.listRows).map((r) => ({
          id: r.id,
          title: cut(r.title, LIMITS.rowTitle),
          ...(r.description ? { description: cut(r.description, LIMITS.rowDescription) } : {})
        }))
      }
    ]);

  async function call(draft, action, data) {
    return hub.call(draft.phone, action, data);
  }

  async function loadDraft(phone) {
    const draft = await store.get(phone);
    if (!draft) return null;
    if (!(Number(draft.updatedAtMillis) > 0) || now() - Number(draft.updatedAtMillis) > DRAFT_TTL_MS) {
      await store.delete(phone);
      return null;
    }
    draft.data = draft.data || {};
    draft.history = draft.history || [];
    draft.view = draft.view || {};
    return draft;
  }

  async function saveDraft(draft) {
    draft.updatedAtMillis = now();
    draft.expiresAtMillis = draft.updatedAtMillis + DRAFT_TTL_MS;
    await store.set(draft.phone, draft);
  }

  /* ---- asking ---- */

  async function showAgencies(draft, query) {
    const result = await call(draft, 'listAgencies', query ? { query } : {});
    if (!result || result.ok === false) {
      await say(draft.phone, (result && result.message) || 'Could not load the agencies. Try again.');
      return;
    }
    const agencies = Array.isArray(result.agencies) ? result.agencies : [];
    const shown = agencies.slice(0, LIMITS.listRows - 1);
    draft.view.agencyOptions = shown;
    const rows = shown.map((a) => ({
      id: `${ID.AGENCY}${a.id}`,
      title: a.name,
      description: [a.district, a.hasPhone === false ? 'no phone on file' : ''].filter(Boolean).join(' · ')
    }));
    rows.push(
      coordinatorMode
        ? { id: ID.NEW_AGENCY, title: 'Not in the list', description: 'Type its name, number and district' }
        : { id: ID.NEW_AGENCY, title: '+ New agency', description: 'Add an agency that is not listed' }
    );
    let body;
    if (query) {
      body = shown.length
        ? `Agencies matching "${cut(query, 40)}". Pick one, or type another name.`
        : coordinatorMode
          ? `No agency matches "${cut(query, 40)}". Type another name, or tap Not in the list.`
          : `No agency matches "${cut(query, 40)}". Type another name, or add a new agency.`;
    } else {
      const fresh = draft.view.fresh ? (coordinatorMode ? 'New booking request. ' : 'New booking. ') : '';
      body = `${fresh}Which agency is it for? Type part of a name to search.`;
    }
    draft.view.fresh = false;
    await list(draft.phone, body, 'Agencies', rows);
  }

  async function showDistricts(draft) {
    if (!Array.isArray(draft.view.districts)) {
      const result = await call(draft, 'listDistricts', {});
      if (!result || result.ok === false) {
        await say(draft.phone, (result && result.message) || 'Could not load the districts. Try again.');
        return;
      }
      draft.view.districts = Array.isArray(result.districts) ? result.districts : [];
    }
    const all = draft.view.districts;
    const page = Number(draft.view.districtPage) || 0;
    const per = LIMITS.listRows - 1;
    let start = page * per;
    if (start >= all.length) {
      draft.view.districtPage = 0;
      start = 0;
    }
    const remaining = all.length - start;
    const slice = remaining <= LIMITS.listRows ? all.slice(start) : all.slice(start, start + per);
    const rows = slice.map((x) => ({ id: `${ID.DISTRICT}${x.key}`, title: x.label }));
    if (start + slice.length < all.length) rows.push({ id: ID.DISTRICT_MORE, title: 'More', description: 'More districts' });
    await list(draft.phone, 'Which district is the agency in?', 'Districts', rows);
  }

  async function showPatients(draft) {
    const d = draft.data;
    if (coordinatorMode) return showAgencyPatients(draft);
    const result = await call(draft, 'listPatients', { familyId: d.client.familyId });
    if (!result || result.ok === false) {
      await say(draft.phone, (result && result.message) || 'Could not load the patients. Try again.');
      return;
    }
    const patients = Array.isArray(result.patients) ? result.patients : [];
    const shown = patients.slice(0, LIMITS.listRows - 1);
    draft.view.patientOptions = shown;
    draft.view.nextName = result.nextName || `Patient ${patients.length + 1}`;
    const rows = shown.map((p) => ({
      id: `${ID.PATIENT}${p.memberId}`,
      title: p.name || 'Patient',
      description: [
        GENDER_SHORT[p.gender] || '',
        Number(p.ageYears) > 0 ? `${p.ageYears} yrs` : '',
        p.agencyLabel ? `"${p.agencyLabel}"` : ''
      ].filter(Boolean).join(' · ')
    }));
    rows.push({ id: ID.NEW_PATIENT, title: '+ New patient', description: `Adds ${draft.view.nextName}` });
    await list(draft.phone, shown.length ? 'Which patient?' : 'No patients yet for this agency. Add one.', 'Patients', rows);
  }

  function patientRows(patients) {
    return patients.map((p) => ({
      id: `${ID.PATIENT}${p.memberId}`,
      title: p.name || 'Patient',
      description: [
        GENDER_SHORT[p.gender] || '',
        Number(p.ageYears) > 0 ? `${p.ageYears} yrs` : '',
        p.agencyLabel ? `"${p.agencyLabel}"` : ''
      ].filter(Boolean).join(' · ')
    }));
  }

  /* Coordinator: the agency's patients are read without creating its client
     record (listAgencyPatients). A new agency, or one with no client record or
     no patients yet, goes straight to a new patient. */
  async function showAgencyPatients(draft) {
    const d = draft.data;
    if (!d.agency) {
      d.newPatient = { name: 'New patient' };
      return ask(draft, nextStep(d));
    }
    const result = await call(draft, 'listAgencyPatients', { bureauId: d.agency.id });
    if (!result || result.ok === false) {
      await say(draft.phone, (result && result.message) || 'Could not load the patients. Try again.');
      return undefined;
    }
    const patients = Array.isArray(result.patients) ? result.patients : [];
    draft.view.nextName = result.nextName || `Patient ${patients.length + 1}`;
    if (!patients.length) {
      d.newPatient = { name: draft.view.nextName };
      return ask(draft, nextStep(d));
    }
    const shown = patients.slice(0, LIMITS.listRows - 1);
    draft.view.patientOptions = shown;
    const rows = patientRows(shown);
    rows.push({ id: ID.NEW_PATIENT, title: 'New patient', description: `Would be ${draft.view.nextName}` });
    return list(draft.phone, 'Which patient?', 'Patients', rows);
  }

  function ratesText(d) {
    const r = d.rates;
    const keeps = r.agencyCharge - r.pay;
    const tierName = TIER_LABEL[r.tier] || TIER_LABEL[effectiveTier(d)] || r.tier;
    const lines = [
      r.changed ? `Rates for ${tierName}, per day` : `Suggested rates for ${tierName}, per day`,
      `Caregiver gets ${money(r.pay)}`,
      `Agency is charged ${money(r.agencyCharge)}`,
      r.changed && Number(d.days) > 0
        ? `Pulso keeps ${money(keeps)} · ${money(keeps * d.days)} for ${d.days} days`
        : `Pulso keeps ${money(keeps)}`
    ];
    return lines.join('\n');
  }

  async function showRates(draft) {
    const d = draft.data;
    if (!ratesValid(d)) {
      const tier = effectiveTier(d);
      const result = await call(draft, 'rates', {
        tier: tier === 'all' ? ALL_TIERS[0] : tier,
        shift: shiftOf(d),
        hasStoma: d.stoma === true,
        hasTracheostomy: d.trach === true
      });
      if (!result || result.ok === false) {
        await say(draft.phone, (result && result.message) || 'Could not load the rates. Try again.');
        return;
      }
      const pay = Math.round(Number(result.pay));
      const markup = Math.round(Number(result.markup)) || 0;
      const agencyCharge = Number(result.agencyCharge) > 0 ? Math.round(Number(result.agencyCharge)) : pay + markup;
      d.rates = {
        requestedTier: tier,
        tier: result.tier || tier,
        shift: shiftOf(d),
        pay,
        agencyCharge,
        markup,
        agencyEdited: false,
        changed: false
      };
      delete d.ratesConfirmed;
      if (tier === 'all') {
        // More than one tier: no usual pay to suggest; the admin types it.
        d.rates.tier = 'all';
        d.rates.pay = null;
        d.rates.agencyCharge = null;
        d.rates.changed = true;
        draft.view.rateEditing = 'pay';
        await say(draft.phone, `Basic, GDA and Nurse are all offered, so type the caregiver's pay per day. At least ${money(MIN_PAY)}.`);
        return;
      }
    }
    await buttons(draft.phone, ratesText(d), [
      { id: ID.RATES_KEEP, title: 'Keep' },
      { id: ID.RATES_PAY, title: 'Change pay' },
      { id: ID.RATES_AGENCY, title: 'Change agency' }
    ]);
  }

  function summaryText(d) {
    if (coordinatorMode) return ['Check the request', '', ...requestLines(d)].join('\n');
    const p = d.patient || {};
    const flags = [
      d.bedridden ? 'bedridden' : '',
      d.ryles ? 'Ryles tube' : '',
      d.catheter ? 'catheter' : '',
      d.stoma ? 'stoma' : '',
      d.trach ? 'tracheostomy' : ''
    ].filter(Boolean);
    const patientLine = [p.name, GENDER_SHORT[p.gender], p.ageYears, `${d.weight} kg`, flags.length ? flags.join(', ') : 'not bedridden, no tubes']
      .filter((x) => x !== undefined && x !== '')
      .join(' · ');
    const service = d.service === 'senior_care_8h' ? '8 hours a day' : '24 hours a day';
    const caregiver = d.cgGender === 'any' ? 'any caregiver' : `${d.cgGender} caregiver`;
    const end = addDays(d.startDate, d.days - 1);
    const r = d.rates;
    const keeps = r.agencyCharge - r.pay;
    const then =
      d.afterCreate === 'push_online'
        ? `push online to ${d.audience === 'nurse' ? 'nurses only' : 'all caregivers'}`
        : 'assign manually';
    return [
      'Check the booking',
      '',
      `Agency: ${d.agency.name}`,
      `Patient: ${patientLine}`,
      ...(d.ageReason ? [`Under 45, because: ${d.ageReason}`] : []),
      `Service: ${service} · ${caregiver}`,
      `Dates: ${dayLabel(d.startDate)} to ${dayLabel(end)} · ${d.days} days`,
      `Location: ${d.location.addressSummary || 'pin sent'}`,
      `Who: ${TIER_LONG_LABEL[effectiveTier(d)] || effectiveTier(d)}`,
      `Agency charged: ${money(r.agencyCharge)}/day · ${money(r.agencyCharge * d.days)}`,
      `Caregiver gets: ${money(r.pay)}/day · ${money(r.pay * d.days)}`,
      `Pulso keeps: ${money(keeps)}/day · ${money(keeps * d.days)}`,
      'Payment: agency pays week by week',
      `Then: ${then}`
    ].join('\n');
  }

  async function ask(draft, step) {
    const d = draft.data;
    const to = draft.phone;
    draft.step = step;
    switch (step) {
      case 'agency':
        return showAgencies(draft, draft.view.agencyQuery || '');
      case 'newAgencyName':
        return say(to, coordinatorMode ? "Agency not in the list. What is the agency's name?" : "New agency. What is the agency's name?");
      case 'newAgencyPhone':
        return say(to, "Owner's WhatsApp number?");
      case 'newAgencyDistrict':
        return showDistricts(draft);
      case 'agencyPhone':
        return say(to, `${d.agency.name} has no phone on file. Owner's WhatsApp number?`);
      case 'patient':
        return showPatients(draft);
      case 'newPatientAge':
        if (coordinatorMode) return say(to, "New patient. Patient's age in years?");
        return say(to, `New patient: ${d.newPatient.name}. The agency can give a name in its app.\n\nPatient's age in years?`);
      case 'patientAge':
        return say(to, "Patient's age in years?");
      case 'newPatientGender':
      case 'patientGender':
        return buttons(to, "Patient's gender?", [
          { id: ID.FEMALE, title: 'Female' },
          { id: ID.MALE, title: 'Male' }
        ]);
      case 'weight':
        return say(to, 'Weight in kg?');
      case 'bedridden':
      case 'ryles':
      case 'catheter':
      case 'stoma':
      case 'trach':
        return buttons(to, YES_NO_STEPS[step], [
          { id: ID.YES, title: 'Yes' },
          { id: ID.NO, title: 'No' }
        ]);
      case 'ageReason':
        return say(to, `Age is under ${AGE_REASON_BELOW}. Why is this booking allowed?`);
      case 'service':
        return buttons(to, 'Which service?', [
          { id: ID.SERVICE_8H, title: '8 hours a day' },
          { id: ID.SERVICE_24H, title: '24 hours a day' }
        ]);
      case 'cgGender':
        return buttons(to, 'Caregiver gender?', [
          { id: ID.ANY, title: 'Any' },
          { id: ID.FEMALE, title: 'Female' },
          { id: ID.MALE, title: 'Male' }
        ]);
      case 'startDate': {
        if (draft.view.dateTyping) {
          return say(to, 'Type the start date, like 15-10-2026 or 15 Oct.');
        }
        const today = istDayKey(now());
        const t1 = addDays(today, 1);
        const t2 = addDays(today, 2);
        return buttons(to, 'Start date? Senior care starts at 8 am.', [
          { id: ID.DATE_1, title: `Tomorrow, ${dayLabel(t1)}` },
          { id: ID.DATE_2, title: `${weekdayOf(t2)}, ${dayLabel(t2)}` },
          { id: ID.DATE_OTHER, title: 'Another date' }
        ]);
      }
      case 'days':
        return say(to, `How many days? At least ${MIN_DAYS}.`);
      case 'location':
        return say(to, 'Where is the care? Send the location pin: tap 📎, then Location, then Send.');
      case 'tier':
        return list(to, 'Who should do this work?', 'Choose', [
          { id: `${ID.TIER}basic`, title: 'Basic' },
          { id: `${ID.TIER}gda`, title: 'GDA and above' },
          { id: `${ID.TIER}nurse`, title: 'Nurse' },
          { id: `${ID.TIER}all`, title: 'All three', description: 'Basic, GDA and Nurse' }
        ]);
      case 'rates':
        if (draft.view.rateEditing === 'pay') return say(to, `Caregiver's pay per day? At least ${money(MIN_PAY)}.`);
        if (draft.view.rateEditing === 'agency') {
          return say(to, `What is the agency charged per day? At least ${money(d.rates.pay)}, the caregiver's pay.`);
        }
        return showRates(draft);
      case 'afterCreate':
        return buttons(to, 'After the booking is created?', [
          { id: ID.PUSH, title: 'Push online' },
          { id: ID.MANUAL, title: 'Assign manually' }
        ]);
      case 'audience':
        return buttons(to, 'Send the offer to?', [
          { id: ID.AUD_ALL, title: 'All caregivers' },
          { id: ID.AUD_NURSE, title: 'Nurses only' }
        ]);
      case 'summary':
        return buttons(to, summaryText(d), [
          { id: ID.CREATE, title: coordinatorMode ? 'Send for review' : 'Create booking' },
          { id: ID.CHANGE, title: 'Change something' },
          { id: ID.CANCEL, title: 'Cancel' }
        ]);
      case 'changePick':
        return list(
          to,
          'What do you want to change?',
          'Change',
          changeFields.map((f) => ({ id: `${ID.CHANGE_FIELD}${f.key}`, title: f.title, description: f.description }))
        );
      default:
        return undefined;
    }
  }

  async function askNext(draft) {
    await ask(draft, nextStep(draft.data));
  }

  /* ---- side effects after an agency is settled ---- */

  async function settleAgency(draft) {
    const d = draft.data;
    if (coordinatorMode) return true; // nothing is opened in Pulso Hub for a request
    if (!d.agency || !d.agency.hasPhone || d.client) return true;
    const result = await call(draft, 'ensureClient', { bureauId: d.agency.id });
    if (!result || result.ok === false) {
      await say(draft.phone, (result && result.message) || "Could not open the agency's client record. Pick the agency again.");
      clearStep(d, 'agency');
      draft.history = draft.history.filter((k) => k !== 'agency' && k !== 'agencyPhone');
      return false;
    }
    d.client = { familyId: result.familyId, name: result.name || '', phone: result.phone || '', city: result.city || '' };
    await say(draft.phone, `${d.agency.name} · manpower supply. The patient stays the agency's client; Pulso provides the caregiver.`);
    return true;
  }

  /* ---- answering: true = answered (moves on), false = ask again ---- */

  async function answer(draft, step, message) {
    const d = draft.data;
    const to = draft.phone;
    const id = getInteractiveReplyId(message) || '';
    const text = messageText(message);

    switch (step) {
      case 'agency': {
        if (id === ID.NEW_AGENCY) {
          d.newAgency = {};
          draft.view.districtPage = 0;
          return true;
        }
        if (id.startsWith(ID.AGENCY)) {
          const agencyId = id.slice(ID.AGENCY.length);
          const found = (draft.view.agencyOptions || []).find((a) => String(a.id) === agencyId);
          if (!found) return false;
          d.agency = { id: found.id, name: found.name, district: found.district || '', hasPhone: found.hasPhone !== false };
          delete draft.view.agencyQuery;
          return true;
        }
        if (text) {
          draft.view.agencyQuery = text;
          await showAgencies(draft, text);
          return null; // asked already
        }
        return false;
      }
      case 'newAgencyName':
        if (text.length < 2) return false;
        d.newAgency.name = text.slice(0, 80);
        return true;
      case 'newAgencyPhone':
      case 'agencyPhone': {
        const digits = text.replace(/\D/g, '');
        if (digits.length < 10) {
          await say(to, 'That needs at least 10 digits.');
          return false;
        }
        const phone = normalizePhone(digits);
        if (step === 'newAgencyPhone') {
          d.newAgency.phone = phone;
          return true;
        }
        const result = await call(draft, 'setAgencyPhone', { bureauId: d.agency.id, phone });
        if (!result || result.ok === false) {
          await say(to, (result && result.message) || 'Could not save the number. Try again.');
          return false;
        }
        d.agency.hasPhone = true;
        return true;
      }
      case 'newAgencyDistrict': {
        const districts = draft.view.districts || [];
        if (id === ID.DISTRICT_MORE) {
          draft.view.districtPage = (Number(draft.view.districtPage) || 0) + 1;
          await showDistricts(draft);
          return null;
        }
        let district = null;
        if (id.startsWith(ID.DISTRICT)) district = districts.find((x) => `${ID.DISTRICT}${x.key}` === id);
        else if (text) district = districts.find((x) => String(x.label).toLowerCase() === text.toLowerCase() || String(x.key).toLowerCase() === text.toLowerCase());
        if (!district) return false;
        if (coordinatorMode) {
          // Written in the note only; the reviewer adds the agency when booking.
          d.newAgency.district = { key: district.key, label: district.label || district.key };
          return true;
        }
        const result = await call(draft, 'createAgency', { name: d.newAgency.name, ownerPhone: d.newAgency.phone, district: district.key });
        if (!result || result.ok === false || !result.agency) {
          await say(to, (result && result.message) || 'Could not add the agency. Try again.');
          return false;
        }
        d.agency = { id: result.agency.id, name: result.agency.name || d.newAgency.name, district: result.agency.district || district.key, hasPhone: true };
        delete d.newAgency;
        // The new agency now stands where the agency answer would.
        draft.history = draft.history.filter((k) => !k.startsWith('newAgency'));
        return 'agency';
      }
      case 'patient': {
        if (id === ID.NEW_PATIENT) {
          d.newPatient = { name: draft.view.nextName || 'New patient' };
          return true;
        }
        if (id.startsWith(ID.PATIENT)) {
          const memberId = id.slice(ID.PATIENT.length);
          const p = (draft.view.patientOptions || []).find((x) => String(x.memberId) === memberId);
          if (!p) return false;
          d.patient = {
            memberId: p.memberId,
            name: p.name || 'Patient',
            agencyLabel: p.agencyLabel || '',
            gender: ['female', 'male'].includes(p.gender) ? p.gender : '',
            ageYears: Number(p.ageYears) > 0 ? Math.round(Number(p.ageYears)) : 0
          };
          return true;
        }
        return false;
      }
      case 'newPatientAge':
      case 'patientAge': {
        const age = parseInteger(message);
        if (age === null || age < MIN_AGE || age > MAX_AGE) {
          await say(to, `Type the age in years, ${MIN_AGE} to ${MAX_AGE}.`);
          return false;
        }
        if (step === 'newPatientAge') d.newPatient.ageYears = age;
        else d.patient.ageYears = age;
        return true;
      }
      case 'newPatientGender':
      case 'patientGender': {
        // Pulso Hub books only a male or female patient (memberGender).
        const gender = parseGender(message, { allowOther: false }, ID);
        if (!gender) return false;
        if (step === 'patientGender') {
          d.patient.gender = gender;
          return true;
        }
        if (coordinatorMode) {
          d.newPatient.gender = gender; // the reviewer adds the patient when booking
          return true;
        }
        const result = await call(draft, 'addPatient', {
          familyId: d.client.familyId,
          gender,
          ageYears: d.newPatient.ageYears
        });
        if (!result || result.ok === false || !result.memberId) {
          await say(to, (result && result.message) || 'Could not add the patient. Try again.');
          return false;
        }
        d.patient = {
          memberId: result.memberId,
          name: result.name || d.newPatient.name,
          agencyLabel: '',
          gender,
          ageYears: d.newPatient.ageYears
        };
        delete d.newPatient;
        draft.history = draft.history.filter((k) => !k.startsWith('newPatient'));
        return 'patient';
      }
      case 'weight': {
        const w = parseWeight(message);
        if (w === null) {
          await say(to, 'Type the weight as a number, like 60.');
          return false;
        }
        d.weight = w;
        return true;
      }
      case 'bedridden':
      case 'ryles':
      case 'catheter':
      case 'stoma':
      case 'trach': {
        const yes = parseYesNo(message, ID);
        if (yes === null) return false;
        const wasForced = nurseForced(d);
        d[step] = yes;
        if (!wasForced && nurseForced(d)) {
          await say(to, 'This needs a nurse, so the tier is set to Nurse.');
        }
        return true;
      }
      case 'ageReason':
        if (text.length < 5) {
          await say(to, 'Please give a reason of at least 5 characters.');
          return false;
        }
        d.ageReason = text.slice(0, 500);
        return true;
      case 'service':
        if (id === ID.SERVICE_8H || /^8/.test(command(message))) d.service = 'senior_care_8h';
        else if (id === ID.SERVICE_24H || /^24/.test(command(message))) d.service = 'senior_care_24h';
        else return false;
        return true;
      case 'cgGender': {
        const g = parseGender(message, { allowAny: true, allowOther: false }, ID);
        if (!g) return false;
        d.cgGender = g;
        return true;
      }
      case 'startDate': {
        const today = istDayKey(now());
        let key = null;
        if (id === ID.DATE_1) key = addDays(today, 1);
        else if (id === ID.DATE_2) key = addDays(today, 2);
        else if (id === ID.DATE_OTHER) {
          draft.view.dateTyping = true;
          await ask(draft, 'startDate');
          return null;
        } else if (text) {
          key = parseTypedDate(text, today);
          if (!key) {
            await say(to, 'I could not read that date. Type it like 15-10-2026 or 15 Oct.');
            draft.view.dateTyping = true;
            return null;
          }
          if (key <= today) {
            await say(to, 'The start must be after today. Same-day starts are made in the app.');
            draft.view.dateTyping = true;
            return null;
          }
          if (daysBetween(today, key) > MAX_DATE_AHEAD_DAYS) {
            await say(to, 'That is more than a year away. Type a nearer date.');
            draft.view.dateTyping = true;
            return null;
          }
        }
        if (!key) return false;
        d.startDate = key;
        delete draft.view.dateTyping;
        return true;
      }
      case 'days': {
        const n = parseInteger(message);
        if (n === null || n < MIN_DAYS || n > MAX_DAYS) {
          await say(to, `Type a number of days, ${MIN_DAYS} to ${MAX_DAYS}.`);
          return false;
        }
        d.days = n;
        return true;
      }
      case 'location': {
        const loc = message && message.type === 'location' ? message.location : null;
        if (!loc || !Number.isFinite(Number(loc.latitude)) || !Number.isFinite(Number(loc.longitude))) return false;
        const result = await call(draft, 'checkLocation', {
          lat: Number(loc.latitude),
          lng: Number(loc.longitude),
          ...(loc.name ? { name: loc.name } : {}),
          ...(loc.address ? { address: loc.address } : {})
        });
        if (!result || result.ok === false) {
          await say(to, `${(result && result.message) || 'Could not check that location.'} Send another pin.`);
          return null;
        }
        if (!result.inServiceArea) {
          await say(to, 'We do not serve this location yet. Send another pin.');
          return null;
        }
        d.location = {
          lat: Number(loc.latitude),
          lng: Number(loc.longitude),
          addressSummary: result.addressSummary || loc.name || loc.address || '',
          city: result.city || '',
          district: result.district || '',
          serviceCityKey: result.serviceCityKey || ''
        };
        return true;
      }
      case 'tier': {
        const t = id.startsWith(ID.TIER) ? id.slice(ID.TIER.length) : { basic: 'basic', gda: 'gda', 'gda and above': 'gda', nurse: 'nurse', all: 'all', 'all three': 'all' }[command(message)];
        if (!TIER_LABEL[t]) return false;
        d.tier = t;
        delete d.ratesConfirmed;
        return true;
      }
      case 'rates': {
        const r = d.rates;
        if (id === ID.RATES_KEEP) {
          if (!r || !(r.pay > 0) || !(r.agencyCharge > 0)) {
            draft.view.rateEditing = 'pay';
            await ask(draft, 'rates');
            return null;
          }
          delete draft.view.rateEditing;
          d.ratesConfirmed = true;
          return true;
        }
        if (id === ID.RATES_PAY || id === ID.RATES_AGENCY) {
          draft.view.rateEditing = id === ID.RATES_PAY ? 'pay' : 'agency';
          await ask(draft, 'rates');
          return null;
        }
        if (!r || !draft.view.rateEditing) return false;
        const amount = parseAmount(message);
        if (draft.view.rateEditing === 'pay') {
          if (amount === null || amount < MIN_PAY) {
            await say(to, `The caregiver's pay can't be under ${money(MIN_PAY)}. Type ${money(MIN_PAY)} or more.`);
            return null;
          }
          r.pay = amount;
          if (!r.agencyEdited) {
            r.agencyCharge = amount + r.markup;
          } else if (r.agencyCharge < amount) {
            r.agencyCharge = amount + r.markup;
            r.agencyEdited = false;
            await say(to, `The agency charge was under the new pay, so it moves to ${money(r.agencyCharge)}.`);
          }
        } else {
          if (amount === null) {
            await say(to, `Type the amount, like ${money(r.pay + r.markup)}.`);
            return null;
          }
          if (amount < r.pay) {
            await say(
              to,
              `${money(amount)} is under the caregiver's pay (${money(r.pay)}). Pulso would pay the difference. Type ${money(r.pay)} or more.`
            );
            return null;
          }
          r.agencyCharge = amount;
          r.agencyEdited = true;
        }
        r.changed = true;
        delete draft.view.rateEditing;
        await showRates(draft);
        return null;
      }
      case 'afterCreate':
        if (id === ID.PUSH) d.afterCreate = 'push_online';
        else if (id === ID.MANUAL) {
          d.afterCreate = 'manual_assign';
          delete d.audience;
        } else return false;
        return true;
      case 'audience':
        if (id === ID.AUD_ALL) d.audience = 'all';
        else if (id === ID.AUD_NURSE) d.audience = 'nurse';
        else return false;
        return true;
      case 'changePick': {
        const field = changeFields.find((f) => `${ID.CHANGE_FIELD}${f.key}` === id);
        if (!field) return false;
        for (const key of field.clear) clearStep(d, key);
        return 'reopen';
      }
      default:
        return false;
    }
  }

  function createPayload(d) {
    const p = d.patient;
    return {
      bureauId: d.agency.id,
      familyId: d.client.familyId,
      memberId: p.memberId,
      service: d.service,
      days: d.days,
      desiredStartMillis: startMillisOf(d.startDate),
      caregiverGender: d.cgGender,
      memberGender: p.gender,
      memberAgeYears: p.ageYears,
      ...(p.ageYears < AGE_REASON_BELOW && d.ageReason ? { ageOverrideReason: d.ageReason } : {}),
      patientWeightKg: d.weight,
      isBedridden: d.bedridden === true,
      hasRylesTube: d.ryles === true,
      hasCatheter: d.catheter === true,
      hasStoma: d.stoma === true,
      hasTracheostomy: d.trach === true,
      addressLat: d.location.lat,
      addressLng: d.location.lng,
      addressSummary: d.location.addressSummary,
      city: d.location.city,
      ...(effectiveTier(d) === 'all'
        ? { providerTier: ALL_TIERS[0], dispatchTiers: ALL_TIERS.slice() }
        : { providerTier: d.rates.tier || effectiveTier(d) }),
      partnerProviderRate: d.rates.pay,
      partnerCustomerRate: d.rates.agencyCharge,
      offlinePostCreateAction: d.afterCreate,
      dispatchAudience: d.afterCreate === 'push_online' && effectiveTier(d) !== 'all' ? d.audience || 'all' : 'all'
    };
  }

  async function createBooking(draft) {
    const d = draft.data;
    const linked = draft.coordinatorRequest && draft.coordinatorRequest.id;
    if (linked && typeof hooks.beforeCreate === 'function') {
      // The request may have been taken back or decided since the draft opened.
      const check = await hooks.beforeCreate(draft);
      if (!check || check.ok === false) {
        await store.delete(draft.phone);
        await say(draft.phone, (check && check.message) || `${linked} can't be booked from here any more.`);
        return false;
      }
    }
    const payload = createPayload(d);
    if (linked) {
      payload.coordinatorRequestId = draft.coordinatorRequest.id;
      payload.coordinatorPhone = draft.coordinatorRequest.coordinatorPhone || '';
    }
    const result = await call(draft, 'create', payload);
    if (result && result.ok !== false && result.requestId) {
      await store.delete(draft.phone);
      const lines = [
        `✅ Booking created for ${d.agency.name} · ${d.patient.name} · starts ${dayLabel(d.startDate)}.`,
        d.afterCreate === 'push_online' ? 'Offers are going to caregivers now.' : 'Assign the caregiver in the admin panel.'
      ];
      if (result.adminUrl) lines.push(result.adminUrl);
      lines.push('Type booking for another one.');
      await say(draft.phone, lines.join('\n'));
      if (linked && typeof hooks.onCreated === 'function') {
        try {
          await hooks.onCreated(draft, result);
        } catch (error) {
          console.error('[COORDINATOR_REQUEST_BOOKED_HOOK_FAILED]', linked, error && error.message);
        }
      }
      return true;
    }
    const message = (result && result.message) || 'Pulso Hub did not create the booking.';
    await say(draft.phone, message);
    const back = stepForRefusal(result);
    if (back) {
      for (const key of back.clear) clearStep(d, key);
    }
    await askNext(draft);
    await saveDraft(draft);
    return false;
  }

  /* A draft made from a coordinator request gives the request back (to
     'pending') when it is cancelled, or dropped for another booking. */
  async function release(draft) {
    if (!draft || !draft.coordinatorRequest || typeof hooks.onReleased !== 'function') return;
    try {
      await hooks.onReleased(draft);
    } catch (error) {
      console.error('[COORDINATOR_REQUEST_RELEASE_FAILED]', draft.coordinatorRequest.id, error && error.message);
    }
  }

  /* The person behind the number, from Pulso Hub. Admin mode needs an admin
     login (uid); coordinator mode takes a coordinator or an admin. Pulso Hub
     answers { role, admin | coordinator }; the older flat { uid, name } is
     read too. */
  function whoFrom(who) {
    if (!who || who.ok === false) return null;
    if (coordinatorMode) {
      const person = who.coordinator || who.admin || (who.uid ? who : null);
      return person ? { uid: person.uid || '', name: person.name || '', viaPhone: person.viaPhone || '', role: who.role || (who.coordinator ? 'coordinator' : 'admin') } : null;
    }
    if (who.role === 'coordinator') return null;
    const admin = who.admin && who.admin.uid ? who.admin : who;
    return admin && admin.uid ? { uid: admin.uid, name: admin.name || '', viaPhone: admin.viaPhone || '' } : null;
  }

  const REFUSED = coordinatorMode
    ? "This number can't send booking requests. Ask the owner to add it as a care coordinator."
    : "This number can't make bookings. Ask the owner to add it as an admin.";

  async function startBooking(phone) {
    const previous = coordinatorMode ? null : await loadDraft(phone).catch(() => null);
    await store.delete(phone);
    await release(previous);
    const draft = { phone, data: {}, history: [], view: { fresh: true }, step: 'agency', createdAtMillis: now() };
    const who = await hub.call(phone, 'whoami', {});
    const person = whoFrom(who);
    if (!person) {
      // The admin chat keeps its own words; a coordinator sees Pulso Hub's.
      await say(phone, (coordinatorMode && who && who.ok === false && who.message) || REFUSED);
      return;
    }
    if (coordinatorMode) draft.coordinator = { name: person.name, role: person.role };
    else draft.admin = { uid: person.uid, name: person.name, viaPhone: person.viaPhone };
    await ask(draft, 'agency');
    await saveDraft(draft);
  }

  /* Coordinator: "Change something" on a request already sent reopens its
     answers in a new draft; sending it makes a replacement request. */
  async function reopenRequest(phone, data, { replaces, coordinator } = {}) {
    const draft = {
      phone,
      data: JSON.parse(JSON.stringify(data || {})),
      history: [],
      view: {},
      step: 'changePick',
      createdAtMillis: now(),
      ...(replaces ? { replaces } : {}),
      coordinator: coordinator || {}
    };
    draft.history = answeredSteps(draft.data);
    await ask(draft, 'changePick');
    await saveDraft(draft);
  }

  /** Steps already answered, in order: what "back" walks through. */
  function answeredSteps(d) {
    const out = [];
    for (const step of steps) {
      if (step.key === 'summary') break;
      if (step.applies && !step.applies(d)) continue;
      if (!step.done(d)) break;
      out.push(step.key);
    }
    return out;
  }

  /* Admin: a booking from a coordinator's request. The answers come in as
     draft data; the agency's client record is opened (ensureClient) and a new
     patient added (addPatient) as this admin, and the chat lands on the first
     thing still missing, which is the rates step. */
  async function openPrefilled(phone, data, { admin, coordinatorRequest } = {}) {
    const p = normalizePhone(phone);
    const previous = await loadDraft(p).catch(() => null);
    await store.delete(p);
    if (previous && !(previous.coordinatorRequest && coordinatorRequest && previous.coordinatorRequest.id === coordinatorRequest.id)) {
      await release(previous);
    }
    const draft = {
      phone: p,
      data: JSON.parse(JSON.stringify(data || {})),
      history: [],
      view: {},
      step: 'agency',
      createdAtMillis: now(),
      admin: admin || {},
      ...(coordinatorRequest ? { coordinatorRequest } : {})
    };
    const d = draft.data;
    if (!(await settleAgency(draft))) {
      // settleAgency said why; the admin picks the agency again.
      draft.history = answeredSteps(d);
      await askNext(draft);
      await saveDraft(draft);
      return { ok: false };
    }
    if (!(await settlePatient(draft))) {
      draft.history = answeredSteps(d);
      await askNext(draft);
      await saveDraft(draft);
      return { ok: false };
    }
    draft.history = answeredSteps(d);
    await askNext(draft);
    await saveDraft(draft);
    return { ok: true, step: draft.step };
  }

  /* A new patient whose age and gender are already known (from a request) is
     added once the client record is open. */
  async function settlePatient(draft) {
    const d = draft.data;
    if (coordinatorMode || d.patient || !d.newPatient || !d.client || !(Number(d.newPatient.ageYears) > 0) || !d.newPatient.gender) return true;
    const result = await call(draft, 'addPatient', {
      familyId: d.client.familyId,
      gender: d.newPatient.gender,
      ageYears: d.newPatient.ageYears
    });
    if (!result || result.ok === false || !result.memberId) {
      await say(draft.phone, (result && result.message) || 'Could not add the patient. Add one below.');
      delete d.newPatient.gender;
      return false;
    }
    d.patient = {
      memberId: result.memberId,
      name: result.name || d.newPatient.name,
      agencyLabel: '',
      gender: d.newPatient.gender,
      ageYears: d.newPatient.ageYears
    };
    delete d.newPatient;
    return true;
  }

  async function goBack(draft) {
    const v = draft.view;
    if (draft.step === 'rates' && v.rateEditing) {
      delete v.rateEditing;
    } else if (draft.step === 'startDate' && v.dateTyping) {
      delete v.dateTyping;
    } else if (draft.step === 'newAgencyDistrict' && Number(v.districtPage) > 0) {
      v.districtPage = Number(v.districtPage) - 1;
    } else if (draft.step === 'agency' && v.agencyQuery) {
      delete v.agencyQuery;
    } else if (draft.step === 'changePick') {
      // back from the change list is the summary again
    } else {
      const last = draft.history.pop();
      if (last) clearStep(draft.data, last);
      if (last === 'agency') delete v.agencyQuery;
    }
    await askNext(draft);
    await saveDraft(draft);
  }

  async function submitRequest(draft) {
    if (typeof deps.onSubmit !== 'function') throw new Error('No reviewer is set up for requests');
    const result = await deps.onSubmit(draft);
    if (result && result.ok === false) {
      await say(draft.phone, result.message || 'Could not send the request. Try again.');
      await ask(draft, 'summary');
      await saveDraft(draft);
      return;
    }
    await store.delete(draft.phone);
  }

  async function handleTurn(draft, message) {
    const cmd = command(message);
    if (cmd === 'cancel' || getInteractiveReplyId(message) === ID.CANCEL) {
      await store.delete(draft.phone);
      if (coordinatorMode) {
        await say(
          draft.phone,
          draft.replaces
            ? `Change cancelled. ${draft.replaces} stays as it was sent.`
            : 'Request cancelled. Type request to start again.'
        );
        return;
      }
      await say(
        draft.phone,
        draft.coordinatorRequest
          ? `Booking cancelled. ${draft.coordinatorRequest.id} is back to waiting for review.`
          : 'Booking cancelled. Type booking to start again.'
      );
      await release(draft);
      return;
    }
    if (cmd === 'back') {
      await goBack(draft);
      return;
    }

    const step = draft.step || nextStep(draft.data);

    if (step === 'summary') {
      const id = getInteractiveReplyId(message);
      if (id === ID.CREATE) {
        if (coordinatorMode) await submitRequest(draft);
        else await createBooking(draft);
        return;
      }
      if (id === ID.CHANGE) {
        await ask(draft, 'changePick');
        await saveDraft(draft);
        return;
      }
      await ask(draft, 'summary');
      await saveDraft(draft);
      return;
    }

    const outcome = await answer(draft, step, message);
    if (outcome === null) {
      // The handler already replied (a search, a sub-question, a re-shown panel).
      await saveDraft(draft);
      return;
    }
    if (outcome === false) {
      await ask(draft, step);
      await saveDraft(draft);
      return;
    }
    if (outcome !== 'reopen') {
      const recorded = typeof outcome === 'string' ? outcome : step;
      if (draft.history[draft.history.length - 1] !== recorded) draft.history.push(recorded);
    }
    if (await settleAgency(draft)) await settlePatient(draft);
    await askNext(draft);
    await saveDraft(draft);
  }

  /** The open draft for this number, if any (expired ones are dropped). */
  async function peekDraft(phone) {
    return loadDraft(normalizePhone(phone));
  }

  /** Drops this admin's draft if it was made from that request. */
  async function discardRequestDraft(phone, requestId) {
    const p = normalizePhone(phone);
    const draft = await loadDraft(p).catch(() => null);
    if (draft && draft.coordinatorRequest && draft.coordinatorRequest.id === requestId) await store.delete(p);
  }

  /** True when this message was the booking bot's to answer. */
  async function maybeHandle(phone, message) {
    const p = normalizePhone(phone);
    if (!admins().has(p)) return false;
    const start = isStartWord(message, startWords);
    let draft = null;
    if (!start) {
      try {
        draft = await loadDraft(p);
      } catch (error) {
        console.error(coordinatorMode ? '[COORDINATOR_REQUEST_DRAFT_READ_FAILED]' : '[ADMIN_BOOKING_DRAFT_READ_FAILED]', error && error.message);
        return false;
      }
      if (!draft) return false;
    }
    try {
      if (start) await startBooking(p);
      else await handleTurn(draft, message);
    } catch (error) {
      console.error(coordinatorMode ? '[COORDINATOR_REQUEST_FAILED]' : '[ADMIN_BOOKING_FAILED]', JSON.stringify({ phone: p, message: error && error.message }));
      await say(p, `Something went wrong: ${cut((error && error.message) || 'unknown error', 200)}. Try again, or type cancel.`).catch(() => {});
    }
    return true;
  }

  return {
    mode: coordinatorMode ? 'coordinator' : 'admin',
    ids: ID,
    maybeHandle,
    nextStep,
    createPayload,
    summaryText,
    peekDraft,
    openPrefilled,
    reopenRequest,
    discardRequestDraft,
    isStartWord: (message) => isStartWord(message, startWords),
    setHooks: (next) => Object.assign(hooks, next || {})
  };
}

let defaultFlow = null;

/** The live entry point, called first thing on the support number. */
async function maybeHandleAdminBooking(phone, message) {
  const p = normalizePhone(phone);
  // No Firestore read, no hub call, nothing for anyone not on the list.
  if (!adminPhoneSet(config.adminBookingBotPhones).has(p)) return false;
  return getDefaultFlow().maybeHandle(phone, message);
}

/** The live admin flow (the one the support number uses). */
function getDefaultFlow() {
  if (!defaultFlow) defaultFlow = createAdminBookingFlow();
  return defaultFlow;
}

module.exports = {
  createAdminBookingFlow,
  maybeHandleAdminBooking,
  getDefaultFlow,
  memoryDraftStore,
  firestoreDraftStore,
  normalizePhone,
  isStartWord,
  isCoordinatorStartWord,
  requestLines,
  phoneLabel,
  dayLabel,
  addDays,
  adminPhoneSet,
  cut,
  parseTypedDate,
  istDayKey,
  startMillisOf,
  nextStep,
  stepForRefusal,
  LIMITS,
  ID,
  COORDINATOR_ID,
  DRAFT_TTL_MS,
  _setDefaultFlow: (flow) => {
    defaultFlow = flow;
  }
};
