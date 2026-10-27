'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isAwaitingUaeLicence, saveProviderContact } = require('../src/services/googleContactsService');
const { handleLicenceReviewed } = require('../src/services/uaeLicence');

describe('Dubai contact is saved only after licence approval (27 Oct 2026)', () => {
  it('holds a Dubai caregiver until approve, never an India one', () => {
    assert.strictEqual(isAwaitingUaeLicence({ region: 'uae' }), true);
    assert.strictEqual(isAwaitingUaeLicence({ region: 'uae', uaeLicenceReview: { action: 'video_call' } }), true);
    assert.strictEqual(isAwaitingUaeLicence({ region: 'uae', uaeLicenceReview: { action: 'approve' } }), false);
    assert.strictEqual(isAwaitingUaeLicence({ region: 'kerala' }), false);
    assert.strictEqual(isAwaitingUaeLicence({ region: 'karnataka' }), false);
  });

  it('saveProviderContact skips a Dubai caregiver who is not approved', async () => {
    const r = await saveProviderContact({ phone: '917025119631', region: 'uae', fullName: 'X' });
    assert.deepStrictEqual([r.ok, r.skipped, r.reason], [false, true, 'uae_awaiting_licence_approval']);
  });

  function deps(provider) {
    const calls = { saved: [], alerts: [], updates: [] };
    let state = { ...provider };
    return {
      calls,
      getProvider: async () => state,
      updateProvider: async (_p, patch) => { calls.updates.push(patch); state = { ...state, ...patch }; },
      appendHistory: async () => {},
      sendText: async () => {},
      sendTemplate: async () => {},
      isWithinWhatsappReplyWindow: () => true,
      saveProviderContact: async (p) => { calls.saved.push(p); return { ok: true, skipped: false, resourceName: 'people/c1', name: 'n' }; },
      notifyUaeLicenceApproved: async (p) => { calls.alerts.push(p); }
    };
  }

  it('approve saves the contact (with the approval on record) and alerts ops', async () => {
    const d = deps({ phone: '917025119631', region: 'uae', fullName: 'Rini Raju' });
    await handleLicenceReviewed({ phone: '917025119631', action: 'approve' }, d);
    assert.strictEqual(d.calls.saved.length, 1);
    assert.strictEqual(d.calls.saved[0].uaeLicenceReview.action, 'approve');
    assert.strictEqual(d.calls.alerts.length, 1);
    assert.ok(d.calls.updates.some((u) => u.contactSync && u.contactSync.resourceName === 'people/c1'));
  });

  for (const action of ['reject', 'video_call']) {
    it(`${action} saves nothing and sends no approval alert`, async () => {
      const d = deps({ phone: '917025119631', region: 'uae', fullName: 'Rini Raju' });
      await handleLicenceReviewed({ phone: '917025119631', action }, d);
      assert.strictEqual(d.calls.saved.length, 0);
      assert.strictEqual(d.calls.alerts.length, 0);
    });
  }
});
