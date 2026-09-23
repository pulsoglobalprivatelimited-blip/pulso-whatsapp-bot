/* The booking board: a list of WhatsApp chats from `whatsappBookingChats` with
   a detail pane beside it.

   One board, three audiences. Agency enquiries and customer bookings live in
   the same collection and differ only in which `enquiryType` they carry, so
   rather than copy this screen per audience the board takes a `mode` that says
   which chats it keeps, which metric tiles and filter chips it shows, and which
   cards the detail pane draws:

     customer  every chat that is NOT an agency  (the Direct customer side)
     agency    only agency enquiries             (the Partner agency side)
     all       everything                        (the standalone /admin/bookings)

   Every element is resolved through `root.querySelector('[data-el="..."]')`
   rather than by id, so two boards can sit on one page — which is exactly what
   the /admin shell does.

   Exposes a single global: window.PulsoBookingBoard */
(function (global) {
  'use strict';

  const Partner = global.PulsoPartnerReview;
  const Desk = global.PulsoDesk;

  /* ---- formatting ------------------------------------------------------- */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll('"', '&quot;');
  }

  function normalizePhone(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function formatPhone(value) {
    const digits = normalizePhone(value);
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    return value || '-';
  }

  /* Shares the provider desk's dictionary so the same status is named the same
     thing on whichever desk you meet it. */
  function formatStatus(value) {
    return Desk.label(value, '-') || '-';
  }

  function formatBoolean(value) {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    return '-';
  }

  function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function formatService(chat) {
    const label = chat.serviceLabel || chat.service || '-';
    return chat.hours ? `${label} (${chat.hours}h)` : label;
  }

  function formatPrice(chat) {
    const price = Number(chat.price || 0);
    return price ? `Rs ${price.toLocaleString('en-IN')}` : '-';
  }

  function normalizeSearchTerm(value) {
    return String(value || '').trim().toLowerCase();
  }

  function buildWhatsAppLink(phone) {
    const digits = normalizePhone(phone);
    return digits ? `https://wa.me/${digits}` : '';
  }

  function renderPhoneLink(phone) {
    const href = buildWhatsAppLink(phone);
    const label = formatPhone(phone);
    return href
      ? `<a class="phone-link detail-phone-link" href="${href}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
      : escapeHtml(label);
  }

  function isCompleted(chat) {
    return chat.status === 'booking_completed';
  }

  function partnerStatusOf(chat) {
    return String(chat.partnerStatus || '');
  }

  /* ---- mode definitions -------------------------------------------------- */

  const SORT_CHIPS = [
    { key: 'queue', label: 'Oldest waiting' },
    { key: 'latest', label: 'Latest first' }
  ];

  /* The same key the provider desk uses: one preference about how a person
     reads a list, not one per desk. */
  const SORT_STORAGE_KEY = 'pulso-desk-sort';

  function readStoredSort() {
    try {
      return global.localStorage.getItem(SORT_STORAGE_KEY) === 'latest' ? 'latest' : 'queue';
    } catch (error) {
      return 'queue';
    }
  }

  function rememberSort(mode) {
    try {
      global.localStorage.setItem(SORT_STORAGE_KEY, mode);
    } catch (error) {
      // Private browsing, or storage blocked. It still holds for this visit.
    }
  }

  const REGION_CHIPS = [
    { key: 'all', label: 'All locations' },
    { key: 'kerala', label: 'Kerala' },
    { key: 'karnataka', label: 'Karnataka' },
    { key: 'other', label: 'Other' }
  ];

  const CUSTOMER_STATUS_CHIPS = [
    { key: 'all', label: 'All' },
    { key: 'booking_completed', label: 'Completed' },
    { key: 'active', label: 'Active' },
    { key: 'test', label: 'Test only' }
  ];

  /* An agency chip stands for one or more `partnerStatus` values, so a tile and
     the chip it selects always count the same rows. */
  const AGENCY_STATUS_CHIPS = [
    { key: 'all', label: 'All agencies' },
    { key: 'document_received', label: 'To verify', statuses: ['document_received'] },
    { key: 'asked_again', label: 'Asked again', statuses: ['asked_again'] },
    { key: 'terms_sent', label: 'Terms sent', statuses: ['terms_sent'] },
    /* "Joined" used to cover both, which made a sent link look like a working
       partner. Two of the first six sat in it having never opened the app. */
    { key: 'invited', label: 'Invited', statuses: ['terms_accepted', 'invited'] },
    { key: 'signed_in', label: 'Signed in', statuses: ['signed_in'] },
    { key: 'terms_declined', label: 'Declined', statuses: ['terms_declined'] },
    { key: 'rejected_document', label: 'Rejected', statuses: ['rejected_document'] }
  ];

  const CUSTOMER_METRICS = [
    { label: 'Total chats', count: (chats) => chats.length, status: 'all' },
    { label: 'Completed bookings', count: (chats) => chats.filter(isCompleted).length, status: 'booking_completed' },
    { label: 'Active bookings', count: (chats) => chats.filter((chat) => !isCompleted(chat)).length, status: 'active' },
    { label: 'Test bookings', count: (chats) => chats.filter((chat) => chat.isTestBooking === true).length, status: 'test' }
  ];

  function countPartnerStatus(chats, statuses) {
    return chats.filter((chat) => statuses.includes(partnerStatusOf(chat))).length;
  }

  const AGENCY_METRICS = [
    {
      label: 'To verify',
      attention: true,
      count: (chats) => countPartnerStatus(chats, ['document_received']),
      status: 'document_received'
    },
    { label: 'Total agencies', count: (chats) => chats.length, status: 'all' },
    { label: 'Terms sent', count: (chats) => countPartnerStatus(chats, ['terms_sent']), status: 'terms_sent' },
    {
      label: 'Invited, not in yet',
      attention: true,
      count: (chats) => countPartnerStatus(chats, ['terms_accepted', 'invited']),
      status: 'invited'
    },
    {
      label: 'Signed in',
      count: (chats) => countPartnerStatus(chats, ['signed_in']),
      status: 'signed_in'
    },
    { label: 'Asked again', count: (chats) => countPartnerStatus(chats, ['asked_again']), status: 'asked_again' }
  ];

  /* Detail-pane cards. A card is either a `rows` list of label/value pairs or a
     `render` that builds its own body (the review card needs buttons). */
  const BOOKING_CARDS = [
    {
      title: 'Booking',
      rows: [
        ['Request ID', (chat) => chat.requestId],
        ['Service', formatService],
        ['Care recipient', (chat) => chat.careRecipientName],
        ['Relation', (chat) => chat.careRecipientRelation],
        ['Days', (chat) => chat.days],
        ['Start', (chat) => chat.startLabel],
        ['Caregiver gender', (chat) => chat.caregiverGender && formatStatus(chat.caregiverGender)],
        ['Price', formatPrice]
      ]
    },
    {
      title: 'Family account',
      rows: [
        ['Family contact', (chat) => chat.familyName],
        ['Family ID', (chat) => chat.familyId],
        ['Location', (chat) => chat.addressSummary || chat.city],
        ['Region', (chat) => chat.region && formatStatus(chat.region)],
        ['Language', (chat) => chat.language],
        ['Test booking', (chat) => formatBoolean(chat.isTestBooking)],
        ['Created', (chat) => chat.createdAt && formatTime(chat.createdAt)],
        ['Updated', (chat) => formatTime(chat.updatedAt || chat.lastMessageAt)]
      ]
    },
    {
      title: 'Care details',
      rows: [
        ['Age', (chat) => chat.careRecipientAge],
        ['Gender', (chat) => chat.careRecipientGender && formatStatus(chat.careRecipientGender)],
        ['Weight', (chat) => chat.careRecipientWeightKg && `${chat.careRecipientWeightKg} kg`],
        ['Bedridden', (chat) => formatBoolean(chat.isBedridden)],
        ['Feeding tube', (chat) => formatBoolean(chat.hasFeedingTube)],
        ['Catheter', (chat) => formatBoolean(chat.hasCatheter)],
        ['Stoma', (chat) => formatBoolean(chat.hasStoma)]
      ]
    },
    { title: 'Actions', kind: 'actions', copy: 'request' }
  ];

  const AGENCY_CARDS = [
    { title: 'Agency', kind: 'partner-facts' },
    { title: 'Document review', kind: 'review' },
    { title: 'Actions', kind: 'actions', copy: 'phone' }
  ];

  const MODES = {
    customer: {
      keeps: (type) => type !== 'partner',
      metrics: CUSTOMER_METRICS,
      statusChips: CUSTOMER_STATUS_CHIPS,
      enquiryChips: [
        { key: 'all', label: 'All enquiries' },
        { key: 'care', label: 'Bookings' },
        { key: 'job', label: 'Job enquiries' },
        { key: 'undecided', label: 'Undecided' }
      ],
      cards: BOOKING_CARDS,
      boardTitle: 'Booking conversations',
      searchLabel: 'Phone, name, request, or location search',
      searchPlaceholder: 'Search booking chats',
      emptyTitle: 'No booking chats'
    },
    agency: {
      keeps: (type) => type === 'partner',
      metrics: AGENCY_METRICS,
      statusChips: AGENCY_STATUS_CHIPS,
      enquiryChips: [],
      cards: AGENCY_CARDS,
      boardTitle: 'Agency onboarding',
      searchLabel: 'Agency, phone, or district search',
      searchPlaceholder: 'Search partner agencies',
      emptyTitle: 'No agency enquiries'
    },
    all: {
      keeps: () => true,
      metrics: CUSTOMER_METRICS,
      statusChips: CUSTOMER_STATUS_CHIPS,
      enquiryChips: [
        { key: 'all', label: 'All enquiries' },
        { key: 'care', label: 'Bookings' },
        { key: 'job', label: 'Job enquiries' },
        { key: 'partner', label: 'Agencies' },
        { key: 'undecided', label: 'Undecided' }
      ],
      cards: BOOKING_CARDS,
      boardTitle: 'Booking conversations',
      searchLabel: 'Phone, name, request, or location search',
      searchPlaceholder: 'Search booking chats',
      emptyTitle: 'No booking chats'
    }
  };

  /* ---- the board --------------------------------------------------------- */

  /**
   * @param {object} options
   * @param {Element} options.root          element containing the board markup
   * @param {Element} [options.metricsRoot] where the metric tiles are rendered
   * @param {string}  [options.mode]        'customer' | 'agency' | 'all'
   * @param {string}  [options.region]      'kerala' | 'karnataka' — locks the region
   * @returns {{ load: function, refresh: function, getChats: function }}
   */
  function create(options) {
    const settings = options || {};
    const root = settings.root;
    if (!root) throw new Error('PulsoBookingBoard.create needs a root element');

    const mode = MODES[settings.mode] ? settings.mode : 'all';
    const config = MODES[mode];
    const region = settings.region || '';
    const metricsRoot = settings.metricsRoot || null;

    let chats = [];
    let loaded = false;
    let selectedPhone = null;
    let selectedChat = null;
    let statusFilter = 'all';
    let regionFilter = region || 'all';
    let enquiryFilter = 'all';
    let sortMode = readStoredSort();
    let search = '';
    let mobileDetailOpen = false;
    let detailToken = 0;

    const el = (name) => root.querySelector(`[data-el="${name}"]`);
    const all = (selector) => Array.from(root.querySelectorAll(selector));

    const bookingList = el('booking-list');
    const bookingDetail = el('booking-detail');
    const detailPanel = el('detail-panel');
    const bookingContent = el('booking-content');
    const searchInput = el('booking-search');
    const detailGrid = el('detail-grid');
    const historyList = el('history-list');

    /* ---- chrome the mode owns ------------------------------------------- */

    function renderChrome() {
      const title = el('board-title');
      if (title) title.textContent = config.boardTitle;

      const searchLabel = el('search-label');
      if (searchLabel) searchLabel.textContent = config.searchLabel;
      if (searchInput) searchInput.placeholder = config.searchPlaceholder;

      renderFilterRows();
      renderMetricShells();
    }

    function chipRow(attribute, chips, activeKey) {
      if (!chips.length) return '';
      const buttons = chips
        .map((chip) => {
          const active = chip.key === activeKey ? ' active' : '';
          return `<button class="filter${active}" type="button" ${attribute}="${escapeAttr(chip.key)}">${escapeHtml(chip.label)}</button>`;
        })
        .join('');
      return `<div class="filters">${buttons}</div>`;
    }

    /* One strip stays on screen — the status the reviewer works by — and the
       rest moves into the filter sheet. Three stacked scrolling rows of chips
       used to sit between the heading and the first agency. */
    function renderFilterRows() {
      const segments = el('segments');
      const container = el('filter-rows');

      if (segments) {
        // The chips scroll inside their own track so the filter button beside
        // them keeps its place instead of sitting on top of the last chip.
        segments.innerHTML =
          '<div class="desk-segments-scroll">' +
          config.statusChips
            .map((chip) => {
              const active = chip.key === statusFilter ? ' active' : '';
              return `<button class="filter${active}" type="button" data-status-filter="${escapeAttr(chip.key)}">${escapeHtml(chip.label)}</button>`;
            })
            .join('') +
          '</div>' +
          '<button class="desk-filter-button" type="button" data-sheet-open="filters" aria-label="Filter">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4"></path></svg>' +
          '<span class="desk-filter-count"></span></button>';
      }

      if (container) {
        container.innerHTML = [
          '<p class="desk-sheet-label">Order</p>',
          chipRow('data-sort', SORT_CHIPS, sortMode),
          '<p class="desk-sheet-label">Narrow</p>',
          chipRow('data-region-filter', REGION_CHIPS, regionFilter),
          chipRow('data-enquiry-filter', config.enquiryChips, enquiryFilter)
        ].join('');
      }

      wireChips('data-status-filter', (key) => { statusFilter = key; });
      wireChips('data-sort', (key) => {
        sortMode = key === 'latest' ? 'latest' : 'queue';
        rememberSort(sortMode);
      });
      wireChips('data-region-filter', (key) => { regionFilter = key; });
      wireChips('data-enquiry-filter', (key) => { enquiryFilter = key; });
    }

    function wireChips(attribute, apply) {
      all(`[${attribute}]`).forEach((button) => {
        button.addEventListener('click', () => {
          all(`[${attribute}]`).forEach((item) => item.classList.remove('active'));
          button.classList.add('active');
          apply(button.getAttribute(attribute));
          renderList();
        });
      });
    }

    function renderMetricShells() {
      if (!metricsRoot) return;
      metricsRoot.innerHTML = config.metrics
        .map((metric, index) => `
          <button class="metric metric-button${metric.attention ? ' attention' : ''}" type="button" data-metric="${index}">
            <span data-metric-count="${index}">0</span>
            <label>${escapeHtml(metric.label)}</label>
          </button>
        `)
        .join('');

      metricsRoot.querySelectorAll('[data-metric]').forEach((button) => {
        button.addEventListener('click', () => {
          // A chip is a filter now, so it has to look switched on once tapped.
          metricsRoot.querySelectorAll('[data-metric]').forEach((other) => {
            other.classList.toggle('is-active', other === button);
          });
          applyMetricFilters(config.metrics[Number(button.dataset.metric)].status);
        });
      });
    }

    function updateMetrics() {
      if (!metricsRoot) return;
      config.metrics.forEach((metric, index) => {
        const target = metricsRoot.querySelector(`[data-metric-count="${index}"]`);
        if (target) target.textContent = String(metric.count(chats));
      });
    }

    /* Clicking a metric tile is a shortcut to the filter behind it, so it
       clears everything else rather than combining with a stale search. */
    function applyMetricFilters(nextStatus) {
      statusFilter = nextStatus || 'all';
      regionFilter = region || 'all';
      enquiryFilter = 'all';
      search = '';
      if (searchInput) searchInput.value = '';
      syncChip('data-status-filter', statusFilter);
      syncChip('data-region-filter', regionFilter);
      syncChip('data-enquiry-filter', 'all');
      renderList();
    }

    function syncChip(attribute, key) {
      all(`[${attribute}]`).forEach((item) => {
        item.classList.toggle('active', item.getAttribute(attribute) === key);
      });
    }

    /* ---- filtering ------------------------------------------------------- */

    function statusMatches(chat) {
      if (statusFilter === 'all') return true;
      if (mode === 'agency') {
        const chip = config.statusChips.find((item) => item.key === statusFilter);
        return chip ? chip.statuses.includes(partnerStatusOf(chat)) : false;
      }
      if (statusFilter === 'test') return chat.isTestBooking === true;
      // "Active" is the complement of completed, matching the metric tile that
      // selects this chip — a chat parked mid-flow has a step, not a status.
      if (statusFilter === 'active') return !isCompleted(chat);
      return chat.status === statusFilter;
    }

    function regionMatches(chat) {
      if (regionFilter === 'all') return true;
      if (regionFilter === 'other') return !['kerala', 'karnataka'].includes(chat.region);
      return chat.region === regionFilter;
    }

    function getVisibleChats() {
      return chats.filter((chat) => {
        const enquiryMatch =
          enquiryFilter === 'all' || Partner.resolveEnquiryType(chat) === enquiryFilter;
        return statusMatches(chat) && regionMatches(chat) && enquiryMatch && matchesSearch(chat, search);
      });
    }

    function matchesSearch(chat, term) {
      if (!term) return true;
      const haystack = [
        chat.phone,
        chat.id,
        chat.requestId,
        chat.familyId,
        chat.familyName,
        chat.careRecipientName,
        chat.careRecipientRelation,
        chat.service,
        chat.serviceLabel,
        chat.city,
        chat.addressSummary,
        chat.region,
        chat.language,
        chat.status,
        chat.currentStep,
        chat.partnerAgencyName,
        chat.partnerDistrict,
        chat.partnerStatus,
        Partner.enquiryMeta(Partner.resolveEnquiryType(chat)).label,
        chat.lastIncomingText
      ]
        .map((value) => normalizeSearchTerm(value))
        .join(' ');
      return haystack.includes(term);
    }

    /* ---- list ------------------------------------------------------------ */

    /* ---- what a row says -------------------------------------------------

       Two lines, the same two lines every desk now uses: who it is, what they
       last said, when. An agency row used to carry five — the phone number as
       its title when the agency had no name yet, the same number again as its
       subtitle, how far through the pitch they had read, a Meta ad id, and a
       timestamp to the second. Two of the five were the same number and one
       was a database key. */

    /* The agency's name, or the family's, when we have one. Kept apart from the
       row heading because the heading falls back to a phone number and a phone
       number does not have initials. */
    function rowPerson(chat) {
      if (mode === 'agency') return chat.partnerAgencyName || '';
      return chat.careRecipientName || chat.familyName || '';
    }

    function rowName(chat) {
      const person = rowPerson(chat);
      if (!person) return formatPhone(chat.phone || chat.id);
      return mode !== 'agency' && chat.isTestBooking ? `${person} · Test` : person;
    }

    function rowPreview(chat) {
      const said = String(chat.lastIncomingText || '').trim();
      if (said) return said;

      if (mode === 'agency') {
        if (partnerStatusOf(chat)) return Desk.label(partnerStatusOf(chat));
        return chat.partnerPitchStep
          ? `Read ${chat.partnerPitchStep} of 4 intro messages`
          : 'Agency enquiry';
      }

      if (isCompleted(chat)) return 'Booking confirmed';
      return Desk.label(chat.currentStep, 'No messages yet');
    }

    /* The same four words as the provider desk, so a colour means one thing
       across the whole admin. An agency we have asked for a clearer document
       is waiting on them, not on us — the old badge called that "attention"
       and coloured it like work. */
    function chatTone(chat) {
      const at = chat.updatedAt || chat.lastMessageAt;

      if (mode === 'agency') {
        const status = partnerStatusOf(chat);
        if (status === 'document_received') return Desk.escalate('needs', at);
        if (status === 'terms_declined' || status === 'rejected_document') return 'stuck';
        if (status === 'signed_in') return 'done';
        /* An agency with an account it has never opened is not finished. It is
           not waiting on us either, so it stays amber rather than red — until
           two days pass, at which point somebody should ring them. */
        if (status === 'terms_accepted' || status === 'invited') {
          const hours = Desk.hoursSince(at);
          return hours !== null && hours >= 48 ? 'stuck' : 'waiting';
        }
        return 'waiting';
      }

      return isCompleted(chat) ? 'done' : 'waiting';
    }

    function chatTime(chat, tone) {
      const at = chat.updatedAt || chat.lastMessageAt;
      if (tone === 'needs' || tone === 'stuck') return Desk.waitLabel(at);
      return Desk.relativeTime(chat.lastMessageAt || at);
    }

    function groupLabel(chat, tone) {
      return Desk.groupFor(sortMode, tone, chat.updatedAt || chat.lastMessageAt);
    }

    /* Oldest-waiting first among the rows that need something, newest first
       among the ones that are finished. */
    function sortForQueue(list) {
      return Desk.sortRows(list, {
        mode: sortMode,
        toneOf: chatTone,
        timeOf: (chat) => chat.updatedAt || chat.lastMessageAt
      });
    }

    function renderList() {
      if (!loaded) {
        bookingList.innerHTML = Desk.skeleton(7);
        return;
      }

      const visible = sortForQueue(getVisibleChats());
      let lastGroup = null;

      bookingList.innerHTML =
        visible
          .map((chat) => {
            const phone = chat.phone || chat.id;
            const tone = chatTone(chat);
            const group = groupLabel(chat, tone);
            const divider = group === lastGroup ? '' : Desk.divider(group);
            lastGroup = group;

            return divider + Desk.row({
              name: rowName(chat),
              person: rowPerson(chat),
              preview: rowPreview(chat),
              time: chatTime(chat, tone),
              tone,
              active: phone === selectedPhone || chat.id === selectedPhone,
              data: { phone }
            });
          })
          .join('') || emptyHtml();

      bookingList.querySelectorAll('[data-phone]').forEach((item) => {
        item.addEventListener('click', () => {
          renderDetail(item.dataset.phone);
        });
      });

      updateDeskCounts();
    }

    function emptyHtml() {
      const needsYou = chats.filter((chat) => {
        const tone = chatTone(chat);
        return tone === 'needs' || tone === 'stuck';
      }).length;

      if (statusFilter === 'all' && !search && !needsYou) {
        return Desk.empty({
          title: "You're all caught up",
          body: mode === 'agency'
            ? 'Every agency document has been reviewed.'
            : 'Nothing on this desk is waiting on you.'
        });
      }

      return Desk.empty({
        title: config.emptyTitle,
        body: 'No one matches the filters you have on.'
      });
    }

    /* The count on this desk's tab, and the badge saying how many filters are
       quietly narrowing what the queue shows. */
    function updateDeskCounts() {
      if (!global.PulsoDeskShell) return;

      const needsYou = chats.filter((chat) => {
        const tone = chatTone(chat);
        return tone === 'needs' || tone === 'stuck';
      }).length;

      if (mode === 'agency' || mode === 'customer') {
        global.PulsoDeskShell.setTabCount(mode, needsYou);
      }

      const refinements = [
        !region && regionFilter !== 'all',
        enquiryFilter !== 'all'
      ].filter(Boolean).length;
      global.PulsoDeskShell.setFilterCount(root, refinements);
    }

    /* ---- detail ---------------------------------------------------------- */

    function rowsHtml(rows, chat) {
      return rows
        .map(([label, read]) => {
          const value = read(chat);
          const text = value === null || value === undefined || value === '' ? '-' : String(value);
          return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>`;
        })
        .join('');
    }

    function partnerFactsHtml(chat) {
      const facts = Partner.partnerFacts(chat);
      if (!facts.length) {
        return '<p class="attachment-empty">Agency enquiry — no details yet.</p>';
      }
      return `<dl>${facts
        .map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(String(item.value))}</dd></div>`)
        .join('')}</dl>`;
    }

    function reviewHtml(chat) {
      const state = Partner.reviewState(chat);
      if (!state.isPartner) {
        return '<p class="attachment-empty">Not an agency enquiry.</p>';
      }
      if (!state.hasDoc) {
        return '<p class="attachment-empty">No registration document yet. The agency is still reading the pitch.</p>';
      }

      const viewButton = '<button class="attachment-action" type="button" data-review="view">View document</button>';
      if (state.toVerify) {
        return `
          <div class="attachment-actions">
            ${viewButton}
            <button class="button approve" type="button" data-review="approve">Approve &amp; send terms</button>
            <button class="button secondary" type="button" data-review="ask">Ask again</button>
            <button class="button reject" type="button" data-review="reject">Reject</button>
          </div>
          <p class="card-note">Approving sends the terms and creates the partner account in Pulso Hub. Ask again keeps the agency in the queue; Reject closes the enquiry.</p>
          <p class="form-status" data-el="review-status" aria-live="polite"></p>
        `;
      }

      const done = state.done;
      return `
        <div class="attachment-actions">${viewButton}</div>
        ${done ? `<p class="detail-pills" style="margin-top:12px"><span class="pill ${escapeAttr(done.pill)}">${escapeHtml(done.label)}</span></p>
        <p class="card-note">${escapeHtml(done.note)}</p>` : ''}
        <p class="form-status" data-el="review-status" aria-live="polite"></p>
      `;
    }

    function actionsHtml(chat, card) {
      const link = buildWhatsAppLink(chat.phone || chat.id);
      const copyLabel = card.copy === 'phone' ? 'Copy phone' : 'Copy request ID';
      const copyDisabled = card.copy === 'phone' ? false : !chat.requestId;
      return `
        <div class="attachment-actions">
          ${link ? `<a class="attachment-action" href="${escapeAttr(link)}" target="_blank" rel="noreferrer">Open WhatsApp</a>` : ''}
          <button class="attachment-action" type="button" data-copy="${escapeAttr(card.copy)}"${copyDisabled ? ' disabled' : ''}>${escapeHtml(copyLabel)}</button>
        </div>
        <p class="form-status" data-el="action-status" aria-live="polite"></p>
      `;
    }

    function cardBodyHtml(card, chat) {
      if (card.kind === 'partner-facts') return partnerFactsHtml(chat);
      if (card.kind === 'review') return reviewHtml(chat);
      if (card.kind === 'actions') return actionsHtml(chat, card);
      return `<dl>${rowsHtml(card.rows, chat)}</dl>`;
    }

    function renderCards(chat) {
      if (!detailGrid) return;
      detailGrid.innerHTML = config.cards
        .map((card) => {
          const extraClass = card.kind === 'review' && Partner.reviewState(chat).toVerify ? ' review-card' : '';
          return `<article class="card${extraClass}"><h4>${escapeHtml(card.title)}</h4>${cardBodyHtml(card, chat)}</article>`;
        })
        .join('');

      wireCardActions(chat);
    }

    function wireCardActions(chat) {
      const phone = chat.phone || chat.id;

      detailGrid.querySelectorAll('[data-copy]').forEach((button) => {
        button.addEventListener('click', () => {
          const value = button.dataset.copy === 'phone' ? phone : chat.requestId;
          copyToClipboard(value, button.dataset.copy === 'phone' ? 'Phone number' : 'Request ID');
        });
      });

      detailGrid.querySelectorAll('[data-review]').forEach((button) => {
        button.addEventListener('click', () => handleReview(button.dataset.review, phone));
      });
    }

    function setStatusText(name, text, kind) {
      const target = detailGrid && detailGrid.querySelector(`[data-el="${name}"]`);
      if (!target) return;
      target.textContent = text;
      target.classList.remove('success', 'error');
      if (kind) target.classList.add(kind);
    }

    async function copyToClipboard(value, label) {
      if (!value) return;
      try {
        await navigator.clipboard.writeText(String(value));
        setStatusText('action-status', `${label} copied.`, 'success');
      } catch (error) {
        setStatusText('action-status', `Could not copy the ${label.toLowerCase()}.`, 'error');
      }
    }

    /* Approving sends a real message to a real agency, so this waits on the
       round trip rather than guessing, and puts the buttons back on failure. */
    async function handleReview(action, phone) {
      if (action === 'view') {
        setStatusText('review-status', 'Opening the document…');
        try {
          const data = await Partner.openDocument(phone);
          if (data && data.url) {
            global.open(data.url, '_blank', 'noreferrer');
            setStatusText('review-status', '');
          } else {
            setStatusText('review-status', 'No document was returned.', 'error');
          }
        } catch (error) {
          setStatusText('review-status', error.message || 'Could not open the document.', 'error');
        }
        return;
      }

      let reason = '';
      if (action === 'ask') {
        reason = global.prompt('What should the agency send instead?', 'The document was not readable.');
        if (reason === null) return;
      }
      if (action === 'reject') {
        // Ending an enquiry is not undoable from the desk, so it asks twice:
        // once for the reason the agency will be told, once to be sure.
        reason = global.prompt('Why can this document not be verified? The agency is told this.', '');
        if (reason === null) return;
        if (!global.confirm('Close this agency enquiry? They will be told it could not be verified.')) return;
      }

      const buttons = Array.from(detailGrid.querySelectorAll('[data-review]'));
      buttons.forEach((button) => { button.disabled = true; });
      setStatusText(
        'review-status',
        action === 'approve' ? 'Sending terms…' : action === 'reject' ? 'Closing the enquiry…' : 'Asking again…'
      );

      try {
        if (action === 'approve') {
          await Partner.approve(phone);
        } else if (action === 'reject') {
          await Partner.reject(phone, reason);
        } else {
          await Partner.askAgain(phone, reason);
        }
        await load();
        await renderDetail(phone);
      } catch (error) {
        buttons.forEach((button) => { button.disabled = false; });
        setStatusText('review-status', error.message || 'That did not go through. Try again.', 'error');
      }
    }

    async function renderDetail(phone) {
      const token = ++detailToken;
      selectedPhone = phone;
      selectedChat = null;

      const chat = await fetchJson(`/admin/booking-chats/${encodeURIComponent(phone)}`);
      if (token !== detailToken) return;

      selectedChat = chat;
      selectedPhone = chat.phone || chat.id;

      if (isMobileViewport()) mobileDetailOpen = true;
      bookingDetail.classList.remove('hidden');
      if (detailPanel) detailPanel.classList.remove('hidden');
      updateMobileDetailState();
      renderList();

      const phoneTarget = el('detail-phone');
      if (phoneTarget) phoneTarget.innerHTML = renderPhoneLink(selectedPhone);

      const enquiry = Partner.enquiryMeta(Partner.resolveEnquiryType(chat));
      const enquiryPill = el('detail-enquiry-type');
      if (enquiryPill) {
        enquiryPill.textContent = enquiry.label;
        enquiryPill.className = `pill enquiry-pill ${enquiry.className}`;
      }

      setText('detail-status', detailHeadline(chat));
      setText('detail-step', detailStep(chat));

      renderCards(chat);
      renderHistory(chat.messages || []);
      setTimeout(scrollHistoryToBottom, 0);
      if (isMobileViewport()) {
        global.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }

    function detailHeadline(chat) {
      if (mode === 'agency') return chat.partnerAgencyName || 'Agency enquiry';
      return isCompleted(chat) ? 'Booking completed' : 'Booking in progress';
    }

    function detailStep(chat) {
      if (mode === 'agency') return Partner.statusLabel(chat);
      return formatStatus(chat.currentStep || chat.status || 'booking chat');
    }

    function setText(name, value) {
      const target = el(name);
      if (target) target.textContent = value || '-';
    }

    /* ---- history --------------------------------------------------------- */

    function renderHistory(messages) {
      if (!historyList) return;
      historyList.innerHTML =
        (messages || []).map(renderHistoryBubble).join('') ||
        '<p class="attachment-empty">No chat history yet. New messages will appear after the customer replies again.</p>';
    }

    function renderHistoryBubble(message) {
      const directionClass = message.direction === 'outbound' ? 'history-item-outbound' : 'history-item-inbound';
      const sender = message.direction === 'outbound' ? 'Booking bot' : mode === 'agency' ? 'Agency' : 'Customer';
      const content = getMessageContent(message);
      const label = message.direction === 'outbound' && message.kind && message.kind !== 'text' ? message.kind : '';

      return `
        <article class="history-item ${directionClass}">
          <div class="history-meta">
            <span class="history-sender">${escapeHtml(sender)}</span>
            <time>${escapeHtml(formatTime(message.createdAt))}</time>
          </div>
          <div class="history-bubble">
            ${label ? `<div class="history-label">${escapeHtml(label)}</div>` : ''}
            <div class="history-text">${escapeHtml(content || 'Message')}</div>
          </div>
        </article>
      `;
    }

    function getMessageContent(message) {
      if (message.type === 'location' && message.location) {
        const location = message.location;
        return [
          'Location shared',
          location.name || '',
          location.address || '',
          location.latitude && location.longitude ? `${location.latitude}, ${location.longitude}` : ''
        ]
          .filter(Boolean)
          .join('\n');
      }

      const lines = [];
      if (message.text) lines.push(message.text);
      if (Array.isArray(message.buttonTitles) && message.buttonTitles.length) {
        lines.push(message.buttonTitles.join(' | '));
      }
      if (Array.isArray(message.listRows) && message.listRows.length) {
        lines.push(
          message.listRows.map((row) => (row.description ? `${row.title} - ${row.description}` : row.title)).join('\n')
        );
      }
      return lines.join('\n');
    }

    function scrollHistoryToBottom() {
      if (!historyList) return;
      historyList.scrollTo({ top: historyList.scrollHeight, behavior: 'smooth' });
    }

    /* ---- mobile ---------------------------------------------------------- */

    function updateMobileDetailState() {
      if (!bookingContent) return;
      bookingContent.classList.toggle('mobile-detail-open', mobileDetailOpen);
    }

    function isMobileViewport() {
      return global.matchMedia('(max-width: 960px), (hover: none) and (pointer: coarse)').matches;
    }

    /* ---- loading --------------------------------------------------------- */

    async function fetchJson(url, fetchOptions) {
      const response = await fetch(url, fetchOptions);
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

    async function load() {
      const query = region ? `?region=${encodeURIComponent(region)}` : '';
      const data = await fetchJson(`/admin/booking-chats${query}`);
      chats = (data.chats || []).filter((chat) => config.keeps(Partner.resolveEnquiryType(chat)));
      loaded = true;
      updateMetrics();
      renderList();

      if (selectedPhone) {
        const selected = chats.find((item) => (item.phone || item.id) === selectedPhone);
        if (selected) {
          await renderDetail(selected.phone || selected.id);
          return;
        }
      }

      // Same reason as the provider desk: on a phone the queue is the screen,
      // so nothing is opened until someone taps a row.
      const first = isMobileViewport() ? null : getVisibleChats()[0];
      if (first) {
        await renderDetail(first.phone || first.id);
      } else {
        bookingDetail.classList.add('hidden');
      }
    }

    function showLoadError(error) {
      bookingList.innerHTML = `<div class="provider-item"><strong>Dashboard unavailable</strong><p>${escapeHtml(error.message)}</p></div>`;
    }

    /* ---- wiring ---------------------------------------------------------- */

    renderChrome();

    const refreshButton = el('refresh-button');
    if (refreshButton) {
      refreshButton.addEventListener('click', () => load().catch(showLoadError));
    }

    const clearButton = el('clear-search-button');
    if (clearButton) {
      clearButton.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        search = '';
        renderList();
      });
    }

    const backButton = el('back-to-list-button');
    if (backButton) {
      backButton.addEventListener('click', () => {
        mobileDetailOpen = false;
        updateMobileDetailState();
      });
    }

    const historyButton = el('history-bottom-button');
    if (historyButton) {
      historyButton.addEventListener('click', scrollHistoryToBottom);
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        search = normalizeSearchTerm(searchInput.value);
        renderList();
      });
    }

    global.addEventListener('resize', updateMobileDetailState);

    return {
      load: () => load().catch((error) => { showLoadError(error); throw error; }),
      refresh: () => load().catch(showLoadError),
      getChats: () => chats.slice()
    };
  }

  global.PulsoBookingBoard = { create, MODES };

  /* ---- the standalone /admin/bookings page ------------------------------- */

  function regionFromPath() {
    if (global.location.pathname.endsWith('/kerala')) return 'kerala';
    if (global.location.pathname.endsWith('/karnataka')) return 'karnataka';
    return '';
  }

  /* Only the standalone page carries this marker; the /admin shell creates its
     boards itself, with its own modes. */
  function bootstrapStandalonePage() {
    const page = document.querySelector('[data-booking-standalone]');
    if (!page) return;

    const region = regionFromPath();
    const board = create({
      root: page,
      metricsRoot: page.querySelector('[data-el="hero-meta"]'),
      mode: 'all',
      region
    });

    if (region) {
      const title = document.getElementById('booking-dashboard-title');
      const subtitle = document.getElementById('booking-dashboard-subtitle');
      const allLink = document.getElementById('all-bookings-link');
      const regionLink = document.getElementById(`${region}-bookings-link`);
      if (title) title.textContent = `${formatStatus(region)} senior care booking chats`;
      if (subtitle) subtitle.textContent = `Review WhatsApp family booking conversations for ${formatStatus(region)}.`;
      if (allLink) allLink.classList.remove('hidden');
      if (regionLink) regionLink.classList.add('hidden');
    }

    board.refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapStandalonePage);
  } else {
    bootstrapStandalonePage();
  }
})(window);
