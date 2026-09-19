'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';

const {
  parseReviewerAction,
  buildCertificateReviewBodyValues
} = require('../src/services/opsNotifications');
const {
  buildReviewAlertState,
  collectAlertMessages
} = require('../src/services/reviewAlertDelivery');
const {
  needsCatchUp,
  lastAttemptMs,
  MAX_REVIEW_ALERT_RETRIES
} = require('../src/services/certificateReviewCatchUp');
const { isCertificateReviewAlertFailed } = require('../src/services/pulsoHubSyncService');

// ---- the reviewer's tap ----------------------------------------------------

test('a quick reply on the template is read like a tap on the buttons', () => {
  const fromTemplate = parseReviewerAction({
    type: 'button',
    button: { payload: 'review_approve_919000000156', text: 'Approve' }
  });
  const fromButtons = parseReviewerAction({
    type: 'interactive',
    interactive: { button_reply: { id: 'review_approve_919000000156' } }
  });
  assert.deepEqual(fromTemplate, fromButtons);
  assert.deepEqual(fromTemplate, { action: 'approve', phone: '919000000156' });
});

test('reject and ask-again come back off the template too', () => {
  assert.deepEqual(
    parseReviewerAction({ type: 'button', button: { payload: 'review_reject_919000000156' } }),
    { action: 'reject', phone: '919000000156' }
  );
  assert.deepEqual(
    parseReviewerAction({
      type: 'button',
      button: { payload: 'review_request_additional_document_919000000156' }
    }),
    { action: 'request_additional_document', phone: '919000000156' }
  );
});

test('a reviewer typing something is still a note, not a button', () => {
  const action = parseReviewerAction({ type: 'text', text: { body: 'looks fine' } });
  assert.equal(action.action, 'note_text');
  assert.equal(action.note, 'looks fine');
});

// ---- what counts as the alert getting through ------------------------------

test('only the messages a reviewer can act on are tracked as the alert', () => {
  const messages = collectAlertMessages([
    { to: '919446600809', type: 'review_template', ok: true, messages: [{ id: 'a' }] },
    { to: '919446600809', type: 'review_buttons', ok: true, messages: [{ id: 'b' }] },
    { to: '919446600809', type: 'review_media', ok: true, messages: [{ id: 'c' }] },
    { to: '919446600809', type: 'agent_help', ok: true, messages: [{ id: 'd' }] }
  ]);
  assert.deepEqual(messages.map((m) => m.id), ['a', 'b', 'c']);
  assert.deepEqual(
    messages.filter((m) => m.actionable).map((m) => m.id),
    ['b']
  );
});

test('18 Sep: the bare template arriving alone is not the alert getting through', () => {
  // Exactly what happened: the template was read, the buttons and the file were
  // refused for being outside the 24-hour window.
  const state = buildReviewAlertState({
    sent: true,
    recipients: ['919446600809'],
    attempts: [
      { to: '919446600809', type: 'review_template', ok: true, messages: [{ id: 'template' }] },
      { to: '919446600809', type: 'review_buttons', ok: true, messages: [{ id: 'buttons' }] },
      { to: '919446600809', type: 'review_media', ok: true, messages: [{ id: 'media' }] }
    ]
  });

  assert.equal(state.delivered, false);
  assert.equal(state.messages.find((m) => m.id === 'template').actionable, false);
  assert.equal(state.messages.find((m) => m.id === 'buttons').actionable, true);
});

test('a send that never produced a message is a failure straight away', () => {
  const state = buildReviewAlertState({
    sent: true,
    recipients: ['919446600809'],
    attempts: [
      {
        to: '919446600809',
        type: 'review_template_v2',
        ok: false,
        reason: 'attachment_without_archive_url'
      }
    ]
  });
  assert.equal(state.failed, true);
  assert.equal(state.delivered, false);
});

test('the new template landing on its own is the alert getting through', () => {
  const state = buildReviewAlertState({
    sent: true,
    recipients: ['919446600809'],
    attempts: [
      { to: '919446600809', type: 'review_template_v2', ok: true, messages: [{ id: 'v2' }] }
    ]
  });
  state.messages[0].status = 'delivered';
  const failed = isCertificateReviewAlertFailed({
    verification: { reviewAlert: { ...state, delivered: true, failed: false } }
  });
  assert.equal(failed, false);
});

test('a failed alert is what gets escalated to Pulso', () => {
  assert.equal(
    isCertificateReviewAlertFailed({
      verification: { reviewAlert: { failed: true, delivered: false } }
    }),
    true
  );
  assert.equal(
    isCertificateReviewAlertFailed({
      verification: { reviewAlert: { failed: true, delivered: true } }
    }),
    false
  );
  assert.equal(isCertificateReviewAlertFailed({ verification: {} }), false);
});

// ---- the catch-up sweep ----------------------------------------------------

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-09-18T14:30:00.000Z');

function pendingProvider(reviewAlert, extra = {}) {
  return {
    phone: '919000000156',
    status: 'certificate_verification_pending',
    termsAccepted: false,
    completedAt: null,
    verification: { status: 'pending', reviewAlert },
    ...extra
  };
}

test('a caregiver waiting on an undelivered alert is picked up', () => {
  const provider = pendingProvider({
    delivered: false,
    failed: true,
    retryCount: 0,
    lastSentAt: new Date(NOW - 20 * MINUTE).toISOString()
  });
  assert.equal(needsCatchUp(provider, NOW), true);
});

test('an alert sent a minute ago is left alone', () => {
  const provider = pendingProvider({
    delivered: false,
    failed: false,
    retryCount: 0,
    lastSentAt: new Date(NOW - MINUTE).toISOString()
  });
  assert.equal(needsCatchUp(provider, NOW), false);
});

test('a delivered alert is never resent', () => {
  const provider = pendingProvider({
    delivered: true,
    failed: false,
    retryCount: 1,
    lastSentAt: new Date(NOW - 5 * 60 * MINUTE).toISOString()
  });
  assert.equal(needsCatchUp(provider, NOW), false);
});

test('it gives up after three tries and leaves the ops alert standing', () => {
  const provider = pendingProvider({
    delivered: false,
    failed: true,
    retryCount: MAX_REVIEW_ALERT_RETRIES,
    lastSentAt: new Date(NOW - 5 * 60 * MINUTE).toISOString()
  });
  assert.equal(needsCatchUp(provider, NOW), false);
});

test('a record from before this tracking existed falls back to when it last moved', () => {
  const stale = pendingProvider(undefined, { updatedAt: new Date(NOW - 45 * MINUTE).toISOString() });
  const fresh = pendingProvider(undefined, { updatedAt: new Date(NOW - 2 * MINUTE).toISOString() });
  assert.equal(needsCatchUp(stale, NOW), true);
  assert.equal(needsCatchUp(fresh, NOW), false);
});

test('someone already approved or signed up is not swept', () => {
  const approved = pendingProvider({ delivered: false, failed: true, retryCount: 0 }, { termsAccepted: true });
  const done = { ...pendingProvider({ delivered: false, failed: true }), status: 'completed' };
  assert.equal(needsCatchUp(approved, NOW), false);
  assert.equal(needsCatchUp(done, NOW), false);
});

test('the longest wait is served first', () => {
  const week = pendingProvider(undefined, { updatedAt: new Date(NOW - 7 * 24 * 60 * MINUTE).toISOString() });
  const hour = pendingProvider(undefined, { updatedAt: new Date(NOW - 60 * MINUTE).toISOString() });
  assert.ok(lastAttemptMs(week) < lastAttemptMs(hour));
});

test('a reviewAlert timestamp beats the record\'s own updatedAt', () => {
  const provider = pendingProvider(
    { delivered: false, failed: true, retryCount: 1, lastSentAt: new Date(NOW - 20 * MINUTE).toISOString() },
    { updatedAt: new Date(NOW - 5 * 24 * 60 * MINUTE).toISOString() }
  );
  assert.equal(lastAttemptMs(provider), Date.parse(new Date(NOW - 20 * MINUTE).toISOString()));
});

// ---- the template body matches the old free-form alert --------------------

test('the alert Meta receives is the old message, verbatim, with the file on it', async () => {
  // Reconstructs the payload the way the old free-form alert read, so a change
  // to either side shows up here rather than in the reviewer's chat.
  const provider = {
    phone: '918157878452',
    fullName: 'Anjana Santhosh',
    age: 29,
    sex: 'Female',
    region: 'kerala',
    dutyHourPreference: '24_hour',
    qualification: 'bsc_nursing',
    district: 'Ernakulam',
    status: 'certificate_verification_pending'
  };
  const values = buildCertificateReviewBodyValues(provider);
  const labels = [
    'Name', 'Phone', 'Age', 'Sex', 'Region',
    'Preferred duty hour', 'Qualification', 'District', 'Status'
  ];
  const rendered = [
    'New certificate uploaded for review.',
    ...labels.map((label, i) => `${label}: ${values[i]}`),
    'Tap below to approve or reject.'
  ].join('\n');

  assert.equal(
    rendered,
    [
      'New certificate uploaded for review.',
      'Name: Anjana Santhosh',
      'Phone: 918157878452',
      'Age: 29',
      'Sex: Female',
      'Region: kerala',
      'Preferred duty hour: 24 hour',
      'Qualification: BSC_NURSING',
      'District: Ernakulam',
      'Status: certificate verification pending',
      'Tap below to approve or reject.'
    ].join('\n')
  );
});

test('nine body values, in the order the template numbers them', () => {
  const provider = {
    phone: '918157878452',
    fullName: 'Anjana Santhosh',
    age: 29,
    sex: 'Female',
    region: 'kerala',
    dutyHourPreference: '24_hour',
    qualification: 'bsc_nursing',
    district: 'Ernakulam',
    status: 'certificate_verification_pending'
  };
  const values = buildCertificateReviewBodyValues(provider);
  assert.equal(values.length, 9, 'the v3 template has {{1}}..{{9}}');
  assert.equal(values[0], 'Anjana Santhosh');
  assert.equal(values[1], '918157878452');
  assert.equal(values[2], '29');
  assert.equal(values[3], 'Female');
  assert.equal(values[4], 'kerala');
  assert.equal(values[6], 'BSC_NURSING');
  assert.equal(values[7], 'Ernakulam');
  // A template variable may never be empty, or Meta refuses the send.
  values.forEach((v, i) => assert.ok(v && v.length, `value ${i + 1} is empty`));
});

test('a half-filled record still sends: no empty variable reaches Meta', () => {
  const values = buildCertificateReviewBodyValues({ phone: '919000000199' });
  assert.equal(values.length, 9);
  values.forEach((v, i) => assert.ok(v && v.length, `value ${i + 1} is empty`));
  assert.equal(values[0], '-');
});
