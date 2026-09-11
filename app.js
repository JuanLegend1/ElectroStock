// =============================================
//  EE Lab Inventory — app.js
// =============================================

const GOOGLE_SHEET_API = "https://script.google.com/macros/s/AKfycbzZZMwir_VvYMYhdfxhg47ta9Y-4PP2xdqPXpmEMuFl2N0dX4DCFcOFHmWCmrV2CMBz/exec";

// --- DOM refs ---
const inventoryGrid = document.getElementById('inventoryGrid');
const searchInput   = document.getElementById('searchInput');
const filterRow     = document.getElementById('filterRow');
const navStatus     = document.getElementById('navStatus');
const modalOverlay  = document.getElementById('modalOverlay');
const modalClose    = document.getElementById('modalClose');
const lendableNotice = document.getElementById('lendableNotice');

// --- Review DOM refs ---
const reviewBtn            = document.getElementById('reviewBtn');
const reviewAvgEl          = document.getElementById('reviewAvg');
const reviewCountEl        = document.getElementById('reviewCount');
const reviewModalOverlay   = document.getElementById('reviewModalOverlay');
const reviewModalClose     = document.getElementById('reviewModalClose');
const starPicker           = document.getElementById('starPicker');
const reviewSubmitBtn      = document.getElementById('reviewSubmitBtn');
const reviewSubmitLabel    = document.getElementById('reviewSubmitLabel');
const reviewSubmitSpinner  = document.getElementById('reviewSubmitSpinner');
const thankYouOverlay      = document.getElementById('thankYouOverlay');
const thankYouCloseBtn     = document.getElementById('thankYouCloseBtn');

// --- Review Details DOM refs (optional name + comment step) ---
const reviewDetailsOverlay       = document.getElementById('reviewDetailsOverlay');
const reviewDetailsClose         = document.getElementById('reviewDetailsClose');
const reviewNameInput            = document.getElementById('reviewName');
const reviewCommentInput         = document.getElementById('reviewComment');
const reviewDetailsSubmitBtn     = document.getElementById('reviewDetailsSubmitBtn');
const reviewDetailsSubmitLabel   = document.getElementById('reviewDetailsSubmitLabel');
const reviewDetailsSubmitSpinner = document.getElementById('reviewDetailsSubmitSpinner');

// --- State ---
let allComponents  = [];
let activeFilter   = 'All';
let activeItemType = 'All';
let selectedStars  = 0;

// Reviewing is allowed once per visit (cleared when the tab/browser closes)
const REVIEW_SESSION_KEY = 'eeLabReviewSubmitted';

// =============================================
//  Icon — sheet URL takes full priority
// =============================================
// Extract Google Drive file ID from any Drive URL
function getDriveFileId(url) {
    const matchFile = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (matchFile) return matchFile[1];
    const matchId = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchId) return matchId[1];
    const matchThumb = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (matchThumb) return matchThumb[1];
    return null;
}

function resolveIconUrl(url, size = 72) {
    const trimmed = url.trim();
    if (trimmed.startsWith('data:')) return trimmed;
    // Google Drive — use lh3 content server for full-resolution images
    const id = getDriveFileId(trimmed);
    if (id) return 'https://lh3.googleusercontent.com/d/' + id + '=s' + size;
    // Any other URL → proxy through wsrv.nl
    return 'https://wsrv.nl/?url=' + encodeURIComponent(trimmed) + '&w=' + size + '&h=' + size + '&fit=contain&output=webp';
}

// Global onerror handler — swaps broken img for a neutral placeholder box
function iconFallback(imgEl) {
    imgEl.outerHTML = '<span style="font-size:1.4rem;line-height:1">📦</span>';
}

// Card icon (36×36) — accepts http URLs and data: URIs
function getIcon(iconUrl, category) {
    if (iconUrl && (iconUrl.trim().startsWith('http') || iconUrl.trim().startsWith('data:'))) {
        const src = resolveIconUrl(iconUrl.trim(), 72);
        return '<img src="' + src + '" alt="icon" ' +
               'style="width:36px;height:36px;object-fit:contain;border-radius:4px;" ' +
               'onerror="iconFallback(this)">';
    }
    return '<span style="font-size:1.6rem;line-height:1">' + getEmojiIcon(category) + '</span>';
}

// Modal icon (160×160) — full resolution
function getModalIcon(iconUrl, category) {
    if (iconUrl && (iconUrl.trim().startsWith('http') || iconUrl.trim().startsWith('data:'))) {
        const src = resolveIconUrl(iconUrl.trim(), 800);
        return '<img src="' + src + '" alt="icon" ' +
               'style="width:160px;height:160px;object-fit:contain;border-radius:12px;" ' +
               'onerror="iconFallback(this)">';
    }
    return '<span style="font-size:5rem;line-height:1">' + getEmojiIcon(category) + '</span>';
}

function getEmojiIcon(category = '') {
    const cat = category.toLowerCase();
    if (cat.includes('passive') || cat.includes('resistor') || cat.includes('capacitor')) return '🟡';
    if (cat.includes('wire') || cat.includes('wiring') || cat.includes('cable'))           return '🔌';
    if (cat.includes('module') || cat.includes('relay'))                                   return '📟';
    if (cat.includes('ic') || cat.includes('integrated') || cat.includes('timer'))        return '🎛️';
    if (cat.includes('sensor'))                                                             return '📡';
    if (cat.includes('power') || cat.includes('battery'))                                  return '🔋';
    return '📦';
}

// =============================================
//  Derive status from quantity
//  (Available / Out of Stock only — a single
//  "low stock" threshold doesn't fit every item type,
//  so that indicator has been removed. Zero units is
//  the only state that still gets flagged.)
// =============================================
function deriveStatus(qty) {
    return qty === 0 ? 'Out of Stock' : 'Available';
}

// =============================================
//  Fetch live data
// =============================================
async function fetchLiveInventory() {
    showSkeletons();
    setNavStatus('connecting');

    try {
        const response = await fetch(GOOGLE_SHEET_API);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.json();

        allComponents = raw.map(item => ({
            itemName : item.itemName || 'Unknown',
            category : item.category || 'Uncategorized',
            quantity : Number(item.quantity ?? 0),
            status   : item.status || deriveStatus(Number(item.quantity ?? 0)),
            iconUrl  : item.iconUrl  || '',
            itemType : item.itemType || 'Lendable',
            price    : item.price !== undefined ? item.price : null,
        }));

        updateSummaryChips(allComponents);
        setNavStatus('connected');
        applyFilters();

    } catch (err) {
        console.error('[EE Lab] Fetch failed:', err);
        setNavStatus('error');
        inventoryGrid.innerHTML = `
            <div class="state-message">
                <span class="state-icon">📡</span>
                <h3>Couldn't reach the lab sheet</h3>
                <p>Check your network or verify the Apps Script is deployed for <em>Anyone</em>.</p>
            </div>`;
    }
}

// =============================================
//  Render cards
// =============================================
function displayComponents(items) {
    inventoryGrid.innerHTML = '';

    if (items.length === 0) {
        inventoryGrid.innerHTML = `
            <div class="state-message">
                <span class="state-icon">🔍</span>
                <h3>No components match</h3>
                <p>Try a different search term or clear the filter.</p>
            </div>`;
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.classList.add('component-card');

        const statusClass = item.status === 'Out of Stock' ? 'status-out-of-stock' : 'status-available';
        card.classList.add(statusClass);

        const badgeClass = item.status === 'Out of Stock' ? 'out-of-stock' : 'available';

        const isSellable    = item.itemType === 'Sellable';
        const itemTypeBadge = isSellable
            ? `<span class="item-type-badge sellable">🛒 Sellable</span>`
            : `<span class="item-type-badge lendable">🔄 Lendable</span>`;

        const priceHtml = (isSellable && item.price !== null && item.price !== undefined)
            ? ` <span class="card-price">₱${Number(item.price).toFixed(2)}</span>`
            : '';

        card.innerHTML = `
            <div class="card-icon">${getIcon(item.iconUrl, item.category)}</div>
            <div class="card-details">
                <h3 class="component-title" title="${item.itemName}">${item.itemName}</h3>
                <p class="card-category">${item.category}</p>
                ${itemTypeBadge}
                <div class="card-footer">
                    <span class="card-qty">Qty: <span>${item.quantity}</span>${priceHtml}</span>
                    <span class="status-badge ${badgeClass}">${item.status}</span>
                </div>
            </div>`;

        card.addEventListener('click', () => openModal(item));
        inventoryGrid.appendChild(card);
    });
}

// =============================================
//  Skeletons
// =============================================
function showSkeletons(count = 6) {
    inventoryGrid.innerHTML = Array.from({ length: count }, () => `
        <div class="skeleton-card">
            <div class="skel skel-icon"></div>
            <div class="skel-lines">
                <div class="skel skel-title"></div>
                <div class="skel skel-cat"></div>
                <div class="skel skel-badge"></div>
            </div>
        </div>`).join('');
}

// =============================================
//  Summary chips
// =============================================
function updateSummaryChips(items) {
    document.getElementById('totalCount').textContent = items.length;
    document.getElementById('availCount').textContent = items.filter(i => i.status === 'Available').length;
    document.getElementById('outCount').textContent   = items.filter(i => i.status === 'Out of Stock').length;
}

// =============================================
//  Filters
// =============================================
function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();

    // Show the borrower notice only while filtering to Lendable items
    lendableNotice.classList.toggle('hidden', activeItemType !== 'Lendable');

    const filtered = allComponents.filter(item => {
        const matchSearch   = item.itemName.toLowerCase().includes(query) ||
                              item.category.toLowerCase().includes(query);
        const matchCategory = activeFilter   === 'All' ||
                              item.category.toLowerCase().includes(activeFilter.toLowerCase());
        const matchType     = activeItemType === 'All' ||
                              item.itemType  === activeItemType;
        return matchSearch && matchCategory && matchType;
    });

    displayComponents(filtered);
}

searchInput.addEventListener('input', applyFilters);

filterRow.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    if ('itemtype' in btn.dataset) {
        document.querySelectorAll('.filter-btn[data-itemtype]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeItemType = btn.dataset.itemtype;
    } else {
        document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
    }

    applyFilters();
});

// =============================================
//  Modal
// =============================================
function openModal(item) {
    // Icon — larger size for modal
    const modalIconEl = document.getElementById('modalIcon');
    modalIconEl.innerHTML = getModalIcon(item.iconUrl, item.category);

    document.getElementById('modalTitle').textContent    = item.itemName;
    document.getElementById('modalCategory').textContent = item.category;
    document.getElementById('modalQty').textContent      = item.quantity;

    const statusEl   = document.getElementById('modalStatus');
    const badgeClass = item.status === 'Out of Stock' ? 'out-of-stock' : 'available';
    statusEl.innerHTML = `<span class="status-badge ${badgeClass}">${item.status}</span>`;

    // Item type
    const typeEl = document.getElementById('modalItemType');
    if (typeEl) {
        const isSellable = item.itemType === 'Sellable';
        typeEl.innerHTML = isSellable
            ? `<span class="item-type-badge sellable">🛒 Sellable</span>`
            : `<span class="item-type-badge lendable">🔄 Lendable</span>`;
    }

    // Price — only for Sellable
    const priceRow = document.getElementById('modalPriceRow');
    const priceEl  = document.getElementById('modalPrice');
    if (priceRow && priceEl) {
        if (item.itemType === 'Sellable' && item.price !== null && item.price !== undefined) {
            priceRow.classList.remove('hidden');
            priceEl.textContent = `₱${Number(item.price).toFixed(2)}`;
        } else {
            priceRow.classList.add('hidden');
        }
    }

    modalOverlay.classList.add('open');
    modalClose.focus();
}

function closeModal() { modalOverlay.classList.remove('open'); }

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeModal();
    closeReviewModal();
    closeReviewDetailsModal();
    thankYouOverlay.classList.remove('open');
});

// =============================================
//  Nav status
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
//  Review — average rating + count
// =============================================
async function fetchReviewStats() {
    try {
        const res  = await fetch(`${GOOGLE_SHEET_API}?action=reviewStats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const avg   = Number(data.average) || 0;
        const count = Number(data.count) || 0;

        reviewAvgEl.textContent   = count > 0 ? `${avg.toFixed(1)} ★` : '— ★';
        reviewCountEl.textContent = `${count} review${count === 1 ? '' : 's'}`;

    } catch (err) {
        console.error('[EE Lab] Failed to load review stats:', err);
        reviewAvgEl.textContent   = '— ★';
        reviewCountEl.textContent = '— reviews';
    }
}

// =============================================
//  Review modal — open / close
// =============================================
function openReviewModal() {
    selectedStars = 0;
    updateStarDisplay();
    reviewSubmitBtn.disabled = true;
    reviewModalOverlay.classList.add('open');
}

function closeReviewModal() {
    reviewModalOverlay.classList.remove('open');
}

reviewBtn.addEventListener('click', () => {
    if (sessionStorage.getItem(REVIEW_SESSION_KEY)) return; // already reviewed this visit
    openReviewModal();
});

reviewModalClose.addEventListener('click', closeReviewModal);
reviewModalOverlay.addEventListener('click', e => { if (e.target === reviewModalOverlay) closeReviewModal(); });

// =============================================
//  Star picker
// =============================================
function updateStarDisplay(hoverValue = 0) {
    const value = hoverValue || selectedStars;
    starPicker.querySelectorAll('.star').forEach(star => {
        star.classList.toggle('filled', Number(star.dataset.value) <= value);
    });
}

starPicker.addEventListener('click', e => {
    const star = e.target.closest('.star');
    if (!star) return;
    selectedStars = Number(star.dataset.value);
    updateStarDisplay();
    reviewSubmitBtn.disabled = selectedStars < 1;
});

starPicker.addEventListener('mouseover', e => {
    const star = e.target.closest('.star');
    if (star) updateStarDisplay(Number(star.dataset.value));
});

starPicker.addEventListener('mouseleave', () => updateStarDisplay());

// =============================================
//  Star picker submit — moves to the details step
//  (name + comment are optional, collected next)
//  Nothing is sent to the server yet.
// =============================================
reviewSubmitBtn.addEventListener('click', () => {
    if (selectedStars < 1) return;
    closeReviewModal();
    openReviewDetailsModal();
});

// =============================================
//  Review Details modal — open / close
// =============================================
function openReviewDetailsModal() {
    reviewNameInput.value    = '';
    reviewCommentInput.value = '';
    reviewDetailsOverlay.classList.add('open');
}

function closeReviewDetailsModal() {
    reviewDetailsOverlay.classList.remove('open');
}

reviewDetailsClose.addEventListener('click', closeReviewDetailsModal);
reviewDetailsOverlay.addEventListener('click', e => { if (e.target === reviewDetailsOverlay) closeReviewDetailsModal(); });

// =============================================
//  Submit review — fires the actual POST, carrying
//  the stars picked earlier plus whatever name/comment
//  (if any) were typed here. Blank fields are sent as
//  empty strings, so those sheet columns stay empty.
// =============================================
reviewDetailsSubmitBtn.addEventListener('click', async () => {
    reviewDetailsSubmitLabel.classList.add('hidden');
    reviewDetailsSubmitSpinner.classList.remove('hidden');
    reviewDetailsSubmitBtn.disabled = true;

    const reviewerName = reviewNameInput.value.trim();
    const comment       = reviewCommentInput.value.trim();

    try {
        // Google Apps Script requires no-cors POST
        await fetch(GOOGLE_SHEET_API, {
            method:  'POST',
            mode:    'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({
                formType: 'review',
                stars:    selectedStars,
                name:     reviewerName,
                comment:  comment,
            }).toString(),
        });

        sessionStorage.setItem(REVIEW_SESSION_KEY, '1');
        closeReviewDetailsModal();
        thankYouOverlay.classList.add('open');
        lockReviewButton();
        fetchReviewStats();

    } catch (err) {
        console.error('[EE Lab] Review submit failed:', err);
        alert('Could not submit your review. Check your connection and try again.');
    } finally {
        reviewDetailsSubmitLabel.classList.remove('hidden');
        reviewDetailsSubmitSpinner.classList.add('hidden');
        reviewDetailsSubmitBtn.disabled = false;
    }
});

thankYouCloseBtn.addEventListener('click', () => thankYouOverlay.classList.remove('open'));

// =============================================
//  Once-per-visit lock
// =============================================
function lockReviewButton() {
    reviewBtn.disabled    = true;
    reviewBtn.textContent = '✓ Review Submitted';
}

function initReviewState() {
    if (sessionStorage.getItem(REVIEW_SESSION_KEY)) lockReviewButton();
}

window.addEventListener('load', () => {
    fetchLiveInventory();
    fetchReviewStats();
    initReviewState();
});