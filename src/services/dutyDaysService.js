'use strict';

/**
 * How many duty days she has done, and how many are left before the experience
 * certificate from Pulso Global Private Limited.
 *
 * The number is NOT counted here. The hub counts it (lib/duty_days.js, written
 * on every attendance change) and stores it on users/{uid}. The bot only reads
 * it, so the chat and the app can never quote different numbers at the same
 * caregiver — which is exactly how the pay figures went wrong in September.
 */
const { getHubFirestore } = require('./hubStorage');

const CERTIFICATE_DAYS = 180;

/** The hub uid for a provider the bot knows, or '' when she has no app account. */
function hubUidOf(provider) {
  if (!provider || typeof provider !== 'object') return '';
  const sync = provider.sync && typeof provider.sync === 'object' ? provider.sync : {};
  return String(provider.appProviderUid || sync.matchedUserId || '').trim();
}

function posInt(value, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Her progress, or null when we cannot say.
 *
 * Null is returned — never a zero — when she has no app account yet or the hub
 * cannot be read. "0 days completed" to someone who has worked forty is worse
 * than saying nothing, because she will believe it.
 */
async function getDutyDaysProgress(provider) {
  const uid = hubUidOf(provider);
  if (!uid) return null;
  let data = null;
  try {
    const snap = await getHubFirestore().collection('users').doc(uid).get();
    data = snap.exists ? snap.data() : null;
  } catch (error) {
    console.error('[DUTY_DAYS_READ_FAILED]', uid, error && error.message);
    return null;
  }
  if (!data || data.dutyDaysCompleted === undefined || data.dutyDaysCompleted === null) return null;
  const completed = posInt(data.dutyDaysCompleted, 0);
  const target = Math.max(1, posInt(data.dutyDaysTarget, CERTIFICATE_DAYS));
  const remaining = Math.max(0, posInt(data.dutyDaysRemaining, target - completed));
  return {
    completed,
    target,
    remaining,
    eligible: data.dutyDaysCertificateEligible === true || completed >= target,
  };
}

/** What she reads. Days left first, because that is the number that moves her. */
function dutyDaysMessage(progress, language = 'ml') {
  const ml = !String(language || '').toLowerCase().startsWith('en');
  if (!progress) {
    return ml
      ? `Pulso-യിൽ 180 ദിവസത്തെ duty പൂർത്തിയാക്കിയാൽ Pulso Global Private Limited-ന്റെ experience certificate ലഭിക്കും. നിങ്ങളുടെ ദിവസങ്ങൾ Pulso App-ൽ കാണാം.`
      : `After 180 days of duty with Pulso you will receive an experience certificate from Pulso Global Private Limited. You can see your days in the Pulso App.`;
  }
  if (progress.eligible) {
    return ml
      ? `നിങ്ങൾ ${progress.completed} ദിവസത്തെ duty പൂർത്തിയാക്കി. Pulso Global Private Limited-ന്റെ experience certificate തയ്യാറാണ്.`
      : `You have completed ${progress.completed} duty days. Your experience certificate from Pulso Global Private Limited is ready.`;
  }
  return ml
    ? `നിങ്ങൾ ഇതുവരെ ${progress.completed} ദിവസത്തെ duty പൂർത്തിയാക്കി. Experience certificate-ന് ഇനി ${progress.remaining} ദിവസം കൂടി.`
    : `You have completed ${progress.completed} duty days so far. ${progress.remaining} more days for your experience certificate.`;
}

/**
 * Whether a typed message is asking about the certificate.
 *
 * Kept narrow on purpose. "certificate" alone is the word she also uses for the
 * GDA/GNM certificate she uploaded during onboarding, so that word only counts
 * once she has finished onboarding — the caller checks her status.
 */
const ASK_PATTERNS = [
  'experience certificate', 'experience cerificate', 'exp certificate',
  'certificate', 'certificat', 'cerificate',
  'സർട്ടിഫിക്കറ്റ്', 'സെര്‍ട്ടിഫിക്കറ്റ്', 'എക്സ്പീരിയൻസ്',
  '180 days', '180 ദിവസ',
];

function isDutyDaysQuestion(message) {
  const text = String((message && (message.text || message.body)) || message || '')
    .trim()
    .toLowerCase();
  if (!text || text.length > 120) return false;
  return ASK_PATTERNS.some((p) => text.includes(p));
}

/**
 * The milestones she hears about on WhatsApp, highest first.
 *
 * Three only. A message every ten days is noise, and noise gets a number
 * blocked; these are the points where the goal feels different — half way,
 * nearly there, and done.
 */
const MILESTONES = Object.freeze([
  { days: 180, key: 'done' },
  { days: 150, key: 'nearly' },
  { days: 90, key: 'half' },
]);

/**
 * The milestone to send now, or null.
 *
 * Only the highest one she has newly crossed: someone who does thirty days in a
 * fortnight, or whose count is back-filled for the first time, must not receive
 * three messages at once. Anything already sent is never sent again, even if
 * her count later drops (an ops correction to a missed day can do that).
 */
function milestoneDue(progress, alreadySent = []) {
  if (!progress) return null;
  const sent = new Set((Array.isArray(alreadySent) ? alreadySent : []).map((v) => String(v)));
  // Only the HIGHEST milestone she has reached is ever considered. A back-fill
  // can take someone from nothing to 180 in one sweep; sending 180 today and
  // "only 30 more days" tomorrow would read as a mistake, because it is one.
  const highest = MILESTONES.find((m) => progress.completed >= m.days);
  if (!highest) return null;
  return sent.has(String(highest.days)) ? null : highest;
}

/** The milestone plus every lower one, so the lower ones never fire later. */
function milestonesCoveredBy(milestone) {
  if (!milestone) return [];
  return MILESTONES.filter((m) => m.days <= milestone.days).map((m) => String(m.days));
}

/** What each milestone says. Days left, then the reason to keep going. */
function milestoneMessage(milestone, progress, language = 'ml') {
  if (!milestone || !progress) return '';
  const ml = !String(language || '').toLowerCase().startsWith('en');
  const { completed, remaining } = progress;
  if (milestone.key === 'done') {
    return ml
      ? `അഭിനന്ദനങ്ങൾ! നിങ്ങൾ Pulso-യിൽ ${completed} ദിവസത്തെ duty പൂർത്തിയാക്കി. Pulso Global Private Limited-ന്റെ experience certificate തയ്യാറാണ്. Pulso App-ൽ നിന്ന് download ചെയ്യാം.`
      : `Congratulations! You have completed ${completed} duty days with Pulso. Your experience certificate from Pulso Global Private Limited is ready. You can download it from the Pulso App.`;
  }
  if (milestone.key === 'nearly') {
    return ml
      ? `നിങ്ങൾ ${completed} ദിവസത്തെ duty പൂർത്തിയാക്കി. Experience certificate-ന് ഇനി ${remaining} ദിവസം മാത്രം.`
      : `You have completed ${completed} duty days. Only ${remaining} more days for your experience certificate.`;
  }
  return ml
    ? `നിങ്ങൾ ${completed} ദിവസത്തെ duty പൂർത്തിയാക്കി — പകുതി വഴി കഴിഞ്ഞു. Experience certificate-ന് ഇനി ${remaining} ദിവസം കൂടി.`
    : `You have completed ${completed} duty days — half way there. ${remaining} more days for your experience certificate.`;
}

module.exports = {
  CERTIFICATE_DAYS,
  MILESTONES,
  hubUidOf,
  getDutyDaysProgress,
  dutyDaysMessage,
  isDutyDaysQuestion,
  milestoneDue,
  milestonesCoveredBy,
  milestoneMessage,
};
