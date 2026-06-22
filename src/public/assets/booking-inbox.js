/* Read-only WhatsApp-style inbox for customer BOOKING conversations.
   Reuses the inbox shell/styles and the PulsoChat utilities. Booking chats use
   a different data shape than provider history (a `messages` subcollection with
   direction/createdAt/text/buttonTitles/listRows/location), so the thread
   rendering is booking-specific. Replies happen in WhatsApp via the handoff. */
(function () {
  'use strict';

  const Chat = window.PulsoChat;
  const REFRESH_MS = 25000;
  const PRE_CHOICE_STEPS = ['', 'language', 'region', 'intent'];

  const els = {
    app: document.getElementById('inbox-app'),
    list: document.getElementById('inbox-list'),
    count: document.getElementById('inbox-count'),
    search: document.getElementById('inbox-search'),
    clear: document.getElementById('inbox-clear'),
    refresh: document.getElementById('inbox-refresh'),
    regionFilters: document.getElementById('region-filters'),
    statusFilters: document.getElementById('status-filters'),
    empty: document.getElementById('thread-empty'),
    view: document.getElementById('thread-view'),
    back: document.getElementById('thread-back'),
    avatar: document.getElementById('thread-avatar'),
    name: document.getElementById('thread-name'),
    status: document.getElementById('thread-status'),
    enquiry: document.getElementById('thread-enquiry'),
    facts: document.getElementById('booking-facts'),
    scroll: document.getElementById('thread-scroll'),
    history: document.getElementById('thread-history'),
    openChat: document.getElementById('thread-open-chat'),
    copyRequest: document.getElementById('copy-request')
  };

  let chats = [];
  let selectedPhone = null;
  let selectedChat = null;
  let searchTerm = '';
  let regionFilter = 'all';
  let statusFilter = 'all';
  let renderedMessageCount = -1;

  /* ---- data ------------------------------------------------------------- */
  async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (response.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('Authentication required');
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(payload.error || 'Request failed');
    }
    return response.json();
  }

  async function loadList() {
    try {
      const data = await fetchJson('/admin/booking-chats');
      chats = Array.isArray(data.chats) ? data.chats : [];
      renderList();
    } catch (error) {
      els.list.innerHTML = `<p class="is-loading">${Chat.escapeHtml(error.message || 'Could not load conversations.')}</p>`;
      els.count.textContent = '';
    }
  }

  /* ---- helpers ---------------------------------------------------------- */
  function normalizePhone(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function formatPhone(value) {
    const digits = normalizePhone(value);
    if (digits.length === 12 && digits.startsWith('91')) {
      return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
    }
    return value ? String(value) : '-';
  }

  function chatPhone(chat) {
    return chat.phone || chat.id || '';
  }

  function displayName(chat) {
    return chat.careRecipientName || chat.familyName || formatPhone(chatPhone(chat));
  }

  function initials(chat) {
    const name = (chat.careRecipientName || chat.familyName || '').trim();
    if (name) {
      const chars = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('');
      if (chars) return chars;
    }
    return normalizePhone(chatPhone(chat)).slice(-2) || '?';
  }

  function isCompleted(chat) {
    return chat.status === 'booking_completed';
  }

  function statusLabel(chat) {
    return isCompleted(chat) ? 'Completed' : Chat.formatStatus(chat.currentStep || 'active');
  }

  function resolveEnquiryType(chat) {
    const tagged = String(chat.enquiryType || '').toLowerCase();
    if (tagged === 'care' || tagged === 'job') return tagged;
    const step = String(chat.currentStep || '').toLowerCase();
    if (step && !PRE_CHOICE_STEPS.includes(step)) return 'care';
    return 'undecided';
  }

  function enquiryMeta(type) {
    if (type === 'care') return { label: 'Booking', className: 'care' };
    if (type === 'job') return { label: 'Job enquiry', className: 'job' };
    return { label: 'Undecided', className: 'undecided' };
  }

  function rowTime(chat) {
    return chat.updatedAt || chat.lastMessageAt || chat.createdAt || null;
  }

  function shortTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
    }
    return date.toLocaleDateString();
  }

  function rowPreview(chat) {
    if (chat.lastIncomingText) return chat.lastIncomingText;
    return isCompleted(chat) ? `Booking completed${chat.requestId ? ` · ${chat.requestId}` : ''}` : statusLabel(chat);
  }

  /* ---- chat list -------------------------------------------------------- */
  function getVisibleChats() {
    const term = searchTerm.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return chats.filter((chat) => {
      const regionMatch = regionFilter === 'all' || String(chat.region || '').toLowerCase() === regionFilter;
      const statusMatch =
        statusFilter === 'all' ||
        (statusFilter === 'test' && chat.isTestBooking === true) ||
        (statusFilter === 'active' && !isCompleted(chat)) ||
        chat.status === statusFilter;
      let searchMatch = true;
      if (term) {
        const haystack = [
          chat.careRecipientName, chat.familyName, chatPhone(chat), chat.requestId,
          chat.familyId, chat.city, chat.addressSummary, chat.serviceLabel || chat.service
        ].map((v) => String(v || '').toLowerCase()).join(' ');
        searchMatch = haystack.includes(term) || (digits && normalizePhone(chatPhone(chat)).includes(digits));
      }
      return regionMatch && statusMatch && searchMatch;
    });
  }

  function renderRow(chat) {
    const phone = chatPhone(chat);
    const enquiry = enquiryMeta(resolveEnquiryType(chat));
    const done = isCompleted(chat);

    return `
      <button class="chat-row${phone === selectedPhone ? ' active' : ''}" type="button" data-phone="${Chat.escapeHtml(phone)}">
        <span class="chat-avatar">${Chat.escapeHtml(initials(chat))}</span>
        <span class="chat-main">
          <span class="chat-line">
            <span class="chat-name">${Chat.escapeHtml(displayName(chat))}${chat.isTestBooking ? ' · Test' : ''}</span>
            <span class="chat-time">${Chat.escapeHtml(shortTime(rowTime(chat)))}</span>
          </span>
          <span class="chat-sub">
            <span class="chat-preview">${Chat.escapeHtml(rowPreview(chat))}</span>
            <span class="chat-status-pill ${done ? 'done' : ''}">${Chat.escapeHtml(statusLabel(chat))}</span>
            <span class="enquiry-badge ${enquiry.className}">${Chat.escapeHtml(enquiry.label)}</span>
          </span>
        </span>
      </button>
    `;
  }

  function renderList() {
    const visible = getVisibleChats();
    els.count.textContent = (searchTerm || regionFilter !== 'all' || statusFilter !== 'all')
      ? `${visible.length} of ${chats.length} conversations`
      : `${chats.length} conversations`;

    els.list.innerHTML = visible.length
      ? visible.map(renderRow).join('')
      : '<p class="is-loading">No conversations match your filters.</p>';
  }

  /* ---- booking message rendering (booking-specific shape) --------------- */
  function getMessageContent(message) {
    if (message.type === 'location' && message.location) {
      const loc = message.location;
      return ['Location shared', loc.name || '', loc.address || '',
        loc.latitude && loc.longitude ? `${loc.latitude}, ${loc.longitude}` : '']
        .filter(Boolean).join('\n');
    }
    const lines = [];
    if (message.text) lines.push(message.text);
    if (Array.isArray(message.buttonTitles) && message.buttonTitles.length) {
      lines.push(message.buttonTitles.join(' | '));
    }
    if (Array.isArray(message.listRows) && message.listRows.length) {
      lines.push(message.listRows.map((row) => row.description ? `${row.title} - ${row.description}` : row.title).join('\n'));
    }
    return lines.join('\n');
  }

  function renderMessageBubble(message) {
    const outbound = message.direction === 'outbound';
    const directionClass = outbound ? 'history-item-outbound' : 'history-item-inbound';
    const sender = outbound ? 'Booking bot' : 'Customer';
    const content = getMessageContent(message);
    const label = outbound && message.kind && message.kind !== 'text' ? message.kind : '';

    return `
      <article class="history-item ${directionClass}">
        <div class="history-meta">
          <span class="history-sender">${Chat.escapeHtml(sender)}</span>
          <time>${Chat.escapeHtml(Chat.formatHistoryTime(message.createdAt))}</time>
        </div>
        <div class="history-bubble">
          ${label ? `<div class="history-label">${Chat.escapeHtml(label)}</div>` : ''}
          <div class="history-text">${Chat.escapeHtml(content || 'Message')}</div>
        </div>
      </article>
    `;
  }

  function buildMessagesHtml(messages) {
    const items = (Array.isArray(messages) ? messages : []).map(renderMessageBubble).join('');
    return items || '<p class="attachment-empty">No chat history yet.</p>';
  }

  /* ---- booking facts ---------------------------------------------------- */
  function fact(label, value) {
    if (value === null || value === undefined || value === '' || value === '-') return '';
    return `<span class="booking-fact"><span class="bf-label">${Chat.escapeHtml(label)}</span><span class="bf-value">${Chat.escapeHtml(String(value))}</span></span>`;
  }

  function flagChip(label, value) {
    return value === true ? `<span class="booking-fact warn"><span class="bf-value">${Chat.escapeHtml(label)}</span></span>` : '';
  }

  function serviceText(chat) {
    const base = chat.serviceLabel || chat.service || '';
    if (!base) return '';
    return chat.hours ? `${base} (${chat.hours}h)` : base;
  }

  function recipientText(chat) {
    return [chat.careRecipientName, chat.careRecipientRelation && `(${chat.careRecipientRelation})`].filter(Boolean).join(' ');
  }

  function renderFacts(chat) {
    const price = Number(chat.price || 0) ? `Rs ${Number(chat.price).toLocaleString('en-IN')}` : '';
    const facts = [
      fact('Request', chat.requestId || (isCompleted(chat) ? '-' : 'Not completed yet')),
      fact('Service', serviceText(chat)),
      fact('Recipient', recipientText(chat)),
      fact('Age', chat.careRecipientAge),
      fact('Gender', chat.careRecipientGender && Chat.formatStatus(chat.careRecipientGender)),
      fact('Days', chat.days),
      fact('Start', chat.startLabel),
      fact('Caregiver', chat.caregiverGender && Chat.formatStatus(chat.caregiverGender)),
      fact('Price', price),
      fact('Location', chat.addressSummary || chat.city),
      fact('Language', chat.language),
      flagChip('Bedridden', chat.isBedridden),
      flagChip('Feeding tube', chat.hasFeedingTube),
      flagChip('Catheter', chat.hasCatheter),
      flagChip('Stoma', chat.hasStoma)
    ].filter(Boolean).join('');
    els.facts.innerHTML = facts || '<span class="booking-fact"><span class="bf-value">No booking details yet</span></span>';
  }

  /* ---- thread ----------------------------------------------------------- */
  function renderThread(chat, { keepScroll } = {}) {
    selectedChat = chat;
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const enquiry = enquiryMeta(resolveEnquiryType(chat));

    els.avatar.textContent = initials(chat);
    els.name.textContent = displayName(chat);
    els.status.textContent = `${formatPhone(chatPhone(chat))} · ${isCompleted(chat) ? 'Booking completed' : 'Booking in progress'}`;
    els.enquiry.textContent = enquiry.label;
    els.enquiry.className = `enquiry-badge ${enquiry.className}`;

    renderFacts(chat);

    const atBottom = els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight < 80;
    els.history.innerHTML = buildMessagesHtml(messages);
    renderedMessageCount = messages.length;
    if (!keepScroll || atBottom) {
      els.scroll.scrollTop = els.scroll.scrollHeight;
    }

    const digits = normalizePhone(chatPhone(chat));
    els.openChat.href = digits ? `https://wa.me/${digits}` : '#';
    els.copyRequest.disabled = !chat.requestId;
  }

  async function selectChat(phone) {
    selectedPhone = phone;
    renderedMessageCount = -1;
    els.empty.style.display = 'none';
    els.view.classList.remove('hidden');
    els.app.classList.add('thread-open');
    els.history.innerHTML = '<p class="is-loading">Loading conversation…</p>';
    els.facts.innerHTML = '';
    els.name.textContent = phone;
    els.status.textContent = '';
    els.enquiry.textContent = '';
    document.querySelectorAll('.chat-row').forEach((row) => {
      row.classList.toggle('active', row.dataset.phone === phone);
    });

    try {
      const chat = await fetchJson(`/admin/booking-chats/${encodeURIComponent(phone)}`);
      if (selectedPhone !== phone) return;
      renderThread(chat);
    } catch (error) {
      els.history.innerHTML = `<p class="attachment-empty">${Chat.escapeHtml(error.message || 'Could not load conversation.')}</p>`;
    }
  }

  async function refreshOpenThread() {
    if (!selectedPhone) return;
    try {
      const chat = await fetchJson(`/admin/booking-chats/${encodeURIComponent(selectedPhone)}`);
      if (selectedPhone !== (chat.phone || chat.id)) return;
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      if (messages.length !== renderedMessageCount) {
        renderThread(chat, { keepScroll: true });
      }
    } catch (error) {
      /* keep current view on transient refresh errors */
    }
  }

  function closeThread() {
    selectedPhone = null;
    els.app.classList.remove('thread-open');
    els.view.classList.add('hidden');
    els.empty.style.display = '';
    document.querySelectorAll('.chat-row.active').forEach((row) => row.classList.remove('active'));
  }

  /* ---- events ----------------------------------------------------------- */
  els.list.addEventListener('click', (event) => {
    const row = event.target.closest('.chat-row');
    if (row && row.dataset.phone) selectChat(row.dataset.phone);
  });

  els.search.addEventListener('input', () => {
    searchTerm = els.search.value || '';
    renderList();
  });

  els.clear.addEventListener('click', () => {
    els.search.value = '';
    searchTerm = '';
    renderList();
    els.search.focus();
  });

  els.regionFilters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-region]');
    if (!chip) return;
    regionFilter = chip.dataset.region;
    els.regionFilters.querySelectorAll('.inbox-chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderList();
  });

  els.statusFilters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-status]');
    if (!chip) return;
    statusFilter = chip.dataset.status;
    els.statusFilters.querySelectorAll('.inbox-chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderList();
  });

  els.refresh.addEventListener('click', async () => {
    await loadList();
    await refreshOpenThread();
  });

  els.back.addEventListener('click', closeThread);

  els.copyRequest.addEventListener('click', async () => {
    if (!selectedChat || !selectedChat.requestId) return;
    try {
      await navigator.clipboard.writeText(selectedChat.requestId);
      els.copyRequest.textContent = 'Copied ✓';
      window.setTimeout(() => { els.copyRequest.textContent = 'Copy Request ID'; }, 1500);
    } catch (error) {
      els.copyRequest.textContent = 'Copy failed';
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadList();
      refreshOpenThread();
    }
  });

  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    loadList();
    refreshOpenThread();
  }, REFRESH_MS);

  loadList();
})();
