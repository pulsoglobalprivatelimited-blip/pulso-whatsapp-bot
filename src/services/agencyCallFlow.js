'use strict';

/**
 * The calling bot: hand the founder one agency at a time, write down what
 * happened, hand him the next one.
 *
 * 100 cold agencies were sent a WhatsApp on 3-5 Oct 2026 and three replied. The
 * other 97 need a phone call, and a call sheet nobody opens is worth nothing —
 * the 516-row CSV from 2 Oct has not had a single row filled. So the sheet comes
 * to him on the phone he is already holding, one agency per message, and the
 * outcome is a button.
 *
 * This file is pure: it parses what he typed and says what should be sent and
 * stored. No Firestore, no WhatsApp. The store and the wiring are separate, so
 * every rule below is tested without either.
 *
 * The bot never messages an agency. Founder's decision, 5 Oct 2026: it hands
 * out numbers and records answers, nothing else — so a mistyped reply can
 * embarrass nobody.
 */

/** What a call can end as. The first three are buttons; WhatsApp allows 3. */
const OUTCOMES = Object.freeze({
  interested: 'interested',
  later: 'later',
  noAnswer: 'no answer',
  notInterested: 'not interested',
  wrongNumber: 'wrong number',
});

const BUTTON_IDS = Object.freeze({
  interested: 'agency_call_interested',
  later: 'agency_call_later',
  noAnswer: 'agency_call_no_answer',
});

/** Where the conversation is. Held on his caller record, not guessed. */
const STATES = Object.freeze({
  idle: 'idle',
  awaitingOutcome: 'awaiting_outcome',
  awaitingNote: 'awaiting_note',
  awaitingFollowUp: 'awaiting_follow_up',
});

/** After three unanswered calls a number stops coming back. */
const MAX_ATTEMPTS = 3;
/** A "no answer" returns after this many days, at a different time of day. */
const NO_ANSWER_RETRY_DAYS = 2;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

/**
 * What he typed or tapped.
 *
 * Deliberately forgiving about case and spacing and nothing else: a command
 * list he has to remember exactly is a command list he will stop using. But
 * "interested" must never be inferred from a sentence containing the word,
 * because that would record an outcome he did not choose.
 */
function parseCommand(input = {}) {
  const buttonId = clean(input.buttonId);
  if (buttonId === BUTTON_IDS.interested) return { kind: 'outcome', outcome: OUTCOMES.interested };
  if (buttonId === BUTTON_IDS.later) return { kind: 'outcome', outcome: OUTCOMES.later };
  if (buttonId === BUTTON_IDS.noAnswer) return { kind: 'outcome', outcome: OUTCOMES.noAnswer };

  const text = lower(input.text);
  if (!text) return { kind: null };

  if (['call', 'next', 'c'].includes(text)) return { kind: 'call' };
  if (['stats', 'status', 'progress'].includes(text)) return { kind: 'stats' };
  if (['stop', 'pause', 'done for today'].includes(text)) return { kind: 'stop' };
  if (['skip', 'leave'].includes(text)) return { kind: 'skip' };
  if (['help', 'commands'].includes(text)) return { kind: 'help' };

  if (['interested', 'yes', 'y'].includes(text)) return { kind: 'outcome', outcome: OUTCOMES.interested };
  if (['later', 'callback', 'call back'].includes(text)) return { kind: 'outcome', outcome: OUTCOMES.later };
  if (['no answer', 'noanswer', 'na', 'not picked', 'no response'].includes(text)) {
    return { kind: 'outcome', outcome: OUTCOMES.noAnswer };
  }
  if (['no', 'not interested', 'n'].includes(text)) return { kind: 'outcome', outcome: OUTCOMES.notInterested };
  if (['wrong', 'wrong number', 'wrong no'].includes(text)) return { kind: 'outcome', outcome: OUTCOMES.wrongNumber };

  if (text.startsWith('note ')) return { kind: 'note', note: clean(input.text).slice(5).trim() };

  return { kind: 'text', text: clean(input.text) };
}

/** A date from "1 week", "3 days", "monday", "12/10" or "2026-10-12". */
function parseFollowUpDate(text, now = new Date()) {
  const t = lower(text);
  if (!t) return null;
  const base = new Date(now.getTime());

  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : iso[0];
  }

  const rel = t.match(/^(\d{1,3})\s*(day|days|week|weeks|month|months)$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const days = unit.startsWith('week') ? n * 7 : unit.startsWith('month') ? n * 30 : n;
    base.setDate(base.getDate() + days);
    return toDayKey(base);
  }
  if (['tomorrow', 'naale'].includes(t)) {
    base.setDate(base.getDate() + 1);
    return toDayKey(base);
  }
  if (['next week'].includes(t)) {
    base.setDate(base.getDate() + 7);
    return toDayKey(base);
  }

  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const idx = days.indexOf(t);
  if (idx >= 0) {
    // Which day it is in Kerala, not on the server, and never today: a callback
    // booked for an hour that has already passed is a callback that never
    // happens. The modulo matters — without it "friday" said next Friday from a
    // Monday, a week late, and nobody would have noticed until the call was
    // missed.
    const istDow = new Date(base.getTime() + 5.5 * 60 * 60 * 1000).getUTCDay();
    const ahead = ((idx - istDow + 7) % 7) || 7;
    base.setDate(base.getDate() + ahead);
    return toDayKey(base);
  }

  const dm = t.match(/^(\d{1,2})[/-](\d{1,2})$/);
  if (dm) {
    const d = new Date(base.getFullYear(), Number(dm[2]) - 1, Number(dm[1]));
    if (d < base) d.setFullYear(d.getFullYear() + 1);
    return Number.isNaN(d.getTime()) ? null : toDayKey(d);
  }
  return null;
}

/** India time, so "tomorrow" means tomorrow in Kerala. */
function toDayKey(date) {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/** The agency as he reads it before dialling. */
function agencyMessage(agency, { position, total } = {}) {
  if (!agency) return '';
  const lines = [];
  const where = clean(agency.district);
  const head = [position && total ? `${position} of ${total}` : '', where].filter(Boolean).join(' · ');
  if (head) lines.push(`*${head}*`, '');
  lines.push(`*${clean(agency.agency)}*`);
  lines.push(clean(agency.phone));
  const extra = [];
  if (agency.repliedToBroadcast) extra.push('⭐ Already replied to our message');
  if (clean(agency.messagedOn)) extra.push(`Messaged ${clean(agency.messagedOn)}`);
  const attempts = Number(agency.attempts || 0);
  if (attempts > 0) extra.push(`Call attempt ${attempts + 1}`);
  if (clean(agency.notes)) extra.push(`Note: ${clean(agency.notes)}`);
  if (extra.length) lines.push('', ...extra);
  return lines.join('\n');
}

/** The three buttons under it. */
function outcomeButtons() {
  return [
    { id: BUTTON_IDS.interested, title: 'Interested' },
    { id: BUTTON_IDS.later, title: 'Later' },
    { id: BUTTON_IDS.noAnswer, title: 'No answer' },
  ];
}

/** The contact card, so he taps to dial instead of copying a number. */
function agencyContactCard(agency) {
  if (!agency) return null;
  const digits = String(agency.phone || '').replace(/\D/g, '');
  const tel = digits.length === 10 ? `+91${digits}` : digits ? `+${digits.replace(/^(\+)?/, '')}` : '';
  const name = clean(agency.agency) || 'Agency';
  return {
    name: { formatted_name: name, first_name: name },
    org: { company: clean(agency.district) ? `Home care · ${clean(agency.district)}` : 'Home care' },
    phones: tel ? [{ phone: tel, type: 'WORK', wa_id: digits.length >= 11 ? digits : `91${digits}` }] : [],
  };
}

function statsMessage(counts = {}) {
  const n = (k) => Number(counts[k] || 0);
  const done = n('interested') + n('later') + n('noAnswer') + n('notInterested') + n('wrongNumber');
  const total = n('total');
  const lines = [
    `*Called ${done} of ${total}*`,
    '',
    `Interested: ${n('interested')}`,
    `Later: ${n('later')}`,
    `No answer: ${n('noAnswer')}`,
    `Not interested: ${n('notInterested')}`,
    `Wrong number: ${n('wrongNumber')}`,
  ];
  if (n('dueToday') > 0) lines.push('', `${n('dueToday')} follow-ups due today`);
  if (clean(counts.nextDistrict)) lines.push('', `Next up: ${clean(counts.nextDistrict)}`);
  return lines.join('\n');
}

const HELP_TEXT = [
  '*Calling commands*',
  '',
  'call — the next agency',
  'skip — leave this one, give me the next',
  'stats — how far I have got',
  'stop — finish for now',
  '',
  'After a call, tap a button or type:',
  'no — not interested',
  'wrong — wrong number',
  'note <anything> — add a note',
].join('\n');

const MESSAGES = Object.freeze({
  help: HELP_TEXT,
  stopped: 'Stopped. Type *call* when you want the next one.',
  allDone: 'That is everyone on the list. Nothing left to call.',
  noneDue: 'Nothing due right now. The follow-ups come back on their date.',
  askNote: 'What do they need? (district, type of staff) — or send *skip*.',
  askFollowUp: 'When should we call again? Try *1 week*, *monday*, or *12/10*.',
  savedNext: 'Saved.',
  notUnderstood: 'I did not catch that. Type *help* to see the commands.',
  nothingInHand: 'No agency in hand. Type *call* to get the next one.',
});

/**
 * What the outcome does to the record.
 *
 * A "no answer" is not a refusal: it comes back in two days, and only after
 * three tries does it stop — most agency owners are driving or on another call.
 * Everything else is final, so the number is never handed out twice.
 */
function recordFor(outcome, { attempts = 0, followUpOn = null, now = new Date() } = {}) {
  const tries = Number(attempts || 0) + 1;
  if (outcome === OUTCOMES.noAnswer) {
    if (tries >= MAX_ATTEMPTS) {
      return { status: 'retired', outcome, attempts: tries, followUpOn: null, nextStep: 'none' };
    }
    const back = new Date(now.getTime());
    back.setDate(back.getDate() + NO_ANSWER_RETRY_DAYS);
    return { status: 'pending', outcome, attempts: tries, followUpOn: toDayKey(back), nextStep: 'call again' };
  }
  if (outcome === OUTCOMES.later) {
    return { status: 'pending', outcome, attempts: tries, followUpOn: followUpOn || null, nextStep: 'call again' };
  }
  return { status: 'done', outcome, attempts: tries, followUpOn: null, nextStep: 'none' };
}

/** Which outcomes need a follow-up question before the next agency goes out. */
function asksFollowUp(outcome) {
  return outcome === OUTCOMES.later;
}

function asksNote(outcome) {
  return outcome === OUTCOMES.interested;
}

module.exports = {
  OUTCOMES,
  BUTTON_IDS,
  STATES,
  MAX_ATTEMPTS,
  NO_ANSWER_RETRY_DAYS,
  MESSAGES,
  parseCommand,
  parseFollowUpDate,
  toDayKey,
  agencyMessage,
  outcomeButtons,
  agencyContactCard,
  statsMessage,
  recordFor,
  asksFollowUp,
  asksNote,
};
