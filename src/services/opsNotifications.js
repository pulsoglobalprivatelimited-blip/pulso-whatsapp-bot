const fs = require('fs');
const path = require('path');
const config = require('../config');
const { uploadLocalFileToFirebaseStorage } = require('./mediaStorage');
const {
  sendText,
  sendButtons,
  sendList,
  sendTemplate,
  sendImageById,
  sendDocumentById,
  sendImageByUrl,
  sendDocumentByUrl,
  isAppMediaId
} = require('./metaClient');

const REVIEW_ACTIONS = {
  APPROVE: 'review_approve_',
  APPROVE_QUALIFICATION: 'review_approve_qualification_',
  REJECT: 'review_reject_',
  REQUEST_ADDITIONAL_DOCUMENT: 'review_request_additional_document_',
  REASON_REUPLOAD: 'review_reason_reupload_',
  REASON_CV_INSTEAD_OF_CERTIFICATE: 'review_reason_cv_instead_',
  REASON_WRONG_IMAGE: 'review_reason_wrong_image_',
  REASON_AGE_LIMIT_EXCEEDED: 'review_reason_age_limit_',
  REASON_PERMANENT_REJECT: 'review_reason_permanent_reject_',
  REASON_OTHER: 'review_reason_other_',
  ADD_NOTE: 'review_add_note_',
  CONFIRM_REQUEST_ADDITIONAL_DOCUMENT: 'review_confirm_request_additional_document_',
  CONFIRM_REJECT: 'review_confirm_reject_',
  CONFIRM_APPROVE: 'review_confirm_approve_',
  CANCEL: 'review_cancel_'
};

// basic_caregiver: no formal certificate, taken on for practical experience.
// Chosen by the reviewer looking at the upload, never offered to the candidate.
const APPROVABLE_QUALIFICATIONS = ['gda', 'gnm', 'anm', 'hca', 'bsc_nursing', 'other_caregiving', 'basic_caregiver'];

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function getOpsNotificationPhone() {
  return normalizePhone(config.agentHelpWhatsappNumber) || normalizePhone(config.ownerNotificationPhone);
}

function getCertificateReviewPhone() {
  return normalizePhone(config.ownerNotificationPhone) || getOpsNotificationPhone();
}

function getReviewerPhones() {
  return [
    normalizePhone(config.agentHelpWhatsappNumber),
    normalizePhone(config.ownerNotificationPhone)
  ].filter(Boolean);
}

function uniquePhones(phones) {
  return phones.filter(Boolean).filter((phone, index, list) => list.indexOf(phone) === index);
}

function getCertificateReviewPhones() {
  return uniquePhones([
    getCertificateReviewPhone(),
    ...getReviewerPhones()
  ]);
}

function isReviewerPhone(phone) {
  return getReviewerPhones().includes(normalizePhone(phone));
}

function joinLines(lines) {
  return lines.filter(Boolean).join('\n');
}

function formatStatus(value) {
  return String(value || '').replace(/_/g, ' ');
}

function formatDutyHourPreference(value) {
  if (value === '8_hour') return '8 hour';
  if (value === '24_hour') return '24 hour';
  if (value === 'both') return 'Both';
  return value || '-';
}

function formatPulsoAppHelpReason(value) {
  if (value === 'install_help') return 'Pulso app install help';
  if (value === 'login_otp_issue') return 'Pulso app login / OTP issue';
  if (value === 'no_smartphone') return 'Pulso app no smartphone';
  return value ? formatStatus(value) : null;
}

function getHelpRequestedAt(provider) {
  return (
    (provider && provider.pulsoAppHelpRequestedAt) ||
    (provider && provider.agentHelpRequestedAt) ||
    (provider && provider.updatedAt) ||
    null
  );
}

function formatProviderSummary(provider) {
  return [
    `Name: ${(provider && provider.fullName) || '-'}`,
    `Phone: ${(provider && provider.phone) || '-'}`,
    `Age: ${(provider && provider.age) || '-'}`,
    `Sex: ${(provider && provider.sex) || '-'}`,
    `Region: ${(provider && provider.region) || '-'}`,
    `Preferred duty hour: ${formatDutyHourPreference(provider && provider.dutyHourPreference)}`,
    `Qualification: ${provider && provider.qualification ? provider.qualification.toUpperCase() : '-'}`,
    `District: ${(provider && provider.district) || '-'}`,
    `Status: ${provider && provider.status ? formatStatus(provider.status) : '-'}`
  ];
}

function buildProviderChatLink(phone) {
  const normalizedPhone = normalizePhone(phone);
  return normalizedPhone ? `https://wa.me/${normalizedPhone}` : null;
}

function buildProviderIntroMessage(provider, senderName = 'Ashmila') {
  const name = provider && provider.fullName ? provider.fullName : null;
  return [
    `നമസ്കാരം${name ? ` ${name}` : ''},`,
    `ഞാൻ ${senderName}, Pulso support team-ിൽ നിന്നാണ് message ചെയ്യുന്നത്.`,
    'താങ്കൾ കൂടുതൽ സഹായം ആവശ്യപ്പെട്ടതായി കണ്ടു.',
    'എങ്ങനെ സഹായിക്കാം?'
  ].join(' ');
}

function buildProviderPrefilledChatLink(provider, senderName = 'Ashmila') {
  const chatLink = buildProviderChatLink(provider && provider.phone);
  if (!chatLink) {
    return null;
  }

  return `${chatLink}?text=${encodeURIComponent(buildProviderIntroMessage(provider, senderName))}`;
}

function buildReviewButtons(providerPhone) {
  return [
    { id: `${REVIEW_ACTIONS.APPROVE}${providerPhone}`, title: 'Approve' },
    { id: `${REVIEW_ACTIONS.REJECT}${providerPhone}`, title: 'Reject' },
    { id: `${REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT}${providerPhone}`, title: 'Request doc' }
  ];
}

function buildConfirmationButtons(providerPhone, action) {
  if (action === 'approve') {
    return [
      { id: `${REVIEW_ACTIONS.CONFIRM_APPROVE}${providerPhone}`, title: 'Confirm approve' },
      { id: `${REVIEW_ACTIONS.CANCEL}${providerPhone}`, title: 'Cancel' }
    ];
  }

  return [
    { id: `${REVIEW_ACTIONS.CONFIRM_REJECT}${providerPhone}`, title: 'Confirm reject' },
    { id: `${REVIEW_ACTIONS.CANCEL}${providerPhone}`, title: 'Cancel' }
  ];
}

function normalizeQualification(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return APPROVABLE_QUALIFICATIONS.includes(normalized) ? normalized : null;
}

function formatQualification(value) {
  if (value === 'gda') return 'GDA';
  if (value === 'gnm') return 'GNM';
  if (value === 'anm') return 'ANM';
  if (value === 'hca') return 'HCA';
  if (value === 'bsc_nursing') return 'BSc Nursing';
  if (value === 'other_caregiving') return 'Other caregiving';
  if (value === 'basic_caregiver') return 'Basic caregiver';
  return value ? formatStatus(value) : '-';
}

function buildApproveQualificationRows(providerPhone) {
  return APPROVABLE_QUALIFICATIONS.map((qualification) => ({
    id: `${REVIEW_ACTIONS.APPROVE_QUALIFICATION}${qualification}_${providerPhone}`,
    title: formatQualification(qualification)
  }));
}

function buildRejectReasonButtons(providerPhone) {
  return [
    { id: `${REVIEW_ACTIONS.REASON_REUPLOAD}${providerPhone}`, title: 'Request reupload' },
    { id: `${REVIEW_ACTIONS.REASON_CV_INSTEAD_OF_CERTIFICATE}${providerPhone}`, title: 'CV instead' },
    { id: `${REVIEW_ACTIONS.REASON_WRONG_IMAGE}${providerPhone}`, title: 'Wrong image' },
    { id: `${REVIEW_ACTIONS.REASON_AGE_LIMIT_EXCEEDED}${providerPhone}`, title: 'Age limit exceeded' },
    { id: `${REVIEW_ACTIONS.REASON_PERMANENT_REJECT}${providerPhone}`, title: 'Permanent reject' },
    { id: `${REVIEW_ACTIONS.REASON_OTHER}${providerPhone}`, title: 'Other reason' }
  ];
}

function buildRejectReasonRows(providerPhone) {
  return buildRejectReasonButtons(providerPhone).map((button) => ({
    id: button.id,
    title: button.title
  }));
}

function buildRejectFollowupButtons(providerPhone) {
  return [
    { id: `${REVIEW_ACTIONS.ADD_NOTE}${providerPhone}`, title: 'Add note' },
    { id: `${REVIEW_ACTIONS.CONFIRM_REJECT}${providerPhone}`, title: 'Reject now' },
    { id: `${REVIEW_ACTIONS.CANCEL}${providerPhone}`, title: 'Cancel' }
  ];
}

async function sendOpsNotification(body) {
  const to = getCertificateReviewPhone();
  if (!to) {
    return null;
  }

  try {
    return await sendText(to, body);
  } catch (error) {
    console.error(
      '[OPS_NOTIFICATION_ERROR]',
      JSON.stringify(
        {
          to,
          body,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function sendNotificationTo(phone, body, logLabel) {
  const to = normalizePhone(phone);
  if (!to) {
    return null;
  }

  try {
    const result = await sendText(to, body);
    console.log(
      '[OPS_NOTIFICATION_SENT]',
      JSON.stringify(
        {
          to,
          logLabel,
          preview: body.slice(0, 140)
        },
        null,
        2
      )
    );
    return result;
  } catch (error) {
    console.error(
      `[${logLabel}]`,
      JSON.stringify(
        {
          to,
          body,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

function getReviewerDestination(reviewerPhone) {
  return normalizePhone(reviewerPhone) || getCertificateReviewPhone();
}

function extractWhatsappMessages(result) {
  return result && Array.isArray(result.messages)
    ? result.messages.map((message) => ({
        id: message.id || null,
        messageStatus: message.message_status || null
      }))
    : [];
}

function buildNotificationAttempt(to, type, result, error, extra = {}) {
  const attempt = {
    to,
    type,
    ok: Boolean(result),
    at: new Date().toISOString(),
    ...extra
  };

  if (result) {
    attempt.messages = extractWhatsappMessages(result);
  }

  if (error) {
    attempt.error = {
      message: error.message,
      response: error.response ? error.response.data : null
    };
  }

  return attempt;
}

function getCertificateReviewTemplateName() {
  return String(config.certificateReviewTemplateName || '').trim();
}

function getCertificateReviewTemplateLanguage() {
  return String(config.certificateReviewTemplateLanguage || 'en').trim() || 'en';
}

async function sendCertificateReviewTemplate(to, provider) {
  const templateName = getCertificateReviewTemplateName();
  if (!templateName || !to) {
    return null;
  }

  try {
    const result = await sendTemplate(to, templateName, getCertificateReviewTemplateLanguage(), []);
    console.log(
      '[OPS_REVIEW_TEMPLATE_SENT]',
      JSON.stringify(
        {
          to,
          providerPhone: provider && provider.phone ? provider.phone : null,
          templateName
        },
        null,
        2
      )
    );
    return result;
  } catch (error) {
    console.error(
      '[OPS_REVIEW_TEMPLATE_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider && provider.phone ? provider.phone : null,
          templateName,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    throw error;
  }
}

// ---- The review alert that stands on its own -------------------------------
// The old alert was three messages: a bare template, then the buttons, then the
// file. Only the template may cross the 24-hour window, and it carried neither
// the certificate nor the buttons — so a reviewer who had not written to the bot
// that day got a notice about a certificate they could not see or act on. These
// two templates carry the file in the header, the caregiver in the body and the
// Approve / Reject / Ask again quick replies, so one message does all of it and
// the window never applies.

function getCertificateReviewV2TemplateName(attachment) {
  const name =
    attachment && attachment.type === 'image'
      ? config.certificateReviewImageTemplateName
      : config.certificateReviewFileTemplateName;
  return String(name || '').trim();
}

function formatReviewTemplateValue(value) {
  // A template variable may not be empty and may not hold a newline or a run of
  // spaces, or Meta rejects the send with 132000.
  const text = String(value === 0 ? '0' : value || '').replace(/\s+/g, ' ').trim();
  return text || '-';
}

// The nine lines the old free-form alert showed, in the same order and from the
// same helper, so the template and the summary can never drift apart. The
// template's body is fixed at approval, so this list and the {{1}}..{{9}} in
// certificate_review_v3_* must stay in step.
function buildCertificateReviewBodyValues(provider) {
  return formatProviderSummary(provider).map((line) =>
    formatReviewTemplateValue(line.slice(line.indexOf(':') + 1))
  );
}

function buildCertificateReviewV2Components(provider, attachment) {
  const link = attachment && attachment.cloudStorageUrl ? attachment.cloudStorageUrl : null;
  if (!link) {
    return null;
  }

  const header =
    attachment.type === 'image'
      ? { type: 'image', image: { link } }
      : {
          type: 'document',
          document: { link, filename: attachment.fileName || 'certificate.pdf' }
        };

  const providerPhone = normalizePhone(provider && provider.phone);

  return [
    { type: 'header', parameters: [header] },
    {
      type: 'body',
      parameters: buildCertificateReviewBodyValues(provider).map((text) => ({ type: 'text', text }))
    },
    // The payloads are the same ids the interactive buttons use, so a tap on a
    // template button and a tap on an in-window button reach the same handler.
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '0',
      parameters: [{ type: 'payload', payload: `${REVIEW_ACTIONS.APPROVE}${providerPhone}` }]
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '1',
      parameters: [{ type: 'payload', payload: `${REVIEW_ACTIONS.REJECT}${providerPhone}` }]
    },
    {
      type: 'button',
      sub_type: 'quick_reply',
      index: '2',
      parameters: [
        { type: 'payload', payload: `${REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT}${providerPhone}` }
      ]
    }
  ];
}

async function sendCertificateReviewV2Template(to, provider, attachment) {
  const templateName = getCertificateReviewV2TemplateName(attachment);
  const components = buildCertificateReviewV2Components(provider, attachment);

  if (!to || !templateName || !components) {
    return { ok: false, reason: components ? 'template_not_configured' : 'attachment_without_archive_url' };
  }

  try {
    const result = await sendTemplate(
      to,
      templateName,
      getCertificateReviewTemplateLanguage(),
      components
    );
    console.log(
      '[OPS_REVIEW_V2_SENT]',
      JSON.stringify(
        { to, providerPhone: provider && provider.phone ? provider.phone : null, templateName },
        null,
        2
      )
    );
    return { ok: true, result, templateName };
  } catch (error) {
    console.error(
      '[OPS_REVIEW_V2_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider && provider.phone ? provider.phone : null,
          templateName,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return { ok: false, reason: 'send_failed', error, templateName };
  }
}

/* The file is still on the server's disk even when both ways of sending it
   have gone: the Meta id expires after about thirty days, and the cloud copy
   was never made for anything uploaded while FIREBASE_STORAGE_BUCKET pointed at
   a bucket that did not exist (April-May 2026). Those certificates were
   unsendable for good, which is how a reviewer came to get an alert with no
   certificate attached to it.

   The bucket works now, so the file is archived on the spot and the fresh URL
   used. It repairs the record as a side effect, so the next alert for the same
   provider costs nothing. Returns null if the file is not on this disk either,
   which is the genuine dead end. */
async function archiveFromLocalDisk(provider, attachment) {
  const localPath = attachment && attachment.storagePath;
  if (!localPath || !fs.existsSync(localPath)) {
    return null;
  }

  try {
    const uploaded = await uploadLocalFileToFirebaseStorage(
      (provider && provider.phone) || 'unknown',
      attachment.category || 'certificate',
      attachment.fileName || path.basename(localPath),
      localPath,
      attachment.mimeType || undefined
    );
    return (uploaded && (uploaded.cloudStorageUrl || uploaded.url)) || null;
  } catch (error) {
    console.error(
      '[OPS_REVIEW_MEDIA_RESCUE_ERROR]',
      JSON.stringify({ attachmentId: attachment.id, localPath, message: error.message })
    );
    return null;
  }
}

async function sendReviewMediaTo(to, provider, attachment, index, total) {
  // A file ops uploaded from the dashboard has no media id, only an archived
  // copy; that link is enough to send it.
  if (!to || !attachment || (!attachment.id && !attachment.cloudStorageUrl)) {
    return null;
  }

  const caption = joinLines([
    total > 1 ? `Provider certificate for review (${index}/${total})` : 'Provider certificate for review',
    provider && provider.phone ? `Phone: ${provider.phone}` : null
  ]);

  const archivedUrl = attachment.cloudStorageUrl || null;

  const sendByUrl = async (link) =>
    attachment.type === 'image'
      ? sendImageByUrl(to, link, caption)
      : sendDocumentByUrl(to, link, attachment.fileName || undefined, caption);

  // An app upload has no Meta media id — its id only ever existed in this
  // process's memory — so the archived link is the only way to send it.
  if (!attachment.id || isAppMediaId(attachment.id)) {
    if (!archivedUrl) {
      const rescued = await archiveFromLocalDisk(provider, attachment);
      if (rescued) {
        try {
          return await sendByUrl(rescued);
        } catch (rescueError) {
          console.error(
            '[OPS_REVIEW_MEDIA_ERROR]',
            JSON.stringify({ to, attachmentId: attachment.id, via: 'local_disk_rescue_app', message: rescueError.message })
          );
          return null;
        }
      }
    }
    if (!archivedUrl) {
      console.error(
        '[OPS_REVIEW_MEDIA_ERROR]',
        JSON.stringify(
          {
            to,
            attachmentId: attachment.id,
            reason: 'app_media_without_archive_url',
            detail: 'App-uploaded media was never archived to cloud storage, so it cannot be sent to the reviewer.'
          },
          null,
          2
        )
      );
      return null;
    }

    try {
      return await sendByUrl(archivedUrl);
    } catch (error) {
      console.error(
        '[OPS_REVIEW_MEDIA_ERROR]',
        JSON.stringify(
          { to, attachmentId: attachment.id, via: 'archive_url', message: error.message, response: error.response ? error.response.data : null },
          null,
          2
        )
      );
      return null;
    }
  }

  try {
    if (attachment.type === 'image') {
      return await sendImageById(to, attachment.id, caption);
    }

    return await sendDocumentById(to, attachment.id, attachment.fileName || undefined, caption);
  } catch (error) {
    // A Meta media id expires about 30 days after upload, so an older
    // certificate can only be resent from the archive.
    if (archivedUrl) {
      try {
        return await sendByUrl(archivedUrl);
      } catch (urlError) {
        console.error(
          '[OPS_REVIEW_MEDIA_ERROR]',
          JSON.stringify(
            { to, attachmentId: attachment.id, via: 'archive_url_fallback', message: urlError.message, response: urlError.response ? urlError.response.data : null },
            null,
            2
          )
        );
        return null;
      }
    }

    // Last resort, and the one that saves the older certificates: the file is
    // on disk, so archive it now and send that.
    const rescuedUrl = await archiveFromLocalDisk(provider, attachment);
    if (rescuedUrl) {
      try {
        return await sendByUrl(rescuedUrl);
      } catch (rescueError) {
        console.error(
          '[OPS_REVIEW_MEDIA_ERROR]',
          JSON.stringify(
            { to, attachmentId: attachment.id, via: 'local_disk_rescue', message: rescueError.message },
            null,
            2
          )
        );
        return null;
      }
    }

    console.error(
      '[OPS_REVIEW_MEDIA_ERROR]',
      JSON.stringify(
        {
          to,
          attachmentId: attachment.id,
          attachmentType: attachment.type,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function sendAdditionalDocumentMedia(provider, attachment) {
  const to = getCertificateReviewPhone();
  if (!to || !attachment || !attachment.id) {
    return null;
  }

  const caption = joinLines([
    'Requested additional document uploaded',
    provider && provider.phone ? `Phone: ${provider.phone}` : null,
    attachment.fileName ? `File: ${attachment.fileName}` : null
  ]);

  try {
    if (attachment.type === 'image') {
      return await sendImageById(to, attachment.id, caption);
    }

    return await sendDocumentById(to, attachment.id, attachment.fileName || undefined, caption);
  } catch (error) {
    console.error(
      '[OPS_ADDITIONAL_DOC_MEDIA_ERROR]',
      JSON.stringify(
        {
          to,
          attachmentId: attachment.id,
          attachmentType: attachment.type,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function notifyCertificateUploaded(provider, attachments) {
  const recipients = getCertificateReviewPhones();
  if (!recipients.length) {
    return { sent: false, recipients: [], attempts: [] };
  }

  const body = joinLines([
    'New certificate uploaded for review.',
    ...formatProviderSummary(provider),
    'Tap below to approve or reject.'
  ]);

  const files = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];

  let notificationSent = false;
  const attempts = [];

  for (const to of recipients) {
    // One self-contained template per certificate. Only if one of them cannot
    // go — no archived link, template not approved yet, Meta refused it — does
    // this recipient fall back to the old three messages, which at least reach
    // them while the reviewer's 24-hour window is open.
    if (config.certificateReviewV2Enabled && files.length) {
      let deliveredEverything = true;

      for (const attachment of files) {
        const outcome = await sendCertificateReviewV2Template(to, provider, attachment);
        attempts.push(
          buildNotificationAttempt(to, 'review_template_v2', outcome.ok ? outcome.result : null, outcome.error || null, {
            templateName: outcome.templateName || null,
            attachmentId: attachment && attachment.id ? attachment.id : null,
            attachmentType: attachment && attachment.type ? attachment.type : null,
            ...(outcome.ok ? {} : { reason: outcome.reason || 'send_failed' })
          })
        );

        if (outcome.ok) {
          notificationSent = true;
        } else {
          deliveredEverything = false;
        }
      }

      if (deliveredEverything) {
        continue;
      }
    }

    try {
      const result = await sendCertificateReviewTemplate(to, provider);
      if (result) {
        attempts.push(
          buildNotificationAttempt(to, 'review_template', result, null, {
            templateName: getCertificateReviewTemplateName()
          })
        );
        notificationSent = true;
      }
    } catch (error) {
      attempts.push(
        buildNotificationAttempt(to, 'review_template', null, error, {
          templateName: getCertificateReviewTemplateName()
        })
      );
    }

    try {
      const result = await sendButtons(to, body, buildReviewButtons(provider.phone));
      attempts.push(buildNotificationAttempt(to, 'review_buttons', result));
      notificationSent = true;
    } catch (error) {
      attempts.push(buildNotificationAttempt(to, 'review_buttons', null, error));
      console.error(
        '[OPS_REVIEW_BUTTON_ERROR]',
        JSON.stringify(
          {
            to,
            providerPhone: provider && provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
    }

    for (let index = 0; index < files.length; index += 1) {
      const result = await sendReviewMediaTo(to, provider, files[index], index + 1, files.length);
      attempts.push(
        buildNotificationAttempt(to, 'review_media', result, null, {
          attachmentId: files[index] && files[index].id ? files[index].id : null,
          attachmentType: files[index] && files[index].type ? files[index].type : null
        })
      );
    }
  }

  return { sent: notificationSent, recipients, attempts };
}

async function notifyCertificateReviewed(provider, decision, reviewedBy, notes) {
  const body = joinLines([
    `Pulso alert: certificate ${decision}`,
    ...formatProviderSummary(provider),
    reviewedBy ? `Reviewer: ${reviewedBy}` : null,
    notes ? `Notes: ${notes}` : null
  ]);

  return sendOpsNotification(body);
}

async function notifyAdditionalDocumentRequested(provider, requestedBy, note) {
  const body = joinLines([
    'Pulso alert: additional document requested',
    ...formatProviderSummary(provider),
    requestedBy ? `Requested by: ${requestedBy}` : null,
    note ? `Note: ${note}` : null
  ]);

  return sendOpsNotification(body);
}

async function notifyAdditionalDocumentUploaded(provider, attachment, request) {
  const to = getCertificateReviewPhone();
  const body = joinLines([
    'Pulso alert: requested additional document uploaded',
    ...formatProviderSummary(provider),
    request && request.note ? `Requested note: ${request.note}` : null,
    attachment && attachment.fileName ? `File: ${attachment.fileName}` : null,
    'Tap below to approve, reject, or request another document.'
  ]);

  if (to && provider && provider.phone) {
    try {
      await sendButtons(to, body, buildReviewButtons(provider.phone));
    } catch (error) {
      console.error(
        '[OPS_ADDITIONAL_DOC_BUTTON_ERROR]',
        JSON.stringify(
          {
            to,
            providerPhone: provider.phone,
            message: error.message,
            response: error.response ? error.response.data : null
          },
          null,
          2
        )
      );
      await sendOpsNotification(body);
    }
  } else {
    await sendOpsNotification(body);
  }

  await sendAdditionalDocumentMedia(provider, attachment);
  return null;
}

async function notifyOnboardingCompleted(provider) {
  const body = joinLines([
    'Pulso alert: onboarding completed',
    ...formatProviderSummary(provider)
  ]);

  const recipients = [
    getCertificateReviewPhone(),
    normalizePhone(config.secondaryNotificationPhone)
  ].filter(Boolean)
    .filter((phone, index, list) => list.indexOf(phone) === index);

  for (const recipient of recipients) {
    await sendNotificationTo(recipient, body, 'OPS_ONBOARDING_COMPLETED_ERROR');
  }

  return null;
}

async function notifyAgentHelpRequested(provider) {
  const helpNumber = normalizePhone(config.agentHelpWhatsappNumber);
  const backupHelpNumber = normalizePhone(config.secondaryNotificationPhone);
  const recipients = [
    { phone: helpNumber, senderName: 'Ashmila' },
    { phone: backupHelpNumber, senderName: 'Ashmila' }
  ]
    .filter((entry) => entry.phone)
    .filter((entry, index, list) => list.findIndex((item) => item.phone === entry.phone) === index);
  if (!recipients.length) {
    return null;
  }

  console.log(
    '[AGENT_HELP_REQUESTED]',
    JSON.stringify(
      {
        providerPhone: provider && provider.phone ? provider.phone : null,
        recipients: recipients.map((entry) => entry.phone)
      },
      null,
      2
    )
  );

  for (const recipient of recipients) {
    const chatLink = buildProviderChatLink(provider && provider.phone);
    const introLink = buildProviderPrefilledChatLink(provider, recipient.senderName);
    const helpReason = formatPulsoAppHelpReason(provider && provider.pulsoAppHelpReason);
    const body = joinLines([
      'Pulso alert: provider requested additional help',
      helpReason ? `Help type: ${helpReason}` : 'Help type: General support',
      getHelpRequestedAt(provider) ? `Requested at: ${getHelpRequestedAt(provider)}` : null,
      chatLink ? `Reply now: ${chatLink}` : null,
      introLink ? `Reply with intro: ${introLink}` : null,
      ...formatProviderSummary(provider),
      `Intro message: ${buildProviderIntroMessage(provider, recipient.senderName)}`
    ]);
    await sendNotificationTo(recipient.phone, body, 'AGENT_HELP_NOTIFICATION_ERROR');
  }

  return null;
}

async function requestReviewQualificationSelection(provider, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    'Select the qualification shown on the certificate.',
    provider.qualification ? `Candidate selected: ${formatQualification(provider.qualification)}` : null,
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendList(to, body, 'Select qualification', [
      {
        title: 'Approved qualification',
        rows: buildApproveQualificationRows(provider.phone)
      }
    ]);
  } catch (error) {
    console.error(
      '[OPS_APPROVE_QUALIFICATION_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function requestReviewConfirmation(provider, action, reviewerPhone, qualification) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const actionLabel = action === 'approve' ? 'approve' : 'reject';
  const body = joinLines([
    `Please confirm: ${actionLabel} certificate?`,
    action === 'approve' && qualification ? `Approved qualification: ${formatQualification(qualification)}` : null,
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendButtons(to, body, buildConfirmationButtons(provider.phone, action));
  } catch (error) {
    console.error(
      '[OPS_REVIEW_CONFIRMATION_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          action,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function requestRejectReason(provider, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    'Choose the reject reason.',
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendList(to, body, 'Choose reason', [
      {
        title: 'Reject reason',
        rows: buildRejectReasonRows(provider.phone)
      }
    ]);
  } catch (error) {
    console.error(
      '[OPS_REJECT_REASON_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function requestRejectNoteOrConfirmation(provider, reasonLabel, note, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    `Reject reason: ${reasonLabel}`,
    note ? `Current note: ${note}` : 'You can add a note or reject now.',
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendButtons(to, body, buildRejectFollowupButtons(provider.phone));
  } catch (error) {
    console.error(
      '[OPS_REJECT_NOTE_OR_CONFIRM_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function promptAdditionalDocumentNoteEntry(provider, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    'Send the note for the additional document request now.',
    'Example: Please upload Aadhaar front side.',
    'Your next WhatsApp text will be saved as the request note.'
  ]);

  return sendNotificationTo(to, body, 'OPS_ADDITIONAL_DOC_NOTE_PROMPT_ERROR');
}

async function requestAdditionalDocumentConfirmation(provider, note, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to || !provider || !provider.phone) {
    return null;
  }

  const body = joinLines([
    'Please confirm: request additional document?',
    note ? `Note: ${note}` : null,
    ...formatProviderSummary(provider)
  ]);

  try {
    return await sendButtons(to, body, [
      { id: `${REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT}${provider.phone}`, title: 'Edit note' },
      { id: `${REVIEW_ACTIONS.CONFIRM_REQUEST_ADDITIONAL_DOCUMENT}${provider.phone}`, title: 'Send request' },
      { id: `${REVIEW_ACTIONS.CANCEL}${provider.phone}`, title: 'Cancel' }
    ]);
  } catch (error) {
    console.error(
      '[OPS_ADDITIONAL_DOC_CONFIRM_ERROR]',
      JSON.stringify(
        {
          to,
          providerPhone: provider.phone,
          message: error.message,
          response: error.response ? error.response.data : null
        },
        null,
        2
      )
    );
    return null;
  }
}

async function promptRejectNoteEntry(provider, reasonLabel, reviewerPhone) {
  const to = getReviewerDestination(reviewerPhone);
  if (!to) {
    return null;
  }

  const body = joinLines([
    `Send the note for rejection now.`,
    `Reason: ${reasonLabel}`,
    'Your next WhatsApp text will be saved as the rejection note.'
  ]);

  return sendNotificationTo(to, body, 'OPS_REJECT_NOTE_PROMPT_ERROR');
}

function getRejectReasonDetails(action) {
  if (action === 'reason_reupload') {
    return {
      code: 'request_reupload',
      label: 'Request reupload',
      rejectMessageKey: 'certificateReuploadRequested'
    };
  }

  if (action === 'reason_cv_instead_of_certificate') {
    return {
      code: 'cv_instead_of_certificate',
      label: 'CV instead of certificate',
      rejectMessageKey: 'certificateCvUploaded'
    };
  }

  if (action === 'reason_wrong_image') {
    return {
      code: 'wrong_image_instead_of_certificate',
      label: 'Wrong image',
      rejectMessageKey: 'certificateWrongImageUploaded'
    };
  }

  if (action === 'reason_age_limit_exceeded') {
    return {
      code: 'age_limit_exceeded',
      label: 'Age limit exceeded',
      rejectMessageKey: 'ageFinalRejection'
    };
  }

  if (action === 'reason_permanent_reject') {
    return {
      code: 'permanent_reject',
      label: 'Permanent reject',
      rejectMessageKey: 'certificateRejectedPermanent'
    };
  }

  if (action === 'reason_other') {
    return {
      code: 'other_reason',
      label: 'Other reason',
      rejectMessageKey: 'certificateRejected'
    };
  }

  return null;
}

function parseReviewerAction(message) {
  const replyId =
    message &&
    message.interactive &&
    message.interactive.button_reply &&
    message.interactive.button_reply.id;
  const listReplyId =
    message &&
    message.interactive &&
    message.interactive.list_reply &&
    message.interactive.list_reply.id;
  // A quick reply on a template comes back as its own message type, carrying the
  // payload the template was sent with rather than an interactive reply id. The
  // payloads are the same ids, so both taps land on the same branches below.
  const templateButtonPayload =
    message && message.type === 'button' && message.button ? message.button.payload : null;
  const interactiveReplyId = replyId || listReplyId || templateButtonPayload;

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.APPROVE_QUALIFICATION)) {
    const value = interactiveReplyId.slice(REVIEW_ACTIONS.APPROVE_QUALIFICATION.length);
    const qualification = APPROVABLE_QUALIFICATIONS.find((item) => value.startsWith(`${item}_`));

    if (qualification) {
      return {
        action: 'approve_qualification',
        qualification,
        phone: value.slice(qualification.length + 1)
      };
    }
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.APPROVE)) {
    return {
      action: 'approve',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.APPROVE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REJECT)) {
    return {
      action: 'reject',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REJECT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT)) {
    return {
      action: 'request_additional_document',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REQUEST_ADDITIONAL_DOCUMENT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_REUPLOAD)) {
    return {
      action: 'reason_reupload',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_REUPLOAD.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_CV_INSTEAD_OF_CERTIFICATE)) {
    return {
      action: 'reason_cv_instead_of_certificate',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_CV_INSTEAD_OF_CERTIFICATE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_WRONG_IMAGE)) {
    return {
      action: 'reason_wrong_image',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_WRONG_IMAGE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_AGE_LIMIT_EXCEEDED)) {
    return {
      action: 'reason_age_limit_exceeded',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_AGE_LIMIT_EXCEEDED.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_PERMANENT_REJECT)) {
    return {
      action: 'reason_permanent_reject',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_PERMANENT_REJECT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.REASON_OTHER)) {
    return {
      action: 'reason_other',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.REASON_OTHER.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.ADD_NOTE)) {
    return {
      action: 'add_note',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.ADD_NOTE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CONFIRM_APPROVE)) {
    return {
      action: 'confirm_approve',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CONFIRM_APPROVE.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CONFIRM_REQUEST_ADDITIONAL_DOCUMENT)) {
    return {
      action: 'confirm_request_additional_document',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CONFIRM_REQUEST_ADDITIONAL_DOCUMENT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CONFIRM_REJECT)) {
    return {
      action: 'confirm_reject',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CONFIRM_REJECT.length)
    };
  }

  if (interactiveReplyId && interactiveReplyId.startsWith(REVIEW_ACTIONS.CANCEL)) {
    return {
      action: 'cancel',
      phone: interactiveReplyId.slice(REVIEW_ACTIONS.CANCEL.length)
    };
  }

  const text = String(
    (message && message.text && message.text.body) ||
      (message && message.button && message.button.text) ||
      ''
  ).trim();

  const match = text.match(/^(approve|reject)\s+(\+?\d+)/i);
  if (match) {
    return {
      action: match[1].toLowerCase(),
      phone: normalizePhone(match[2])
    };
  }

  return {
    action: 'note_text',
    note: text
  };
}

module.exports = {
  buildCertificateReviewBodyValues,
  getRejectReasonDetails,
  isReviewerPhone,
  notifyAgentHelpRequested,
  notifyAdditionalDocumentRequested,
  notifyAdditionalDocumentUploaded,
  notifyCertificateUploaded,
  notifyCertificateReviewed,
  notifyOnboardingCompleted,
  parseReviewerAction,
  promptAdditionalDocumentNoteEntry,
  promptRejectNoteEntry,
  requestAdditionalDocumentConfirmation,
  requestRejectNoteOrConfirmation,
  requestRejectReason,
  requestReviewQualificationSelection,
  requestReviewConfirmation
};
