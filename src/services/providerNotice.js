'use strict';

// Notices the Pulso server asks this bot to send a caregiver from 67744
// (founder, 21 Oct 2026): "you are blocked for 90 days / blocked / unblocked".
// The server decides who and when (functions/lib/provider_block_notice.js in
// pulso_hub); this only checks the request, sends the approved template and
// logs it in her chat so the inbox shows it.

const ALLOWED_TEMPLATES = Object.freeze({
  provider_blocked_until: 2, // {{1}} first name, {{2}} date
  provider_blocked_until_v2: 2, // founder's own Malayalam wording, 22 Oct 2026
  provider_blocked_permanent: 1, // {{1}} first name
  provider_unblocked: 1, // {{1}} first name
});
const ALLOWED_LANGUAGES = Object.freeze(['en', 'ml']);

function validate(body = {}) {
  const phone = String(body.phone || '').replace(/\D/g, '');
  if (phone.length < 11 || phone.length > 15) throw new Error('phone is required');
  const templateName = String(body.templateName || '');
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TEMPLATES, templateName)) {
    throw new Error('unknown template');
  }
  const languageCode = String(body.languageCode || '');
  if (!ALLOWED_LANGUAGES.includes(languageCode)) throw new Error('unknown language');
  const params = Array.isArray(body.params) ? body.params.map((p) => String(p || '').trim().slice(0, 60)) : [];
  if (params.length !== ALLOWED_TEMPLATES[templateName] || params.some((p) => !p)) {
    throw new Error('wrong template values');
  }
  return { phone, templateName, languageCode, params, kind: String(body.kind || ''), uid: String(body.uid || '') };
}

/**
 * deps (injected for tests): sendTemplate(to, name, lang, components),
 * getProvider(phone), appendHistory(phone, event).
 */
async function sendProviderNotice(body, deps) {
  const n = validate(body);
  const components = [{ type: 'body', parameters: n.params.map((text) => ({ type: 'text', text })) }];
  const res = await deps.sendTemplate(n.phone, n.templateName, n.languageCode, components);
  const messageId = res && Array.isArray(res.messages) && res.messages[0] ? String(res.messages[0].id || '') : '';
  // Logged only on a record that exists: a caregiver who never used the bot
  // must not appear in the onboarding inbox as a new applicant.
  try {
    const existing = await deps.getProvider(n.phone);
    if (existing) {
      await deps.appendHistory(n.phone, {
        type: 'outbound_message',
        sender: 'pulso',
        payload: { kind: 'template', body: { name: n.templateName, languageCode: n.languageCode, params: n.params } },
        event: `provider_notice_${n.kind || n.templateName}`,
      });
    }
  } catch (err) {
    console.error('[PROVIDER_NOTICE_LOG_ERROR]', n.phone, err && err.message);
  }
  return { messageId };
}

module.exports = { ALLOWED_TEMPLATES, validate, sendProviderNotice };
