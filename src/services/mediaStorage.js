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

// The reviewer's alert carries the certificate as a link to this archive, so an
// upload that quietly fails costs the caregiver their place in the queue. One
// retry covers the usual cause, a blip talking to the bucket.
const CLOUD_UPLOAD_ATTEMPTS = 2;

async function uploadBufferToFirebaseStorage(phone, category, fileName, fileBuffer, mimeType) {
  if (!config.firebaseStorageBucket) {
    return {
      uploaded: false,
      cloudArchiveStatus: 'bucket_not_configured'
    };
  }

  let lastError = null;
  for (let attempt = 1; attempt <= CLOUD_UPLOAD_ATTEMPTS; attempt += 1) {
    const result = await uploadBufferOnce(phone, category, fileName, fileBuffer, mimeType);
    if (result.uploaded) {
      return attempt > 1 ? { ...result, cloudUploadAttempts: attempt } : result;
    }
    lastError = result;
    console.error(
      '[CLOUD_ARCHIVE_ATTEMPT_FAILED]',
      JSON.stringify({ phone, category, fileName, attempt, error: result.cloudError }, null, 2)
    );
  }

  return { ...lastError, cloudUploadAttempts: CLOUD_UPLOAD_ATTEMPTS };
}

async function uploadBufferOnce(phone, category, fileName, fileBuffer, mimeType) {
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

async function uploadLocalFileToFirebaseStorage(phone, category, fileName, localPath, mimeType) {
  const fileBuffer = fs.readFileSync(localPath);
  return uploadBufferToFirebaseStorage(phone, category, fileName, fileBuffer, mimeType);
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
    // The document filename comes straight from WhatsApp (attacker-controllable),
    // so never let it reach a filesystem path unsanitised — a name like
    // "../../server.js" would otherwise escape the provider's media folder.
    const finalFileName = sanitizeFileName(originalFileName) || `${mediaId}${extension}`;
    const safePhone = sanitizeFileName(phone) || 'unknown';
    const safeCategory = sanitizeFileName(category) || 'misc';
    const fileBuffer = await downloadMediaFile(metadata.url);
    const cloudUpload = await uploadBufferToFirebaseStorage(phone, category, finalFileName, fileBuffer, metadata.mime_type);
    const providerDir = path.join(config.mediaStorageDir, safePhone, safeCategory);
    const targetPath = path.join(providerDir, finalFileName);
    let localArchive = {
      archived: false,
      archiveStatus: 'local_archive_not_attempted',
      storagePath: null,
      error: null
    };

    try {
      ensureDir(providerDir);
      fs.writeFileSync(targetPath, fileBuffer);
      localArchive = {
        archived: true,
        archiveStatus: 'downloaded',
        storagePath: targetPath,
        error: null
      };
    } catch (error) {
      localArchive = {
        archived: false,
        archiveStatus: 'local_archive_failed',
        storagePath: null,
        error: error.message
      };
    }

    return {
      id: mediaId,
      type: message.type,
      category,
      fileName: finalFileName,
      mimeType: metadata.mime_type,
      sha256: metadata.sha256 || null,
      bytes: fileBuffer.length,
      storagePath: localArchive.storagePath,
      archived: localArchive.archived,
      archiveStatus: localArchive.archiveStatus,
      error: localArchive.error,
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
  archiveIncomingMedia,
  uploadBufferToFirebaseStorage,
  uploadLocalFileToFirebaseStorage
};
