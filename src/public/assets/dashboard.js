let providers = [];
let selectedPhone = null;
let currentFilter = 'all';

const providerList = document.getElementById('provider-list');
const providerDetail = document.getElementById('provider-detail');
const pendingCount = document.getElementById('pending-count');
const completedCount = document.getElementById('completed-count');

document.getElementById('refresh-button').addEventListener('click', loadProviders);
document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    currentFilter = button.dataset.filter;
    renderList();
  });
});

document.getElementById('approve-button').addEventListener('click', () => submitReview('approve-certificate'));
document.getElementById('reject-button').addEventListener('click', () => submitReview('reject-certificate'));

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
  pendingCount.textContent = providers.filter((item) => item.status === 'certificate_verification_pending').length;
  completedCount.textContent = providers.filter((item) => item.status === 'completed').length;
  renderList();

  if (selectedPhone) {
    const selected = providers.find((item) => item.phone === selectedPhone);
    if (selected) {
      renderDetail(selected);
      return;
    }
  }

  if (providers[0]) {
    renderDetail(providers[0]);
  }
}

function formatStatus(status) {
  return status.replace(/_/g, ' ');
}

function formatDutyHourPreference(value) {
  if (value === '8_hour') return '8 hour (8 am to 6 pm) - 900rs per day';
  if (value === '24_hour') return '24 hour - 1200 rs per day';
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

function renderList() {
  const filtered = providers.filter((item) => currentFilter === 'all' || item.status === currentFilter);

  if (filtered.length && !filtered.some((item) => item.phone === selectedPhone)) {
    renderDetail(filtered[0]);
    return;
  }

  if (!filtered.length) {
    selectedPhone = null;
    providerDetail.classList.add('hidden');
  }

  providerList.innerHTML = filtered.length
    ? filtered.map((provider) => `
        <article class="provider-item ${provider.phone === selectedPhone ? 'active' : ''}" data-phone="${provider.phone}">
          <strong>${provider.phone}</strong>
          <p>${provider.fullName || provider.qualification || 'Profile pending'}</p>
          <p>${formatStatus(provider.status)}</p>
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
  const normalized = storagePath.replace(/^\.?\/*storage\/media\//, '');
  return `/media/${normalized}`;
}

function renderAttachments(id, attachments) {
  const target = document.getElementById(id);
  if (!attachments || !attachments.length) {
    target.innerHTML = '<p class="attachment-empty">No files available.</p>';
    return;
  }

  target.innerHTML = attachments.map((file) => {
    const href = mediaUrl(file.storagePath);
    const name = file.fileName || file.id || 'Attachment';
    const isImage = (file.mimeType || '').startsWith('image/');

    if (!href) {
      return `<div class="attachment-card"><strong>${escapeHtml(name)}</strong><p>File path unavailable</p></div>`;
    }

    return `
      <article class="attachment-card">
        <a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(name)}</a>
        ${isImage ? `<img src="${href}" alt="${escapeHtml(name)}">` : '<p>Preview unavailable for this file type.</p>'}
      </article>
    `;
  }).join('');
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

function renderDetail(provider) {
  selectedPhone = provider.phone;
  providerDetail.classList.remove('hidden');
  renderList();

  setText('detail-phone', provider.phone);
  setText('detail-status', formatStatus(provider.status));
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
  renderAttachments('detail-certificate-files', provider.documents.certificateAttachments);

  document.getElementById('reviewer-input').value = provider.verification.reviewedBy || 'ops-team';
  document.getElementById('notes-input').value = provider.verification.notes || '';
  renderHistory(provider.history);
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
    pendingCount.textContent = providers.filter((item) => item.status === 'certificate_verification_pending').length;
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
