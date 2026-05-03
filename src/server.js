const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('./config');
const { STATUS } = require('./flow');
const {
  processIncomingMessage,
  approveCertificate,
  rejectCertificate,
  requestAdditionalDocument,
  markPulsoAppActivationVerified,
  adminUploadCertificateFiles,
  runTermsReminderSweep,
  startTermsReminderScheduler
} = require('./services/onboardingFlow');
const { listProviders, getProvider, updateProvider } = require('./services/providerService');
const { inferProviderRegion, normalizeRegion } = require('./services/regionService');
const { initializeStorage } = require('./services/storage');
const { notifyCertificateUploaded } = require('./services/opsNotifications');
const {
  requireAdminAuth,
  setSessionCookie,
  clearSessionCookie,
  validateCredentials,
  parseCookies,
  verifySessionToken
} = require('./services/authService');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/admin/assets', express.static(path.join(config.publicDir, 'assets')));

app.get('/admin/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(config.publicDir, 'admin', 'manifest.webmanifest'));
});

app.get('/admin/sw.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Service-Worker-Allowed', '/admin/');
  res.sendFile(path.join(config.publicDir, 'admin', 'sw.js'));
});

const recentlyProcessedMessageIds = new Map();
const MESSAGE_DEDUPE_TTL_MS = 5 * 60 * 1000;

function hasRecentlyProcessedMessage(messageId) {
  if (!messageId) {
    return false;
  }

  const processedAt = recentlyProcessedMessageIds.get(messageId);
  if (!processedAt) {
    return false;
  }

  if (Date.now() - processedAt > MESSAGE_DEDUPE_TTL_MS) {
    recentlyProcessedMessageIds.delete(messageId);
    return false;
  }

  return true;
}

function markMessageProcessed(messageId) {
  if (!messageId) {
    return;
  }

  recentlyProcessedMessageIds.set(messageId, Date.now());

  if (recentlyProcessedMessageIds.size > 1000) {
    const cutoff = Date.now() - MESSAGE_DEDUPE_TTL_MS;
    for (const [id, processedAt] of recentlyProcessedMessageIds.entries()) {
      if (processedAt < cutoff) {
        recentlyProcessedMessageIds.delete(id);
      }
    }
  }
}

function resolveAdminMediaPath(relativePath) {
  const mediaRoot = path.resolve(config.mediaStorageDir);
  const absolutePath = path.resolve(mediaRoot, relativePath || '');
  const isInsideMediaRoot =
    absolutePath === mediaRoot || absolutePath.startsWith(`${mediaRoot}${path.sep}`);

  if (!isInsideMediaRoot) {
    return null;
  }

  return absolutePath;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    dryRun: config.dryRun,
    webhookUrl: `${config.baseUrl}/webhook`,
    firestoreConfigured: Boolean(
      config.googleApplicationCredentials ||
        (config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey)
    ),
    whatsappConfigured: Boolean(config.whatsappToken && config.phoneNumberId)
  });
});

app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'privacy.html'));
});

app.get('/terms', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'terms.html'));
});

app.get('/data-deletion', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'data-deletion.html'));
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry || [];
    let processedMessages = 0;

    for (const item of entry) {
      const changes = item.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = value.messages || [];

        for (const message of messages) {
          if (!message.from) continue;

          if (hasRecentlyProcessedMessage(message.id)) {
            console.log('[WEBHOOK] Skipping duplicate message', message.id);
            continue;
          }

          markMessageProcessed(message.id);
          processedMessages += 1;
          console.log(
            '[WEBHOOK] Incoming message',
            JSON.stringify(
              {
                from: message.from,
                type: message.type,
                text: message.text && message.text.body ? message.text.body : null,
                interactiveReplyId:
                  (message.interactive &&
                    message.interactive.button_reply &&
                    message.interactive.button_reply.id) ||
                  (message.interactive &&
                    message.interactive.list_reply &&
                    message.interactive.list_reply.id) ||
                  null,
                interactiveReplyTitle:
                  (message.interactive &&
                    message.interactive.button_reply &&
                    message.interactive.button_reply.title) ||
                  (message.interactive &&
                    message.interactive.list_reply &&
                    message.interactive.list_reply.title) ||
                  null,
                id: message.id || null
              },
              null,
              2
            )
          );
          await processIncomingMessage(message.from, message);
        }
      }
    }

    if (!processedMessages) {
      console.log('[WEBHOOK] Event received with no message payload');
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing failed', error);
    res.sendStatus(500);
  }
});

app.get('/admin/login', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies.pulso_admin_session);
  if (session) {
    return res.redirect('/admin');
  }
  return res.sendFile(path.join(config.publicDir, 'admin', 'login.html'));
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!validateCredentials(username, password)) {
    return res.status(401).sendFile(path.join(config.publicDir, 'admin', 'login-failed.html'));
  }

  setSessionCookie(res, username);
  return res.redirect('/admin');
});

app.post('/admin/logout', (_req, res) => {
  clearSessionCookie(res);
  res.redirect('/admin/login');
});

app.use('/admin', requireAdminAuth);

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
});

app.get('/admin/karnataka', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
});

app.get('/admin/media/*', (req, res) => {
  const absolutePath = resolveAdminMediaPath(req.params[0]);
  if (!absolutePath || !fs.existsSync(absolutePath) || fs.statSync(absolutePath).isDirectory()) {
    return res.status(404).json({ error: 'File not found' });
  }

  return res.sendFile(absolutePath);
});

app.get('/admin/providers', async (req, res) => {
  const requestedRegion = normalizeRegion(req.query.region);
  const providers = (await listProviders()).map((provider) => ({
    ...provider,
    region: inferProviderRegion(provider) || provider.region || null
  }));

  if (!requestedRegion) {
    return res.json({ providers });
  }

  return res.json({
    providers: providers.filter((provider) => inferProviderRegion(provider) === requestedRegion)
  });
});

app.get('/admin/providers/:phone', async (req, res) => {
  const provider = await getProvider(req.params.phone);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  return res.json(provider);
});

app.post('/admin/providers/:phone/approve-certificate', async (req, res) => {
  try {
    const provider = await approveCertificate(req.params.phone, req.body.reviewedBy, req.body.notes);
    res.json(provider);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/admin/providers/:phone/reject-certificate', async (req, res) => {
  try {
    const provider = await rejectCertificate(req.params.phone, req.body.reviewedBy, req.body.notes);
    res.json(provider);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/admin/providers/:phone/request-additional-document', async (req, res) => {
  try {
    const provider = await requestAdditionalDocument(req.params.phone, req.body.reviewedBy, req.body.note);
    res.json(provider);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/admin/providers/:phone/verify-app-activation', async (req, res) => {
  try {
    const provider = await markPulsoAppActivationVerified(req.params.phone, req.body.verifiedBy || req.body.reviewedBy);
    res.json(provider);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/admin/providers/:phone/upload-certificate', upload.array('certificates', 4), async (req, res) => {
  try {
    const provider = await adminUploadCertificateFiles(
      req.params.phone,
      req.files || [],
      req.body.uploadedBy || req.body.reviewedBy || 'admin'
    );
    res.json(provider);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

async function reconcilePendingVerificationNotifications() {
  const providers = await listProviders();
  const pendingProviders = providers.filter(
    (provider) =>
      provider &&
      provider.phone &&
      provider.status === STATUS.VERIFICATION_PENDING &&
      provider.verification &&
      provider.verification.status === 'pending' &&
      !provider.verification.notificationSentAt
  );

  if (!pendingProviders.length) {
    console.log('[STARTUP] No pending verification notifications to resend');
    return;
  }

  console.log(`[STARTUP] Retrying ${pendingProviders.length} pending verification notification(s)`);

  for (const provider of pendingProviders) {
    const attachments =
      provider && provider.documents ? provider.documents.certificateAttachments || [] : [];
    const notificationSent = await notifyCertificateUploaded(provider, attachments);

    if (notificationSent) {
      await updateProvider(provider.phone, {
        verification: {
          notificationSentAt: new Date().toISOString()
        }
      });
      console.log(`[STARTUP] Resent verification notification for ${provider.phone}`);
    } else {
      console.error(`[STARTUP] Failed to resend verification notification for ${provider.phone}`);
    }
  }
}

initializeStorage()
  .then(() => {
    return reconcilePendingVerificationNotifications();
  })
  .then(() => {
    return runTermsReminderSweep();
  })
  .then(() => {
    startTermsReminderScheduler();
    app.listen(config.port, () => {
      console.log(`Pulso WhatsApp bot listening on port ${config.port}`);
      console.log(`Webhook verify token: ${config.verifyToken}`);
      console.log(`Webhook callback URL: ${config.baseUrl}/webhook`);
      console.log(`Dry run mode: ${config.dryRun}`);
      console.log(`Media storage dir: ${config.mediaStorageDir}`);
      console.log(`Terms first reminder delay hours: ${config.termsFirstReminderDelayHours}`);
      console.log(`Terms second reminder delay hours: ${config.termsSecondReminderDelayHours}`);
      console.log(`Terms reminder check interval minutes: ${config.termsReminderCheckIntervalMinutes}`);
      console.log(`Terms reminder template configured: ${Boolean(config.termsReminderTemplateName)}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize storage', error);
    process.exit(1);
  });
