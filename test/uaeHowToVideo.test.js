'use strict';
// The UAE how-to video (founder approved, 28 Oct 2026): sent once, by a web
// link, right after the install links, before "Have you installed?".
process.env.WHATSAPP_DRY_RUN = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/config');
const flow = require('../src/flow');
const metaClient = require('../src/services/metaClient');
const appChannel = require('../src/services/appChannel');

test('the video is a fixed pulso.co.in link, not an expiring media id', () => {
  assert.equal(config.uaeHowToVideoUrl, 'https://www.pulso.co.in/uae/assets/how-to-take-a-duty.mp4');
});

test('only the UAE flows carry the caption', () => {
  const en = flow.runWithFlow('uae_english', () => flow.MESSAGES.uaeHowToVideoCaption);
  const ml = flow.runWithFlow('uae_malayalam', () => flow.MESSAGES.uaeHowToVideoCaption);
  assert.match(en, /^Watch this video to see how to take a duty in the Pulso app/);
  assert.match(ml, /video-ൽ കാണാം/);
  for (const id of Object.keys(flow.FLOWS).filter((f) => !f.startsWith('uae_'))) {
    assert.ok(!flow.runWithFlow(id, () => flow.MESSAGES.uaeHowToVideoCaption), `${id} must not send the UAE video`);
  }
});

test('a link video reaches the in-app chat with its url and caption', async () => {
  const { replies } = await metaClient.runCollected(async () => {
    await metaClient.sendVideoByUrl('971500000102', config.uaeHowToVideoUrl, 'Watch this video');
  }, { onlyTo: '971500000102' });
  assert.equal(replies.length, 1);
  assert.deepEqual(appChannel.payloadToAppMessage(replies[0]), { kind: 'video', text: 'Watch this video', url: config.uaeHowToVideoUrl });

  const chat = appChannel.historyToAppMessages([
    { at: '2026-10-28T10:00:00.000Z', type: 'outbound_message', sender: 'bot', payload: { kind: 'video_url', body: { link: config.uaeHowToVideoUrl, caption: 'Watch this video' } } }
  ]);
  assert.equal(chat.length, 1);
  assert.equal(chat[0].kind, 'video');
  assert.equal(chat[0].url, config.uaeHowToVideoUrl);
});

test('order after Accept: install links, then the video, then "Have you installed?"', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/onboardingFlow.js'), 'utf8');
  const links = src.indexOf("await sendAndLog(phone, 'text', MESSAGES.uaeAppInstructions, sender);");
  const video = src.indexOf('sendUaeHowToVideo(phone, refreshedProvider, sender)');
  const buttons = src.indexOf('await sendPulsoAppInstalledConfirmationButtons(phone);', links);
  assert.ok(links > 0 && video > links && buttons > video);
});
