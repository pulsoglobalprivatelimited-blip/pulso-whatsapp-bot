let providers = [];
let selectedPhone = null;
let currentFilter = 'all';

const providerList = document.getElementById('provider-list');
const emptyState = document.getElementById('empty-state');
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

function renderList() {
  const filtered = providers.filter((item) => currentFilter === 'all' || item.status === currentFilter);

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

function renderHistory(history) {
  const target = document.getElementById('history-list');
  target.innerHTML = (history || []).slice().reverse().map((entry) => `
    <div class="history-item">
      <time>${new Date(entry.at).toLocaleString()}</time>
      <strong>${entry.type.replace(/_/g, ' ')}</strong>
      <div>${escapeHtml(JSON.stringify(entry.payload || entry.event || '', null, 2))}</div>
    </div>
  `).join('');
}

function renderDetail(provider) {
  selectedPhone = provider.phone;
  emptyState.classList.add('hidden');
  providerDetail.classList.remove('hidden');
  renderList();

  setText('detail-phone', provider.phone);
  setText('detail-status', formatStatus(provider.status));
  setText('detail-step', `Step ${provider.currentStep}`);
  setText('detail-name', provider.fullName);
  setText('detail-qualification', provider.qualification);
  setText('detail-interest', provider.interestConfirmed ? 'Yes' : 'No');
  setText('detail-duty-hour', formatDutyHourPreference(provider.dutyHourPreference));
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
