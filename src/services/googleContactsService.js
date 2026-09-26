// Saves a finished provider into the Google Contacts of one Gmail account, so
// the ops team can ring a caregiver straight from their phone book.
//
// Why raw HTTP instead of `googleapis`: this needs exactly two endpoints - a
// token refresh and a contact create. The official client pulls in every Google
// API surface for that, and this service is small enough to read in one sitting.
//
// The account is a consumer Gmail, so there is no domain-wide delegation to
// impersonate it. The only credential that works is a refresh token that the
// account itself consented to once, in a browser. See
// src/scripts/getGoogleContactsToken.js for the one-time consent, and keep the
// token in the environment - never in render.yaml or git.
const axios = require('axios');
const config = require('../config');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CREATE_CONTACT_URL = 'https://people.googleapis.com/v1/people:createContact';
const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts';

// The prefix is how ops finds people: typing "p24" in Contacts should return
// everyone who can work a 24-hour duty. Someone marked `both` can work either,
// so they carry both prefixes and show up in both searches. Collapsing them to
// a single prefix would hide the largest group - `both` is ~38% of providers -
// from whichever search they got left out of.
// These are not invented: the ops phone already holds ~573 provider contacts in
// this exact shape - 216 P24, 188 P8, 169 P24&8 - entered by hand over months.
// Matching it means a generated contact sorts and searches beside the ones
// already there, instead of starting a second naming system in the same phone
// book. P24&8 is also the team's own answer for someone who works either duty.
const DUTY_PREFIX = {
  '24_hour': 'P24',
  '8_hour': 'P8',
  both: 'P24&8',
};

const QUALIFICATION_LABEL = {
  gda: 'GDA',
  gnm: 'GNM',
  anm: 'ANM',
  hca: 'HCA',
  bsc_nursing: 'BSc Nursing',
  other_caregiving: 'Other caregiving',
  basic_caregiver: 'Basic caregiver',
};

const REGION_LABEL = {
  kerala: 'Kerala',
  karnataka: 'Karnataka',
};

// The words the existing hand-entered names use: Nurse rather than BSc Nursing,
// Caregiver rather than Other caregiving. Counted off the phone itself - GDA 188,
// Caregiver 122, Nurse 99, GNM 71, ANM 67, HCA 13.
const QUALIFICATION_SHORT = {
  gda: 'GDA',
  gnm: 'GNM',
  anm: 'ANM',
  hca: 'HCA',
  bsc_nursing: 'Nurse',
  other_caregiving: 'Caregiver',
  basic_caregiver: 'Caregiver',
};

function qualificationShort(qualification) {
  const key = String(qualification || '').trim().toLowerCase();
  return QUALIFICATION_SHORT[key] || '';
}

function dutyPrefix(dutyHourPreference) {
  const key = String(dutyHourPreference || '').trim().toLowerCase();
  return DUTY_PREFIX[key] || '';
}

function dutyLabel(dutyHourPreference) {
  const key = String(dutyHourPreference || '').trim().toLowerCase();
  if (key === '24_hour') return '24 hour';
  if (key === '8_hour') return '8 hour';
  if (key === 'both') return '24 hour or 8 hour';
  return '';
}

function qualificationLabel(qualification) {
  const key = String(qualification || '').trim().toLowerCase();
  return QUALIFICATION_LABEL[key] || '';
}

function regionLabel(region) {
  const key = String(region || '').trim().toLowerCase();
  return REGION_LABEL[key] || '';
}

// Stored numbers look like "919074490963" - country code, no plus. Contacts
// needs it dialable, so hand it back in the form a phone will call.
function formatContactPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const national = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (national.length === 10) {
    return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
  }
  return `+${digits}`;
}

// A handful of people answered the name question with a sentence - one reply
// carried a newline and a second phone number, which would have split the
// contact's name across lines in the phone book. Collapse the whitespace and cap
// the length, generously enough that a genuine long name like
// "Aneena Treesa Jacob p i" survives untouched. Anything actually truncated is
// kept whole in the notes, so no typed detail is lost.
const MAX_CONTACT_NAME = 40;

function sanitizeFullName(fullName) {
  const collapsed = String(fullName || '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_CONTACT_NAME) {
    return { name: collapsed, truncated: false };
  }
  return { name: `${collapsed.slice(0, MAX_CONTACT_NAME).trim()}…`, truncated: true };
}

// "P24&8 Anju M Babu GDA Female Ernakulam" - duty, name, qualification, sex,
// district, in that order, because that is the order the existing contacts use.
// Everything rides in the display name rather than only in structured fields:
// the phone's contact list shows the name alone, and that list is where the ops
// team actually picks somebody for a duty.
function buildContactName(provider) {
  const prefix = dutyPrefix(provider && provider.dutyHourPreference);
  const { name } = sanitizeFullName(provider && provider.fullName);
  const fallback = formatContactPhone(provider && provider.phone) || 'Pulso provider';
  const qualification = qualificationShort(provider && provider.qualification);
  const sex = String((provider && provider.sex) || '').trim();
  const district = String((provider && provider.district) || '').trim();
  return [prefix, name || fallback, qualification, sex, district]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function buildContactAddress(provider) {
  const district = String((provider && provider.district) || '').trim();
  const state = regionLabel(provider && provider.region);
  return [district, state].filter(Boolean).join(', ');
}

function buildContactNotes(provider) {
  const sex = String((provider && provider.sex) || '').trim();
  const duty = dutyLabel(provider && provider.dutyHourPreference);
  const parts = [sex, duty ? `Duty: ${duty}` : ''].filter(Boolean);
  const { truncated } = sanitizeFullName(provider && provider.fullName);
  if (truncated) {
    parts.push(`Typed name: ${String(provider.fullName).replace(/\s+/g, ' ').trim()}`);
  }
  return parts.join(' · ');
}

// The People API "person" body. Organization carries name + title separately so
// Contacts renders it as the qualification against Pulso, rather than one opaque
// string nobody can filter on later.
function buildProviderContactBody(provider) {
  const body = {
    names: [{ givenName: buildContactName(provider) }],
  };

  const phone = formatContactPhone(provider && provider.phone);
  if (phone) {
    body.phoneNumbers = [{ value: phone, type: 'mobile' }];
  }

  const title = qualificationLabel(provider && provider.qualification);
  body.organizations = [{ name: 'Pulso', ...(title ? { title } : {}) }];

  const address = buildContactAddress(provider);
  if (address) {
    body.addresses = [{ formattedValue: address, type: 'work' }];
  }

  const notes = buildContactNotes(provider);
  if (notes) {
    body.biographies = [{ value: notes, contentType: 'TEXT_PLAIN' }];
  }

  return body;
}

function contactsCredentials() {
  return {
    clientId: String(config.googleContactsClientId || '').trim(),
    clientSecret: String(config.googleContactsClientSecret || '').trim(),
    refreshToken: String(config.googleContactsRefreshToken || '').trim(),
  };
}

// An access token lasts an hour; refreshing on every completion would spend a
// round trip for nothing, so hold it until it is nearly out.
let cachedToken = { value: '', expiresAt: 0 };

function resetAccessTokenCache() {
  cachedToken = { value: '', expiresAt: 0 };
}

async function getAccessToken() {
  const { clientId, clientSecret, refreshToken } = contactsCredentials();
  if (!clientId || !clientSecret || !refreshToken) {
    return '';
  }

  const now = Date.now();
  if (cachedToken.value && cachedToken.expiresAt > now + 60000) {
    return cachedToken.value;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await axios.post(TOKEN_URL, params.toString(), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  });

  const token = (response.data && response.data.access_token) || '';
  const expiresIn = Number((response.data && response.data.expires_in) || 3600);
  cachedToken = { value: token, expiresAt: now + expiresIn * 1000 };
  return token;
}

// Never throws for a configuration or API problem: a contact that failed to
// save must not hold up a caregiver's onboarding. The caller records the reason
// and the backfill script can retry later.
async function saveProviderContact(provider) {
  if (!provider || !provider.phone) {
    return { ok: false, skipped: true, reason: 'missing_provider' };
  }

  // Already in the phone book. Creating again would leave ops with two entries
  // for one caregiver and no way to tell which is current. Checked before
  // configuration, because an already-saved contact stays saved either way.
  const existing = provider.contactSync && provider.contactSync.resourceName;
  if (existing) {
    return { ok: true, skipped: true, reason: 'already_saved', resourceName: existing };
  }

  const { clientId, clientSecret, refreshToken } = contactsCredentials();
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, skipped: true, reason: 'missing_contacts_configuration' };
  }

  const body = buildProviderContactBody(provider);

  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return { ok: false, skipped: true, reason: 'missing_access_token' };
    }

    const response = await axios.post(CREATE_CONTACT_URL, body, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      timeout: 15000,
    });

    return {
      ok: true,
      skipped: false,
      resourceName: (response.data && response.data.resourceName) || '',
      name: body.names[0].givenName,
    };
  } catch (error) {
    // A revoked or rotated refresh token keeps answering 401 until the token is
    // replaced; drop the cache so the next attempt refetches rather than
    // replaying a token we already know is dead.
    const status = error.response && error.response.status;
    if (status === 401) {
      resetAccessTokenCache();
    }
    const detail =
      (error.response && error.response.data && error.response.data.error) || null;
    const reason =
      (detail && (detail.message || detail.error_description || detail)) ||
      error.message ||
      'contact_create_failed';
    console.error(
      '[GOOGLE_CONTACT_SAVE_ERROR]',
      JSON.stringify({ providerPhone: provider.phone, status: status || null, reason }, null, 2)
    );
    return { ok: false, skipped: false, reason: String(reason) };
  }
}

module.exports = {
  saveProviderContact,
  getAccessToken,
  resetAccessTokenCache,
  // Exported for tests: the mapping is the part worth checking without a token.
  buildProviderContactBody,
  buildContactName,
  buildContactAddress,
  buildContactNotes,
  formatContactPhone,
  sanitizeFullName,
  dutyPrefix,
  dutyLabel,
  qualificationShort,
  qualificationLabel,
  regionLabel,
  CONTACTS_SCOPE,
};
