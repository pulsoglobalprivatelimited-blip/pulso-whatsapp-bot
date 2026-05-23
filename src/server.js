const express = require('express');
const fs = require('fs');
const net = require('net');
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
const { processProviderSupportMessage } = require('./services/providerSupportFlow');
const {
  getProviderSupportSessionDetail,
  listProviderSupportSessions,
  resetProviderSupportSession
} = require('./services/providerSupportAdminService');
const { listProviders, listProviderSummaries, getProvider, updateProvider } = require('./services/providerService');
const { inferProviderRegion, normalizeRegion } = require('./services/regionService');
const { initializeStorage, saveWhatsappMessageStatus } = require('./services/storage');
const { notifyCertificateUploaded } = require('./services/opsNotifications');
const {
  buildWelcomeTwiml,
  buildMenuTwiml,
  buildInvalidTwiml,
  buildDialStaffTwiml,
  buildJobTwiml,
  getJobVoiceMessage,
  resolveLanguage,
  resolveMenuAction,
  sendJobWhatsapp
} = require('./services/twilioIvrService');
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

function summarizeErrorForLog(error) {
  return {
    name: error && error.name ? error.name : 'Error',
    message: error && error.message ? error.message : String(error),
    status: error && error.response ? error.response.status : null,
    response: error && error.response ? error.response.data : null
  };
}

function durationSince(startedAt) {
  return Date.now() - startedAt;
}

function logTiming(label, startedAt, details = {}) {
  console.log(
    label,
    JSON.stringify({
      ...details,
      durationMs: durationSince(startedAt)
    })
  );
}

function getWebhookMetadata(value = {}) {
  return {
    phoneNumberId:
      value.metadata && value.metadata.phone_number_id
        ? value.metadata.phone_number_id
        : null,
    displayPhoneNumber:
      value.metadata && value.metadata.display_phone_number
        ? value.metadata.display_phone_number
        : null
  };
}

function countByStatus(statuses) {
  return statuses.reduce((counts, status) => {
    const key = status && status.status ? status.status : 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function getStatusErrors(status) {
  return Array.isArray(status && status.errors) ? status.errors : [];
}

function summarizeStatus(status, value) {
  return {
    id: status.id || null,
    status: status.status || null,
    recipientId: status.recipient_id || status.recipientId || null,
    timestamp: status.timestamp || null,
    errorCount: getStatusErrors(status).length,
    ...getWebhookMetadata(value)
  };
}

function logStatusBatch(statuses, value) {
  if (!statuses.length) {
    return;
  }

  const errorStatuses = statuses.filter(
    (status) => status && (status.status === 'failed' || getStatusErrors(status).length)
  );

  console.log(
    '[WEBHOOK] Message status batch',
    JSON.stringify({
      count: statuses.length,
      statuses: countByStatus(statuses),
      errorCount: errorStatuses.length,
      ...getWebhookMetadata(value)
    })
  );

  errorStatuses.forEach((status) => {
    console.warn(
      '[WEBHOOK] Message status error',
      JSON.stringify({
        ...summarizeStatus(status, value),
        errors: getStatusErrors(status).map((error) => ({
          code: error.code || null,
          title: error.title || null,
          message: error.message || null,
          details: error.error_data || null
        }))
      })
    );
  });
}

function buildVerificationNotificationPatch(notificationResult) {
  if (!notificationResult || !notificationResult.sent) {
    return null;
  }

  return {
    notificationSentAt: new Date().toISOString(),
    notificationRecipients: notificationResult.recipients || [],
    notificationAttempts: notificationResult.attempts || []
  };
}

async function persistWhatsappMessageStatus(status, value) {
  const startedAt = Date.now();
  if (!status || !status.id) {
    return { saved: false, skipped: true, durationMs: durationSince(startedAt) };
  }

  try {
    await saveWhatsappMessageStatus({
      id: status.id,
      status: status.status || null,
      recipientId: status.recipient_id || null,
      timestamp: status.timestamp || null,
      conversation: status.conversation || null,
      pricing: status.pricing || null,
      errors: Array.isArray(status.errors) ? status.errors : [],
      ...getWebhookMetadata(value)
    });

    return { saved: true, durationMs: durationSince(startedAt) };
  } catch (error) {
    console.error(
      '[WEBHOOK_STATUS_SAVE_ERROR]',
      JSON.stringify(
        {
          id: status.id,
          status: status.status || null,
          recipientId: status.recipient_id || null,
          message: error.message
        },
        null,
        2
      )
    );
    return { saved: false, error: true, durationMs: durationSince(startedAt) };
  }
}

async function processWhatsappStatuses(statuses, value) {
  const startedAt = Date.now();
  let saved = 0;
  let failed = 0;
  let maxSaveDurationMs = 0;

  for (const status of statuses) {
    const result = await persistWhatsappMessageStatus(status, value);
    if (result.saved) {
      saved += 1;
    } else if (result.error) {
      failed += 1;
    }
    maxSaveDurationMs = Math.max(maxSaveDurationMs, result.durationMs || 0);
  }

  logTiming('[WEBHOOK_STATUS_BATCH_TIMING]', startedAt, {
    count: statuses.length,
    saved,
    failed,
    maxSaveDurationMs,
    ...getWebhookMetadata(value)
  });
}

function processWhatsappStatusesInBackground(statuses, value) {
  if (!statuses.length) {
    return;
  }

  logStatusBatch(statuses, value);

  processWhatsappStatuses(statuses, value).catch((error) => {
    console.error(
      '[WEBHOOK_STATUS_BACKGROUND_ERROR]',
      JSON.stringify({
        count: statuses.length,
        message: error.message,
        ...getWebhookMetadata(value)
      })
    );
  });
}

function sendTwiml(res, body) {
  res.type('text/xml');
  res.send(body);
}

function getIvrCallerPhone(req) {
  const source = { ...req.query, ...req.body };
  return (
    source.From ||
    source.from ||
    source.Caller ||
    source.caller ||
    source.caller_id ||
    source.callerId ||
    source.CallFrom ||
    source.phone ||
    source.mobile ||
    (source.recipient && source.recipient.phone) ||
    (source.customer && source.customer.phone) ||
    ''
  );
}

function normalizeDigits(value) {
  return (value || '').toString().replace(/\D+/g, '');
}

function normalizeIp(value) {
  let ip = String(value || '').trim().replace(/^"|"$/g, '');
  if (!ip) {
    return '';
  }

  if (ip.startsWith('[')) {
    const closingBracket = ip.indexOf(']');
    if (closingBracket > 0) {
      ip = ip.slice(1, closingBracket);
    }
  }

  const ipv4WithPort = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPort) {
    ip = ipv4WithPort[1];
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  const zoneIndex = ip.indexOf('%');
  if (zoneIndex > -1) {
    ip = ip.slice(0, zoneIndex);
  }

  return net.isIP(ip) ? ip : '';
}

function ipv4ToNumber(ip) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }

  return parts.reduce((acc, part) => ((acc << 8) + part) >>> 0, 0);
}

function isPrivateOrReservedIpv4(ip) {
  const value = ipv4ToNumber(ip);
  if (value === null) {
    return false;
  }

  const ranges = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['224.0.0.0', 4]
  ];

  return ranges.some(([base, prefix]) => matchesIpv4Cidr(ip, `${base}/${prefix}`));
}

function matchesIpv4Cidr(ip, cidr) {
  const [baseIp, prefixText] = cidr.split('/');
  const normalizedBaseIp = normalizeIp(baseIp);
  const prefix = Number(prefixText);
  if (net.isIP(ip) !== 4 || net.isIP(normalizedBaseIp) !== 4 || !Number.isInteger(prefix)) {
    return false;
  }

  if (prefix < 0 || prefix > 32) {
    return false;
  }

  if (prefix === 0) {
    return true;
  }

  const ipNumber = ipv4ToNumber(ip);
  const baseNumber = ipv4ToNumber(normalizedBaseIp);
  if (ipNumber === null || baseNumber === null) {
    return false;
  }

  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (ipNumber & mask) === (baseNumber & mask);
}

function splitForwardedFor(value) {
  const header = Array.isArray(value) ? value.join(',') : String(value || '');
  return header
    .split(',')
    .map((part) => normalizeIp(part))
    .filter(Boolean);
}

function getRequestClientIp(req) {
  const cloudflareIp = normalizeIp(req.get('cf-connecting-ip')) || normalizeIp(req.get('true-client-ip'));
  if (cloudflareIp) {
    return cloudflareIp;
  }

  const forwardedIps = splitForwardedFor(req.headers['x-forwarded-for']);
  const publicForwardedIps = forwardedIps.filter(
    (ip) => net.isIP(ip) !== 4 || !isPrivateOrReservedIpv4(ip)
  );

  if (publicForwardedIps.length) {
    return publicForwardedIps[0];
  }

  return (
    normalizeIp(req.get('x-real-ip')) ||
    normalizeIp(req.ip) ||
    normalizeIp(req.socket && req.socket.remoteAddress)
  );
}

function isIpAllowed(ip, allowedIps = []) {
  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) {
    return false;
  }

  return allowedIps.some((entry) => {
    const normalizedEntry = String(entry || '').trim();
    if (!normalizedEntry) {
      return false;
    }

    if (normalizedEntry.includes('/')) {
      return matchesIpv4Cidr(normalizedIp, normalizedEntry);
    }

    return normalizedIp === normalizeIp(normalizedEntry);
  });
}

function isProviderSupportWebhookValue(value) {
  const metadata = value && value.metadata ? value.metadata : {};
  const inboundPhoneNumberId = (metadata.phone_number_id || '').toString();
  const displayPhoneNumber = normalizeDigits(metadata.display_phone_number);
  const supportBotNumber = normalizeDigits(config.providerSupportBotWhatsappNumber);

  return Boolean(
    (config.providerSupportPhoneNumberId &&
      inboundPhoneNumberId === config.providerSupportPhoneNumberId) ||
      (supportBotNumber && displayPhoneNumber && displayPhoneNumber.endsWith(supportBotNumber.slice(-10)))
  );
}

function verifyIvrSecret(req, res) {
  const clientIp = getRequestClientIp(req);
  if (isIpAllowed(clientIp, config.ivrWebhookAllowedIps)) {
    return true;
  }

  const providedSecret =
    req.get('x-ivr-secret') || req.body.secret || req.query.secret || '';

  if (config.ivrWebhookSecret && providedSecret === config.ivrWebhookSecret) {
    return true;
  }

  if (!config.ivrWebhookSecret && !config.ivrWebhookAllowedIps.length) {
    return true;
  }

  console.warn('[IVR_UNAUTHORIZED]', JSON.stringify({ clientIp }, null, 2));
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    dryRun: config.dryRun,
    webhookUrl: `${config.baseUrl}/webhook`,
    ivrUrl: `${config.baseUrl}/ivr/welcome`,
    firestoreConfigured: Boolean(
      config.googleApplicationCredentials ||
        (config.firebaseProjectId && config.firebaseClientEmail && config.firebasePrivateKey)
    ),
    whatsappConfigured: Boolean(config.whatsappToken && config.phoneNumberId),
    providerSupportConfigured: Boolean(
      config.whatsappToken &&
        (config.providerSupportPhoneNumberId || config.providerSupportBotWhatsappNumber)
    )
  });
});

app.all('/ivr/welcome', (_req, res) => {
  sendTwiml(res, buildWelcomeTwiml());
});

app.all('/ivr/language', (req, res) => {
  const language = resolveLanguage(req.body.Digits || req.query.Digits);
  if (!language) {
    return sendTwiml(res, buildInvalidTwiml('en'));
  }

  return sendTwiml(res, buildMenuTwiml(language));
});

app.all('/ivr/menu', async (req, res) => {
  const language = req.query.lang === 'ml' ? 'ml' : 'en';
  const action = resolveMenuAction(req.body.Digits || req.query.Digits);

  if (action === 'staff') {
    return sendTwiml(res, buildDialStaffTwiml(language));
  }

  if (action === 'job') {
    try {
      await sendJobWhatsapp(getIvrCallerPhone(req), language);
    } catch (error) {
      console.error('[IVR_WHATSAPP_FAILED]', JSON.stringify(summarizeErrorForLog(error), null, 2));
    }
    return sendTwiml(res, buildJobTwiml(language));
  }

  return sendTwiml(res, buildInvalidTwiml(language));
});

app.all('/ivr/job-whatsapp', async (req, res) => {
  if (!verifyIvrSecret(req, res)) {
    return;
  }

  const language = req.body.lang || req.query.lang || req.body.language || req.query.language;
  const normalizedLanguage = language === 'ml' || language === '2' ? 'ml' : 'en';
  const phone = getIvrCallerPhone(req);

  if (!phone) {
    return res.status(400).json({
      ok: false,
      error: 'Missing caller phone number. Send phone, mobile, from, From, caller, caller_id, or recipient.phone.'
    });
  }

  try {
    const result = await sendJobWhatsapp(phone, normalizedLanguage);
    return res.json({
      ok: true,
      phone,
      language: normalizedLanguage,
      nextAction: 'play_confirmation_and_hangup',
      confirmationVoiceMessage: getJobVoiceMessage(normalizedLanguage),
      result
    });
  } catch (error) {
    console.error('[IVR_JOB_WHATSAPP_FAILED]', JSON.stringify(summarizeErrorForLog(error), null, 2));
    return res.status(500).json({ ok: false, error: error.message });
  }
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
  const webhookStartedAt = Date.now();
  let processedMessages = 0;
  let processedStatuses = 0;
  let statusBatches = 0;

  try {
    const entry = req.body.entry || [];

    for (const item of entry) {
      const changes = item.changes || [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = value.messages || [];
        const statuses = value.statuses || [];
        const useProviderSupportBot = isProviderSupportWebhookValue(value);

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
                id: message.id || null,
                flow: useProviderSupportBot ? 'provider_support' : 'onboarding',
                ...getWebhookMetadata(value)
              },
              null,
              2
            )
          );
          const messageStartedAt = Date.now();
          try {
            if (useProviderSupportBot) {
              await processProviderSupportMessage(message.from, message);
            } else {
              await processIncomingMessage(message.from, message);
            }
          } finally {
            logTiming('[WEBHOOK_MESSAGE_TIMING]', messageStartedAt, {
              id: message.id || null,
              from: message.from,
              type: message.type || null,
              flow: useProviderSupportBot ? 'provider_support' : 'onboarding',
              ...getWebhookMetadata(value)
            });
          }
        }

        if (statuses.length) {
          processedStatuses += statuses.length;
          statusBatches += 1;
          processWhatsappStatusesInBackground(statuses, value);
        }
      }
    }

    if (!processedMessages && !processedStatuses) {
      console.log('[WEBHOOK] Event received with no message payload');
    }

    logTiming('[WEBHOOK_TIMING]', webhookStartedAt, {
      result: 'ok',
      processedMessages,
      processedStatuses,
      statusBatches
    });
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook processing failed', JSON.stringify(summarizeErrorForLog(error), null, 2));
    logTiming('[WEBHOOK_TIMING]', webhookStartedAt, {
      result: 'error',
      processedMessages,
      processedStatuses,
      statusBatches
    });
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

app.get('/admin/kerala', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
});

app.get('/admin/karnataka', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'admin', 'index.html'));
});

app.get('/admin/provider-support', (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'admin', 'provider-support.html'));
});

app.get('/admin/provider-support/sessions', async (_req, res) => {
  try {
    const sessions = await listProviderSupportSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/admin/provider-support/sessions/:phone', async (req, res) => {
  try {
    const session = await getProviderSupportSessionDetail(req.params.phone);
    if (!session) {
      return res.status(404).json({ error: 'Provider support session not found' });
    }
    return res.json(session);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/admin/provider-support/sessions/:phone/reset', async (req, res) => {
  try {
    const result = await resetProviderSupportSession(req.params.phone);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
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
  const providers = (await listProviderSummaries()).map((provider) => ({
    ...provider,
    dashboardSummary: true,
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
    const provider = await approveCertificate(
      req.params.phone,
      req.body.reviewedBy,
      req.body.notes,
      req.body.qualification
    );
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
    const notificationResult = await notifyCertificateUploaded(provider, attachments);
    const notificationPatch = buildVerificationNotificationPatch(notificationResult);

    if (notificationPatch) {
      await updateProvider(provider.phone, {
        verification: notificationPatch
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
