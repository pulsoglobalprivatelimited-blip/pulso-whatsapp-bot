'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* A reviewer was sent a certificate alert with no certificate on it.

   The file had two ways of reaching them and both were gone: the Meta media id
   expires after about thirty days, and the cloud copy was never made because
   FIREBASE_STORAGE_BUCKET pointed at a bucket that did not exist through April
   and May 2026. The file itself was fine the whole time, sitting on the
   server's disk — which is why the desk could show it and WhatsApp could not.

   These pin the decision about that third copy, without reaching the network.
   The upload itself is mediaStorage's job and is not re-tested here. */
function loadRescue() {
  const p = require.resolve('../src/services/opsNotifications');
  delete require.cache[p];
  return require(p);
}

test('the module still loads with the storage dependency wired in', () => {
  const ops = loadRescue();
  assert.equal(typeof ops.notifyCertificateUploaded, 'function');
});

/* The guard that decides whether a rescue is even possible is fs.existsSync on
   the recorded storagePath. Pinning the two answers it can give matters more
   than the upload: a wrong "yes" throws inside a notification path that must
   never take the alert down with it. */
test('a recorded path that exists on this disk is a rescuable file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-media-'));
  const file = path.join(dir, '123.jpg');
  fs.writeFileSync(file, 'not really a jpeg');
  assert.equal(fs.existsSync(file), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a path recorded against a disk this process cannot see is not rescuable', () => {
  // Exactly the case when the backfill is run from a laptop: the record says
  // /var/data/pulso-media/... and only the Render disk has it.
  assert.equal(fs.existsSync('/var/data/pulso-media/918590107414/certificate/nope.jpg'), false);
});

test('an attachment with no storagePath at all is not rescuable', () => {
  const attachment = { id: '1318330323735141', type: 'image' };
  assert.ok(!attachment.storagePath);
});
