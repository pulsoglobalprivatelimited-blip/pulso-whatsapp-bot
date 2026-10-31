const test = require('node:test');
const assert = require('node:assert');
const r = require('../src/services/uaePhotoReminder');

const H = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-30T12:00:00Z');
const provider = (extra = {}) => ({ phone: '971500000150', fullName: 'Asha Mary', region: 'uae', status: 'completed', ...extra });
const hub = (hoursAgo, extra = {}) => ({ uaeLicence: { status: 'pending_photos' }, activatedFromBotAt: new Date(NOW - hoursAgo * H).toISOString(), ...extra });

test('nothing before 24 hours; first at 24 h; second at 72 h; then never', () => {
  assert.strictEqual(r.photoReminderDue(provider(), hub(23), NOW), null);
  assert.strictEqual(r.photoReminderDue(provider(), hub(24), NOW), 1);
  const after1 = provider({ uaePhotoReminder1At: 'x' });
  assert.strictEqual(r.photoReminderDue(after1, hub(48), NOW), null);
  assert.strictEqual(r.photoReminderDue(after1, hub(72), NOW), 2);
  assert.strictEqual(r.photoReminderDue(provider({ uaePhotoReminder1At: 'x', uaePhotoReminder2At: 'y' }), hub(500), NOW), null);
});

test('someone who signed in days ago gets the first one now, not two at once', () => {
  assert.strictEqual(r.photoReminderDue(provider(), hub(100), NOW), 1);
});

test('never once photos are sent, checked, approved or refused', () => {
  for (const status of ['submitted', 'approved', 'rejected', 'video_call']) {
    assert.strictEqual(r.photoReminderDue(provider(), hub(30, { uaeLicence: { status } }), NOW), null, status);
  }
});

test('never for a visa that cannot work, India, or someone not signed in', () => {
  for (const v of ['visit', 'maid', 'cancelled']) assert.strictEqual(r.photoReminderDue(provider(), hub(30, { uaeVisaType: v }), NOW), null, v);
  assert.strictEqual(r.photoReminderDue(provider({ region: 'kerala' }), hub(30), NOW), null);
  assert.strictEqual(r.photoReminderDue(provider(), hub(30, { activatedFromBotAt: null }), NOW), null);
  assert.strictEqual(r.photoReminderDue(provider(), null, NOW), null);
  assert.strictEqual(r.photoReminderDue(provider({ status: 'awaiting_terms_acceptance' }), hub(30), NOW), null);
});

test('template: approved name, English, first name as {{1}}', () => {
  assert.deepStrictEqual(r.templateBody(provider()), {
    name: 'caregiver_uae_id_photos',
    languageCode: 'en',
    components: [{ type: 'body', parameters: [{ type: 'text', text: 'Asha' }] }]
  });
});

test('off unless switched on', () => {
  assert.strictEqual(r.enabled({}), false);
  assert.strictEqual(r.enabled({ UAE_PHOTO_REMINDERS_ENABLED: 'true' }), true);
});

test('sweep marks before sending, sends once, and counts', async () => {
  const calls = [];
  const res = await r.runPhotoReminderSweep({
    listUaeCompleted: async () => [provider(), provider({ phone: '971500000151', uaePhotoReminder1At: 'x' })],
    hubUserFor: async () => hub(30),
    markSent: async (phone, field) => calls.push(['mark', phone, field]),
    send: async (phone, body) => calls.push(['send', phone, body.name]),
    log: async (phone, which) => calls.push(['log', phone, which])
  }, NOW);
  assert.deepStrictEqual(res, { scanned: 2, sent1: 1, sent2: 0, errors: 0 });
  assert.deepStrictEqual(calls, [
    ['mark', '971500000150', 'uaePhotoReminder1At'],
    ['send', '971500000150', 'caregiver_uae_id_photos'],
    ['log', '971500000150', 1]
  ]);
});

test('photo nudge: UAE, completed, app still waiting for photos', () => {
  const r = require('../src/services/uaePhotoReminder');
  const p = { region: 'uae', status: 'completed' };
  assert.equal(r.needsPhotoNudge(p, { uaeLicence: { status: 'pending_photos' } }), true);
  assert.equal(r.needsPhotoNudge(p, { uaeLicence: { status: 'rejected' } }), true);
  assert.equal(r.needsPhotoNudge(p, { uaeLicence: { status: 'submitted' } }), false);
  assert.equal(r.needsPhotoNudge(p, { uaeLicence: { status: 'approved' } }), false);
  assert.equal(r.needsPhotoNudge(p, null), false);
  assert.equal(r.needsPhotoNudge({ region: 'kerala', status: 'completed' }, { uaeLicence: { status: 'pending_photos' } }), false);
  assert.equal(r.needsPhotoNudge({ region: 'uae', status: 'awaiting_terms_acceptance' }, { uaeLicence: { status: 'pending_photos' } }), false);
  assert.match(r.PHOTO_NUDGE_TEXT, /Documents before your first duty/);
  assert.match(r.PHOTO_NUDGE_TEXT, /do not send ID photos on WhatsApp/);
});

test('photo nudge: an album gets one reply, typed words always get it', () => {
  const r = require('../src/services/uaePhotoReminder');
  const now = Date.parse('2026-10-31T12:00:00Z');
  const recent = { uaePhotoNudgeAt: '2026-10-31T11:55:00Z' };
  assert.equal(r.nudgeQuiet(recent, true, now), true);
  assert.equal(r.nudgeQuiet(recent, false, now), false);
  assert.equal(r.nudgeQuiet({ uaePhotoNudgeAt: '2026-10-31T11:40:00Z' }, true, now), false);
  assert.equal(r.nudgeQuiet({}, true, now), false);
});
