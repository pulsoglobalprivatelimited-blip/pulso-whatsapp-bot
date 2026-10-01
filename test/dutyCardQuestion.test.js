const test = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../src/flow');
const parser = require('../src/services/messageParser');

const button = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const text = (body) => ({ type: 'text', text: { body } });

test("the agency question and the benefits are the founder's Malayalam, word for word", async () => {
  await flow.runWithFlow('kerala_malayalam', async () => {
    const M = flow.MESSAGES;
    assert.equal(M.agencyQuestion, 'താങ്കൾ ഇപ്പോൾ ഏതെങ്കിലും Home Care Agency / Caregiving Company വഴി duty ചെയ്യുന്നുണ്ടോ?');
    assert.ok(M.agencyYes.startsWith('നല്ലത് 👍\n\nഇപ്പോൾ ചെയ്യുന്ന duty Pulso App-ൽ add ചെയ്യാം.'));
    assert.ok(M.agencyYes.includes('✓ തുടർച്ചയായി 10 ദിവസം duty പൂർത്തിയാക്കി Agency-യിൽ നിന്ന് 5-star rating ലഭിച്ചാൽ ₹100 reward ലഭിക്കും.'));
    assert.ok(M.agencyYes.endsWith('അതിലൂടെ പുതിയ duty ലഭിക്കാനുള്ള chance മെച്ചപ്പെടും.'));
    assert.equal(M.addDutyInterestQuestion, 'ഇപ്പോൾ ചെയ്യുന്ന duty Pulso App-ൽ add ചെയ്യാൻ താൽപര്യമുണ്ടോ?');
    assert.equal(flow.UI_TEXT.agencyYesTitle, 'ഉണ്ട്');
    assert.equal(flow.UI_TEXT.agencyNoTitle, 'ഇല്ല');
    assert.equal(flow.UI_TEXT.addDutyLaterTitle, 'പിന്നീട്');
  });
});

test('the procedure names every field on the form, the Google number and the ops verification', async () => {
  for (const flowId of ['kerala_malayalam', 'kerala_english', 'karnataka_malayalam', 'karnataka_english']) {
    await flow.runWithFlow(flowId, async () => {
      const p = flow.MESSAGES.addDutyProcedure;
      assert.ok(p, `${flowId}: the procedure exists`);
      assert.match(p, /Add my duty/);
      assert.match(p, /Google/);
      assert.match(p, /map/i);
      assert.match(p, /24 hour \/ Day \/ Night/);
      assert.match(p, /verif/i, 'says Pulso verifies the agency');
      assert.match(p, /selfie/i);
      assert.match(p, /Tip:/);
      assert.ok(p.length < 1024, `${flowId}: fits a WhatsApp text (${p.length})`);
      // Single asterisks only, never ** which WhatsApp shows literally.
      assert.doesNotMatch(p, /\*\*/);
      assert.ok(flow.MESSAGES.addDutyInstallFirst);
      assert.ok(flow.MESSAGES.addDutyLater);
      assert.ok(flow.MESSAGES.agencyQuestionRetry);
    });
  }
});

test('the benefits never promise the reward without the 5-star condition', async () => {
  for (const flowId of ['kerala_malayalam', 'kerala_english']) {
    await flow.runWithFlow(flowId, async () => {
      const y = flow.MESSAGES.agencyYes;
      assert.match(y, /5-star/);
      assert.match(y, /10/);
      assert.match(y, /₹100/);
      assert.match(y, /180/);
    });
  }
});

test('buttons and typed words both answer the agency question', () => {
  assert.equal(parser.parseAgencyAnswer(button(flow.BUTTON_IDS.AGENCY_YES)), 'yes');
  assert.equal(parser.parseAgencyAnswer(button(flow.BUTTON_IDS.AGENCY_NO)), 'no');
  assert.equal(parser.parseAgencyAnswer(text('ഉണ്ട്')), 'yes');
  assert.equal(parser.parseAgencyAnswer(text('Yes')), 'yes');
  assert.equal(parser.parseAgencyAnswer(text('ഇല്ല')), 'no');
  assert.equal(parser.parseAgencyAnswer(text('No')), 'no');
  assert.equal(parser.parseAgencyAnswer(text('I work in Kakkanad')), null);
});

test('buttons and typed words both answer "add it now?"', () => {
  assert.equal(parser.parseAddDutyInterest(button(flow.BUTTON_IDS.ADD_DUTY_NOW)), 'now');
  assert.equal(parser.parseAddDutyInterest(button(flow.BUTTON_IDS.ADD_DUTY_LATER)), 'later');
  assert.equal(parser.parseAddDutyInterest(text('പിന്നീട്')), 'later');
  assert.equal(parser.parseAddDutyInterest(text('Later')), 'later');
  assert.equal(parser.parseAddDutyInterest(text('ഉണ്ട്')), 'now');
  assert.equal(parser.parseAddDutyInterest(text('maybe')), null);
});

test('"duty" and "agency" are keywords; a certificate question is never mistaken for them', () => {
  const duty = require('../src/services/dutyDaysService');
  assert.equal(parser.isAddDutyKeyword(text(' Duty ')), true);
  assert.equal(parser.isAddDutyKeyword(text('add my duty')), true);
  assert.equal(parser.isAddDutyKeyword(text('duty days')), false);
  assert.equal(parser.isAgencyKeyword(text('agency')), true);
  assert.equal(parser.isAgencyKeyword(text('which agency pays more')), false);
  // The certificate matcher runs first in the flow and keeps its own phrases;
  // the bare keywords never collide with it.
  assert.equal(duty.isDutyDaysQuestion({ text: 'experience certificate' }), true);
  assert.equal(duty.isDutyDaysQuestion({ text: 'duty' }), false);
  assert.equal(parser.isAddDutyKeyword(text('experience certificate')), false);
});
