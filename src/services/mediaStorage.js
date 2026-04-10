const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getMediaMetadata, downloadMediaFile } = require('./metaClient');
const { getStorageBucket } = require('./storage');

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

function sanitizeFileName(value) {
  return String(value || '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildCloudObjectPath(phone, category, fileName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = sanitizeFileName(fileName) || `${timestamp}.bin`;
  return `providers/${phone}/${category}/${timestamp}-${safeName}`;
}

async function uploadToFirebaseStorage(phone, category, fileName, fileBuffer, mimeType) {
  if (!config.firebaseStorageBucket) {
    return {
      uploaded: false,
      cloudArchiveStatus: 'bucket_not_configured'
    };
  }

  try {
    const bucket = getStorageBucket();
    const objectPath = buildCloudObjectPath(phone, category, fileName);
    const file = bucket.file(objectPath);

    await file.save(fileBuffer, {
      resumable: false,
      metadata: {
        contentType: mimeType || 'application/octet-stream'
      }
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '2035-01-01'
    });

    return {
      uploaded: true,
      cloudArchiveStatus: 'uploaded',
      cloudStorageBucket: bucket.name,
      cloudStoragePath: objectPath,
      cloudStorageUrl: signedUrl
    };
  } catch (error) {
    return {
      uploaded: false,
      cloudArchiveStatus: 'upload_failed',
      cloudError: error.message
    };
  }
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
      cloudArchived: false,
      cloudArchiveStatus: 'dry_run',
      archivedAt: new Date().toISOString()
    };
  }

  try {
    const metadata = await getMediaMetadata(mediaId);
    const extension = path.extname(originalFileName || '') || extensionFromMime(metadata.mime_type);
    const finalFileName = originalFileName || `${mediaId}${extension}`;
    const targetPath = path.join(providerDir, finalFileName);
    const fileBuffer = await downloadMediaFile(metadata.url);
    const cloudUpload = await uploadToFirebaseStorage(phone, category, finalFileName, fileBuffer, metadata.mime_type);

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
      cloudArchived: cloudUpload.uploaded,
      cloudArchiveStatus: cloudUpload.cloudArchiveStatus,
      cloudStorageBucket: cloudUpload.cloudStorageBucket || null,
      cloudStoragePath: cloudUpload.cloudStoragePath || null,
      cloudStorageUrl: cloudUpload.cloudStorageUrl || null,
      cloudError: cloudUpload.cloudError || null,
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
      cloudArchived: false,
      cloudArchiveStatus: 'not_attempted',
      error: error.message,
      archivedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  archiveIncomingMedia
};
