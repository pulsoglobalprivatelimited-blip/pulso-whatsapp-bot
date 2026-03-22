const express = require('express');
const path = require('path');
const config = require('./config');
const { processIncomingMessage, approveCertificate, rejectCertificate } = require('./services/onboardingFlow');
const { listProviders, getProvider } = require('./services/providerService');
const { initializeStorage } = require('./services/storage');
const {
  requireAdminAuth,
  setSessionCookie,
  clearSessionCookie,
  validateCredentials,
  parseCookies,
  verifySessionToken
} = require('./services/authService');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/admin/assets', express.static(path.join(config.publicDir, 'assets')));

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
          processedMessages += 1;
          console.log(
            '[WEBHOOK] Incoming message',
            JSON.stringify(
              {
                from: message.from,
                type: message.type,
                text: message.text && message.text.body ? message.text.body : null,
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

app.get('/admin/providers', async (_req, res) => {
  res.json({ providers: await listProviders() });
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

initializeStorage()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Pulso WhatsApp bot listening on port ${config.port}`);
      console.log(`Webhook verify token: ${config.verifyToken}`);
      console.log(`Webhook callback URL: ${config.baseUrl}/webhook`);
      console.log(`Dry run mode: ${config.dryRun}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize storage', error);
    process.exit(1);
  });
