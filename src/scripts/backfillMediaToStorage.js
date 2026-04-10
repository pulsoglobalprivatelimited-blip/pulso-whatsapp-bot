const fs = require('fs');
const path = require('path');
const { initializeStorage, listProviders, saveProvider } = require('../services/storage');
const { uploadLocalFileToFirebaseStorage } = require('../services/mediaStorage');

const DOCUMENT_ATTACHMENT_KEYS = [
  { key: 'cvAttachments', category: 'cv' },
  { key: 'certificateAttachments', category: 'certificate' },
  { key: 'additionalDocumentAttachments', category: 'additional-document' }
];

function normalizeStoragePath(storagePath) {
  if (!storagePath) {
    return null;
  }

  return path.resolve(String(storagePath));
}

function shouldBackfillAttachment(attachment) {
  if (!attachment) {
    return false;
  }

  if (attachment.cloudStoragePath || attachment.cloudStorageUrl) {
    return false;
  }

  if (!attachment.storagePath) {
    return false;
  }

  return fs.existsSync(normalizeStoragePath(attachment.storagePath));
}

async function backfillAttachment(phone, category, attachment) {
  const localPath = normalizeStoragePath(attachment.storagePath);
  const fileName = attachment.fileName || path.basename(localPath);
  const result = await uploadLocalFileToFirebaseStorage(
    phone,
    category,
    fileName,
    localPath,
    attachment.mimeType || null
  );

  return {
    ...attachment,
    cloudArchived: result.uploaded,
    cloudArchiveStatus: result.cloudArchiveStatus,
    cloudStorageBucket: result.cloudStorageBucket || null,
    cloudStoragePath: result.cloudStoragePath || null,
    cloudStorageUrl: result.cloudStorageUrl || null,
    cloudError: result.cloudError || null,
    cloudBackfilledAt: new Date().toISOString()
  };
}

async function backfillProvider(provider) {
  if (!provider || !provider.phone || !provider.documents) {
    return { updated: false, migratedCount: 0, failedCount: 0 };
  }

  let updated = false;
  let migratedCount = 0;
  let failedCount = 0;
  const nextDocuments = { ...provider.documents };

  for (const { key, category } of DOCUMENT_ATTACHMENT_KEYS) {
    const attachments = Array.isArray(provider.documents[key]) ? provider.documents[key] : [];
    if (!attachments.length) {
      continue;
    }

    const nextAttachments = [];
    for (const attachment of attachments) {
      if (!shouldBackfillAttachment(attachment)) {
        nextAttachments.push(attachment);
        continue;
      }

      const nextAttachment = await backfillAttachment(provider.phone, category, attachment);
      nextAttachments.push(nextAttachment);
      updated = true;

      if (nextAttachment.cloudArchived) {
        migratedCount += 1;
      } else {
        failedCount += 1;
      }
    }

    nextDocuments[key] = nextAttachments;
  }

  if (!updated) {
    return { updated: false, migratedCount, failedCount };
  }

  await saveProvider(provider.phone, {
    ...provider,
    documents: nextDocuments,
    updatedAt: new Date().toISOString()
  });

  return { updated: true, migratedCount, failedCount };
}

async function main() {
  await initializeStorage();
  const providers = await listProviders();

  let updatedProviders = 0;
  let migratedAttachments = 0;
  let failedAttachments = 0;

  for (const provider of providers) {
    const result = await backfillProvider(provider);
    if (result.updated) {
      updatedProviders += 1;
    }
    migratedAttachments += result.migratedCount;
    failedAttachments += result.failedCount;
  }

  console.log(
    JSON.stringify(
      {
        scannedProviders: providers.length,
        updatedProviders,
        migratedAttachments,
        failedAttachments
      },
      null,
      2
    )
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Media backfill failed.', error);
    process.exit(1);
  });
