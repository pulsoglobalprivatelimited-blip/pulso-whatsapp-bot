// One-time consent for the ops Google Contacts account.
//
// The target mailbox is a consumer Gmail, so no service account can act for it.
// The only credential Google will issue is a refresh token that the account
// itself approves in a browser - that click cannot be automated, and this script
// exists to make it the only manual step.
//
//   node src/scripts/getGoogleContactsToken.js <client-id> <client-secret>
//
// It opens the consent page, waits on a loopback port for Google to hand back
// the code, swaps the code for a refresh token, and prints it. Sign in as the
// account the contacts should live in - whichever account approves is where
// every contact lands.
//
// Put the printed token in GOOGLE_CONTACTS_REFRESH_TOKEN in the Render
// environment. Never commit it: it grants ongoing write access to that account's
// contacts until it is revoked.
const http = require('http');
const { spawn } = require('child_process');
const axios = require('axios');
const { CONTACTS_SCOPE } = require('../services/googleContactsService');

const clientId = (process.argv[2] || process.env.GOOGLE_CONTACTS_CLIENT_ID || '').trim();
const clientSecret = (process.argv[3] || process.env.GOOGLE_CONTACTS_CLIENT_SECRET || '').trim();
const PORT = Number(process.env.OAUTH_LOOPBACK_PORT || 53682);

if (!clientId || !clientSecret) {
  console.error('Usage: node src/scripts/getGoogleContactsToken.js <client-id> <client-secret>');
  console.error('Create the client in Google Cloud console as an OAuth "Desktop app".');
  process.exit(1);
}

const redirectUri = `http://localhost:${PORT}`;
// A Desktop-app client accepts any loopback port without registering it, which
// is why this needs nothing configured beyond the client itself.
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CONTACTS_SCOPE,
    // offline is what makes Google return a refresh token at all; consent
    // forces a fresh one even if this account has approved before, so re-running
    // the script always yields a usable token rather than silently omitting it.
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

async function exchange(code) {
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
  });
  return response.data || {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (!code && !error) {
    res.writeHead(204).end();
    return;
  }

  if (error) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Consent was refused: ${error}. Nothing was saved.`);
    console.error('\nConsent refused:', error);
    server.close();
    process.exit(1);
  }

  try {
    const data = await exchange(code);
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });

    if (!data.refresh_token) {
      res.end('Google returned no refresh token. Check the terminal.');
      console.error('\nNo refresh token in the response. Google omits it when the');
      console.error('account has already consented - rerun, it forces consent.');
      console.error('Response keys:', Object.keys(data).join(', '));
      server.close();
      process.exit(1);
    }

    res.end('Done. The refresh token is in your terminal - you can close this tab.');
    console.log('\n  Scope granted :', data.scope || '(none reported)');
    console.log('\n  Add this to the Render environment:\n');
    console.log(`  GOOGLE_CONTACTS_CLIENT_ID=${clientId}`);
    console.log(`  GOOGLE_CONTACTS_CLIENT_SECRET=${clientSecret}`);
    console.log(`  GOOGLE_CONTACTS_REFRESH_TOKEN=${data.refresh_token}`);
    console.log('\n  Keep the token out of git. It writes to that account until revoked.\n');
    server.close();
    process.exit(0);
  } catch (err) {
    const detail = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Token exchange failed. Check the terminal.');
    console.error('\nToken exchange failed:', detail);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\n  Sign in as the account the contacts should live in.\n');
  console.log('  If the browser does not open, paste this:\n');
  console.log(`  ${authUrl}\n`);
  if (process.platform === 'darwin') {
    spawn('open', [authUrl], { stdio: 'ignore', detached: true }).unref();
  } else if (process.platform === 'linux') {
    spawn('xdg-open', [authUrl], { stdio: 'ignore', detached: true }).unref();
  }
});
