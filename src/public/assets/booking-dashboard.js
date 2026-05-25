let chats = [];
let selectedPhone = null;
let currentStatusFilter = 'all';
let currentRegionFilter = 'all';
let currentSearch = '';
let mobileDetailOpen = false;
let selectedChat = null;

const pathRegion = getRegionFromPath();
const bookingList = document.getElementById('booking-list');
const bookingDetail = document.getElementById('booking-detail');
const detailPanel = document.getElementById('detail-panel');
const bookingContent = document.getElementById('booking-content');
const bookingSearchInput = document.getElementById('booking-search');
const actionStatus = document.getElementById('action-status');

configureRegionView();

document.getElementById('refresh-button').addEventListener('click', loadChats);
document.getElementById('clear-search-button').addEventListener('click', () => {
  bookingSearchInput.value = '';
  currentSearch = '';
  renderList();
});
document.getElementById('back-to-list-button').addEventListener('click', () => {
  mobileDetailOpen = false;
  updateMobileDetailState();
});
document.getElementById('history-bottom-button').addEventListener('click', scrollHistoryToBottom);
document.getElementById('copy-request-button').addEventListener('click', copySelectedRequestId);
bookingSearchInput.addEventListener('input', () => {
  currentSearch = normalizeSearchTerm(bookingSearchInput.value);
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
  applyMetricFilters('all', pathRegion || 'all');
});
document.getElementById('completed-metric').addEventListener('click', () => {
  applyMetricFilters('booking_completed', pathRegion || 'all');
});
document.getElementById('active-metric').addEventListener('click', () => {
  applyMetricFilters('active', pathRegion || 'all');
});
document.getElementById('test-metric').addEventListener('click', () => {
  applyMetricFilters('test', pathRegion || 'all');
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

async function loadChats() {
  const query = pathRegion ? `?region=${encodeURIComponent(pathRegion)}` : '';
  const data = await fetchJson(`/admin/booking-chats${query}`);
  chats = data.chats || [];
  updateMetrics();
  renderList();

  if (selectedPhone) {
    const selected = chats.find((item) => (item.phone || item.id) === selectedPhone);
    if (selected) {
      await renderDetail(selected.phone || selected.id);
      return;
    }
  }

  const first = getVisibleChats()[0];
  if (first) {
    await renderDetail(first.phone || first.id);
  } else {
    bookingDetail.classList.add('hidden');
  }
}

function configureRegionView() {
  const title = document.getElementById('booking-dashboard-title');
  const subtitle = document.getElementById('booking-dashboard-subtitle');
  const allLink = document.getElementById('all-bookings-link');
  const keralaLink = document.getElementById('kerala-bookings-link');
  const karnatakaLink = document.getElementById('karnataka-bookings-link');

  if (pathRegion) {
    currentRegionFilter = pathRegion;
    document.querySelectorAll('[data-region-filter]').forEach((item) => {
      item.classList.toggle('active', item.dataset.regionFilter === pathRegion);
    });
    allLink.classList.remove('hidden');
    title.textContent = `${formatStatus(pathRegion)} senior care booking chats`;
    subtitle.textContent = `Review WhatsApp family booking conversations for ${formatStatus(pathRegion)}.`;
  }

  if (pathRegion === 'kerala') {
    keralaLink.classList.add('hidden');
  }
  if (pathRegion === 'karnataka') {
    karnatakaLink.classList.add('hidden');
  }
}

function applyMetricFilters(statusFilter, regionFilter) {
  document.querySelectorAll('[data-status-filter]').forEach((item) => {
    item.classList.toggle('active', item.dataset.statusFilter === statusFilter);
  });
  document.querySelectorAll('[data-region-filter]').forEach((item) => {
    item.classList.toggle('active', item.dataset.regionFilter === regionFilter);
  });
  currentStatusFilter = statusFilter;
  currentRegionFilter = regionFilter;
  currentSearch = '';
  bookingSearchInput.value = '';
  renderList();
}

function updateMetrics() {
  setText('total-count', chats.length);
  setText('completed-count', chats.filter((chat) => chat.status === 'booking_completed').length);
  setText('active-count', chats.filter((chat) => chat.status !== 'booking_completed').length);
  setText('test-count', chats.filter((chat) => chat.isTestBooking === true).length);
}

function getVisibleChats() {
  return chats.filter((chat) => {
    const statusMatch =
      currentStatusFilter === 'all' ||
      (currentStatusFilter === 'test' && chat.isTestBooking === true) ||
      chat.status === currentStatusFilter;
    const regionMatch =
      currentRegionFilter === 'all' ||
      (currentRegionFilter === 'other' && !['kerala', 'karnataka'].includes(chat.region)) ||
      chat.region === currentRegionFilter;
    const searchMatch = matchesSearch(chat, currentSearch);
    return statusMatch && regionMatch && searchMatch;
  });
}

function matchesSearch(chat, search) {
  if (!search) return true;
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
    chat.lastIncomingText
  ]
    .map((value) => normalizeSearchTerm(value))
    .join(' ');
  return haystack.includes(search);
}

function renderList() {
  const visible = getVisibleChats();
  bookingList.innerHTML =
    visible
      .map((chat) => {
        const phone = chat.phone || chat.id;
        const region = chat.region ? formatStatus(chat.region) : 'Location pending';
        const activeClass = phone === selectedPhone || chat.id === selectedPhone ? ' active' : '';
        const status = chat.status === 'booking_completed' ? 'Completed' : formatStatus(chat.currentStep || 'Active');
        const name = chat.careRecipientName || chat.familyName || 'Name pending';
        const request = chat.requestId ? `Request: ${chat.requestId}` : 'Booking not completed yet';
        const updated = chat.updatedAt || chat.lastMessageAt ? formatTime(chat.updatedAt || chat.lastMessageAt) : 'No update time';

        return `
          <article class="provider-item${activeClass}" data-phone="${escapeAttr(phone)}">
            <div class="provider-meta">
              <strong>${escapeHtml(formatPhone(phone))}</strong>
              <span class="region-badge ${escapeAttr(chat.region || '')}">${escapeHtml(region)}</span>
            </div>
            <p>${escapeHtml(name)}${chat.isTestBooking ? ' · Test' : ''}</p>
            <p>${escapeHtml(status)}</p>
            <p>${escapeHtml(request)}</p>
            <p>${escapeHtml(updated)}</p>
          </article>
        `;
      })
      .join('') ||
    '<div class="provider-item"><strong>No booking chats</strong><p>Nothing matches the selected filters.</p></div>';

  bookingList.querySelectorAll('[data-phone]').forEach((item) => {
    item.addEventListener('click', () => {
      renderDetail(item.dataset.phone);
    });
  });
}

async function renderDetail(phone) {
  selectedPhone = phone;
  selectedChat = null;
  actionStatus.textContent = '';
  actionStatus.classList.remove('success', 'error');
  const chat = await fetchJson(`/admin/booking-chats/${encodeURIComponent(phone)}`);
  selectedChat = chat;
  selectedPhone = chat.phone || chat.id;

  if (isMobileViewport()) {
    mobileDetailOpen = true;
  }
  bookingDetail.classList.remove('hidden');
  detailPanel.classList.remove('hidden');
  updateMobileDetailState();
  renderList();

  document.getElementById('detail-phone').innerHTML = renderPhoneLink(selectedPhone);
  setText('detail-status', chat.status === 'booking_completed' ? 'Booking completed' : 'Booking in progress');
  setText('detail-step', formatStatus(chat.currentStep || chat.status || 'booking chat'));
  setText('detail-request-id', chat.requestId || '-');
  setText('detail-service', formatService(chat));
  setText('detail-recipient', chat.careRecipientName || '-');
  setText('detail-relation', chat.careRecipientRelation || '-');
  setText('detail-days', chat.days ? String(chat.days) : '-');
  setText('detail-start', chat.startLabel || '-');
  setText('detail-caregiver-gender', chat.caregiverGender ? formatStatus(chat.caregiverGender) : '-');
  setText('detail-price', Number(chat.price || 0) ? `Rs ${Number(chat.price || 0).toLocaleString('en-IN')}` : '-');
  setText('detail-family-name', chat.familyName || '-');
  setText('detail-family-id', chat.familyId || '-');
  setText('detail-location', chat.addressSummary || chat.city || '-');
  setText('detail-region', chat.region ? formatStatus(chat.region) : '-');
  setText('detail-language', chat.language || '-');
  setText('detail-test', formatBoolean(chat.isTestBooking));
  setText('detail-created', chat.createdAt ? formatTime(chat.createdAt) : '-');
  setText('detail-updated', chat.updatedAt || chat.lastMessageAt ? formatTime(chat.updatedAt || chat.lastMessageAt) : '-');
  setText('detail-age', chat.careRecipientAge ? String(chat.careRecipientAge) : '-');
  setText('detail-gender', chat.careRecipientGender ? formatStatus(chat.careRecipientGender) : '-');
  setText('detail-weight', chat.careRecipientWeightKg ? `${chat.careRecipientWeightKg} kg` : '-');
  setText('detail-bedridden', formatBoolean(chat.isBedridden));
  setText('detail-feeding-tube', formatBoolean(chat.hasFeedingTube));
  setText('detail-catheter', formatBoolean(chat.hasCatheter));
  setText('detail-stoma', formatBoolean(chat.hasStoma));

  const chatLink = buildWhatsAppLink(selectedPhone);
  const chatAnchor = document.getElementById('open-whatsapp-link');
  chatAnchor.href = chatLink || '#';
  chatAnchor.classList.toggle('hidden', !chatLink);
  document.getElementById('copy-request-button').disabled = !chat.requestId;

  renderHistory(chat.messages || []);
  setTimeout(scrollHistoryToBottom, 0);
  if (isMobileViewport()) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderHistory(messages) {
  const target = document.getElementById('history-list');
  target.innerHTML =
    (messages || []).map(renderHistoryBubble).join('') ||
    '<p class="attachment-empty">No chat history yet. New messages will appear after the customer replies again.</p>';
}

function renderHistoryBubble(message) {
  const directionClass = message.direction === 'outbound' ? 'history-item-outbound' : 'history-item-inbound';
  const sender = message.direction === 'outbound' ? 'Booking bot' : 'Customer';
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
  if (message.text) {
    lines.push(message.text);
  }
  if (Array.isArray(message.buttonTitles) && message.buttonTitles.length) {
    lines.push(message.buttonTitles.join(' | '));
  }
  if (Array.isArray(message.listRows) && message.listRows.length) {
    lines.push(message.listRows.map((row) => row.description ? `${row.title} - ${row.description}` : row.title).join('\n'));
  }
  return lines.join('\n');
}

async function copySelectedRequestId() {
  if (!selectedChat?.requestId) return;

  try {
    await navigator.clipboard.writeText(selectedChat.requestId);
    actionStatus.textContent = 'Request ID copied.';
    actionStatus.classList.add('success');
    actionStatus.classList.remove('error');
  } catch (error) {
    actionStatus.textContent = 'Could not copy request ID.';
    actionStatus.classList.add('error');
    actionStatus.classList.remove('success');
  }
}

function scrollHistoryToBottom() {
  const target = document.getElementById('history-list');
  if (!target) return;
  target.scrollTo({ top: target.scrollHeight, behavior: 'smooth' });
}

function updateMobileDetailState() {
  if (!bookingContent) return;
  bookingContent.classList.toggle('mobile-detail-open', mobileDetailOpen);
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 960px), (hover: none) and (pointer: coarse)').matches;
}

function getRegionFromPath() {
  if (window.location.pathname.endsWith('/kerala')) return 'kerala';
  if (window.location.pathname.endsWith('/karnataka')) return 'karnataka';
  return null;
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

function formatService(chat) {
  const label = chat.serviceLabel || chat.service || '-';
  if (chat.hours) {
    return `${label} (${chat.hours}h)`;
  }
  return label;
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

loadChats().catch((error) => {
  bookingList.innerHTML = `<div class="provider-item"><strong>Dashboard unavailable</strong><p>${escapeHtml(error.message)}</p></div>`;
});
