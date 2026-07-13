// =============================================
//  EE Lab — logs.js
//  Reads from the Requests tab via Apps Script
// =============================================

// 🔧 Replace with your deployed Apps Script URL
// (same URL used in request.js — it handles ?sheet=requests)
const LOGS_API = "https://script.google.com/macros/s/AKfycbxZR1rKeC8aZkvYTxh84gYpM98cQosboAcbvBm8mtA_cSwDwNP6ytdRAXdJackwNXah/exec";

// --- DOM refs ---
const navStatus      = document.getElementById('navStatus');
const refreshBtn     = document.getElementById('refreshBtn');
const filterType     = document.getElementById('filterType');
const filterStatus   = document.getElementById('filterStatus');
const filterResult   = document.getElementById('filterResult');
const logsSkeleton   = document.getElementById('logsSkeleton');
const logsTable      = document.getElementById('logsTable');
const logsTableBody  = document.getElementById('logsTableBody');
const logsEmpty      = document.getElementById('logsEmpty');
const logsEmptyTitle = document.getElementById('logsEmptyTitle');
const logsEmptyMsg   = document.getElementById('logsEmptyMsg');

// --- State ---
let allLogs = [];

// =============================================
//  Fetch logs from Apps Script
// =============================================
async function fetchLogs() {
    showSkeleton();
    setNavStatus('connecting');
    refreshBtn.classList.add('spinning');

    try {
        const res = await fetch(`${LOGS_API}?action=requests`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        allLogs = Array.isArray(data) ? data : [];
        updateChips(allLogs);
        setNavStatus('connected');
        applyFilters();

    } catch (err) {
        console.error('[EE Lab Logs] Fetch failed:', err);
        setNavStatus('error');
        showError('Couldn\'t reach the lab sheet', 'Check your network or verify the Apps Script is deployed for Anyone.');
    } finally {
        refreshBtn.classList.remove('spinning');
    }
}

// =============================================
//  Apply dual filters + render table
// =============================================
function applyFilters() {
    const typeVal   = filterType.value;
    const statusVal = filterStatus.value;

    const filtered = allLogs.filter(row => {
        const matchType   = typeVal   === 'All' || row.type   === typeVal;
        const matchStatus = statusVal === 'All' || row.status === statusVal;
        return matchType && matchStatus;
    });

    // Update filter result count
    if (typeVal !== 'All' || statusVal !== 'All') {
        filterResult.textContent = `Showing ${filtered.length} of ${allLogs.length} entries`;
    } else {
        filterResult.textContent = '';
    }

    renderTable(filtered);
}

filterType.addEventListener('change',   applyFilters);
filterStatus.addEventListener('change', applyFilters);

// =============================================
//  Render table rows
// =============================================
function renderTable(rows) {
    hideSkeleton();

    if (rows.length === 0) {
        logsTableBody.innerHTML = '';
        logsEmpty.classList.remove('hidden');
        document.getElementById('logsTableHead').classList.add('hidden');

        if (allLogs.length === 0) {
            logsEmptyTitle.textContent = 'No logs yet';
            logsEmptyMsg.textContent   = 'Submitted requests will appear here.';
        } else {
            logsEmptyTitle.textContent = 'No entries match your filters';
            logsEmptyMsg.textContent   = 'Try changing the Type or Status filter above.';
        }
        return;
    }

    logsEmpty.classList.add('hidden');
    document.getElementById('logsTableHead').classList.remove('hidden');

    logsTableBody.innerHTML = rows.map(row => `
        <tr>
            <td class="td-name">${escHtml(row.name)}</td>
            <td class="td-section">${escHtml(row.section)}</td>
            <td>${renderTypeBadge(row.type)}</td>
            <td class="td-materials">${escHtml(row.materials)}</td>
            <td class="td-reason" title="${escHtml(row.reason)}">${escHtml(row.reason)}</td>
            <td class="td-time">${formatTime(row.timestamp)}</td>
            <td>${renderStatusBadge(row.status)}</td>
        </tr>
    `).join('');
}

// =============================================
//  Badge renderers
// =============================================
function renderTypeBadge(type) {
    const map = {
        'Borrow':      ['🔄', 'type-borrow',      'Borrow'],
        'Buy':         ['🛒', 'type-buy',          'Buy'],
        'Request New': ['📋', 'type-request-new',  'Request New'],
    };
    const [icon, cls, label] = map[type] || ['📦', '', type || '—'];
    return `<span class="type-badge ${cls}">${icon} ${escHtml(label)}</span>`;
}

function renderStatusBadge(status) {
    const clsMap = {
        'Reserved':    'status-reserved',
        'Not Returned': 'status-not-returned',
        'Pending':      'status-pending',
        'Returned':     'status-returned',
        'Purchased':    'status-purchased',
        'Acknowledged': 'status-acknowledged',
    };
    const cls = clsMap[status] || 'status-unknown';
    return `<span class="status-badge ${cls}">${escHtml(status || '—')}</span>`;
}

// =============================================
//  Summary chips
// =============================================
function updateChips(rows) {
    document.getElementById('chipTotal').textContent  = rows.length;
    document.getElementById('chipBorrow').textContent = rows.filter(r => r.type === 'Borrow').length;
    document.getElementById('chipBuy').textContent    = rows.filter(r => r.type === 'Buy').length;
    document.getElementById('chipNew').textContent    = rows.filter(r => r.type === 'Request New').length;
}

// =============================================
//  Nav status indicator
// =============================================
function setNavStatus(state) {
    const label = navStatus.querySelector('.status-label');
    navStatus.className = 'nav-status';
    if (state === 'connected') {
        navStatus.classList.add('connected');
        label.textContent = 'Live';
    } else if (state === 'error') {
        navStatus.classList.add('error');
        label.textContent = 'Offline';
    } else {
        label.textContent = 'Connecting…';
    }
}

// =============================================
//  Skeleton / state helpers
// =============================================
function showSkeleton() {
    document.getElementById('logsSkeleton').classList.remove('hidden');
    document.getElementById('logsTableHead').classList.add('hidden');
    logsTableBody.innerHTML = '';
    logsEmpty.classList.add('hidden');
}

function hideSkeleton() {
    document.getElementById('logsSkeleton').classList.add('hidden');
    document.getElementById('logsTableHead').classList.remove('hidden');
}

function showError(title, msg) {
    hideSkeleton();
    logsTableBody.innerHTML = '';
    document.getElementById('logsTableHead').classList.add('hidden');
    logsEmpty.classList.remove('hidden');
    logsEmptyTitle.textContent = title;
    logsEmptyMsg.textContent   = msg;
    document.querySelector('#logsEmpty .state-icon').textContent = '📡';
}

// =============================================
//  Utilities
// =============================================
function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let h = d.getHours();
    const m    = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${h}:${m} ${ampm}`;
}

// =============================================
//  Boot
// =============================================
refreshBtn.addEventListener('click', fetchLogs);
window.addEventListener('load', fetchLogs);