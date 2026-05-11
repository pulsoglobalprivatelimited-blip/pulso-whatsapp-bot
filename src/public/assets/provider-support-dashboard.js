let sessions = [];
let selectedPhone = null;
let currentStatusFilter = 'all';
let currentRegionFilter = 'all';
let currentSearch = '';
let mobileDetailOpen = false;

const sessionList = document.getElementById('session-list');
const sessionDetail = document.getElementById('session-detail');
const detailPanel = document.getElementById('detail-panel');
const supportContent = document.getElementById('support-content');
const sessionSearchInput = document.getElementById('session-search');
const actionStatus = document.getElementById('action-status');

document.getElementById('refresh-button').addEventListener('click', loadSessions);
document.getElementById('clear-search-button').addEventListener('click', () => {
  sessionSearchInput.value = '';
  currentSearch = '';
  renderList();
});
document.getElementById('back-to-list-button').addEventListener('click', () => {
  mobileDetailOpen = false;
  updateMobileDetailState();
});
document.getElementById('history-bottom-button').addEventListener('click', scrollHistoryToBottom);
document.getElementById('reset-session-button').addEventListener('click', resetSelectedSession);
sessionSearchInput.addEventListener('input', () => {
  currentSearch = normalizeSearchTerm(sessionSearchInput.value);
  renderList();
});

document.querySelectorAll('[data-status-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-status-filter]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    currentStatusFilter = button.dataset.statusFilter;
    renderList();
  });
});

document.querySelectorAll('[data-region-filter]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-region-filter]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    currentRegionFilter = button.dataset.regionFilter;
    renderList();
  });
});

document.getElementById('total-metric').addEventListener('click', () => {
  applyMetricFilters('all', 'all');
});
document.getElementById('updated-today-metric').addEventListener('click', () => {
  applyMetricFilters('all', 'all', 'today');
});
document.getElementById('kerala-metric').addEventListener('click', () => {
  applyMetricFilters('all', 'kerala');
});
document.getElementById('needs-choice-metric').addEventListener('click', () => {
  applyMetricFilters('awaiting_region', 'all');
});
window.addEventListener('resize', updateMobileDetailState);

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

async function loadSessions() {
  const data = await fetchJson('/admin/provider-support/sessions');
  sessions = data.sessions || [];
  updateMetrics();
  renderList();

  if (selectedPhone) {
    const selected = sessions.find((item) => item.phone === selectedPhone || item.id === selectedPhone);
    if (selected) {
      await renderDetail(selected.phone || selected.id);
      return;
    }
  }

  const first = getVisibleSessions()[0];
  if (first) {
    await renderDetail(first.phone || first.id);
  } else {
    sessionDetail.classList.add('hidden');
  }
}

function applyMetricFilters(statusFilter, regionFilter, activeRange) {
  document.querySelectorAll('[data-status-filter]').forEach((item) => {
    item.classList.toggle('active', item.dataset.statusFilter === statusFilter);
  });
  document.querySelectorAll('[data-region-filter]').forEach((item) => {
    item.classList.toggle('active', item.dataset.regionFilter === regionFilter);
  });
  currentStatusFilter = statusFilter;
  currentRegionFilter = regionFilter;
  currentSearch = activeRange === 'today' ? 'active:today' : '';
  sessionSearchInput.value = currentSearch;
  renderList();
}

function updateMetrics() {
  const today = new Date().toDateString();
  const updatedToday = sessions.filter((session) => isSameDay(session.updatedAt, today));
  const kerala = sessions.filter((session) => session.region === 'kerala');
  const needsChoice = sessions.filter((session) => session.status === 'awaiting_region');

  setText('total-count', sessions.length);
  setText('updated-today-count', updatedToday.length);
  setText('kerala-count', kerala.length);
  setText('needs-choice-count', needsChoice.length);
}

function getVisibleSessions() {
  return sessions.filter((session) => {
    const statusMatch = currentStatusFilter === 'all' || session.status === currentStatusFilter;
    const regionMatch = currentRegionFilter === 'all' || session.region === currentRegionFilter;
    const searchMatch = matchesSearch(session, currentSearch);
    return statusMatch && regionMatch && searchMatch;
  });
}

function matchesSearch(session, search) {
  if (!search) return true;
  if (search === 'active:today') {
    return isSameDay(session.updatedAt, new Date().toDateString());
  }

  const haystack = [
    session.phone,
    session.id,
    session.region,
    session.language,
    session.status,
    session.lastIntent,
    session.lastDutyType
  ].map((value) => normalizeSearchTerm(value)).join(' ');

  return haystack.includes(search);
}

function renderList() {
  const visible = getVisibleSessions();
  sessionList.innerHTML = visible.map((session) => {
    const phone = session.phone || session.id;
    const region = session.region ? formatStatus(session.region) : 'Region pending';
    const updated = session.updatedAt ? formatTime(session.updatedAt) : 'No update time';
    const activeClass = phone === selectedPhone || session.id === selectedPhone ? ' active' : '';

    return `
      <article class="provider-item${activeClass}" data-phone="${escapeAttr(phone)}">
        <div class="provider-meta">
          <strong>${escapeHtml(formatPhone(phone))}</strong>
          <span class="region-badge ${escapeAttr(session.region || '')}">${escapeHtml(region)}</span>
        </div>
        <p>${escapeHtml(formatStatus(session.status || 'unknown'))}</p>
        <p>${escapeHtml(session.lastIntent ? `Last intent: ${formatStatus(session.lastIntent)}` : 'No intent yet')}</p>
        <p>${escapeHtml(updated)}</p>
      </article>
    `;
  }).join('') || '<div class="provider-item"><strong>No support sessions</strong><p>Nothing matches the selected filters.</p></div>';

  sessionList.querySelectorAll('[data-phone]').forEach((item) => {
    item.addEventListener('click', () => {
      renderDetail(item.dataset.phone);
    });
  });
}

async function renderDetail(phone) {
  selectedPhone = phone;
  actionStatus.textContent = '';
  actionStatus.classList.remove('success', 'error');
  const session = await fetchJson(`/admin/provider-support/sessions/${encodeURIComponent(phone)}`);
  selectedPhone = session.phone || session.id;

  if (isMobileViewport()) {
    mobileDetailOpen = true;
  }
  sessionDetail.classList.remove('hidden');
  detailPanel.classList.remove('hidden');
  updateMobileDetailState();
  renderList();

  document.getElementById('detail-phone').innerHTML = renderPhoneLink(selectedPhone);
  setText('detail-status', formatStatus(session.status || 'unknown'));
  setText('detail-step', formatStatus(session.lastIntent || session.status || 'support session'));
  setText('detail-region', session.region ? formatStatus(session.region) : 'Not selected');
  setText('detail-language', session.language || '-');
  setText('detail-intent', session.lastIntent ? formatStatus(session.lastIntent) : '-');
  setText('detail-duty-type', session.lastDutyType || '-');
  setText('detail-created', session.createdAt ? formatTime(session.createdAt) : '-');
  setText('detail-updated', session.updatedAt ? formatTime(session.updatedAt) : '-');

  const chatLink = buildWhatsAppLink(selectedPhone);
  const chatAnchor = document.getElementById('open-whatsapp-link');
  chatAnchor.href = chatLink || '#';
  chatAnchor.classList.toggle('hidden', !chatLink);

  renderHistory(session.events || []);
  setTimeout(scrollHistoryToBottom, 0);
  if (isMobileViewport()) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderHistory(events) {
  const target = document.getElementById('history-list');
  target.innerHTML = (events || []).map(renderHistoryBubble).join('') ||
    '<p class="attachment-empty">No chat history yet.</p>';
}

function renderHistoryBubble(entry) {
  if (entry.type === 'inbound_message') {
    const payload = entry.payload || {};
    const content = payload.text || payload.interactiveReplyId || payload.type || 'Message received';
    return `
      <article class="history-item history-item-inbound">
        <div class="history-meta">
          <span class="history-sender">Provider</span>
          <time>${escapeHtml(formatTime(entry.createdAt))}</time>
        </div>
        <div class="history-bubble">
          <div class="history-text">${escapeHtml(content)}</div>
        </div>
      </article>
    `;
  }

  if (entry.type === 'outbound_message') {
    const payload = entry.payload || {};
    const content = getOutboundContent(payload);
    const kind = payload.kind || 'message';
    return `
      <article class="history-item history-item-outbound">
        <div class="history-meta">
          <span class="history-sender">Support bot</span>
          <time>${escapeHtml(formatTime(entry.createdAt))}</time>
        </div>
        <div class="history-bubble">
          ${kind !== 'text' ? `<div class="history-label">${escapeHtml(kind)}</div>` : ''}
          <div class="history-text">${escapeHtml(content || 'Message sent')}</div>
        </div>
      </article>
    `;
  }

  return `
    <article class="history-item history-item-system">
      <div class="history-meta">
        <span class="history-sender">System</span>
        <time>${escapeHtml(formatTime(entry.createdAt))}</time>
      </div>
      <div class="history-system-note">${escapeHtml(formatStatus(entry.type || 'system update'))}</div>
    </article>
  `;
}

function getOutboundContent(payload) {
  if (!payload) return '';
  if (payload.kind === 'text') {
    return payload.body || '';
  }

  const body = payload.body || {};
  const lines = [];
  if (body.body) {
    lines.push(body.body);
  }
  if (body.buttons && body.buttons.length) {
    lines.push(body.buttons.map((button) => button.title).join(' | '));
  }
  if (body.sections && body.sections.length) {
    body.sections.forEach((section) => {
      (section.rows || []).forEach((row) => lines.push(row.title));
    });
  }
  return lines.join('\n');
}

async function resetSelectedSession() {
  if (!selectedPhone) return;
  const confirmed = window.confirm(`Reset support session for ${formatPhone(selectedPhone)}? Their next message will start from region selection.`);
  if (!confirmed) return;

  try {
    const button = document.getElementById('reset-session-button');
    button.disabled = true;
    button.textContent = 'Resetting...';
    await fetchJson(`/admin/provider-support/sessions/${encodeURIComponent(selectedPhone)}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    actionStatus.textContent = 'Session reset. The next provider message will start fresh.';
    actionStatus.classList.add('success');
    selectedPhone = null;
    await loadSessions();
  } catch (error) {
    actionStatus.textContent = error.message;
    actionStatus.classList.add('error');
  } finally {
    const button = document.getElementById('reset-session-button');
    button.disabled = false;
    button.textContent = 'Reset session';
  }
}

function scrollHistoryToBottom() {
  const target = document.getElementById('history-list');
  if (!target) return;
  target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
}

function updateMobileDetailState() {
  if (!supportContent) return;
  supportContent.classList.toggle('mobile-detail-open', mobileDetailOpen);
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 960px), (hover: none) and (pointer: coarse)').matches;
}

function buildWhatsAppLink(phone) {
  const digits = normalizePhone(phone);
  if (!digits) return '';
  return `https://wa.me/${digits}`;
}

function renderPhoneLink(phone) {
  const href = buildWhatsAppLink(phone);
  const label = formatPhone(phone);
  return href
    ? `<a class="phone-link detail-phone-link" href="${href}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(label);
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

function normalizeSearchTerm(value) {
  return String(value || '').trim().toLowerCase();
}

function formatStatus(value) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function isSameDay(value, dayString) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.toDateString() === dayString;
}

function setText(id, value) {
  const target = document.getElementById(id);
  if (target) {
    target.textContent = value || '-';
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', '&quot;');
}

loadSessions().catch((error) => {
  sessionList.innerHTML = `<div class="provider-item"><strong>Dashboard unavailable</strong><p>${escapeHtml(error.message)}</p></div>`;
});
