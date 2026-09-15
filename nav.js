// =============================================
//  EE Lab — nav.js
//  Shared across every page. Handles:
//    1. the ☰ hamburger slide-out menu
//    2. the footer rating strip (average ★ + count)
//  Loaded BEFORE app.js / request.js / logs.js.
// =============================================

// Deliberately a different const name from GOOGLE_SHEET_API / LOGS_API —
// classic scripts share one global scope, and re-declaring a const throws.
const NAV_API = "https://script.google.com/macros/s/AKfycbx6ygxikoxGL6sVGj2TVwuwsnMjqk4atuUSGoCUZBvRqKOpVG6u_lg8mzWprSk4Jx04/exec";

// =============================================
//  Hamburger menu
// =============================================
(function initNavMenu() {
    const toggle   = document.getElementById('navToggle');
    const menu     = document.getElementById('navMenu');
    const backdrop = document.getElementById('navBackdrop');
    const closeBtn = document.getElementById('navMenuClose');
    if (!toggle || !menu || !backdrop) return;

    let lastFocused = null;

    function openMenu() {
        lastFocused = document.activeElement;
        menu.classList.add('open');
        backdrop.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
        document.body.classList.add('nav-open');
        // Focus the first thing in the panel so keyboard users land inside it
        const first = menu.querySelector('a, button');
        if (first) first.focus();
    }

    function closeMenu() {
        menu.classList.remove('open');
        backdrop.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
        if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    }

    function isOpen() { return menu.classList.contains('open'); }

    toggle.addEventListener('click', () => (isOpen() ? closeMenu() : openMenu()));
    backdrop.addEventListener('click', closeMenu);
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);

    // Any nav item click closes the panel. Links navigate away anyway; the
    // Rate Us button on the dashboard opens a modal, so the panel must get
    // out of its way.
    menu.addEventListener('click', e => {
        if (e.target.closest('a, .nav-rate-btn')) closeMenu();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && isOpen()) closeMenu();
    });

    // Keep Tab inside the panel while it's open
    menu.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        const items = Array.from(menu.querySelectorAll('a, button'))
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0];
        const last  = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault(); first.focus();
        }
    });
})();

// =============================================
//  Footer rating strip
//  Called on load here, and again by app.js right
//  after a review is submitted so the number updates
//  without a refresh.
// =============================================
function renderFooterStars(avg) {
    const el = document.getElementById('footerStars');
    if (!el) return;
    const rounded = Math.round(avg);      // half-stars read as noise at this size
    el.innerHTML = [1, 2, 3, 4, 5]
        .map(n => `<span class="${n <= rounded ? 'on' : 'off'}">★</span>`)
        .join('');
}

async function fetchReviewStats() {
    const avgEl   = document.getElementById('reviewAvg');
    const countEl = document.getElementById('reviewCount');
    if (!avgEl && !countEl) return;

    try {
        const res = await fetch(`${NAV_API}?action=reviewStats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const avg   = Number(data.average) || 0;
        const count = Number(data.count)   || 0;

        if (count > 0) {
            if (avgEl)   avgEl.textContent   = avg.toFixed(1);
            if (countEl) countEl.textContent = `${count} review${count === 1 ? '' : 's'} submitted`;
            renderFooterStars(avg);
        } else {
            if (avgEl)   avgEl.textContent   = '—';
            if (countEl) countEl.textContent = 'No reviews yet';
            renderFooterStars(0);
        }

    } catch (err) {
        console.error('[EE Lab] Failed to load review stats:', err);
        if (avgEl)   avgEl.textContent   = '—';
        if (countEl) countEl.textContent = 'Ratings unavailable';
        renderFooterStars(0);
    }
}

window.addEventListener('load', fetchReviewStats);