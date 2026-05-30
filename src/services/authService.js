const crypto = require('crypto');
const config = require('../config');

const ADMIN_ROLES = {
  SUPER_ADMIN: 'super_admin',
  OPS_ADMIN: 'ops_admin',
  REVIEWER: 'reviewer',
  SUPPORT_ADMIN: 'support_admin'
};

const ROLE_LABELS = {
  [ADMIN_ROLES.SUPER_ADMIN]: 'Super admin',
  [ADMIN_ROLES.OPS_ADMIN]: 'Ops admin',
  [ADMIN_ROLES.REVIEWER]: 'Reviewer',
  [ADMIN_ROLES.SUPPORT_ADMIN]: 'Support admin'
};

function sign(payload) {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

function normalizeRole(role) {
  return ROLE_LABELS[role] ? role : ADMIN_ROLES.REVIEWER;
}

function normalizeAdminUser(user) {
  if (!user || typeof user !== 'object') return null;

  const username = String(user.username || '').trim();
  if (!username) return null;

  return {
    username,
    role: normalizeRole(user.role || ADMIN_ROLES.REVIEWER),
    active: user.active !== false,
    password: typeof user.password === 'string' ? user.password : '',
    passwordHash: typeof user.passwordHash === 'string' ? user.passwordHash : ''
  };
}

function getConfiguredAdminUsers() {
  let users = [];

  if (config.adminUsersJson) {
    try {
      const parsed = JSON.parse(config.adminUsersJson);
      if (Array.isArray(parsed)) {
        users = parsed.map(normalizeAdminUser).filter(Boolean);
      } else {
        console.error('ADMIN_USERS_JSON must be a JSON array');
      }
    } catch (error) {
      console.error('Failed to parse ADMIN_USERS_JSON', error.message);
    }
  }

  if (!users.length && config.adminUsername && config.adminPassword) {
    users.push({
      username: config.adminUsername,
      role: ADMIN_ROLES.SUPER_ADMIN,
      active: true,
      password: config.adminPassword,
      passwordHash: ''
    });
  }

  return users;
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function comparePasswordHash(password, passwordHash) {
  const normalizedHash = passwordHash.startsWith('sha256:')
    ? passwordHash.slice('sha256:'.length)
    : passwordHash;
  const passwordDigest = hashPassword(password);

  try {
    return crypto.timingSafeEqual(Buffer.from(passwordDigest), Buffer.from(normalizedHash));
  } catch (_error) {
    return false;
  }
}

function verifyAdminPassword(user, password) {
  const candidatePassword = String(password || '');

  if (user.passwordHash) {
    return comparePasswordHash(candidatePassword, user.passwordHash);
  }

  if (!user.password) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(candidatePassword), Buffer.from(user.password));
  } catch (_error) {
    return false;
  }
}

function publicAdminUser(user) {
  return {
    username: user.username,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    active: user.active
  };
}

function listAdminUsers() {
  return getConfiguredAdminUsers().map(publicAdminUser);
}

function createSessionToken(admin) {
  const expiresAt = Date.now() + config.sessionTtlHours * 60 * 60 * 1000;
  const session = {
    username: admin.username,
    role: normalizeRole(admin.role),
    expiresAt
  };
  const payload = JSON.stringify(session);
  const signature = sign(payload);
  return Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
}

function verifySessionToken(token) {
  if (!token) return null;

  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded);
    const { payload, signature } = parsed;
    const expectedSignature = sign(payload);

    if (signature !== expectedSignature) return null;
    const session = JSON.parse(payload);
    if (Number(session.expiresAt) < Date.now()) return null;
    const admin = getConfiguredAdminUsers().find((user) => user.username === session.username);
    if (!admin || !admin.active) return null;

    return {
      username: admin.username,
      role: admin.role,
      expiresAt: Number(session.expiresAt)
    };
  } catch (_error) {
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf8');
      const [username, expiresAt, signature] = decoded.split(':');
      const payload = `${username}:${expiresAt}`;
      const expectedSignature = sign(payload);

      if (signature !== expectedSignature) return null;
      if (Number(expiresAt) < Date.now()) return null;

      const admin = getConfiguredAdminUsers().find((user) => user.username === username);
      if (!admin || !admin.active) return null;
      return {
        username: admin.username,
        role: admin.role,
        expiresAt: Number(expiresAt)
      };
    } catch (__error) {
      return null;
    }
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

function wantsJson(req) {
  return req.path.startsWith('/providers') || req.path.startsWith('/api');
}

function requireAdminAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies.pulso_admin_session);

  if (!session) {
    if (wantsJson(req)) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/admin/login');
  }

  req.adminSession = session;
  return next();
}

function requireRole(...roles) {
  const allowedRoles = new Set(roles.flat().map(normalizeRole));

  return (req, res, next) => {
    if (!req.adminSession || !allowedRoles.has(req.adminSession.role)) {
      return res.status(403).json({ error: 'Super admin access required' });
    }

    return next();
  };
}

function requireSuperAdminPage(req, res, next) {
  if (!req.adminSession || req.adminSession.role !== ADMIN_ROLES.SUPER_ADMIN) {
    return res.status(403).send('Super admin access required');
  }

  return next();
}

function setSessionCookie(res, admin) {
  const token = createSessionToken(admin);
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
  const normalizedUsername = String(username || '').trim();
  const admin = getConfiguredAdminUsers().find((user) => user.username === normalizedUsername);

  if (!admin || !admin.active || !verifyAdminPassword(admin, password)) {
    return null;
  }

  return publicAdminUser(admin);
}

function getAdminActor(req) {
  return req && req.adminSession && req.adminSession.username
    ? req.adminSession.username
    : config.adminDefaultReviewer;
}

function getPublicSession(req) {
  if (!req.adminSession) return null;

  return {
    username: req.adminSession.username,
    role: req.adminSession.role,
    roleLabel: ROLE_LABELS[req.adminSession.role] || req.adminSession.role,
    expiresAt: req.adminSession.expiresAt
  };
}

module.exports = {
  ADMIN_ROLES,
  ROLE_LABELS,
  requireAdminAuth,
  requireRole,
  requireSuperAdminPage,
  setSessionCookie,
  clearSessionCookie,
  validateCredentials,
  parseCookies,
  verifySessionToken,
  listAdminUsers,
  getAdminActor,
  getPublicSession,
  hashPassword
};
