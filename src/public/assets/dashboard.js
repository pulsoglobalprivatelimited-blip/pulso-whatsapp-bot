let providers = [];
let selectedPhone = null;
let currentFilter = 'all';
let currentSearch = '';
let currentCompletedRange = 'all';
let mobileDetailOpen = false;

const providerList = document.getElementById('provider-list');
const providerDetail = document.getElementById('provider-detail');
const listPanel = document.getElementById('list-panel');
const detailPanel = document.getElementById('detail-panel');
const pendingCount = document.getElementById('pending-count');
const completedCount = document.getElementById('completed-count');
const newConversationsCount = document.getElementById('new-conversations-count');
const started7dCount = document.getElementById('started-7d-count');
const started30dCount = document.getElementById('started-30d-count');
const completed7dCount = document.getElementById('completed-7d-count');
const completed30dCount = document.getElementById('completed-30d-count');
const phoneSearchInput = document.getElementById('phone-search');
const clearSearchButton = document.getElementById('clear-search-button');
const completedRangeFilters = document.getElementById('completed-range-filters');
const backToListButton = document.getElementById('back-to-list-button');
const historyBottomButton = document.getElementById('history-bottom-button');

document.getElementById('refresh-button').addEventListener('click', loadProviders);
document.querySelectorAll('.filter').forEach((button) => {
  if (!button.dataset.filter) {
    return;
  }

  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    currentFilter = button.dataset.filter;
    currentCompletedRange = 'all';
    updateCompletedRangeFilterState();
    renderList();
  });
});
document.querySelectorAll('[data-completed-range]').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-completed-range]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    currentCompletedRange = button.dataset.completedRange;
    renderList();
  });
});
phoneSearchInput.addEventListener('input', () => {
  currentSearch = normalizePhone(phoneSearchInput.value);
  renderList();
});
clearSearchButton.addEventListener('click', () => {
  phoneSearchInput.value = '';
  currentSearch = '';
  renderList();
});
backToListButton.addEventListener('click', () => {
  mobileDetailOpen = false;
  updateMobileDetailState();
});
historyBottomButton.addEventListener('click', () => {
  scrollHistoryToBottom();
});

document.getElementById('approve-button').addEventListener('click', () => submitReview('approve-certificate'));
document.getElementById('reject-button').addEventListener('click', () => submitReview('reject-certificate'));
document
  .getElementById('request-additional-document-button')
  .addEventListener('click', submitAdditionalDocumentRequest);
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

async function loadProviders() {
  const data = await fetchJson('/admin/providers');
  providers = data.providers || [];
  pendingCount.textContent = providers.filter((item) => getDashboardStatus(item) === 'certificate_verification_pending').length;
  completedCount.textContent = providers.filter((item) => isCompletedToday(item)).length;
  newConversationsCount.textContent = providers.filter((item) => isSameLocalDate(item.createdAt)).length;
  started7dCount.textContent = providers.filter((item) => isCreatedInPastDays(item, 7)).length;
  started30dCount.textContent = providers.filter((item) => isCreatedInPastDays(item, 30)).length;
  completed7dCount.textContent = providers.filter((item) => isCompletedInPastDays(item, 7)).length;
  completed30dCount.textContent = providers.filter((item) => isCompletedInPastDays(item, 30)).length;
  updateCompletedRangeFilterState();
  renderList();

  if (selectedPhone) {
    const selected = getVisibleProviders().find((item) => item.phone === selectedPhone) ||
      providers.find((item) => item.phone === selectedPhone);
    if (selected) {
      renderDetail(selected);
      return;
    }
  }

  const visibleProviders = getVisibleProviders();
  const exactMatch = currentSearch
    ? visibleProviders.find((item) => normalizePhone(item.phone) === currentSearch)
    : null;
  const initialProvider = exactMatch || visibleProviders[0];
  if (initialProvider) {
    renderDetail(initialProvider);
  }
}

function formatStatus(status) {
  return status.replace(/_/g, ' ');
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 960px), (hover: none) and (pointer: coarse)').matches;
}

function updateMobileDetailState() {
  const content = document.querySelector('.content');
  if (!content) {
    return;
  }

  const shouldShowDetail = isMobileViewport() && mobileDetailOpen && !providerDetail.classList.contains('hidden');
  content.classList.toggle('mobile-detail-open', shouldShowDetail);
  listPanel.classList.toggle('hidden', shouldShowDetail);
  detailPanel.classList.toggle('hidden', isMobileViewport() && !shouldShowDetail);
}

function getDashboardStatus(provider) {
  if (provider && provider.termsAccepted) {
    return 'completed';
  }

  return provider && provider.status ? provider.status : '';
}

function getCompletedAt(provider) {
  if (!provider) {
    return null;
  }

  if (provider.completedAt) {
    return provider.completedAt;
  }

  const history = Array.isArray(provider.history) ? provider.history : [];
  const historyCompletion = history.find((entry) => {
    if (!entry) {
      return false;
    }

    if (entry.type === 'system' && entry.event === 'onboarding_completed') {
      return true;
    }

    return (
      entry.type === 'outbound_message' &&
      entry.payload &&
      entry.payload.kind === 'text' &&
      entry.payload.body === 'നന്ദി. താങ്കളുടെ onboarding പൂർത്തിയായി.'
    );
  });

  if (historyCompletion && historyCompletion.at) {
    return historyCompletion.at;
  }

  return provider.updatedAt || null;
}

function isCompletedToday(provider) {
  if (getDashboardStatus(provider) !== 'completed') {
    return false;
  }

  const completedAt = getCompletedAt(provider);
  if (!completedAt) {
    return false;
  }

  const completedDate = new Date(completedAt);
  const now = new Date();

  return (
    completedDate.getFullYear() === now.getFullYear() &&
    completedDate.getMonth() === now.getMonth() &&
    completedDate.getDate() === now.getDate()
  );
}

function isCompletedInPastDays(provider, days) {
  if (getDashboardStatus(provider) !== 'completed') {
    return false;
  }

  const completedAt = getCompletedAt(provider);
  if (!completedAt) {
    return false;
  }

  const completedDate = new Date(completedAt);
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  return completedDate >= cutoff && completedDate <= now;
}

function isCreatedInPastDays(provider, days) {
  if (!provider || !provider.createdAt) {
    return false;
  }

  const createdDate = new Date(provider.createdAt);
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (days - 1));

  return createdDate >= cutoff && createdDate <= now;
}

function isSameLocalDate(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function matchesCompletedRange(provider) {
  if (getDashboardStatus(provider) !== 'completed') {
    return true;
  }

  if (currentCompletedRange === 'today') {
    return isCompletedToday(provider);
  }

  if (currentCompletedRange === '7d') {
    return isCompletedInPastDays(provider, 7);
  }

  if (currentCompletedRange === '30d') {
    return isCompletedInPastDays(provider, 30);
  }

  return true;
}

function updateCompletedRangeFilterState() {
  if (!completedRangeFilters) {
    return;
  }

  completedRangeFilters.classList.toggle('hidden', currentFilter !== 'completed');
  document.querySelectorAll('[data-completed-range]').forEach((button) => {
    button.classList.toggle('active', button.dataset.completedRange === currentCompletedRange);
  });
}

function formatDutyHourPreference(value) {
  if (value === '8_hour') return '8 hour (8 am to 6 pm) - 900rs per day';
  if (value === '24_hour') return '24 hour - 1200 rs per day';
  if (value === 'both') return 'Both (8 hour and 24 hour)';
  return value || '-';
}

function formatExpectedDuties(value) {
  if (value === true) return 'Accepted';
  if (value === false) return 'Declined';
  return '-';
}

function formatAgentHelp(value) {
  return value ? 'Requested' : 'Not requested';
}

function buildProviderIntroMessage(provider) {
  const greetingName = provider && provider.fullName ? ` ${provider.fullName}` : '';
  return `നമസ്കാരം${greetingName}, ഞാൻ Abdul, Pulso support team-ിൽ നിന്നാണ് message ചെയ്യുന്നത്. താങ്കൾ കൂടുതൽ സഹായം ആവശ്യപ്പെട്ടതായി കണ്ടു. എങ്ങനെ സഹായിക്കാം?`;
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildProviderChatLink(phone) {
  const normalized = normalizePhone(phone);
  return normalized ? `https://wa.me/${normalized}` : null;
}

function buildProviderPrefilledChatLink(provider) {
  const chatLink = buildProviderChatLink(provider && provider.phone);
  if (!chatLink) {
    return null;
  }

  return `${chatLink}?text=${encodeURIComponent(buildProviderIntroMessage(provider))}`;
}

function getVisibleProviders() {
  return providers.filter((item) => {
    const matchesFilter = currentFilter === 'all' || getDashboardStatus(item) === currentFilter;
    const matchesCompletedWindow = currentFilter !== 'completed' || matchesCompletedRange(item);
    const matchesSearch = !currentSearch || normalizePhone(item.phone).includes(currentSearch);
    return matchesFilter && matchesCompletedWindow && matchesSearch;
  });
}

function renderList() {
  const filtered = getVisibleProviders();

  if (filtered.length && !filtered.some((item) => item.phone === selectedPhone)) {
    const exactMatch = currentSearch
      ? filtered.find((item) => normalizePhone(item.phone) === currentSearch)
      : null;
    renderDetail(exactMatch || filtered[0]);
    return;
  }

  if (!filtered.length) {
    selectedPhone = null;
    mobileDetailOpen = false;
    providerDetail.classList.add('hidden');
    updateMobileDetailState();
  }

  providerList.innerHTML = filtered.length
    ? filtered.map((provider) => `
        <article class="provider-item ${provider.phone === selectedPhone ? 'active' : ''}" data-phone="${provider.phone}">
          <strong>${provider.phone}</strong>
          <p>${provider.fullName || provider.qualification || 'Profile pending'}</p>
          <p>${formatStatus(getDashboardStatus(provider))}</p>
        </article>
      `).join('')
    : '<div class="provider-item"><strong>No providers</strong><p>Nothing matches the selected filter right now.</p></div>';

  providerList.querySelectorAll('.provider-item[data-phone]').forEach((item) => {
    item.addEventListener('click', () => {
      const provider = providers.find((entry) => entry.phone === item.dataset.phone);
      if (provider) renderDetail(provider);
    });
  });
}

function setText(id, value) {
  document.getElementById(id).textContent = value || '-';
}

function mediaUrl(storagePath) {
  if (!storagePath) return null;
  const normalizedPath = String(storagePath).replaceAll('\\', '/');
  const pathParts = normalizedPath.split('/').filter(Boolean);
  if (pathParts.length < 3) {
    return null;
  }

  const relativePath = pathParts.slice(-3).join('/');
  return `/admin/media/${relativePath}`;
}

function formatAttachmentType(file) {
  const mimeType = file && file.mimeType ? file.mimeType : '';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('image/')) return 'Image';
  if (file && file.type === 'document') return 'Document';
  if (file && file.type === 'image') return 'Image';
  return 'File';
}

function renderAttachments(id, attachments) {
  const target = document.getElementById(id);
  if (!attachments || !attachments.length) {
    target.innerHTML = '<p class="attachment-empty">No files uploaded yet.</p>';
    return;
  }

  target.innerHTML = attachments.map((file) => {
    const href = mediaUrl(file.storagePath);
    const name = file.fileName || file.id || 'Attachment';
    const isImage = (file.mimeType || '').startsWith('image/');
    const uploadTime = file.receivedAt || file.archivedAt || null;
    const typeLabel = formatAttachmentType(file);

    if (!href) {
      return `
        <div class="attachment-card">
          <strong>${escapeHtml(name)}</strong>
          <div class="attachment-meta">
            <span>${escapeHtml(typeLabel)}</span>
            <span>${escapeHtml(file.archiveStatus || 'Unavailable')}</span>
          </div>
          <p>File path unavailable.</p>
        </div>
      `;
    }

    return `
      <article class="attachment-card">
        <a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>
        <div class="attachment-meta">
          <span>${escapeHtml(typeLabel)}</span>
          <span>${uploadTime ? escapeHtml(formatHistoryTime(uploadTime)) : 'Upload time unavailable'}</span>
        </div>
        <div class="attachment-actions">
          <a class="attachment-action" href="${href}" target="_blank" rel="noreferrer">Open</a>
          <a class="attachment-action" href="${href}" download>Download</a>
        </div>
        ${isImage ? `<img src="${href}" alt="${escapeHtml(name)}">` : '<p>Preview unavailable for this file type.</p>'}
      </article>
    `;
  }).join('');
}

function renderAdditionalDocumentRequest(provider) {
  const target = document.getElementById('detail-additional-request');
  const request = provider && provider.documents ? provider.documents.additionalDocumentRequest : null;

  if (!request) {
    target.innerHTML = '<p class="attachment-empty">No additional document request yet.</p>';
    return;
  }

  target.innerHTML = `
    <article class="attachment-card">
      <strong>${escapeHtml(request.status || 'pending')}</strong>
      <div class="attachment-meta">
        <span>${escapeHtml(request.requestedBy || 'Unknown requester')}</span>
        <span>${request.requestedAt ? escapeHtml(formatHistoryTime(request.requestedAt)) : 'Request time unavailable'}</span>
      </div>
      <p>${escapeHtml(request.note || 'No note')}</p>
      <div class="attachment-meta">
        <span>${request.fulfilledAt ? `Fulfilled ${escapeHtml(formatHistoryTime(request.fulfilledAt))}` : 'Awaiting upload'}</span>
      </div>
    </article>
  `;
}

function renderProviderChatActions(provider) {
  const target = document.getElementById('detail-provider-chat-actions');
  const chatLink = buildProviderChatLink(provider && provider.phone);
  const introLink = buildProviderPrefilledChatLink(provider);
  const introMessage = buildProviderIntroMessage(provider);

  if (!chatLink) {
    target.innerHTML = '<p class="attachment-empty">Provider phone unavailable.</p>';
    return;
  }

  target.innerHTML = `
    <article class="attachment-card">
      <strong>Quick WhatsApp handoff</strong>
      <div class="attachment-actions">
        <a class="attachment-action" href="${chatLink}" target="_blank" rel="noreferrer">Open chat</a>
        <a class="attachment-action" href="${introLink}" target="_blank" rel="noreferrer">Open with intro</a>
      </div>
      <p>${escapeHtml(introMessage)}</p>
    </article>
  `;
}

function formatHistoryTime(value) {
  return new Date(value).toLocaleString();
}

function getInboundMessageContent(payload) {
  if (!payload) return '';

  if (payload.text && payload.text.body) {
    return payload.text.body;
  }

  if (payload.button && payload.button.text) {
    return payload.button.text;
  }

  if (payload.interactive && payload.interactive.button_reply) {
    return payload.interactive.button_reply.title || 'Button reply';
  }

  if (payload.interactive && payload.interactive.list_reply) {
    return payload.interactive.list_reply.title || 'List reply';
  }

  if (payload.document) {
    return payload.document.filename || 'Document uploaded';
  }

  if (payload.image) {
    return payload.image.caption || 'Image uploaded';
  }

  return '';
}

function getOutboundMessageContent(payload) {
  if (!payload) return '';
  if (payload.kind === 'text') {
    return payload.body || '';
  }
  if (payload.body && payload.body.body) {
    return payload.body.body;
  }
  return '';
}

function describeSystemEvent(entry) {
  const event = entry.event || '';

  if (event === 'provider_created') return 'Conversation started';
  if (event === 'verification_queue_created') return 'Certificate sent for manual verification';
  if (event === 'certificate_verified') return 'Certificate approved by reviewer';
  if (event === 'certificate_rejected') return 'Certificate rejected by reviewer';
  if (event === 'additional_document_requested') return 'Additional document requested from provider';
  if (event === 'additional_document_received') return 'Requested additional document uploaded';
  if (event === 'agent_help_requested') return 'Provider requested additional help';

  return formatStatus(event || 'system update');
}

function renderHistoryBubble(entry) {
  if (entry.type === 'inbound_message') {
    const payload = entry.payload || {};
    const content = getInboundMessageContent(payload);
    const messageType = payload.type || 'message';
    const isUpload = ['image', 'document'].includes(messageType);

    return `
      <article class="history-item history-item-inbound">
        <div class="history-meta">
          <span class="history-sender">Provider</span>
          <time>${formatHistoryTime(entry.at)}</time>
        </div>
        <div class="history-bubble">
          ${isUpload ? `<div class="history-label">${messageType === 'document' ? 'Document' : 'Image'}</div>` : ''}
          <div class="history-text">${escapeHtml(content || 'Message received')}</div>
        </div>
      </article>
    `;
  }

  if (entry.type === 'outbound_message') {
    const payload = entry.payload || {};
    const content = getOutboundMessageContent(payload);
    const kind = payload.kind || 'message';

    return `
      <article class="history-item history-item-outbound">
        <div class="history-meta">
          <span class="history-sender">${escapeHtml(entry.sender || 'Bot')}</span>
          <time>${formatHistoryTime(entry.at)}</time>
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
        <time>${formatHistoryTime(entry.at)}</time>
      </div>
      <div class="history-system-note">${escapeHtml(describeSystemEvent(entry))}</div>
    </article>
  `;
}

function renderHistory(history) {
  const target = document.getElementById('history-list');
  const items = (history || []).map((entry) => renderHistoryBubble(entry)).join('');
  target.innerHTML = items || '<p class="attachment-empty">No chat history yet.</p>';
}

function scrollHistoryToBottom() {
  const target = document.getElementById('history-list');
  if (!target) {
    return;
  }

  target.scrollTo({
    top: target.scrollHeight,
    behavior: 'smooth'
  });
}

function renderDetail(provider) {
  selectedPhone = provider.phone;
  if (isMobileViewport()) {
    mobileDetailOpen = true;
  }
  providerDetail.classList.remove('hidden');
  detailPanel.classList.remove('hidden');
  updateMobileDetailState();
  renderList();

  setText('detail-phone', provider.phone);
  setText('detail-status', formatStatus(getDashboardStatus(provider)));
  setText('detail-step', `Step ${provider.currentStep}`);
  setText('detail-name', provider.fullName);
  setText('detail-qualification', provider.qualification);
  setText('detail-interest', provider.interestConfirmed ? 'Yes' : 'No');
  setText('detail-duty-hour', formatDutyHourPreference(provider.dutyHourPreference));
  setText('detail-expected-duties', formatExpectedDuties(provider.expectedDutiesAccepted));
  setText('detail-agent-help', formatAgentHelp(provider.agentHelpRequested));
  setText('detail-age', provider.age);
  setText('detail-sex', provider.sex);
  setText('detail-district', provider.district);
  setText('detail-updated', new Date(provider.updatedAt).toLocaleString());
  setText('detail-certificate', provider.documents.certificateReceived ? `${provider.documents.certificateAttachments.length} file(s)` : 'Not received');
  setText('detail-verification', provider.verification.status);
  renderProviderChatActions(provider);
  renderAttachments('detail-certificate-files', provider.documents.certificateAttachments);
  renderAdditionalDocumentRequest(provider);
  renderAttachments('detail-additional-document-files', provider.documents.additionalDocumentAttachments);

  document.getElementById('reviewer-input').value = provider.verification.reviewedBy || 'ops-team';
  document.getElementById('notes-input').value = provider.verification.notes || '';
  document.getElementById('additional-reviewer-input').value = provider.verification.reviewedBy || 'ops-team';
  document.getElementById('additional-note-input').value =
    provider.documents && provider.documents.additionalDocumentRequest && provider.documents.additionalDocumentRequest.status === 'pending'
      ? provider.documents.additionalDocumentRequest.note || ''
      : '';
  renderHistory(provider.history);
  setTimeout(scrollHistoryToBottom, 0);
  if (isMobileViewport()) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

async function submitReview(action) {
  if (!selectedPhone) return;

  const reviewedBy = document.getElementById('reviewer-input').value || 'ops-team';
  const notes = document.getElementById('notes-input').value || '';

  try {
    const provider = await fetchJson(`/admin/providers/${selectedPhone}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewedBy, notes })
    });

    const index = providers.findIndex((item) => item.phone === provider.phone);
    if (index >= 0) providers[index] = provider;
    renderDetail(provider);
    pendingCount.textContent = providers.filter((item) => getDashboardStatus(item) === 'certificate_verification_pending').length;
    completedCount.textContent = providers.filter((item) => isCompletedToday(item)).length;
    newConversationsCount.textContent = providers.filter((item) => isSameLocalDate(item.createdAt)).length;
    completed7dCount.textContent = providers.filter((item) => isCompletedInPastDays(item, 7)).length;
    completed30dCount.textContent = providers.filter((item) => isCompletedInPastDays(item, 30)).length;
  } catch (error) {
    alert(error.message);
  }
}

async function submitAdditionalDocumentRequest() {
  if (!selectedPhone) return;

  const reviewedBy = document.getElementById('additional-reviewer-input').value || 'ops-team';
  const note = document.getElementById('additional-note-input').value || '';

  try {
    const provider = await fetchJson(`/admin/providers/${selectedPhone}/request-additional-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewedBy, note })
    });

    const index = providers.findIndex((item) => item.phone === provider.phone);
    if (index >= 0) providers[index] = provider;
    renderDetail(provider);
    pendingCount.textContent = providers.filter((item) => getDashboardStatus(item) === 'certificate_verification_pending').length;
    completedCount.textContent = providers.filter((item) => isCompletedToday(item)).length;
    newConversationsCount.textContent = providers.filter((item) => isSameLocalDate(item.createdAt)).length;
    completed7dCount.textContent = providers.filter((item) => isCompletedInPastDays(item, 7)).length;
    completed30dCount.textContent = providers.filter((item) => isCompletedInPastDays(item, 30)).length;
  } catch (error) {
    alert(error.message);
  }
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

loadProviders().catch((error) => {
  providerList.innerHTML = `<div class="provider-item"><strong>Dashboard unavailable</strong><p>${error.message}</p></div>`;
});
