'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { shouldEnterDubaiFlow } = require('../src/services/onboardingFlow');
const { parseRegion, isUaePlaceText } = require('../src/services/messageParser');
const { runCollected } = require('../src/services/metaClient');

const plain = (body) => ({ type: 'text', text: { body } });

describe('UAE entry from the app and from typed places (2 Nov 2026)', () => {
  it('a +971 sign-in in the app goes to UAE at the first message', async () => {
    const p = { phone: '971505609563', status: 'new_lead' };
    const { result } = await runCollected(() => shouldEnterDubaiFlow(p, plain('Hi')), { channel: 'app' });
    assert.strictEqual(result, true);
  });

  it('a +971 number on WhatsApp without the ad is not moved by the number alone', () => {
    assert.strictEqual(shouldEnterDubaiFlow({ phone: '971505609563', status: 'new_lead' }, plain('Hi')), false);
  });

  it('a +91 sign-in in the app stays India', async () => {
    const p = { phone: '919876543210', status: 'new_lead' };
    const { result } = await runCollected(() => shouldEnterDubaiFlow(p, plain('Hi')), { channel: 'app' });
    assert.strictEqual(result, false);
  });

  it('typing a UAE place at the region list goes to UAE', () => {
    for (const t of ['Abu Dhabi', 'abudhabi', 'I am in Dubai', 'UAE', 'Sharjah', 'Al Ain']) {
      assert.strictEqual(parseRegion(plain(t)), 'uae', t);
      assert.strictEqual(shouldEnterDubaiFlow({ status: 'awaiting_region_selection' }, plain(t)), true, t);
    }
  });

  it('a long line that only mentions Dubai stays India', () => {
    assert.strictEqual(isUaePlaceText('I worked in Dubai for five years and now live in Kochi'), false);
    assert.strictEqual(parseRegion(plain('Kerala')), 'kerala');
  });

  it('never moves someone already in a flow, even from the app with +971', async () => {
    const p = { phone: '971505609563', status: 'awaiting_qualification', region: 'kerala', flowId: 'kerala_english' };
    const { result } = await runCollected(() => shouldEnterDubaiFlow(p, plain('Abu Dhabi')), { channel: 'app' });
    assert.strictEqual(result, false);
  });
});
