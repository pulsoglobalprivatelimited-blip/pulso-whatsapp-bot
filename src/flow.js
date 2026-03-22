const STEPS = {
  1: 'incoming_lead',
  2: 'awaiting_qualification',
  3: 'qualification_captured',
  4: 'voice_note_sent',
  5: 'awaiting_interest_confirmation',
  6: 'awaiting_documents',
  7: 'documents_received',
  8: 'verification_queue_created',
  9: 'certificate_verification_pending',
  10: 'certificate_verified_or_rejected',
  11: 'awaiting_duty_preference',
  12: 'completed'
};

const STATUS = {
  NEW: 'new_lead',
  AWAITING_QUALIFICATION: 'awaiting_qualification',
  VOICE_NOTE_SENT: 'voice_note_sent',
  AWAITING_INTEREST: 'awaiting_interest_confirmation',
  AWAITING_DOCUMENTS: 'awaiting_documents',
  VERIFICATION_PENDING: 'certificate_verification_pending',
  CERTIFICATE_REJECTED: 'certificate_rejected',
  AWAITING_DUTY_PREFERENCE: 'awaiting_duty_preference',
  COMPLETED: 'completed',
  NEEDS_HUMAN_REVIEW: 'needs_human_review'
};

const QUALIFICATIONS = ['gda', 'gnm', 'anm'];
const DUTY_OPTIONS = ['8 hour', '24 hour'];

const MESSAGES = {
  qualificationQuestion:
    'Hi, thank you for contacting Pulso. Are you a GDA, GNM, or ANM?',
  notEligible:
    'Thanks for reaching out. At the moment we are onboarding GDA, GNM, and ANM providers only. If your qualification changes, please message us again.',
  qualificationRetry:
    'Please reply with your qualification: GDA, GNM, or ANM.',
  voiceNoteIntro:
    'Thank you. Please listen to this short audio about the Pulso working model. If you are interested, reply with "Interested".',
  interestedPrompt:
    'If you would like to continue, please reply with "Interested".',
  documentsRequest:
    'Please send your CV and certificate here. We will verify your certificate before we proceed.',
  documentsAck:
    'We have received your documents. Our team will verify your certificate and get back to you shortly.',
  certificateApproved:
    'Your certificate has been verified. What is your duty preference: 8 hour or 24 hour?',
  certificateRejected:
    'We could not verify the certificate you shared. Please send a clear and valid certificate to continue.',
  dutyRetry:
    'Please reply with your duty preference: 8 hour or 24 hour.',
  completion:
    'Thank you. Your onboarding details have been received. We are sharing the next terms and conditions now.'
};

module.exports = {
  STEPS,
  STATUS,
  QUALIFICATIONS,
  DUTY_OPTIONS,
  MESSAGES
};
