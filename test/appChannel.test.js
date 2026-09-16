'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WHATSAPP_DRY_RUN = process.env.WHATSAPP_DRY_RUN || 'true';

const metaClient = require('../src/services/metaClient');
const appChannel = require('../src/services/appChannel');

test('a collected turn hands every send back instead of posting it', async () => {
  const { replies, result } = await metaClient.runCollected(async () => {
    await metaClient.sendText('919876543210', 'Welcome to Pulso.');
    await metaClient.sendButtons('919876543210', 'Interested?', [
      { id: 'interest_yes', title: 'Yes, interested' },
      { id: 'interest_no', title: 'Not interested' }
    ]);
    await metaClient.sendList('919876543210', 'Pick one', 'Choose', [
      { title: 'Options', rows: [{ id: 'q_gda', title: 'GDA' }] }
    ]);
    await metaClient.sendVideoById('919876543210', '1862764111082996', 'A sample duty');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(replies.length, 4);
  const app = replies.map(appChannel.payloadToAppMessage);
  assert.deepEqual(app[0], { kind: 'text', text: 'Welcome to Pulso.' });
  assert.equal(app[1].kind, 'buttons');
  assert.deepEqual(app[1].buttons.map((b) => b.title), ['Yes, interested', 'Not interested']);
  assert.equal(app[2].kind, 'list');
  assert.equal(app[2].buttonText, 'Choose');
  assert.equal(app[2].sections[0].rows[0].id, 'q_gda');
  assert.deepEqual(app[3], { kind: 'video', text: 'A sample duty', mediaId: '1862764111082996' });
});

test('a send scheduled by a timer inside the turn is still collected, not posted', async () => {
  const { replies } = await metaClient.runCollected(async () => {
    await new Promise((resolve) => setTimeout(async () => {
      await metaClient.sendText('919876543210', 'later');
      resolve();
    }, 5));
  });
  assert.deepEqual(replies.map((p) => p.text.body), ['later']);
});

test('the app\'s taps, rows, text and files become webhook-shaped messages', () => {
  const start = appChannel.buildAppMessage({ phone: '+919876543210', start: true });
  assert.equal(start.from, '919876543210');
  assert.equal(start.type, 'text');
  assert.equal(start.text.body, 'Hi');
  assert.match(start.id, /^app-/);

  const button = appChannel.buildAppMessage({ phone: '919876543210', buttonId: 'interest_yes', buttonTitle: 'Yes, interested' });
  assert.equal(button.type, 'interactive');
  assert.deepEqual(button.interactive.button_reply, { id: 'interest_yes', title: 'Yes, interested' });

  const row = appChannel.buildAppMessage({ phone: '919876543210', listRowId: 'district_ernakulam', listRowTitle: 'Ernakulam' });
  assert.deepEqual(row.interactive.list_reply, { id: 'district_ernakulam', title: 'Ernakulam' });

  const image = appChannel.buildAppMessage({
    phone: '919876543210',
    file: { buffer: Buffer.from('jpeg-bytes'), mimetype: 'image/jpeg', originalname: 'cert.jpg' }
  });
  assert.equal(image.type, 'image');
  assert.ok(metaClient.isAppMediaId(image.image.id));
  assert.equal(image.image.mime_type, 'image/jpeg');

  const pdf = appChannel.buildAppMessage({
    phone: '919876543210',
    file: { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', originalname: 'cert.pdf' }
  });
  assert.equal(pdf.type, 'document');
  assert.equal(pdf.document.filename, 'cert.pdf');

  assert.throws(() => appChannel.buildAppMessage({ phone: '919876543210' }), /nothing to send/);
});

test('an app upload is readable through the same media helpers the flow uses', async () => {
  const message = appChannel.buildAppMessage({
    phone: '919876543210',
    file: { buffer: Buffer.from('certificate-bytes'), mimetype: 'image/png', originalname: 'c.png' }
  });
  const meta = await metaClient.getMediaMetadata(message.image.id);
  assert.equal(meta.mime_type, 'image/png');
  const bytes = await metaClient.downloadMediaFile(meta.url);
  assert.equal(bytes.toString(), 'certificate-bytes');
  await assert.rejects(() => metaClient.downloadMediaFile(meta.url), /expired/);
});

test('the record\'s history becomes the chat, both directions, oldest first', () => {
  const history = [
    { at: '2026-09-16T09:04:00.000Z', type: 'inbound_message', payload: { id: 'app-1', channel: 'app', type: 'text', text: { body: 'Hi' } } },
    { at: '2026-09-16T09:04:01.000Z', type: 'outbound_message', sender: 'bot', payload: { kind: 'list', body: { body: 'Welcome to Pulso.\n\nPlease select your region.', buttonText: 'Select', sections: [{ title: 'Region', rows: [{ id: 'region_kerala', title: 'Kerala' }] }] } } },
    { at: '2026-09-16T09:05:00.000Z', type: 'inbound_message', payload: { id: 'app-2', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'region_kerala', title: 'Kerala' } } } },
    { at: '2026-09-16T09:05:01.000Z', type: 'outbound_message', sender: 'bot', payload: { kind: 'text', body: 'Welcome to Pulso.\nPlease select your qualification.' } },
    { at: '2026-09-16T09:06:00.000Z', type: 'inbound_message', payload: { id: 'app-3', type: 'image', image: { id: 'app:abc', mime_type: 'image/jpeg' } } },
    { at: '2026-09-16T09:06:01.000Z', type: 'outbound_message', sender: 'bot', payload: { kind: 'buttons', body: { body: 'Send more or continue?', buttons: [{ id: 'certificate_add_more', title: 'Send more' }, { id: 'certificate_continue', title: 'Continue' }] } } },
    { at: '2026-09-16T09:07:00.000Z', type: 'system', event: 'certificate_archive_failed' },
    { at: '2026-09-16T09:08:00.000Z', type: 'outbound_message', sender: 'reminder', payload: { kind: 'template', body: { name: 'terms_reminder', languageCode: 'en', components: [] } } }
  ];
  const chat = appChannel.historyToAppMessages(history);
  assert.deepEqual(chat.map((m) => [m.kind, m.outgoing === true]), [
    ['text', true], ['list', false], ['text', true], ['text', false], ['sent_image', true], ['buttons', false]
  ]);
  // The app's opening "Hi" is shown as the button the person tapped.
  assert.equal(chat[0].text, 'Caregiver / nurse job');
  assert.equal(chat[1].sections[0].rows[0].title, 'Kerala');
  assert.equal(chat[5].buttons[1].title, 'Continue');
  assert.equal(chat[5].at, '2026-09-16T09:06:01.000Z');
});
