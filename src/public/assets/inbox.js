/* Read-only WhatsApp-style inbox. Reuses the existing admin APIs
   (GET /admin/providers, GET /admin/providers/:phone) and the shared
   PulsoChat renderer. Replies still happen in WhatsApp via the handoff links. */
(function () {
  'use strict';

  const Chat = window.PulsoChat;
  const REFRESH_MS = 25000;

  const els = {
    app: document.getElementById('inbox-app'),
    list: document.getElementById('inbox-list'),
    count: document.getElementById('inbox-count'),
    search: document.getElementById('inbox-search'),
    clear: document.getElementById('inbox-clear'),
    refresh: document.getElementById('inbox-refresh'),
    empty: document.getElementById('thread-empty'),
    view: document.getElementById('thread-view'),
    back: document.getElementById('thread-back'),
    avatar: document.getElementById('thread-avatar'),
    name: document.getElementById('thread-name'),
    status: document.getElementById('thread-status'),
    step: document.getElementById('thread-step'),
    scroll: document.getElementById('thread-scroll'),
    history: document.getElementById('thread-history'),
    openChat: document.getElementById('thread-open-chat'),
    openIntro: document.getElementById('thread-open-intro')
  };

  let providers = [];
  let selectedPhone = null;
  let searchTerm = '';
  let renderedHistoryCount = -1;

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
      const data = await fetchJson('/admin/providers');
      providers = Array.isArray(data.providers) ? data.providers : [];
      renderList();
    } catch (error) {
      els.list.innerHTML = `<p class="is-loading">${Chat.escapeHtml(error.message || 'Could not load conversations.')}</p>`;
      els.count.textContent = '';
    }
  }

  /* ---- status / formatting helpers ------------------------------------- */
  function isAwaitingTermsAcceptance(provider) {
    if (!provider || provider.termsAccepted) return false;
    if (provider.status === 'awaiting_terms_acceptance') return true;
    return provider.verification && provider.verification.status === 'verified';
  }

  function getDashboardStatus(provider) {
    if (provider && provider.termsAccepted) return 'completed';
    if (isAwaitingTermsAcceptance(provider)) return 'awaiting_terms_acceptance';
    return provider && provider.status ? provider.status : '';
  }

  function needsAttention(provider) {
    if (!provider) return false;
    if (provider.agentHelpRequested) return true;
    if (provider.status === 'certificate_verification_pending') return true;
    return provider.verification && provider.verification.status === 'pending';
  }

  function displayName(provider) {
    return (provider && provider.fullName) ? provider.fullName : (provider && provider.phone) || 'Unknown';
  }

  function initials(provider) {
    const name = provider && provider.fullName ? provider.fullName.trim() : '';
    if (name) {
      const parts = name.split(/\s+/).filter(Boolean);
      const chars = parts.slice(0, 2).map((part) => part[0]).join('');
      if (chars) return chars;
    }
    const digits = String((provider && provider.phone) || '').replace(/\D/g, '');
    return digits.slice(-2) || '?';
  }

  function shortTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
    }
    return date.toLocaleDateString();
  }

  function rowTimestamp(provider) {
    return (provider && (provider.lastMessageAt || provider.updatedAt)) || null;
  }

  function rowPreview(provider) {
    if (provider && provider.lastMessagePreview) return provider.lastMessagePreview;
    return Chat.formatStatus(getDashboardStatus(provider));
  }

  /* ---- chat list -------------------------------------------------------- */
  function getVisibleProviders() {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return providers;
    const digits = term.replace(/\D/g, '');
    return providers.filter((provider) => {
      const name = (provider.fullName || '').toLowerCase();
      const phone = String(provider.phone || '');
      return name.includes(term) || (digits && phone.includes(digits));
    });
  }

  function renderRow(provider) {
    const phone = provider.phone || '';
    const status = getDashboardStatus(provider);
    const attention = needsAttention(provider);
    const done = status === 'completed';
    const pillClass = attention ? 'attention' : (done ? 'done' : '');

    return `
      <button class="chat-row${phone === selectedPhone ? ' active' : ''}" type="button" data-phone="${Chat.escapeHtml(phone)}">
        <span class="chat-avatar">${Chat.escapeHtml(initials(provider))}</span>
        <span class="chat-main">
          <span class="chat-line">
            <span class="chat-name">${Chat.escapeHtml(displayName(provider))}</span>
            <span class="chat-time">${Chat.escapeHtml(shortTime(rowTimestamp(provider)))}</span>
          </span>
          <span class="chat-sub">
            <span class="chat-preview">${Chat.escapeHtml(rowPreview(provider))}</span>
            <span class="chat-status-pill ${pillClass}">${Chat.escapeHtml(Chat.formatStatus(status) || 'lead')}</span>
            <span class="chat-dot${attention ? '' : ' hidden'}"></span>
          </span>
        </span>
      </button>
    `;
  }

  function renderList() {
    const visible = getVisibleProviders();
    els.count.textContent = searchTerm
      ? `${visible.length} of ${providers.length} conversations`
      : `${providers.length} conversations`;

    if (!visible.length) {
      els.list.innerHTML = '<p class="is-loading">No conversations match your search.</p>';
      return;
    }

    els.list.innerHTML = visible.map(renderRow).join('');
  }

  /* ---- WhatsApp handoff links (mirrors dashboard.js) -------------------- */
  function normalizePhone(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function introMessage(provider) {
    const greetingName = provider && provider.fullName ? ` ${provider.fullName}` : '';
    return `നമസ്കാരം${greetingName}, ഞാൻ Ashmila, Pulso support team-ിൽ നിന്നാണ് message ചെയ്യുന്നത്. താങ്കൾ കൂടുതൽ സഹായം ആവശ്യപ്പെട്ടതായി കണ്ടു. എങ്ങനെ സഹായിക്കാം?`;
  }

  function androidIntentLink(phone, fallbackUrl, text) {
    const normalized = normalizePhone(phone);
    if (!normalized) return '';
    const params = new URLSearchParams();
    params.set('phone', normalized);
    if (text) params.set('text', text);
    const fallback = fallbackUrl || `https://wa.me/${normalized}`;
    return `intent://send?${params.toString()}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  }

  function wireHandoff(provider) {
    const phone = normalizePhone(provider && provider.phone);
    if (!phone) {
      els.openChat.removeAttribute('href');
      els.openIntro.removeAttribute('href');
      return;
    }
    const intro = introMessage(provider);
    const chatLink = `https://wa.me/${phone}`;
    const businessChatLink = `whatsapp://send?phone=${phone}`;
    const introLink = `${chatLink}?text=${encodeURIComponent(intro)}`;
    const businessIntroLink = `whatsapp://send?phone=${phone}&text=${encodeURIComponent(intro)}`;

    els.openChat.setAttribute('href', businessChatLink);
    els.openChat.dataset.chatFallbackHref = chatLink;
    els.openChat.dataset.chatAndroidIntentHref = androidIntentLink(phone, chatLink);

    els.openIntro.setAttribute('href', businessIntroLink);
    els.openIntro.dataset.chatFallbackHref = introLink;
    els.openIntro.dataset.chatAndroidIntentHref = androidIntentLink(phone, introLink, intro);

    attachPreferredWhatsAppHandlers(els.view);
  }

  function isAndroidDevice() {
    return /Android/i.test(window.navigator.userAgent || '');
  }

  function attachPreferredWhatsAppHandlers(root) {
    root.querySelectorAll('[data-chat-fallback-href]').forEach((link) => {
      if (link.dataset.chatHandlerAttached === 'true') return;
      link.dataset.chatHandlerAttached = 'true';
      link.addEventListener('click', (event) => {
        const fallbackHref = link.dataset.chatFallbackHref;
        const href = link.getAttribute('href') || '';
        const androidIntentHref = link.dataset.chatAndroidIntentHref || '';
        const targetHref = isAndroidDevice() && androidIntentHref ? androidIntentHref : href;
        if (!fallbackHref || (!href.startsWith('whatsapp://') && !targetHref.startsWith('intent://'))) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();

        let appOpened = false;
        let fallbackTimer = null;
        const markAppOpened = () => { appOpened = true; };
        const handleVisibilityChange = () => {
          if (document.visibilityState === 'hidden') markAppOpened();
        };
        const clearListeners = () => {
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          window.removeEventListener('blur', markAppOpened);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          window.removeEventListener('pagehide', markAppOpened);
        };

        window.addEventListener('blur', markAppOpened, { once: true });
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('pagehide', markAppOpened, { once: true });

        fallbackTimer = window.setTimeout(() => {
          clearListeners();
          if (!appOpened) window.location.href = fallbackHref;
        }, 1200);

        window.location.href = targetHref;
      });
    });
  }

  /* ---- thread ----------------------------------------------------------- */
  function renderThread(provider, { keepScroll } = {}) {
    const history = Array.isArray(provider.history) ? provider.history : [];
    const status = getDashboardStatus(provider);

    els.avatar.textContent = initials(provider);
    els.name.textContent = displayName(provider);
    els.status.textContent = `${provider.phone || ''} · ${Chat.formatStatus(status) || 'lead'}`;

    const region = provider.region ? `${provider.region[0].toUpperCase()}${provider.region.slice(1)}` : null;
    const stepText = [region, provider.currentStep ? `Step ${provider.currentStep}` : null].filter(Boolean).join(' · ');
    els.step.textContent = stepText;
    els.step.style.display = stepText ? '' : 'none';

    const atBottom = els.scroll.scrollHeight - els.scroll.scrollTop - els.scroll.clientHeight < 80;
    els.history.innerHTML = Chat.buildHistoryHtml(history);
    renderedHistoryCount = history.length;

    if (!keepScroll || atBottom) {
      els.scroll.scrollTop = els.scroll.scrollHeight;
    }

    wireHandoff(provider);
  }

  async function selectChat(phone) {
    selectedPhone = phone;
    renderedHistoryCount = -1;
    els.empty.style.display = 'none';
    els.view.classList.remove('hidden');
    els.app.classList.add('thread-open');
    els.history.innerHTML = '<p class="is-loading">Loading conversation…</p>';
    els.name.textContent = phone;
    els.status.textContent = '';
    els.step.style.display = 'none';
    document.querySelectorAll('.chat-row').forEach((row) => {
      row.classList.toggle('active', row.dataset.phone === phone);
    });

    try {
      const provider = await fetchJson(`/admin/providers/${encodeURIComponent(phone)}`);
      if (selectedPhone !== phone) return; // user moved on
      renderThread(provider);
    } catch (error) {
      els.history.innerHTML = `<p class="attachment-empty">${Chat.escapeHtml(error.message || 'Could not load conversation.')}</p>`;
    }
  }

  async function refreshOpenThread() {
    if (!selectedPhone) return;
    try {
      const provider = await fetchJson(`/admin/providers/${encodeURIComponent(selectedPhone)}`);
      if (selectedPhone !== provider.phone) return;
      const history = Array.isArray(provider.history) ? provider.history : [];
      if (history.length !== renderedHistoryCount) {
        renderThread(provider, { keepScroll: true });
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

  els.refresh.addEventListener('click', async () => {
    await loadList();
    await refreshOpenThread();
  });

  els.back.addEventListener('click', closeThread);

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
