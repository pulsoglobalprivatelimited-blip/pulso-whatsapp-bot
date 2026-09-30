const test = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../src/flow');
const duty = require('../src/services/dutyDaysService');

test('the certificate is its own short message, not a line buried in a long one', async () => {
  // It lived at character 1,836 of a 1,935-character message. WhatsApp folds at
  // about 640 and shows "Read more", so it was 95% of the way down a message
  // almost nobody unfolds — correct, and invisible. A short message is never
  // folded, so this pins BOTH halves: the notice exists, and the long message
  // no longer carries it.
  for (const flowId of ['kerala_malayalam', 'kerala_english']) {
    await flow.runWithFlow(flowId, async () => {
      const notice = flow.MESSAGES.experienceCertificateNotice;
      assert.ok(notice, `${flowId}: the notice exists`);
      assert.match(notice, /180/);
      assert.match(notice, /Experience Certificate/);
      assert.match(notice, /CIN: U86201KL2023PTC084619/);
      assert.match(notice, /pulso\.co\.in/);
      assert.ok(notice.length < 640, `${flowId}: short enough never to be folded (${notice.length})`);
      // Single asterisks, because WhatsApp reads *text* as bold and shows the
      // second pair of a ** ** as literal characters.
      assert.doesNotMatch(notice, /\*\*/, `${flowId}: no double asterisks`);
      assert.doesNotMatch(flow.getWorkingModelFor('gda', null), /[Ee]xperience [Cc]ertificate/,
        `${flowId}: the long message no longer carries it`);
    });
  }
});

test("the founder's Malayalam is carried word for word", async () => {
  await flow.runWithFlow('kerala_malayalam', async () => {
    assert.ok(flow.MESSAGES.experienceCertificateNotice.includes(
      'Pulso-യിൽ ആകെ 180 ദിവസത്തെ duty പൂർത്തിയാക്കുന്ന Caregivers / Nursing Professionals-ന്, '
      + 'healthcare & senior care sector-ൽ പ്രവർത്തിക്കുന്ന Pulso Global Private Limited-ന്റെ '
      + 'ഔദ്യോഗിക Experience Certificate ലഭിക്കുന്നതാണ്.'
    ), 'the sentence the founder wrote on 30 Sep 2026, unedited');
  });
});

test('the certificate is promised to people we have accepted, never to people still waiting', async () => {
  await flow.runWithFlow('kerala_malayalam', async () => {
    const M = flow.MESSAGES;
    assert.match(M.certificateApproved, /experience certificate/);
    // Someone we may still reject after a phone call must not be told what she
    // earns for finishing. Both waiting messages stay silent.
    assert.doesNotMatch(M.verificationPending, /experience certificate/);
    assert.doesNotMatch(M.verificationPendingNoCertificate, /experience certificate/);
    assert.doesNotMatch(M.certificateRejected, /experience certificate/);
    assert.doesNotMatch(M.notInterested, /experience certificate/);
  });
});

test('onboarding ends with the goal and the count at zero', async () => {
  await flow.runWithFlow('kerala_malayalam', async () => {
    assert.match(flow.MESSAGES.termsAccepted, /onboarding പൂർത്തിയായി/);
    assert.match(flow.MESSAGES.termsAccepted, /180 ദിവസത്തെ duty/);
    assert.match(flow.MESSAGES.termsAccepted, /0 ദിവസം പൂർത്തിയായി/);
  });
  await flow.runWithFlow('kerala_english', async () => {
    assert.match(flow.MESSAGES.termsAccepted, /completed 0 days so far/);
  });
});

test('a certificate question is recognised, and ordinary chat is not', () => {
  for (const asked of ['certificate', 'Experience certificate', 'സർട്ടിഫിക്കറ്റ്', '180 days', 'exp certificate']) {
    assert.equal(duty.isDutyDaysQuestion(asked), true, asked);
  }
  for (const other of ['yes', 'duty venam', 'ok', '', 'x'.repeat(200)]) {
    assert.equal(duty.isDutyDaysQuestion(other), false, other);
  }
});

test('she reads her own days left, in her own language', () => {
  const part = { completed: 42, target: 180, remaining: 138, eligible: false };
  assert.match(duty.dutyDaysMessage(part, 'ml'), /42 ദിവസത്തെ duty പൂർത്തിയാക്കി.*ഇനി 138 ദിവസം കൂടി/);
  assert.match(duty.dutyDaysMessage(part, 'en'), /completed 42 duty days so far\. 138 more days/);
  const done = { completed: 180, target: 180, remaining: 0, eligible: true };
  assert.match(duty.dutyDaysMessage(done, 'ml'), /തയ്യാറാണ്/);
  assert.doesNotMatch(duty.dutyDaysMessage(done, 'en'), /more days/);
});

test('an unknown count says nothing rather than claiming zero', () => {
  // "0 days completed" to someone who has worked forty is worse than silence,
  // because she will believe it and stop.
  const text = duty.dutyDaysMessage(null, 'ml');
  assert.doesNotMatch(text, /0 ദിവസം/);
  assert.match(text, /Pulso App-ൽ കാണാം/);
  assert.match(duty.dutyDaysMessage(null, 'en'), /see your days in the Pulso App/);
});

test('the hub uid is read from either place the bot stores it', () => {
  assert.equal(duty.hubUidOf({ appProviderUid: 'u1' }), 'u1');
  assert.equal(duty.hubUidOf({ sync: { matchedUserId: 'u2' } }), 'u2');
  assert.equal(duty.hubUidOf({}), '');
  assert.equal(duty.hubUidOf(null), '');
});

test('only the highest newly-crossed milestone is sent, never a burst', () => {
  // A back-fill can take someone from nothing to 180 in one sweep. Three
  // messages in one minute is how a number gets blocked.
  const at180 = { completed: 180, target: 180, remaining: 0, eligible: true };
  assert.equal(duty.milestoneDue(at180, []).days, 180);
  assert.equal(duty.milestoneDue(at180, ['180']), null);
  const at95 = { completed: 95, target: 180, remaining: 85, eligible: false };
  assert.equal(duty.milestoneDue(at95, []).days, 90);
  assert.equal(duty.milestoneDue(at95, ['90']), null);
});

test('a milestone already sent is never repeated, even if her count falls', () => {
  // An ops correction can turn a counted day into a missed one.
  const dropped = { completed: 88, target: 180, remaining: 92, eligible: false };
  assert.equal(duty.milestoneDue(dropped, ['90']), null);
  assert.equal(duty.milestoneDue({ completed: 10, target: 180, remaining: 170 }, []), null);
  assert.equal(duty.milestoneDue(null, []), null);
});

test('each milestone message carries her real numbers', () => {
  const p = { completed: 152, target: 180, remaining: 28, eligible: false };
  const nearly = duty.milestoneMessage(duty.milestoneDue(p, ['90']), p, 'ml');
  assert.match(nearly, /152 ദിവസത്തെ duty/);
  assert.match(nearly, /ഇനി 28 ദിവസം മാത്രം/);
  const done = { completed: 180, target: 180, remaining: 0, eligible: true };
  assert.match(duty.milestoneMessage({ days: 180, key: 'done' }, done, 'en'), /certificate .* is ready/);
  assert.match(duty.milestoneMessage({ days: 90, key: 'half' }, p, 'en'), /half way there/);
  assert.equal(duty.milestoneMessage(null, p, 'ml'), '');
});

test('sending a milestone spends the lower ones for good', () => {
  const at180 = { days: 180, key: 'done' };
  assert.deepEqual(duty.milestonesCoveredBy(at180), ['180', '150', '90']);
  assert.deepEqual(duty.milestonesCoveredBy({ days: 90, key: 'half' }), ['90']);
  assert.deepEqual(duty.milestonesCoveredBy(null), []);
  // Straight to 180 in one back-fill: she is congratulated once, and never
  // told afterwards that she has 30 days to go.
  const done = { completed: 180, target: 180, remaining: 0, eligible: true };
  assert.equal(duty.milestoneDue(done, duty.milestonesCoveredBy(at180)), null);
});
