'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');

process.env.UAE_CAREGIVER_AD_IDS = '120256529159060670';
const { shouldEnterDubaiFlow } = require('../src/services/onboardingFlow');

const AD = '120256529159060670';
const adMessage = { type: 'text', text: { body: 'Hello! Can I get more info on this?' }, referral: { source_id: AD } };
const plain = (body) => ({ type: 'text', text: { body } });

describe('Dubai ad tag that arrives after her own first message (27 Oct 2026)', () => {
  it('first message carries the tag: Dubai, as before', () => {
    assert.strictEqual(shouldEnterDubaiFlow({ status: 'new_lead' }, adMessage), true);
  });

  it('CV line first, tagged ad message one second later at the region list: Dubai', () => {
    const p = { status: 'awaiting_region_selection', region: null, flowId: null, history: [{ type: 'inbound_message', payload: plain('Kindly find here below my CV') }] };
    assert.strictEqual(shouldEnterDubaiFlow(p, adMessage), true);
  });

  it('stuck at the region list, tag earlier in the chat, she writes again: Dubai', () => {
    const p = { status: 'awaiting_region_selection', history: [
      { type: 'inbound_message', payload: plain('Kindly find here below my CV') },
      { type: 'inbound_message', payload: adMessage }
    ] };
    assert.strictEqual(shouldEnterDubaiFlow(p, plain('I am already in UAE( Abu Dhabi)')), true);
  });

  it('a Kerala ad at the region list stays where she is', () => {
    const p = { status: 'awaiting_region_selection', history: [{ type: 'inbound_message', payload: { referral: { source_id: '999' } } }] };
    assert.strictEqual(shouldEnterDubaiFlow(p, plain('Kerala')), false);
  });

  it('never moves a caregiver who already has a region or a flow', () => {
    assert.strictEqual(shouldEnterDubaiFlow({ status: 'awaiting_region_selection', region: 'kerala' }, adMessage), false);
    assert.strictEqual(shouldEnterDubaiFlow({ status: 'new_lead', flowId: 'kerala_english' }, adMessage), false);
    assert.strictEqual(shouldEnterDubaiFlow({ status: 'awaiting_qualification' }, adMessage), false);
    assert.strictEqual(shouldEnterDubaiFlow({ status: 'completed' }, adMessage), false);
  });

  it('typed DUBAI CAREGIVER still works at the region list', () => {
    assert.strictEqual(shouldEnterDubaiFlow({ status: 'awaiting_region_selection' }, plain('DUBAI CAREGIVER')), true);
  });
});
