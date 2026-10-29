const test = require('node:test');
const assert = require('node:assert');
const ML = /[ഀ-ൿ]/;
const { buildAgentHelpMessage } = require('../src/services/onboardingFlow');
const ops = require('../src/services/opsNotifications');
const psn = require('../src/services/providerSupportNotifications');
const { channelInviteText } = require('../src/services/channelInvite');

const en = { language: 'en', flowId: 'uae_english', fullName: 'Asha' };
const enNoLang = { flowId: 'kerala_english', fullName: 'Asha' };
const ml = { language: 'ml', flowId: 'kerala_malayalam', fullName: 'Asha' };

test('support reply: English for English, Malayalam for the rest', () => {
  assert.strictEqual(buildAgentHelpMessage(en), 'The Pulso support team will contact you soon.');
  assert.ok(!ML.test(buildAgentHelpMessage(enNoLang)));
  assert.ok(ML.test(buildAgentHelpMessage(ml)));
  assert.ok(ML.test(buildAgentHelpMessage(undefined)));
});

test('staff first message from the ops alert follows her language', () => {
  const e = ops.buildProviderIntroMessage(en, 'Ashmila');
  assert.ok(!ML.test(e));
  assert.match(e, /^Hello Asha, I am Ashmila from the Pulso support team\./);
  assert.ok(ML.test(ops.buildProviderIntroMessage(ml, 'Ashmila')));
});

test('support-bot alert first message follows the session language', () => {
  assert.ok(!ML.test(psn.buildProviderIntroMessage({ language: 'en', region: 'kerala' })));
  assert.ok(!ML.test(psn.buildProviderIntroMessage({ region: 'uae' })));
  assert.ok(ML.test(psn.buildProviderIntroMessage({ language: 'ml' })));
  assert.ok(ML.test(psn.buildProviderIntroMessage({ region: 'kerala' })));
});

test('channel invite: English only for English, both for the rest', () => {
  const e = channelInviteText({ language: 'en', flowId: 'kerala_english' });
  assert.ok(!ML.test(e));
  assert.match(e, /Follow the Pulso duty channel/);
  const m = channelInviteText({ language: 'ml' });
  assert.ok(ML.test(m) && /Follow the Pulso duty channel/.test(m));
  assert.ok(ML.test(channelInviteText()));
});
