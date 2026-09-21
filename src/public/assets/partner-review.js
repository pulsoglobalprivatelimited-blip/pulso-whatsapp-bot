/* Partner agency vocabulary and review calls, shared by every admin surface
   that shows an agency enquiry.

   Agency enquiries arrive in the same `whatsappBookingChats` collection as
   customer bookings, tagged `enquiryType: 'partner'`. What makes them their own
   thing is `partnerStatus` — the terms journey pulso-hub owns — and the review
   round trip (view the registration document, approve and send terms, or ask
   for a clearer one).

   This module is deliberately DOM-free: it answers "what is this chat" and
   "what may I do with it", and each surface renders that its own way. The
   Booking Inbox draws it as a card in a chat sheet; the Partner Agency desk
   draws it as a card in a detail grid.

   Exposes a single global: window.PulsoPartnerReview */
(function (global) {
  'use strict';

  /* A chat that hasn't got past these steps hasn't said whether it wants care
     or a job, so it can't be classified from progress alone. */
  const PRE_CHOICE_STEPS = ['', 'language', 'region', 'intent'];

  /* Where an agency has got to with the terms matters more than which step the
     bot is on, so it takes the pill once the terms have been sent. */
  const TERMS_LABELS = {
    document_received: 'To verify',
    terms_sent: 'Terms sent',
    terms_accepted: 'Terms accepted',
    terms_declined: 'Terms declined',
    invited: 'Invited'
  };

  /* The document lives on the enquiry in pulso-hub, not on this chat doc, so
     the review card is driven by the status: every one of these means a
     document arrived at some point. */
  const DOC_STATUSES = new Set([
    'document_received', 'asked_again', 'terms_sent', 'terms_accepted', 'terms_declined', 'invited'
  ]);

  const REVIEW_DONE = {
    terms_sent: { pill: 'waiting', label: 'Terms sent', note: 'Waiting for the agency to accept.' },
    terms_accepted: { pill: 'done', label: 'Terms accepted', note: 'The partner account has been created.' },
    terms_declined: { pill: 'attention', label: 'Terms declined', note: 'No account was created.' },
    invited: { pill: 'done', label: 'Invited', note: 'The sign-in link has been sent.' },
    asked_again: { pill: 'attention', label: 'Asked again', note: 'Waiting for a clearer document.' }
  };

  function formatStatus(value) {
    return String(value || '-')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function isCompleted(chat) {
    return chat && chat.status === 'booking_completed';
  }

  function termsState(chat) {
    const status = String((chat && chat.partnerStatus) || '');
    return TERMS_LABELS[status] ? status : '';
  }

  /* What the chat is: an agency enquiry ("partner"), a caregiver service
     booking ("care"), a recruitment enquiry ("job"), or someone who hasn't
     chosen yet ("undecided"). Prefer the `enquiryType` the bot stamps on each
     chat; for older chats that predate that field (and before the backfill
     runs), fall back to how far the flow has progressed. The job path sits at
     the "intent" step with no flag in the summary, so un-backfilled job chats
     read as "undecided" until refreshed. */
  function resolveEnquiryType(chat) {
    const source = chat || {};
    const tagged = String(source.enquiryType || '').toLowerCase();
    if (tagged === 'care' || tagged === 'job' || tagged === 'partner') return tagged;
    const step = String(source.currentStep || '').toLowerCase();
    if (step.startsWith('partner_')) return 'partner';
    if (step && !PRE_CHOICE_STEPS.includes(step)) return 'care';
    return 'undecided';
  }

  function enquiryMeta(type) {
    if (type === 'care') return { label: 'Booking', className: 'care' };
    if (type === 'job') return { label: 'Job enquiry', className: 'job' };
    if (type === 'partner') return { label: 'Agency', className: 'partner' };
    return { label: 'Undecided', className: 'undecided' };
  }

  function isPartner(chat) {
    return resolveEnquiryType(chat) === 'partner';
  }

  function statusLabel(chat) {
    const terms = termsState(chat);
    if (terms) return TERMS_LABELS[terms];
    return isCompleted(chat) ? 'Completed' : formatStatus((chat && chat.currentStep) || 'active');
  }

  function statusPillClass(chat) {
    const terms = termsState(chat);
    // "To verify" is the one a reviewer has to act on, so it reads loudest.
    if (terms === 'document_received') return 'attention';
    if (terms === 'terms_accepted' || terms === 'invited') return 'done';
    if (terms === 'terms_declined') return 'attention';
    if (terms === 'terms_sent') return 'waiting';
    return isCompleted(chat) ? 'done' : '';
  }

  /* What the reviewer may do right now. `toVerify` is the only state with
     buttons; `done` carries the sentence explaining an already-reviewed one. */
  function reviewState(chat) {
    const source = chat || {};
    const status = String(source.partnerStatus || '');
    const partner = isPartner(source);
    return {
      isPartner: partner,
      status,
      hasDoc: partner && DOC_STATUSES.has(status),
      toVerify: partner && status === 'document_received',
      done: partner ? REVIEW_DONE[status] || null : null
    };
  }

  /* Label/value pairs rather than markup, so each surface renders them in its
     own idiom. Blank values are dropped by the caller. */
  function partnerFacts(chat) {
    const source = chat || {};
    if (!isPartner(source) && !source.persona) return [];
    const entry = source.partnerEntry === 'ad'
      ? `Meta ad ${source.partnerAdId || ''}`.trim()
      : source.partnerEntry ? `WhatsApp (${source.partnerEntry})` : '';
    const who = source.persona === 'job'
      ? 'Job-seeker (from partner ad)'
      : source.persona === 'agency' ? 'Home care agency' : '';

    return [
      { label: 'Agency', value: source.partnerAgencyName },
      { label: 'Who', value: who },
      { label: 'Partner status', value: source.partnerStatus && formatStatus(source.partnerStatus) },
      { label: 'Read up to', value: source.partnerPitchStep ? `piece ${source.partnerPitchStep} of 4` : '' },
      { label: 'District', value: source.partnerDistrict && formatStatus(source.partnerDistrict) },
      { label: 'Came from', value: entry },
      { label: 'Region', value: source.region && formatStatus(source.region) },
      { label: 'Language', value: source.language }
    ].filter((item) => item.value !== null && item.value !== undefined && item.value !== '' && item.value !== '-');
  }

  /* ---- the review round trip -------------------------------------------- */

  async function request(url, options) {
    const response = await fetch(url, options);
    if (response.status === 401) {
      global.location.href = '/admin/login';
      throw new Error('Authentication required');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(payload.error || 'Request failed');
    }
    return response.json();
  }

  function chatUrl(phone, suffix) {
    return `/admin/booking-chats/${encodeURIComponent(phone)}/${suffix}`;
  }

  function postJson(url, body) {
    return request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  global.PulsoPartnerReview = {
    PRE_CHOICE_STEPS,
    TERMS_LABELS,
    DOC_STATUSES,
    REVIEW_DONE,
    resolveEnquiryType,
    enquiryMeta,
    isPartner,
    termsState,
    statusLabel,
    statusPillClass,
    reviewState,
    partnerFacts,
    /** Returns { url, mime } for the agency's registration document. */
    openDocument: (phone) => request(chatUrl(phone, 'document')),
    /** Sends the terms message and creates the partner account in pulso-hub. */
    approve: (phone) => postJson(chatUrl(phone, 'approve')),
    /** Asks the agency for a clearer document, quoting `reason`. */
    askAgain: (phone, reason) => postJson(chatUrl(phone, 'ask-again'), { reason })
  };
})(window);
