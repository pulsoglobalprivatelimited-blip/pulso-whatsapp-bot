'use strict';

/**
 * One turn of the calling bot: he types, we answer.
 *
 * The rules are in agencyCallFlow (pure, tested); the records are in
 * agencyCallStore. This file only joins them to WhatsApp, so the order of
 * messages — agency, contact card, buttons — lives in one readable place.
 *
 * It never messages an agency. Only the caller hears from this bot.
 */
const flow = require('./agencyCallFlow');
const store = require('./agencyCallStore');
const { sendText, sendButtons, sendContacts } = require('./metaClient');

/**
 * Send the next agency, or say there is none.
 *
 * Three messages in a fixed order: the details, the contact card to dial, then
 * the buttons. The card sits between them on purpose — a card after the buttons
 * pushes them off the screen on a small phone.
 */
async function handOutNext(callerPhone, { now = new Date(), options } = {}) {
  const { agency, position, total } = await store.claimNextAgency(callerPhone, { now });
  if (!agency) {
    const stats = await store.statsFor({ now });
    const text = stats.total === 0 ? flow.MESSAGES.allDone
      : (stats.dueToday > 0 ? flow.MESSAGES.allDone : flow.MESSAGES.noneDue);
    await sendText(callerPhone, text, options);
    await store.setCaller(callerPhone, { state: flow.STATES.idle, inHand: null });
    return { sent: false };
  }

  await sendText(callerPhone, flow.agencyMessage(agency, { position, total }), options);
  const card = flow.agencyContactCard(agency);
  if (card && card.phones.length) {
    try {
      await sendContacts(callerPhone, card, options);
    } catch (error) {
      // A card that will not send must never stop the call: the number is in
      // the message above it either way.
      console.error('[AGENCY_CALL_CARD_FAILED]', agency.id, error && error.message);
    }
  }
  await sendButtons(callerPhone, 'How did the call go?', flow.outcomeButtons(), options);
  await store.setCaller(callerPhone, { state: flow.STATES.awaitingOutcome, inHand: agency.id });
  return { sent: true, agencyId: agency.id };
}

/**
 * Handle one inbound message from a caller.
 *
 * Returns true when the message was ours to answer. False means the caller is
 * an admin but said something the calling bot does not own, so the normal bot
 * should take it — an admin must still be able to use the support bot.
 */
async function handleCallerMessage({ phone, text, buttonId, now = new Date(), options } = {}) {
  const command = flow.parseCommand({ text, buttonId });
  const caller = await store.getCaller(phone);
  const state = (caller && caller.state) || flow.STATES.idle;
  const inHand = caller && caller.inHand;

  if (command.kind === 'help') {
    await sendText(phone, flow.MESSAGES.help, options);
    return true;
  }

  if (command.kind === 'stats') {
    await sendText(phone, flow.statsMessage(await store.statsFor({ now })), options);
    return true;
  }

  if (command.kind === 'stop') {
    if (inHand) await store.releaseAgency(inHand);
    await store.setCaller(phone, { state: flow.STATES.idle, inHand: null });
    await sendText(phone, flow.MESSAGES.stopped, options);
    return true;
  }

  if (command.kind === 'call') {
    await handOutNext(phone, { now, options });
    return true;
  }

  if (command.kind === 'skip') {
    if (!inHand) {
      await sendText(phone, flow.MESSAGES.nothingInHand, options);
      return true;
    }
    await store.skipAgency(inHand);
    await store.setCaller(phone, { state: flow.STATES.idle, inHand: null });
    await handOutNext(phone, { now, options });
    return true;
  }

  if (command.kind === 'note') {
    if (!inHand) {
      await sendText(phone, flow.MESSAGES.nothingInHand, options);
      return true;
    }
    await store.addNote(inHand, command.note, { callerPhone: phone, now });
    await sendText(phone, 'Noted.', options);
    return true;
  }

  if (command.kind === 'outcome') {
    if (!inHand) {
      await sendText(phone, flow.MESSAGES.nothingInHand, options);
      return true;
    }
    // "Later" and "interested" need one more answer before the next agency, so
    // the outcome is held on the caller and written when that answer arrives.
    if (flow.asksFollowUp(command.outcome)) {
      await store.setCaller(phone, { state: flow.STATES.awaitingFollowUp, inHand, pendingOutcome: command.outcome });
      await sendText(phone, flow.MESSAGES.askFollowUp, options);
      return true;
    }
    if (flow.asksNote(command.outcome)) {
      await store.setCaller(phone, { state: flow.STATES.awaitingNote, inHand, pendingOutcome: command.outcome });
      await sendText(phone, flow.MESSAGES.askNote, options);
      return true;
    }
    await store.recordOutcome(inHand, command.outcome, { callerPhone: phone, now });
    await store.setCaller(phone, { state: flow.STATES.idle, inHand: null, pendingOutcome: null });
    await handOutNext(phone, { now, options });
    return true;
  }

  // A plain line, which means something only while the bot is waiting for one.
  if (state === flow.STATES.awaitingFollowUp && inHand) {
    const date = flow.parseFollowUpDate(text, now);
    if (!date) {
      await sendText(phone, flow.MESSAGES.askFollowUp, options);
      return true;
    }
    await store.recordOutcome(inHand, flow.OUTCOMES.later, { callerPhone: phone, followUpOn: date, now });
    await store.setCaller(phone, { state: flow.STATES.idle, inHand: null, pendingOutcome: null });
    await sendText(phone, `Saved. We call them again on ${date}.`, options);
    await handOutNext(phone, { now, options });
    return true;
  }

  if (state === flow.STATES.awaitingNote && inHand) {
    const note = command.kind === 'skip' ? '' : String(text || '').trim();
    await store.recordOutcome(inHand, flow.OUTCOMES.interested, { callerPhone: phone, note, now });
    await store.setCaller(phone, { state: flow.STATES.idle, inHand: null, pendingOutcome: null });
    await sendText(phone, flow.MESSAGES.savedNext, options);
    await handOutNext(phone, { now, options });
    return true;
  }

  if (state === flow.STATES.awaitingOutcome && inHand) {
    await sendText(phone, flow.MESSAGES.notUnderstood, options);
    return true;
  }

  // Idle, and nothing we recognise: leave it to the normal bot.
  return false;
}

/**
 * The entry point the support flow calls, shaped like the booking bot's.
 *
 * Returns false for anyone not on the admin list, and for an admin who said
 * something this bot does not own, so the ordinary support bot still works for
 * him. Nothing is read from Firestore for a stranger — the gate is checked
 * first, on the number alone.
 */
async function maybeHandleAgencyCall(phone, message) {
  try {
    if (!phone) return false;
    if (!(await store.isCallAdmin(phone))) return false;
    const text =
      (message && message.type === 'text' && message.text && message.text.body) ||
      (message && message.interactive && message.interactive.list_reply && message.interactive.list_reply.title) ||
      '';
    const buttonId =
      (message && message.interactive && message.interactive.button_reply && message.interactive.button_reply.id) || '';
    return await handleCallerMessage({ phone, text, buttonId });
  } catch (error) {
    // A fault here must never swallow a real support message.
    console.error('[AGENCY_CALL_BOT_ERROR]', phone, error && error.message);
    return false;
  }
}

module.exports = { handOutNext, handleCallerMessage, maybeHandleAgencyCall };
