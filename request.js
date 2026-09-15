// =============================================
//  EE Lab — request.js
// =============================================

// 🔧 Same Apps Script URL — it handles both GET (inventory) and POST (requests)
const GOOGLE_SHEET_API = "https://script.google.com/macros/s/AKfycbx6ygxikoxGL6sVGj2TVwuwsnMjqk4atuUSGoCUZBvRqKOpVG6u_lg8mzWprSk4Jx04/exec";

// --- State ---
let currentType = 'Borrow';
// Items the user has added, waiting to be submitted together.
// Each entry: { item, quantity, type, price }
let cartItems = [];

// Combobox state
let inventoryItems     = [];   // full list fetched from the sheet
let selectedItem       = null; // the currently chosen item object, or null
let filteredFlat       = [];   // flat list of *selectable* items in the panel right now (keyboard nav)
let activeOptionIndex  = -1;   // index into filteredFlat currently highlighted

// --- DOM refs ---
const typeTabs          = document.getElementById('typeTabs');
const itemSelectGroup   = document.getElementById('itemSelectGroup');
const itemCombobox      = document.getElementById('itemCombobox');
const itemSearchInput   = document.getElementById('itemSearchInput');
const comboboxClearBtn  = document.getElementById('comboboxClear');
const comboboxPanel     = document.getElementById('comboboxPanel');
const itemTextGroup     = document.getElementById('itemTextGroup');
const itemTextInput     = document.getElementById('itemText');
const addItemBtn        = document.getElementById('addItemBtn');
const cartSection       = document.getElementById('cartSection');
const cartList          = document.getElementById('cartList');
const cartCountEl       = document.getElementById('cartCount');
const cartTotalRow      = document.getElementById('cartTotalRow');
const cartTotalValue    = document.getElementById('cartTotalValue');
const submitBtn         = document.getElementById('submitBtn');
const submitLabel       = document.getElementById('submitLabel');
const submitSpinner     = document.getElementById('submitSpinner');
const successOverlay    = document.getElementById('successOverlay');
const successMessage    = document.getElementById('successMessage');
const successItemsList  = document.getElementById('successItemsList');
const successTotal      = document.getElementById('successTotal');
const newRequestBtn     = document.getElementById('newRequestBtn');
const quantityInput     = document.getElementById('quantity');
const lendableNotice    = document.getElementById('lendableNotice');

// Shared badge look-up used for both the cart list and the success popup
const TYPE_META = {
    'Borrow':      { icon: '🔄', cls: 'borrow',      label: 'Borrow' },
    'Buy':         { icon: '🛒', cls: 'buy',          label: 'Buy' },
    'Request New': { icon: '📋', cls: 'request-new',  label: 'New' },
};

// =============================================
//  Fetch inventory (no more building a giant <select> —
//  items are rendered on demand as the user searches)
// =============================================
async function loadInventory() {
    itemSearchInput.disabled     = true;
    itemSearchInput.placeholder  = '— Loading items… —';

    try {
        const res  = await fetch(`${GOOGLE_SHEET_API}?action=inventory`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        inventoryItems = Array.isArray(data) ? data : [];

        itemSearchInput.placeholder = inventoryItems.length === 0
            ? '— No items available —'
            : '— Search for a component —';
        itemSearchInput.disabled = inventoryItems.length === 0;

        // Handoff from the dashboard's "Buy This" / "Borrow This" button
        applyIncomingItemFromUrl();

    } catch (err) {
        console.error('[EE Lab] Failed to load inventory:', err);
        itemSearchInput.placeholder = '— Failed to load items —';
        itemSearchInput.disabled = true;
    }
}

// =============================================
//  Combobox — filter + render the panel
// =============================================
function renderComboboxPanel(query) {
    const q = query.trim().toLowerCase();

    const matches = q === ''
        ? inventoryItems
        : inventoryItems.filter(item =>
            item.itemName.toLowerCase().includes(q) ||
            (item.category || '').toLowerCase().includes(q)
          );

    if (matches.length === 0) {
        comboboxPanel.innerHTML = `<p class="combobox-empty">No items match “${escHtml(query.trim())}”.</p>`;
        filteredFlat = [];
        activeOptionIndex = -1;
        return;
    }

    // Group by category, preserving first-seen order
    const grouped = {};
    matches.forEach(item => {
        const cat = item.category || 'Other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(item);
    });

    filteredFlat = [];
    let html = '';

    Object.entries(grouped).forEach(([category, items]) => {
        html += `<div class="combobox-group-label">${escHtml(category)}</div>`;
        items.forEach(item => {
            const outOfStock = Number(item.quantity) === 0;
            const priceHtml = (item.itemType === 'Sellable' && item.price !== null && item.price !== undefined && item.price !== '')
                ? `<span class="combobox-option-price">₱${Number(item.price).toFixed(2)}</span>`
                : '';
            const stockLabel = outOfStock ? 'Out of stock' : `${item.quantity} in stock`;

            if (!outOfStock) filteredFlat.push(item);

            html += `
                <div class="combobox-option${outOfStock ? ' out-of-stock' : ''}" data-item="${escHtml(item.itemName)}" role="option">
                    <span class="combobox-option-name">${escHtml(item.itemName)}</span>
                    <span class="combobox-option-meta">
                        ${priceHtml}
                        <span class="combobox-option-stock">${stockLabel}</span>
                    </span>
                </div>
            `;
        });
    });

    comboboxPanel.innerHTML = html;
    activeOptionIndex = -1;
}

function openComboboxPanel() {
    if (itemSearchInput.disabled) return;
    renderComboboxPanel(itemSearchInput.value);
    comboboxPanel.classList.remove('hidden');
}

function closeComboboxPanel() {
    comboboxPanel.classList.add('hidden');
    activeOptionIndex = -1;
}

function highlightActiveOption() {
    const options = Array.from(comboboxPanel.querySelectorAll('.combobox-option:not(.out-of-stock)'));
    options.forEach((el, i) => el.classList.toggle('active', i === activeOptionIndex));
    if (activeOptionIndex >= 0 && options[activeOptionIndex]) {
        options[activeOptionIndex].scrollIntoView({ block: 'nearest' });
    }
}

// Select an item — shared by mouse click, Enter key, and the dashboard handoff
function selectItem(item) {
    selectedItem = item;
    itemSearchInput.value = item.itemName;
    comboboxClearBtn.classList.remove('hidden');
    closeComboboxPanel();
    applyItemTypeLock();
    updateQuantityConstraint();
    clearErrors();
}

function clearSelection() {
    selectedItem = null;
    itemSearchInput.value = '';
    comboboxClearBtn.classList.add('hidden');
    applyItemTypeLock();
    updateQuantityConstraint();
}

itemSearchInput.addEventListener('focus', openComboboxPanel);

itemSearchInput.addEventListener('input', () => {
    // Typing invalidates whatever was selected before
    if (selectedItem && itemSearchInput.value !== selectedItem.itemName) {
        selectedItem = null;
        applyItemTypeLock();
        updateQuantityConstraint();
    }
    comboboxClearBtn.classList.toggle('hidden', itemSearchInput.value.length === 0);
    renderComboboxPanel(itemSearchInput.value);
    comboboxPanel.classList.remove('hidden');
    clearError(itemSearchInput);
});

itemSearchInput.addEventListener('keydown', e => {
    if (comboboxPanel.classList.contains('hidden') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        openComboboxPanel();
        return;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredFlat.length === 0) return;
        activeOptionIndex = (activeOptionIndex + 1) % filteredFlat.length;
        highlightActiveOption();
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredFlat.length === 0) return;
        activeOptionIndex = (activeOptionIndex - 1 + filteredFlat.length) % filteredFlat.length;
        highlightActiveOption();
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const pick = filteredFlat[activeOptionIndex] || (filteredFlat.length === 1 ? filteredFlat[0] : null);
        if (pick) selectItem(pick);
    } else if (e.key === 'Escape') {
        closeComboboxPanel();
    }
});

comboboxPanel.addEventListener('click', e => {
    const opt = e.target.closest('.combobox-option');
    if (!opt || opt.classList.contains('out-of-stock')) return;
    const item = inventoryItems.find(i => i.itemName === opt.dataset.item);
    if (item) selectItem(item);
});

comboboxClearBtn.addEventListener('click', () => {
    clearSelection();
    itemSearchInput.focus();
});

// Close the panel when clicking anywhere outside the combobox
document.addEventListener('click', e => {
    if (!itemCombobox.contains(e.target)) closeComboboxPanel();
});

// =============================================
//  Lock / unlock tabs based on selected item type
//  Lendable  → force Borrow, hide Buy
//  Sellable  → force Buy, hide Borrow
//  (no selection) → restore all tabs
// =============================================
function applyItemTypeLock() {
    const itemType = selectedItem ? (selectedItem.itemType || 'Lendable') : null;

    const borrowTab = document.querySelector('.type-tab[data-type="Borrow"]');
    const buyTab    = document.querySelector('.type-tab[data-type="Buy"]');

    if (itemType === 'Lendable') {
        // Lock to Borrow
        setActiveTab('Borrow');
        borrowTab.disabled = true;
        borrowTab.title    = 'This item can only be borrowed';
        buyTab.disabled    = true;
        buyTab.title       = 'This item can only be borrowed';
    } else if (itemType === 'Sellable') {
        // Lock to Buy
        setActiveTab('Buy');
        borrowTab.disabled = true;
        borrowTab.title    = 'This item can only be purchased';
        buyTab.disabled    = true;
        buyTab.title       = 'This item can only be purchased';
    } else {
        // No item selected — restore all tabs
        borrowTab.disabled = false;
        borrowTab.title    = '';
        buyTab.disabled    = false;
        buyTab.title       = '';
    }
}

// =============================================
//  Cap the Quantity field to the selected item's stock
//  (Borrow/Buy only — Request New has no stock to check)
// =============================================
function updateQuantityConstraint() {
    const stockQty = selectedItem ? Number(selectedItem.quantity) : NaN;

    if (currentType !== 'Request New' && selectedItem && !isNaN(stockQty)) {
        quantityInput.max   = stockQty;
        quantityInput.title = `Only ${stockQty} unit(s) in stock`;
        // If the currently typed quantity now exceeds the new max, clamp it
        if (Number(quantityInput.value) > stockQty) {
            quantityInput.value = stockQty;
        }
    } else {
        quantityInput.removeAttribute('max');
        quantityInput.title = '';
    }
}

// Live-clamp while typing so the field can never visually hold more than what's in stock
quantityInput.addEventListener('input', () => {
    const max = Number(quantityInput.max);
    if (quantityInput.max !== '' && !isNaN(max) && Number(quantityInput.value) > max) {
        quantityInput.value = max;
    }
    clearError(quantityInput);
});

// Helper: switch active tab without triggering the full click handler's item-group toggle
// (we only call this when already on Borrow/Buy, so the combobox stays visible)
function setActiveTab(type) {
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`.type-tab[data-type="${type}"]`);
    if (tab) tab.classList.add('active');
    currentType = type;
    // Keep item search visible (Borrow/Buy both use it)
    itemSelectGroup.classList.remove('hidden');
    itemTextGroup.classList.add('hidden');
    lendableNotice.classList.toggle('hidden', currentType !== 'Borrow');
    clearErrors();
}

// =============================================
//  Switch request type tabs
// =============================================
typeTabs.addEventListener('click', e => {
    const tab = e.target.closest('.type-tab');
    if (!tab || tab.disabled) return;

    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentType = tab.dataset.type;
    lendableNotice.classList.toggle('hidden', currentType !== 'Borrow');

    if (currentType === 'Request New') {
        // Switching to Request New: clear any item-type lock
        const borrowTab = document.querySelector('.type-tab[data-type="Borrow"]');
        const buyTab    = document.querySelector('.type-tab[data-type="Buy"]');
        borrowTab.disabled = false;
        borrowTab.title    = '';
        buyTab.disabled    = false;
        buyTab.title       = '';
        itemSelectGroup.classList.add('hidden');
        itemTextGroup.classList.remove('hidden');
    } else {
        itemSelectGroup.classList.remove('hidden');
        itemTextGroup.classList.add('hidden');
        // Re-apply lock in case the selected item enforces a type
        applyItemTypeLock();
    }

    updateQuantityConstraint();
    clearErrors();
});

// =============================================
//  Validation — item picker (run when clicking "Add")
// =============================================
function validateItemPicker() {
    let valid = true;
    let itemName = '';

    if (currentType === 'Request New') {
        if (!itemTextInput.value.trim()) {
            markError(itemTextInput, 'Please enter the item name.');
            valid = false;
        } else {
            clearError(itemTextInput);
            itemName = itemTextInput.value.trim();
        }
    } else {
        if (!selectedItem) {
            markError(itemSearchInput, 'Please select an item from the list.');
            valid = false;
        } else {
            clearError(itemSearchInput);
            itemName = selectedItem.itemName;
        }
    }

    const qtyVal = Number(quantityInput.value);
    if (!quantityInput.value || isNaN(qtyVal) || qtyVal < 1) {
        markError(quantityInput, 'Please enter a valid quantity.');
        valid = false;
    } else {
        clearError(quantityInput);

        // Quantity, combined with any of this same item already added,
        // can't exceed what's currently in stock
        if (currentType !== 'Request New' && selectedItem) {
            const stockQty = Number(selectedItem.quantity);

            if (!isNaN(stockQty)) {
                const alreadyInCart = cartItems
                    .filter(c => c.item === itemName && c.type === currentType)
                    .reduce((sum, c) => sum + c.quantity, 0);

                if (alreadyInCart + qtyVal > stockQty) {
                    const remaining = Math.max(0, stockQty - alreadyInCart);
                    markError(quantityInput, `Only ${remaining} more unit(s) of this item can be added (${stockQty} in stock).`);
                    valid = false;
                }
            }
        }
    }

    return valid;
}

// =============================================
//  Validation — shared request details (run on final submit)
// =============================================
function validateRequestDetails() {
    let valid = true;

    const fields = [
        { id: 'studentName',    msg: 'Please enter your full name.' },
        { id: 'studentSection', msg: 'Please enter your course, year level, and section.' },
        { id: 'reason',         msg: 'Please enter a reason or purpose.' },
    ];

    fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el.value.trim()) {
            markError(el, f.msg);
            valid = false;
        } else {
            clearError(el);
        }
    });

    return valid;
}

function markError(el, msg) {
    el.classList.add('error');
    const group = el.closest('.field-group');
    if (group) {
        group.classList.add('has-error');
        let errEl = group.querySelector('.error-msg');
        if (!errEl) {
            errEl = document.createElement('span');
            errEl.className = 'error-msg';
            group.appendChild(errEl);
        }
        errEl.textContent = msg;
    }
}

function clearError(el) {
    el.classList.remove('error');
    const group = el.closest('.field-group');
    if (group) group.classList.remove('has-error');
}

function clearErrors() {
    document.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));
}

// =============================================
//  Add item to the cart
// =============================================
function addCurrentItemToCart() {
    if (!validateItemPicker()) return false;

    const itemName = currentType === 'Request New'
        ? itemTextInput.value.trim()
        : selectedItem.itemName;

    const quantity = Math.max(1, parseInt(quantityInput.value, 10) || 1);

    // Unit price, if this item has one (only Sellable/Buy items carry one)
    let price = null;
    if (currentType !== 'Request New' && selectedItem) {
        price = (selectedItem.price !== null && selectedItem.price !== undefined && selectedItem.price !== '')
            ? Number(selectedItem.price) : null;
    }

    cartItems.push({ item: itemName, quantity, type: currentType, price });
    renderCart();
    resetItemPicker();
    return true;
}

addItemBtn.addEventListener('click', addCurrentItemToCart);

// Resets just the item-picker row (not the whole form) so the next
// item can be added right away. Stays on the same tab for convenience.
function resetItemPicker() {
    selectedItem = null;
    itemSearchInput.value = '';
    comboboxClearBtn.classList.add('hidden');
    closeComboboxPanel();
    itemTextInput.value   = '';
    quantityInput.value   = '1';
    quantityInput.removeAttribute('max');
    quantityInput.title   = '';
    applyItemTypeLock(); // nothing selected now, so this just unlocks the tabs
    clearErrors();
}

// =============================================
//  Render the cart list + keep Submit enabled state in sync
// =============================================
// Sums the cost of Buy items only — Borrow/Request New never carry a charge
function computeBuyTotal(items) {
    return items
        .filter(c => c.type === 'Buy' && c.price !== null && !isNaN(c.price))
        .reduce((sum, c) => sum + (c.price * c.quantity), 0);
}

function renderCart() {
    cartCountEl.textContent = cartItems.length;
    cartSection.classList.toggle('hidden', cartItems.length === 0);
    submitBtn.disabled = cartItems.length === 0;

    cartList.innerHTML = cartItems.map((entry, idx) => {
        const meta = TYPE_META[entry.type] || TYPE_META['Buy'];
        const hasPrice = entry.type === 'Buy' && entry.price !== null && !isNaN(entry.price);
        const qtyLabel = hasPrice
            ? `×${entry.quantity} · ₱${(entry.price * entry.quantity).toFixed(2)}`
            : `×${entry.quantity}`;
        return `
            <li class="cart-item">
                <div class="cart-item-info">
                    <span class="cart-item-badge ${meta.cls}">${meta.icon} ${meta.label}</span>
                    <span class="cart-item-name" title="${escHtml(entry.item)}">${escHtml(entry.item)}</span>
                </div>
                <span class="cart-item-qty">${qtyLabel}</span>
                <button type="button" class="cart-item-remove" data-index="${idx}" aria-label="Remove ${escHtml(entry.item)}">✕</button>
            </li>
        `;
    }).join('');

    const buyTotal = computeBuyTotal(cartItems);
    if (buyTotal > 0) {
        cartTotalValue.textContent = `₱${buyTotal.toFixed(2)}`;
        cartTotalRow.classList.remove('hidden');
    } else {
        cartTotalRow.classList.add('hidden');
    }
}

// Remove an item from the cart
cartList.addEventListener('click', e => {
    const btn = e.target.closest('.cart-item-remove');
    if (!btn) return;
    const idx = Number(btn.dataset.index);
    cartItems.splice(idx, 1);
    renderCart();
});

// =============================================
//  Submit — posts every cart item as its own row,
//  sharing the same name / section / reason
// =============================================
submitBtn.addEventListener('click', async () => {
    if (cartItems.length === 0) return;
    if (!validateRequestDetails()) return;

    const name    = document.getElementById('studentName').value.trim();
    const section = document.getElementById('studentSection').value.trim();
    const reason  = document.getElementById('reason').value.trim();

    submitLabel.classList.add('hidden');
    submitSpinner.classList.remove('hidden');
    submitBtn.disabled = true;

    try {
        // Google Apps Script requires no-cors POST — send items one at a
        // time (in order) so the server's lock isn't hit concurrently.
        for (const entry of cartItems) {
            await fetch(GOOGLE_SHEET_API, {
                method:  'POST',
                mode:    'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    new URLSearchParams({
                    type:     entry.type,
                    name,
                    section,
                    item:     entry.item,
                    quantity: entry.quantity,
                    reason,
                }).toString(),
            });
        }

        // no-cors means we can't read the response body,
        // but if it didn't throw, the requests reached the server
        showSuccess(cartItems);
        cartItems = [];
        renderCart();

    } catch (err) {
        console.error('[EE Lab] Submit failed:', err);
        alert('Could not submit your request. Check your connection and try again.');
    } finally {
        submitLabel.classList.remove('hidden');
        submitSpinner.classList.add('hidden');
        submitBtn.disabled = cartItems.length === 0;
    }
});

// =============================================
//  Success overlay — lists every item that was submitted
// =============================================
function showSuccess(items) {
    successMessage.textContent = items.length === 1
        ? 'Your request has been logged. The lab in-charge will review it during lab hours.'
        : `Your request for ${items.length} items has been logged. The lab in-charge will review it during lab hours.`;

    successItemsList.innerHTML = items.map(entry => {
        const meta = TYPE_META[entry.type] || TYPE_META['Buy'];
        const hasPrice = entry.type === 'Buy' && entry.price !== null && !isNaN(entry.price);
        const qtyLabel = hasPrice
            ? `×${entry.quantity} · ₱${(entry.price * entry.quantity).toFixed(2)}`
            : `×${entry.quantity}`;
        return `
            <li class="success-item">
                <div class="success-item-info">
                    <span class="cart-item-badge ${meta.cls}">${meta.icon} ${meta.label}</span>
                    <span class="success-item-name" title="${escHtml(entry.item)}">${escHtml(entry.item)}</span>
                </div>
                <span class="success-item-qty">${qtyLabel}</span>
            </li>
        `;
    }).join('');

    const buyTotal = computeBuyTotal(items);
    if (buyTotal > 0) {
        successTotal.textContent = `💰 Total to pay at the lab: ₱${buyTotal.toFixed(2)}`;
        successTotal.classList.remove('hidden');
    } else {
        successTotal.classList.add('hidden');
    }

    // Add the visit reminder if not already present
    let reminder = document.getElementById('successReminder');
    if (!reminder) {
        reminder = document.createElement('p');
        reminder.id = 'successReminder';
        reminder.style.cssText = [
            'margin: 0 0 1.5rem',
            'padding: .65rem 1rem',
            'background: #fef3c7',
            'border: 1.5px solid #f59e0b',
            'border-radius: 8px',
            'font-size: .88rem',
            'font-weight: 700',
            'color: #92400e',
            'line-height: 1.5',
        ].join(';');
        reminder.innerHTML = '📍 Please proceed to the EE Lab to complete the transaction.';
        successTotal.insertAdjacentElement('afterend', reminder);
    }

    successOverlay.classList.add('open');
}

newRequestBtn.addEventListener('click', () => {
    successOverlay.classList.remove('open');
    // Reset the whole form for a fresh request
    document.getElementById('studentName').value    = '';
    document.getElementById('studentSection').value = '';
    document.getElementById('reason').value          = '';
    cartItems = [];
    renderCart();
    resetItemPicker();
    // Release any item-type lock left over from the last request
    document.querySelector('.type-tab[data-type="Borrow"]').disabled = false;
    document.querySelector('.type-tab[data-type="Borrow"]').title    = '';
    document.querySelector('.type-tab[data-type="Buy"]').disabled    = false;
    document.querySelector('.type-tab[data-type="Buy"]').title       = '';
    setActiveTab('Borrow');
    clearErrors();
});

// =============================================
//  Dashboard handoff — arriving via a "Buy This" / "Borrow This"
//  button on an item's detail modal. Looks the item up in the
//  freshly-loaded inventory, selects it, and adds it to the cart
//  with quantity 1 so it's sitting there ready to go.
// =============================================
function applyIncomingItemFromUrl() {
    const params   = new URLSearchParams(location.search);
    const itemName = params.get('item');
    if (!itemName) return;

    const item = inventoryItems.find(i => i.itemName === itemName);
    if (!item || Number(item.quantity) === 0) {
        history.replaceState(null, '', location.pathname);
        return;
    }

    selectItem(item);           // sets tab + lock based on the item's type
    quantityInput.value = '1';
    addCurrentItemToCart();      // drops it straight into the cart

    history.replaceState(null, '', location.pathname); // don't re-add on refresh
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

// =============================================
//  Boot — load inventory on page load
// =============================================
window.addEventListener('load', loadInventory);