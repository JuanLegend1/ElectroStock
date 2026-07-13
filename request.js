// =============================================
//  EE Lab — request.js
// =============================================

// 🔧 Same Apps Script URL — it handles both GET (inventory) and POST (requests)
const GOOGLE_SHEET_API = "https://script.google.com/macros/s/AKfycbxZR1rKeC8aZkvYTxh84gYpM98cQosboAcbvBm8mtA_cSwDwNP6ytdRAXdJackwNXah/exec";

// --- State ---
let currentType = 'Borrow';

// --- DOM refs ---
const typeTabs        = document.getElementById('typeTabs');
const itemSelectGroup = document.getElementById('itemSelectGroup');
const itemSelect      = document.getElementById('itemSelect');
const itemTextGroup   = document.getElementById('itemTextGroup');
const submitBtn       = document.getElementById('submitBtn');
const submitLabel     = document.getElementById('submitLabel');
const submitSpinner   = document.getElementById('submitSpinner');
const successOverlay  = document.getElementById('successOverlay');
const successMessage  = document.getElementById('successMessage');
const newRequestBtn   = document.getElementById('newRequestBtn');
const quantityInput   = document.getElementById('quantity');
const lendableNotice  = document.getElementById('lendableNotice');

// =============================================
//  Fetch inventory and populate the dropdown
// =============================================
async function loadInventory() {
    itemSelect.innerHTML = '<option value="" disabled selected>— Loading items\u2026 —</option>';
    itemSelect.disabled = true;

    try {
        const res  = await fetch(`${GOOGLE_SHEET_API}?action=inventory`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.error) throw new Error(data.error);

        const items = Array.isArray(data) ? data : [];

        if (items.length === 0) {
            itemSelect.innerHTML = '<option value="" disabled selected>— No items available —</option>';
            itemSelect.disabled = false;
            return;
        }

        // Group by category
        const grouped = {};
        items.forEach(item => {
            const cat = item.category || 'Other';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        });

        // Build dropdown
        itemSelect.innerHTML = '<option value="" disabled selected>— Select a component —</option>';
        Object.entries(grouped).forEach(([category, catItems]) => {
            const group = document.createElement('optgroup');
            group.label = category;
            catItems.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.itemName;
                opt.textContent = item.itemName;
                if (item.quantity !== undefined) {
                    opt.textContent += ` (${item.quantity} in stock)`;
                    opt.dataset.qty = item.quantity;
                }
                // Store itemType so we can lock tabs on selection
                opt.dataset.itemType = item.itemType || 'Lendable';
                group.appendChild(opt);
            });
            itemSelect.appendChild(group);
        });

        itemSelect.disabled = false;

    } catch (err) {
        console.error('[EE Lab] Failed to load inventory:', err);
        itemSelect.innerHTML = '<option value="" disabled selected>— Failed to load items —</option>';
        itemSelect.disabled = false;
    }
}

// =============================================
//  Lock / unlock tabs based on selected item type
//  Lendable  → force Borrow, hide Buy
//  Sellable  → force Buy, hide Borrow
//  (no selection) → restore all tabs
// =============================================
function applyItemTypeLock() {
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    const itemType    = selectedOpt ? selectedOpt.dataset.itemType : null;

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
    const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
    const stockQty     = selectedOpt ? Number(selectedOpt.dataset.qty) : NaN;

    if (currentType !== 'Request New' && selectedOpt && !isNaN(stockQty)) {
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
// (we only call this when already on Borrow/Buy, so the dropdown stays visible)
function setActiveTab(type) {
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`.type-tab[data-type="${type}"]`);
    if (tab) tab.classList.add('active');
    currentType = type;
    // Keep item select visible (Borrow/Buy both use it)
    itemSelectGroup.classList.remove('hidden');
    itemTextGroup.classList.add('hidden');
    lendableNotice.classList.toggle('hidden', currentType !== 'Borrow');
    clearErrors();
}

// React to item selection changes
itemSelect.addEventListener('change', () => {
    applyItemTypeLock();
    updateQuantityConstraint();
});

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
//  Validation
// =============================================
function validateForm() {
    let valid = true;

    const fields = [
        { id: 'studentName',    msg: 'Please enter your full name.' },
        { id: 'studentSection', msg: 'Please enter your course, year level, and section.' },
        { id: 'quantity',       msg: 'Please enter a quantity.' },
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

    // Item field — depends on type
    if (currentType === 'Request New') {
        const el = document.getElementById('itemText');
        if (!el.value.trim()) {
            markError(el, 'Please enter the item name.');
            valid = false;
        } else {
            clearError(el);
        }
    } else {
        const el = document.getElementById('itemSelect');
        if (!el.value) {
            markError(el, 'Please select an item.');
            valid = false;
        } else {
            clearError(el);

            // Quantity can't exceed what's currently in stock for this item
            const selectedOpt = itemSelect.options[itemSelect.selectedIndex];
            const stockQty     = selectedOpt ? Number(selectedOpt.dataset.qty) : NaN;
            const qtyVal       = Number(quantityInput.value);

            if (!isNaN(stockQty) && qtyVal > stockQty) {
                markError(quantityInput, `Only ${stockQty} unit(s) of this item left in stock.`);
                valid = false;
            }
        }
    }

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
//  Submit
// =============================================
submitBtn.addEventListener('click', async () => {
    if (!validateForm()) return;

    // Strip the "(N in stock)" suffix added for display purposes
    let itemName = currentType === 'Request New'
        ? document.getElementById('itemText').value.trim()
        : document.getElementById('itemSelect').value.replace(/\s*\(\d+ in stock\)$/, '').trim();

    const payload = {
        type:     currentType,
        name:     document.getElementById('studentName').value.trim(),
        section:  document.getElementById('studentSection').value.trim(),
        item:     itemName,
        quantity: document.getElementById('quantity').value,
        reason:   document.getElementById('reason').value.trim(),
    };

    // Show loading state
    submitLabel.classList.add('hidden');
    submitSpinner.classList.remove('hidden');
    submitBtn.disabled = true;

    try {
        // Google Apps Script requires no-cors POST
        await fetch(GOOGLE_SHEET_API, {
            method:  'POST',
            mode:    'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams(payload).toString(),
        });

        // no-cors means we can't read the response body,
        // but if it didn't throw, the request reached the server
        showSuccess(payload);

    } catch (err) {
        console.error('[EE Lab] Submit failed:', err);
        alert('Could not submit your request. Check your connection and try again.');
    } finally {
        submitLabel.classList.remove('hidden');
        submitSpinner.classList.add('hidden');
        submitBtn.disabled = false;
    }
});

// =============================================
//  Success overlay
// =============================================
function showSuccess(payload) {
    const typeLabel = {
        'Borrow':      'borrow request for',
        'Buy':         'purchase request for',
        'Request New': 'new item request for',
    }[payload.type] || 'request for';

    successMessage.textContent =
        `Your ${typeLabel} "${payload.item}" has been logged. The lab in-charge will review it during lab hours.`;

    // Add the visit reminder if not already present
    let reminder = document.getElementById('successReminder');
    if (!reminder) {
        reminder = document.createElement('p');
        reminder.id = 'successReminder';
        reminder.style.cssText = [
            'margin: .75rem 0 0',
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
        successMessage.insertAdjacentElement('afterend', reminder);
    }

    successOverlay.classList.add('open');
}

newRequestBtn.addEventListener('click', () => {
    successOverlay.classList.remove('open');
    // Reset form and unlock tabs
    document.getElementById('studentName').value    = '';
    document.getElementById('studentSection').value = '';
    document.getElementById('itemSelect').value     = '';
    document.getElementById('itemText').value       = '';
    quantityInput.value = '1';
    quantityInput.removeAttribute('max');
    quantityInput.title = '';
    document.getElementById('reason').value         = '';
    // Release any item-type lock
    document.querySelector('.type-tab[data-type="Borrow"]').disabled = false;
    document.querySelector('.type-tab[data-type="Borrow"]').title    = '';
    document.querySelector('.type-tab[data-type="Buy"]').disabled    = false;
    document.querySelector('.type-tab[data-type="Buy"]').title       = '';
    setActiveTab('Borrow');
    clearErrors();
});

// =============================================
//  Boot — load inventory on page load
// =============================================
window.addEventListener('load', loadInventory);