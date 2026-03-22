const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getMediaMetadata, downloadMediaFile } = require('./metaClient');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function extensionFromMime(mimeType) {
  if (!mimeType) return '.bin';
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  return `.${mimeType.split('/')[1] || 'bin'}`;
}

async function archiveIncomingMedia(phone, message, category) {
  const mediaId = message.document ? message.document.id : message.image ? message.image.id : null;
  const originalFileName = message.document ? message.document.filename || null : null;

  if (!mediaId) {
    return {
      id: null,
      type: message.type,
      category,
      fileName: originalFileName,
      archived: false,
      archiveStatus: 'missing_media_id',
      archivedAt: new Date().toISOString()
    };
  }

  const providerDir = path.join(config.mediaStorageDir, phone, category);
  ensureDir(providerDir);

  if (config.dryRun || !config.whatsappToken) {
    return {
      id: mediaId,
      type: message.type,
      category,
      fileName: originalFileName,
      archived: false,
      archiveStatus: 'dry_run',
      archivedAt: new Date().toISOString()
    };
  }

  try {
    const metadata = await getMediaMetadata(mediaId);
    const extension = path.extname(originalFileName || '') || extensionFromMime(metadata.mime_type);
    const finalFileName = originalFileName || `${mediaId}${extension}`;
    const targetPath = path.join(providerDir, finalFileName);
    const fileBuffer = await downloadMediaFile(metadata.url);

    fs.writeFileSync(targetPath, fileBuffer);

    return {
      id: mediaId,
      type: message.type,
      category,
      fileName: finalFileName,
      mimeType: metadata.mime_type,
      sha256: metadata.sha256 || null,
      bytes: fileBuffer.length,
      storagePath: targetPath,
      archived: true,
      archiveStatus: 'downloaded',
      archivedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      id: mediaId,
      type: message.type,
      category,
      fileName: originalFileName,
      archived: false,
      archiveStatus: 'download_failed',
      error: error.message,
      archivedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  archiveIncomingMedia
};
