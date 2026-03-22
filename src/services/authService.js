const crypto = require('crypto');
const config = require('../config');

function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

function createSessionToken(username) {
  const expiresAt = Date.now() + config.sessionTtlHours * 60 * 60 * 1000;
  const payload = `${username}:${expiresAt}`;
  const signature = sign(payload);
  return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

function verifySessionToken(token) {
  if (!token) return null;

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [username, expiresAt, signature] = decoded.split(':');
    const payload = `${username}:${expiresAt}`;
    const expectedSignature = sign(payload);

    if (signature !== expectedSignature) return null;
    if (Number(expiresAt) < Date.now()) return null;

    return { username, expiresAt: Number(expiresAt) };
  } catch (_error) {
    return null;
  }
}

function parseCookies(header) {
  return (header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split('=');
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
}

function requireAdminAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies.pulso_admin_session);

  if (!session) {
    if (req.path.startsWith('/providers')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/admin/login');
  }

  req.adminSession = session;
  return next();
}

function setSessionCookie(res, username) {
  const token = createSessionToken(username);
  const secure = config.baseUrl.startsWith('https://');
  const parts = [
    `pulso_admin_session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${config.sessionTtlHours * 60 * 60}`
  ];

  if (secure) {
    parts.push('Secure');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'pulso_admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function validateCredentials(username, password) {
  return username === config.adminUsername && password === config.adminPassword && Boolean(config.adminPassword);
}

module.exports = {
  requireAdminAuth,
  setSessionCookie,
  clearSessionCookie,
  validateCredentials,
  parseCookies,
  verifySessionToken
};
