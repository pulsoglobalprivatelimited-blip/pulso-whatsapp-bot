/* The shared vocabulary and row of the ops desks.

   Three desks — provider, agency, customer — used to each own their list markup,
   their own way of saying "waiting", and their own idea of what a date looks
   like. Same job, renamed at every tab, so nothing a reviewer learnt on one desk
   carried to the next.

   This module is the one place that answers:

     what do we call this           label()
     how urgent is it               tone()
     what does a row look like      row()
     what time is it, to a human    relativeTime()

   It is deliberately DOM-free apart from returning HTML strings: each desk still
   decides what to put in a row, this decides how a row looks.

   Exposes a single global: window.PulsoDesk */
(function (global) {
  'use strict';

  /* ---- escaping ---------------------------------------------------------- */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  /* ---- the dictionary ----------------------------------------------------

     Every enum the bot writes, in the words an ops person would use out loud.
     Anything missing falls through to a de-underscored, sentence-cased guess,
     which is what the whole desk used to do for everything. */

  const LABELS = {
    /* qualifications */
    gda: 'GDA',
    gnm: 'GNM',
    anm: 'ANM',
    hca: 'HCA',
    bsc_nursing: 'BSc Nursing',
    other_caregiving: 'Other caregiving',

    /* provider onboarding status */
    certificate_verification_pending: 'Certificate to review',
    awaiting_certificate: 'Waiting for certificate',
    awaiting_terms_acceptance: 'Waiting for terms',
    completed: 'Done',
    pending_verification: 'Certificate to review',

    /* agency partner status */
    document_received: 'Document to review',
    asked_again: 'Asked for a clearer one',
    terms_sent: 'Terms sent',
    terms_accepted: 'Terms accepted',
    terms_declined: 'Terms declined',
    invited: 'Sign-in link sent',

    /* booking status */
    booking_completed: 'Booking confirmed',

    /* duty preference */
    '8_hour': '8 hour',
    '24_hour': '24 hour',
    both: '8 or 24 hour',

    /* regions */
    kerala: 'Kerala',
    karnataka: 'Karnataka',

    /* app activation */
    verified: 'App verified',
    help: 'Needs app help'
  };

  function sentenceCase(value) {
    const text = String(value || '').replace(/_/g, ' ').trim();
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** The human name for an enum. Unknown keys degrade to a readable guess. */
  function label(value, fallback) {
    const key = String(value === null || value === undefined ? '' : value).trim();
    if (!key) return fallback || '';
    if (Object.prototype.hasOwnProperty.call(LABELS, key)) return LABELS[key];
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(LABELS, lower)) return LABELS[lower];
    return sentenceCase(key);
  }

  /* ---- tone --------------------------------------------------------------

     Four words, and only four, across all three desks:

       needs    a decision is waiting on us
       waiting  we asked; nothing back yet
       done     nothing to do
       stuck    needs us, and has needed us too long

     Tone drives the colour, so a colour means the same thing on every desk.
     The accent terracotta is never a tone — it stays for brand and for the
     thing you tap. */

  const TONE_LABELS = {
    needs: 'Needs you',
    waiting: 'Waiting on them',
    done: 'Done',
    stuck: 'Overdue'
  };

  /** Hours a row may sit in "needs" before it reads as overdue. */
  const OVERDUE_HOURS = 24;

  function hoursSince(value) {
    if (!value) return null;
    const then = new Date(value).getTime();
    if (Number.isNaN(then)) return null;
    return (Date.now() - then) / 3600000;
  }

  /**
   * @param {string} tone  'needs' | 'waiting' | 'done'
   * @param {*} since      when it entered that state; promotes needs → stuck
   */
  function escalate(tone, since) {
    if (tone !== 'needs') return tone;
    const hours = hoursSince(since);
    return hours !== null && hours >= OVERDUE_HOURS ? 'stuck' : 'needs';
  }

  function toneLabel(tone) {
    return TONE_LABELS[tone] || '';
  }

  /* ---- time --------------------------------------------------------------

     What WhatsApp does, because everyone using this desk already reads it all
     day: a time for today, a word for yesterday, a date for the rest. */

  function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  /* Whole calendar days back, not elapsed hours. Twenty-eight hours ago can be
     the day before yesterday, and a row that said "Yesterday" over a date of
     "21 Sept" was both right and useless. */
  function dayOffset(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);
  }

  function relativeTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const days = dayOffset(value);

    if (days <= 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    if (days === 1) return 'Yesterday';
    if (days < 365) return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
    return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** How long something has been waiting, for a row that needs chasing. */
  function waitLabel(value) {
    const hours = hoursSince(value);
    if (hours === null) return '';
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${Math.floor(hours)} hr`;
    const days = Math.floor(hours / 24);
    return days === 1 ? '1 day' : `${days} days`;
  }

  /* The heading a row sits under, in the same terms as its right-hand column:
     rows that need a decision show how long they have waited, so they group by
     that; rows that show a date group by date. Mixing the two produced a row
     reading "2 hr" under a heading saying "Yesterday" — both true just after
     midnight, and nonsense side by side. */
  function groupLabel(tone, value) {
    if (tone === 'stuck') return 'Waiting longest';
    if (tone === 'needs') return 'Waiting today';
    if (tone === 'done') return 'Done';

    const days = dayOffset(value);
    if (days === null) return 'No date';
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return 'Earlier';
  }

  /** Milliseconds, for sorting. Missing dates sort last, not first. */
  function timeValue(value) {
    if (!value) return 0;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }

  /* ---- identity ---------------------------------------------------------- */

  function normalizePhone(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function formatPhone(value) {
    const digits = normalizePhone(value);
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return value ? String(value) : '';
  }

  /* Two letters when we know a name. When we don't, a person glyph — the last
     two digits of someone's phone number in a circle told a reviewer nothing
     and read as a label the person had been given. */
  const PERSON_GLYPH =
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="8.5" r="3.6"></circle>' +
    '<path d="M4.8 20c0-3.9 3.2-6 7.2-6s7.2 2.1 7.2 6z"></path>' +
    '</svg>';

  function initials(name) {
    const text = String(name || '').trim();
    if (!text) return '';
    const parts = text.split(/\s+/).filter(Boolean);
    const letters = parts.length > 1
      ? parts[0][0] + parts[parts.length - 1][0]
      : parts[0].slice(0, 2);
    return letters.toUpperCase();
  }

  function avatar(name, tone) {
    const marks = initials(name);
    const toneClass = tone ? ` ${tone}` : '';
    return marks
      ? `<span class="desk-avatar${toneClass}" aria-hidden="true">${escapeHtml(marks)}</span>`
      : `<span class="desk-avatar${toneClass} is-anonymous" aria-hidden="true">${PERSON_GLYPH}</span>`;
  }

  /* ---- the row -----------------------------------------------------------

     Two lines. A face, who it is, what they last said, when. The IDs a row used
     to carry — Meta ad numbers, request ids, a repeated phone number — belong in
     the record, not in a list you scan. */

  /**
   * @param {object} item
   * @param {string} item.name      what the row is headed with
   * @param {string} [item.person]  their actual name, if we know it. Kept apart
   *   from `name` on purpose: `name` falls back to a formatted phone number,
   *   and initialising that gives you "+9" in a circle.
   * @param {string} [item.preview] their last message, or what we're waiting on
   * @param {string} [item.time]    already-formatted, right-aligned
   * @param {string} [item.tone]    needs | waiting | done | stuck
   * @param {boolean} [item.active] currently open in the detail pane
   * @param {object} [item.data]    data-* attributes to hang on the row
   */
  function row(item) {
    const entry = item || {};
    const tone = entry.tone || '';
    const toneClass = tone ? ` tone-${tone}` : '';
    const activeClass = entry.active ? ' active' : '';

    const data = Object.entries(entry.data || {})
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`)
      .join('');

    const timeClass = tone === 'stuck' ? ' is-late' : '';
    const time = entry.time
      ? `<span class="desk-time${timeClass}">${escapeHtml(entry.time)}</span>`
      : '';
    const dot = tone ? `<span class="desk-dot ${tone}" aria-hidden="true"></span>` : '';
    const preview = entry.preview
      ? `<span class="desk-preview">${escapeHtml(entry.preview)}</span>`
      : '<span class="desk-preview is-quiet">No messages yet</span>';

    return `
      <article class="desk-row${toneClass}${activeClass}"${data}>
        ${avatar(entry.person, tone)}
        <span class="desk-body">
          <span class="desk-line">
            <span class="desk-name">${escapeHtml(entry.name || 'Unknown')}</span>
            ${time}
          </span>
          <span class="desk-line">
            ${preview}
            ${dot}
          </span>
        </span>
      </article>
    `;
  }

  /* A sticky label between groups, so a list sorted by how long something has
     waited still reads as a sequence of days rather than one long run. */
  function divider(text) {
    return `<p class="desk-divider">${escapeHtml(text)}</p>`;
  }

  /** The queue has nothing in it — which is different from being broken. */
  function empty(options) {
    const config = options || {};
    const tick =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>';
    const hint = config.hint ? `<p class="desk-empty-hint">${escapeHtml(config.hint)}</p>` : '';
    return `
      <div class="desk-empty">
        <span class="desk-empty-tick" aria-hidden="true">${tick}</span>
        <strong>${escapeHtml(config.title || 'Nothing here')}</strong>
        <p>${escapeHtml(config.body || '')}</p>
        ${hint}
      </div>
    `;
  }

  /* Loading looked exactly like empty — a blank panel — so a slow network read
     as "no one is waiting". Rows in outline say the opposite. */
  function skeleton(count) {
    const rows = Math.max(1, Math.min(Number(count) || 6, 12));
    return Array.from({ length: rows }, () => `
      <div class="desk-row is-skeleton" aria-hidden="true">
        <span class="desk-avatar sk"></span>
        <span class="desk-body">
          <span class="sk-bar" style="width:52%"></span>
          <span class="sk-bar" style="width:74%"></span>
        </span>
      </div>
    `).join('');
  }

  global.PulsoDesk = {
    escapeHtml,
    LABELS,
    label,
    TONE_LABELS,
    OVERDUE_HOURS,
    escalate,
    toneLabel,
    hoursSince,
    dayOffset,
    groupLabel,
    relativeTime,
    waitLabel,
    timeValue,
    normalizePhone,
    formatPhone,
    initials,
    avatar,
    row,
    divider,
    empty,
    skeleton
  };
})(window);
