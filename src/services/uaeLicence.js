'use strict';

// Dubai caregivers (founder, 26 Oct 2026; contract in pulso_hub
// docs/uae_build_contract.md). In place of the certificate photo she TYPES her
// DHA licence number, or, without a licence, her company name and staff ID.
// The licence card photo and a selfie are taken later in the Pulso app, the
// hub's ops review them, and the hub calls /internal/uae-licence-reviewed so
// this bot can tell her on WhatsApp.
//
// Pure where it can be: reading the typed answer and the review texts. The
// route's sending goes through injected deps, like subscriptionFee.markPaid.

const config = require('../config');
const { FLOWS, DEFAULT_FLOW_ID_BY_REGION } = require('../flow');

const MAX_LENGTH = 120;

/**
 * Reads what she typed at the licence step.
 *
 *  - A licence number: letters, digits and dashes, at least five digits, at
 *    most one space ("DHA-12345678", "P 1234567").  -> { dhaLicenceNumber }
 *  - Anything else with words in it is a company and a staff ID: the last
 *    token carrying a digit is the staff ID, the rest the company name
 *    ("Amana Healthcare staff ID 45213").  -> { licenceCompanyName, licenceStaffId }
 *
 * Returns null for an empty answer. Best effort by design: ops see the raw
 * text too (`licenceText`) and the photos settle it.
 */
function parseLicenceAnswer(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
  if (!raw) return null;
  const digits = (raw.match(/\d/g) || []).length;
  const spaces = (raw.match(/ /g) || []).length;
  if (/^[A-Za-z0-9-]+( [A-Za-z0-9-]+)?$/.test(raw) && digits >= 5 && spaces <= 1) {
    return { kind: 'licence', dhaLicenceNumber: raw, licenceCompanyName: '', licenceStaffId: '', licenceText: raw };
  }

  const tokens = raw.split(/[\s,;]+/).filter(Boolean);
  let staffIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (/\d/.test(tokens[i])) {
      staffIndex = i;
      break;
    }
  }
  const strip = (s) => String(s || '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9)]+$/g, '');
  const licenceStaffId = staffIndex >= 0 ? strip(tokens[staffIndex]) : '';
  const nameTokens = staffIndex >= 0 ? tokens.filter((_, i) => i !== staffIndex) : tokens;
  const licenceCompanyName = nameTokens
    .join(' ')
    // "…staff ID", "…ID no:", "…employee number" left in front of the number.
    .replace(/(\b(staff|employee|emp)\b\s*)?\b(id|no|number|num)\b[\s:.#-]*$/i, '')
    .replace(/\b(company|name)\s*[:-]\s*/gi, '')
    .replace(/[\s:#,.-]+$/, '')
    .trim();
  return { kind: 'company', dhaLicenceNumber: '', licenceCompanyName, licenceStaffId, licenceText: raw };
}

function isUaeProvider(provider) {
  if (!provider) return false;
  if (String(provider.region || '').toLowerCase() === 'uae') return true;
  const flow = provider.flowId ? FLOWS[provider.flowId] : null;
  return Boolean(flow && flow.region === 'uae');
}

const REVIEW_TEXTS = {
  en: {
    approve: '✅ You are verified, {name}.\nKeep the Pulso app notifications ON. Duty offers near {area} will come in the app.',
    video_call: 'Hi {name}, we need to confirm one thing.\nOur team will video-call you for 1 minute today. Please keep your licence card ready.',
    reject: 'Hi {name}, we could not check your photos. Please open the Pulso app and take the 2 photos again: your licence card (or company ID card) and a clear selfie holding it, in good light.'
  },
  ml: {
    approve: '✅ {name}, താങ്കൾ verified ആണ്.\nPulso app notifications ON ആക്കി വയ്ക്കുക. {area}-ന് അടുത്തുള്ള duty offers app-ൽ വരും.',
    video_call: 'Hi {name}, ഒരു കാര്യം ഉറപ്പാക്കാനുണ്ട്.\nഞങ്ങളുടെ team ഇന്ന് 1 മിനിറ്റ് video call ചെയ്യും. ദയവായി licence card കയ്യിൽ വയ്ക്കുക.',
    reject: 'Hi {name}, താങ്കളുടെ ഫോട്ടോകൾ പരിശോധിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി Pulso app തുറന്ന് 2 ഫോട്ടോകൾ വീണ്ടും എടുക്കുക: licence card (അല്ലെങ്കിൽ company ID card), അത് കയ്യിൽ പിടിച്ചുള്ള വ്യക്തമായ ഒരു selfie, നല്ല വെളിച്ചത്തിൽ.'
  }
};
const ACTIONS = Object.keys(REVIEW_TEXTS.en);

// Documents before the first duty (27 Oct 2026): Emirates ID front and back
// and a selfie, for everyone reviewed on the WhatsApp desk. Approve reads the
// same; the video-call and retake lines name the Emirates ID.
const DOCUMENT_TEXTS = {
  en: {
    approve: REVIEW_TEXTS.en.approve,
    video_call: 'Hi {name}, we need to confirm one thing.\nOur team will video-call you for 1 minute today. Please keep your Emirates ID ready.',
    reject: 'Hi {name}, we could not check your photos. Please open the Pulso app and take the 3 photos again: your Emirates ID front, the back, and a clear selfie, in good light.'
  },
  ml: {
    approve: REVIEW_TEXTS.ml.approve,
    video_call: 'Hi {name}, ഒരു കാര്യം ഉറപ്പാക്കാനുണ്ട്.\nഞങ്ങളുടെ team ഇന്ന് 1 മിനിറ്റ് video call ചെയ്യും. ദയവായി Emirates ID കയ്യിൽ വയ്ക്കുക.',
    reject: 'Hi {name}, താങ്കളുടെ ഫോട്ടോകൾ പരിശോധിക്കാൻ കഴിഞ്ഞില്ല. ദയവായി Pulso app തുറന്ന് 3 ഫോട്ടോകൾ വീണ്ടും എടുക്കുക: Emirates ID-യുടെ മുൻവശം, പിൻവശം, വ്യക്തമായ ഒരു selfie, നല്ല വെളിച്ചത്തിൽ.'
  }
};

function languageOf(provider) {
  if (provider && provider.language === 'ml') return 'ml';
  const flow = provider && provider.flowId ? FLOWS[provider.flowId] : null;
  return flow && flow.language === 'ml' ? 'ml' : 'en';
}

/** The WhatsApp line for a review decision. */
function reviewedMessage(action, { name, area, language, kind } = {}) {
  const texts = kind === 'emirates_id' ? DOCUMENT_TEXTS : REVIEW_TEXTS;
  const set = texts[language === 'ml' ? 'ml' : 'en'];
  const template = set[action];
  if (!template) throw new Error(`Unknown action: ${action}`);
  return template
    .split('{name}').join(String(name || '').trim() || 'Caregiver')
    .split('{area}').join(String(area || '').trim() || 'you');
}

function firstName(value) {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

/** "DUBAI" as the area when she picked "Other area, Dubai". */
function areaFor(provider) {
  const district = String((provider && provider.district) || '').trim();
  if (!district || /^other area/i.test(district)) return 'Dubai';
  return district;
}

function validateReviewed(body = {}) {
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (phone.length < 11 || phone.length > 15) throw new Error('phone is required');
  const action = String(body.action || '').trim().toLowerCase();
  if (!ACTIONS.includes(action)) throw new Error('action must be approve, reject or video_call');
  const kind = String(body.kind || '').trim().toLowerCase() === 'emirates_id' ? 'emirates_id' : 'licence';
  return { phone, action, name: String(body.name || '').trim().slice(0, 60), kind };
}

/**
 * The hub reviewed her licence photos. Tells her on WhatsApp from the
 * caregiver number, as subscription-fee-paid does: a text inside her 24-hour
 * window, and outside it only a template, when one is configured
 * (UAE_LICENCE_REVIEWED_TEMPLATE, body params: name, action line). Without a
 * template a closed window is reported, not raised, so the hub does not retry
 * a send that cannot happen.
 *   deps: getProvider, updateProvider, appendHistory, sendText, sendTemplate,
 *         isWithinWhatsappReplyWindow (provider -> boolean)
 */
async function handleLicenceReviewed(body, deps) {
  const reviewed = validateReviewed(body);
  const provider = await deps.getProvider(reviewed.phone);
  const language = languageOf(provider || { flowId: DEFAULT_FLOW_ID_BY_REGION.uae });
  const name = reviewed.name || firstName(provider && provider.fullName) || 'Caregiver';
  const text = reviewedMessage(reviewed.action, { name, area: areaFor(provider), language, kind: reviewed.kind });
  const at = new Date().toISOString();

  if (provider) {
    await deps.updateProvider(reviewed.phone, {
      uaeLicenceReview: { action: reviewed.action, at }
    });
    await deps.appendHistory(reviewed.phone, { type: 'system', event: 'uae_licence_reviewed', action: reviewed.action });
  }

  const templateName = String(config.uaeLicenceReviewedTemplateName || '').trim();
  const inWindow = provider && typeof deps.isWithinWhatsappReplyWindow === 'function'
    ? deps.isWithinWhatsappReplyWindow(provider)
    : true;

  let delivered = 'none';
  let error = null;
  if (inWindow || !templateName) {
    try {
      await deps.sendText(reviewed.phone, text);
      delivered = 'text';
    } catch (sendError) {
      error = sendError;
    }
  }
  if (delivered === 'none' && templateName) {
    try {
      const components = [{ type: 'body', parameters: [{ type: 'text', text: name }, { type: 'text', text: reviewed.action }] }];
      await deps.sendTemplate(reviewed.phone, templateName, language === 'ml' ? 'ml' : 'en', components);
      delivered = 'template';
      error = null;
    } catch (templateError) {
      error = templateError;
    }
  }

  // Approved = complete (founder, 27 Oct 2026). Only now does she go in the
  // ops phone book and only now do ops get the Save contact link. Never fails
  // the review: a contact that did not save is recorded, not raised.
  if (provider && reviewed.action === 'approve') {
    await afterApproval(reviewed.phone, deps);
  }

  if (provider) {
    await deps.appendHistory(reviewed.phone, {
      type: 'outbound_message',
      sender: 'pulso',
      payload: { kind: delivered === 'template' ? 'template' : 'text', body: delivered === 'template' ? { name: templateName, action: reviewed.action } : text },
      ...(delivered === 'none' ? { failed: true } : {})
    });
  }

  return {
    ok: delivered !== 'none',
    known: Boolean(provider),
    action: reviewed.action,
    delivered,
    ...(delivered === 'none' ? { reason: error ? error.message : 'outside_whatsapp_window' } : {}),
    text
  };
}

async function afterApproval(phone, deps) {
  const fresh = await deps.getProvider(phone);
  if (typeof deps.saveProviderContact === 'function') {
    try {
      const r = await deps.saveProviderContact(fresh);
      await deps.updateProvider(phone, {
        contactSync: {
          status: r.ok ? 'saved' : r.skipped ? 'skipped' : 'failed',
          skipped: r.skipped === true,
          reason: r.reason || '',
          savedAt: new Date().toISOString(),
          resourceName: r.resourceName || '',
          name: r.name || ''
        }
      });
      await deps.appendHistory(phone, { type: 'system', event: r.ok ? 'google_contact_saved' : 'google_contact_skipped', details: { reason: r.reason || '', name: r.name || '' } });
    } catch (error) {
      console.error('[UAE_CONTACT_SAVE_ERROR]', phone, error.message);
    }
  }
  if (typeof deps.notifyUaeLicenceApproved === 'function') {
    try {
      await deps.notifyUaeLicenceApproved(await deps.getProvider(phone));
    } catch (error) {
      console.error('[UAE_APPROVED_ALERT_ERROR]', phone, error.message);
    }
  }
}

/**
 * The express handler for POST /internal/uae-licence-reviewed. The same auth
 * as /internal/subscription-fee-paid: header x-pulso-bot-secret must equal
 * PULSO_HUB_BOT_SYNC_SECRET (an empty secret refuses everybody). Deps are
 * fetched per request so the server's requires stay lazy.
 */
function uaeLicenceReviewedHandler(getDeps, getSecret = () => config.pulsoHubBotSyncSecret) {
  return async (req, res) => {
    const expected = String(getSecret() || '').trim();
    const given = String((req.get && req.get('x-pulso-bot-secret')) || '').trim();
    if (!expected || given !== expected) return res.status(401).json({ error: 'unauthorized' });
    try {
      return res.json(await handleLicenceReviewed(req.body || {}, getDeps()));
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  };
}

module.exports = {
  uaeLicenceReviewedHandler,
  parseLicenceAnswer,
  isUaeProvider,
  reviewedMessage,
  validateReviewed,
  handleLicenceReviewed,
  REVIEW_TEXTS,
  DOCUMENT_TEXTS
};
