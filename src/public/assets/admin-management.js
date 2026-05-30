let admins = [];
let selectedUsername = '';

const totalCount = document.getElementById('admin-total-count');
const activeCount = document.getElementById('admin-active-count');
const superCount = document.getElementById('admin-super-count');
const tableBody = document.getElementById('admin-table-body');
const searchInput = document.getElementById('admin-search');
const roleFilter = document.getElementById('admin-role-filter');
const refreshButton = document.getElementById('refresh-admins-button');

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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatStatus(admin) {
  return admin && admin.active ? 'Active' : 'Disabled';
}

function getVisibleAdmins() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedRole = roleFilter.value;

  return admins.filter((admin) => {
    const matchesRole = selectedRole === 'all' || admin.role === selectedRole;
    const matchesQuery = !query ||
      admin.username.toLowerCase().includes(query) ||
      admin.role.toLowerCase().includes(query) ||
      admin.roleLabel.toLowerCase().includes(query);

    return matchesRole && matchesQuery;
  });
}

function updateMetrics() {
  totalCount.textContent = admins.length;
  activeCount.textContent = admins.filter((admin) => admin.active).length;
  superCount.textContent = admins.filter((admin) => admin.role === 'super_admin').length;
}

function renderSelectedAdmin(admin) {
  document.getElementById('selected-admin-title').textContent = admin ? admin.username : 'No admin selected';
  document.getElementById('selected-admin-username').textContent = admin ? admin.username : '-';
  document.getElementById('selected-admin-role').textContent = admin ? admin.roleLabel : '-';
  document.getElementById('selected-admin-status').textContent = admin ? formatStatus(admin) : '-';
}

function renderAdmins() {
  const visibleAdmins = getVisibleAdmins();
  const selectedAdmin = admins.find((admin) => admin.username === selectedUsername) || visibleAdmins[0] || null;
  selectedUsername = selectedAdmin ? selectedAdmin.username : '';

  if (!visibleAdmins.length) {
    tableBody.innerHTML = '<tr><td colspan="4">No admins found.</td></tr>';
    renderSelectedAdmin(null);
    return;
  }

  tableBody.innerHTML = visibleAdmins.map((admin) => {
    const isSelected = admin.username === selectedUsername;
    return `
      <tr class="${isSelected ? 'selected' : ''}" data-username="${escapeHtml(admin.username)}">
        <td><strong>${escapeHtml(admin.username)}</strong></td>
        <td><span class="role-pill">${escapeHtml(admin.roleLabel)}</span></td>
        <td><span class="status-pill ${admin.active ? 'active' : 'disabled'}">${formatStatus(admin)}</span></td>
        <td><button class="attachment-action" type="button" data-select-admin="${escapeHtml(admin.username)}">View</button></td>
      </tr>
    `;
  }).join('');

  tableBody.querySelectorAll('[data-select-admin]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedUsername = button.dataset.selectAdmin;
      renderAdmins();
    });
  });

  renderSelectedAdmin(selectedAdmin);
}

async function loadAdmins() {
  const data = await fetchJson('/admin/api/admins');
  admins = data.admins || [];
  updateMetrics();
  renderAdmins();
}

searchInput.addEventListener('input', renderAdmins);
roleFilter.addEventListener('change', renderAdmins);
refreshButton.addEventListener('click', loadAdmins);

loadAdmins().catch((error) => {
  tableBody.innerHTML = `<tr><td colspan="4">${escapeHtml(error.message)}</td></tr>`;
});
