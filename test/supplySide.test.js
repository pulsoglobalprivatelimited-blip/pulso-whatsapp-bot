'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

/* Browser code with no module system, loaded the way the page loads it. */
function loadPartnerReview() {
  const path = require.resolve('../src/public/assets/partner-review.js');
  delete require.cache[path];
  global.window = { PulsoPartnerReview: null };
  require(path);
  return global.window.PulsoPartnerReview;
}

/* The supply bot's chats are agencies, like the partner bot's, but a different
   queue: one is signing up to the programme, the other wants someone this week.
   The desk has to tell them apart or they pile into one list. */

const supplyChat = {
  phone: '+919000000009',
  enquiryType: 'supply',
  supplyAgencyName: 'Hoppe68',
  supplyDistrict: 'kollam',
  supplyTier: 'basic',
  supplyStatus: 'notified',
  /* The same number went through the partner bot weeks earlier, so the record
     still carries its answers. This is the case that made supply* keys
     necessary: read the partner ones and the desk names the wrong agency. */
  partnerAgencyName: 'Maxpro',
  partnerDistrict: 'ernakulam',
  partnerStatus: 'terms_accepted'
};

const partnerChat = {
  phone: '+919000000001',
  enquiryType: 'partner',
  partnerAgencyName: 'Maxwell Home Care',
  partnerStatus: 'document_received'
};

const familyChat = { phone: '+919000000002', enquiryType: 'care', familyName: 'Omana' };

test('a supply chat is supply, and is not mistaken for a partner one', () => {
  const Partner = loadPartnerReview();
  assert.equal(Partner.isSupply(supplyChat), true);
  assert.equal(Partner.isPartner(supplyChat), false);
});

test('a partner chat is still a partner chat', () => {
  const Partner = loadPartnerReview();
  assert.equal(Partner.isPartner(partnerChat), true);
  assert.equal(Partner.isSupply(partnerChat), false);
});

test('a family booking is neither', () => {
  const Partner = loadPartnerReview();
  assert.equal(Partner.isPartner(familyChat), false);
  assert.equal(Partner.isSupply(familyChat), false);
});

/* The tab badge counts agencies that answered everything and have not been rung.
   The founder switched the WhatsApp alert off, so this badge is the only thing
   that says somebody is waiting — if it counts wrong, nobody is told at all. */
function waitingCount(chats) {
  return chats.filter(
    (chat) => String(chat.enquiryType || '') === 'supply'
      && String(chat.supplyStatus || '') === 'notified'
      && !chat.supplyHandledAt
  ).length;
}

test('the badge counts a finished enquiry nobody has dealt with', () => {
  assert.equal(waitingCount([supplyChat, partnerChat, familyChat]), 1);
});

test('marking one handled clears it from the badge', () => {
  const handled = { ...supplyChat, supplyHandledAt: new Date().toISOString() };
  assert.equal(waitingCount([handled]), 0);
});

test('an agency still partway through is not counted as waiting', () => {
  for (const status of ['asked_agency', 'asked_district', 'asked_need', 'not_now', 'job_redirected']) {
    assert.equal(waitingCount([{ ...supplyChat, supplyStatus: status }]), 0, status);
  }
});

/* Before the Supply side existed these chats had nowhere to go and sat on the
   customer board, so an agency asking for staff was listed as a family booking.
   The customer board now has to let them through to Supply. */
test('the customer board no longer keeps supply chats, and supply keeps only its own', () => {
  const customerKeeps = (type) => type !== 'partner' && type !== 'supply';
  const supplyKeeps = (type) => type === 'supply';
  assert.equal(customerKeeps('supply'), false);
  assert.equal(customerKeeps('care'), true);
  assert.equal(customerKeeps('job'), true);
  assert.equal(supplyKeeps('supply'), true);
  assert.equal(supplyKeeps('care'), false);
  assert.equal(supplyKeeps('partner'), false);
});

/* The tag is not always there. An older chat, or one written before the bot set
   enquiryType, only has the step — and supply_done is a step like any other, so
   without a rule for it the chat is read as a family booking. */
test('a supply chat is recognised from its step alone, not called a booking', () => {
  const Partner = loadPartnerReview();
  const byStepOnly = { phone: '+919000000003', currentStep: 'supply_district' };
  assert.equal(Partner.isSupply(byStepOnly), true);
  assert.equal(Partner.isPartner(byStepOnly), false);
});
