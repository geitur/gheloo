// Replaces the Nitro client loading screen with a fully custom Gheloo branded overlay.
// Manifest already scopes this content script to leet.city/hotel, so no host check needed here.
//
// Design borrows from a proven pattern (poll on an interval as a backstop, don't rely
// solely on MutationObserver firing; use real getComputedStyle/getBoundingClientRect
// visibility checks, not just querySelector truthiness) after the pure-MutationObserver
// version got stuck showing a black screen when its "is the hotel loaded" check didn't
// fire in time.
(function () {
    'use strict';
    if (window.__ghLoadingScreenStarted) return;
    window.__ghLoadingScreenStarted = true;

    const ROOT_ID = 'gh-loading-screen';
    const STYLE_ID = 'gh-loading-style';

    let root = null, barInnerEl = null, markerEl = null, percentEl = null;
    let progress = 2, everReady = false, finishing = false;
    let finishTimer = 0, removeTimer = 0, pollTimer = 0, rafQueued = false;

    // This is MAIN world — can't call chrome.runtime.getManifest() directly (see
    // core/bridge.js) — so read the real installed version off the same
    // __ghk_update_status relay core/update-toast.js already uses, instead of a hardcoded
    // string that has to be remembered and bumped by hand every release (and wasn't).
    let installedVersion = null;
    window.addEventListener('message', function (e) {
        if (e.source !== window || !e.data || e.data.type !== '__ghk_update_status') return;
        if (!e.data.installedVersion) return;
        installedVersion = e.data.installedVersion;
        const vEl = root && root.querySelector('.gh-version');
        if (vEl) vEl.textContent = 'v' + installedVersion;
    });

    function onHotel() {
        return String(location.pathname || '').indexOf('/hotel') >= 0;
    }

    function visible(el) {
        if (!el) return false;
        try {
            const cs = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0 && rect.width > 2 && rect.height > 2;
        } catch (e) { return false; }
    }

    function originalLoading() { return document.querySelector('.nitro-loading'); }

    function gameReady() {
        return (visible(document.querySelector('.nitro-hotel-view')) || visible(document.querySelector('.nitro-toolbar')))
            && !visible(originalLoading());
    }

    const STYLE = `
        @keyframes gh-spin-a { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes gh-spin-b { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes gh-pulse-ring { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes gh-orbit-dot { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes gh-bg-drift { from { transform: translate3d(0,0,0); opacity: .45; } to { transform: translate3d(22px,-16px,0); opacity: .8; } }
        @keyframes gh-glow-breathe { 0%, 100% { opacity: .6; } 50% { opacity: 1; } }

        #${ROOT_ID} { position: fixed; inset: 0; z-index: 2147483647; overflow: hidden;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            background:
                radial-gradient(ellipse at 50% 38%, rgba(108,124,255,.16) 0%, rgba(10,11,16,0) 55%),
                radial-gradient(ellipse at 18% 82%, rgba(91,156,246,.10) 0%, rgba(10,11,16,0) 50%),
                radial-gradient(ellipse at 84% 18%, rgba(108,124,255,.09) 0%, rgba(10,11,16,0) 45%),
                #0A0B10;
            gap: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            opacity: 1; transition: opacity .35s ease, visibility .35s ease; }
        #${ROOT_ID}.gh-finish { opacity: 0; visibility: hidden; pointer-events: none; }

        #${ROOT_ID} .gh-bg-glow { position: absolute; inset: 0; z-index: 0; pointer-events: none;
            background: radial-gradient(circle at 50% 42%, rgba(108,124,255,.14) 0%, transparent 45%);
            animation: gh-glow-breathe 4s ease-in-out infinite; }
        #${ROOT_ID} .gh-bg-dots { position: absolute; inset: -60px; z-index: 0; pointer-events: none; opacity: .55;
            background-image:
                radial-gradient(circle, #6C7CFF 0 1px, transparent 1.7px),
                radial-gradient(circle, #A6B0FF 0 .8px, transparent 1.5px),
                radial-gradient(circle, #376da7 0 .7px, transparent 1.4px);
            background-size: 160px 130px, 210px 175px, 100px 110px;
            background-position: 20px 15px, 90px 50px, 12px 73px;
            animation: gh-bg-drift 9s ease-in-out infinite alternate; }
        #${ROOT_ID} .gh-vignette { position: absolute; inset: 0; z-index: 0; pointer-events: none;
            background: radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.35) 100%); }

        .gh-badge-wrap { position: relative; z-index: 1; width: 220px; height: 220px; cursor: pointer;
            transition: transform 0.35s cubic-bezier(.34,1.56,.64,1), filter 0.35s ease; }
        .gh-badge-wrap:hover { transform: scale(1.08) rotate(4deg); filter: drop-shadow(0 0 22px rgba(108,124,255,.55)); }
        .gh-ring-pulse { animation: gh-pulse-ring 2.6s ease-in-out infinite; }
        .gh-badge-wrap:hover .gh-ring-pulse { animation-duration: 1.1s; }
        .gh-grid-a { transform-origin: 120px 120px; animation: gh-spin-a 16s linear infinite; }
        .gh-badge-wrap:hover .gh-grid-a { animation-duration: 4s; }
        .gh-grid-b { transform-origin: 120px 120px; animation: gh-spin-b 22s linear infinite; }
        .gh-badge-wrap:hover .gh-grid-b { animation-duration: 6s; }
        .gh-orbit { transform-origin: 120px 120px; animation: gh-orbit-dot 6s linear infinite; }
        .gh-badge-wrap:hover .gh-orbit { animation-duration: 1.5s; }

        .gh-wordmark { position: relative; z-index: 1; text-align: center; }
        .gh-wordmark .gh-title { font-size: 44px; font-weight: 700; margin: 0 0 8px; }
        .gh-wordmark .gh-part1 { color: #6C7CFF; }
        .gh-wordmark .gh-part2 { color: #5b9cf6; }
        .gh-wordmark .gh-sub { font-size: 14px; letter-spacing: 4px; color: #5c5e6b; margin: 0; }
        .gh-wordmark .gh-version { font-size: 10px; letter-spacing: 1px; color: #3a3c47; margin: 6px 0 0; }

        .gh-bar-row { position: relative; z-index: 1; width: 520px; padding-top: 24px; }
        .gh-bar-track { width: 100%; height: 14px; background: #1c1e2a; border: 1px solid #23252f;
            border-radius: 99px; overflow: hidden; }
        .gh-bar-inner { background: #6C7CFF; border-radius: 99px; height: 100%; width: 2%; transition: width 0.2s ease-out; }
        .gh-marker { position: absolute; top: 13px; width: 36px; height: 36px; margin-left: -18px; left: 2%;
            border-radius: 10px; background: #1c1e2a; border: 1px solid #6C7CFF;
            display: flex; align-items: center; justify-content: center;
            font-size: 13px; font-weight: 700; color: #6C7CFF; transition: left 0.2s ease-out; }
        .gh-percent { font-size: 15px; font-weight: 700; color: #6C7CFF; }
    `;

    function injectStyleOnce() {
        if (document.getElementById(STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = STYLE_ID;
        s.textContent = STYLE;
        document.head.appendChild(s);
    }

    function badgeSvg() {
        return `
        <svg width="220" height="220" viewBox="0 0 240 240">
            <circle class="gh-ring-pulse" cx="120" cy="120" r="70" fill="none" stroke="#6C7CFF" stroke-width="3"/>
            <g class="gh-grid-a">
                <g clip-path="url(#gh-c1)">
                    <clipPath id="gh-c1"><circle cx="120" cy="120" r="70"/></clipPath>
                    <line x1="50" y1="120" x2="190" y2="120" stroke="#23252f" stroke-width="0.9"/>
                    <ellipse cx="120" cy="120" rx="14" ry="70" fill="none" stroke="#23252f" stroke-width="0.7" opacity="0.85"/>
                    <ellipse cx="120" cy="120" rx="61" ry="70" fill="none" stroke="#23252f" stroke-width="0.7" opacity="0.85"/>
                </g>
            </g>
            <g class="gh-grid-b">
                <g clip-path="url(#gh-c2)">
                    <clipPath id="gh-c2"><circle cx="120" cy="120" r="70"/></clipPath>
                    <line x1="58" y1="90" x2="182" y2="90" stroke="#23252f" stroke-width="0.6" opacity="0.85"/>
                    <line x1="58" y1="150" x2="182" y2="150" stroke="#23252f" stroke-width="0.6" opacity="0.85"/>
                    <ellipse cx="120" cy="120" rx="39" ry="70" fill="none" stroke="#23252f" stroke-width="0.7" opacity="0.85"/>
                </g>
            </g>
            <g stroke="#A6B0FF" stroke-width="1.5">
                <line x1="120" y1="42" x2="120" y2="34"/>
                <line x1="120" y1="198" x2="120" y2="206"/>
                <line x1="42" y1="120" x2="34" y2="120"/>
                <line x1="198" y1="120" x2="206" y2="120"/>
            </g>
            <circle cx="120" cy="120" r="82" fill="none" stroke="#23252f" stroke-width="1" stroke-dasharray="2 5"/>
            <g class="gh-orbit"><circle cx="196" cy="80" r="3" fill="#A6B0FF"/></g>
            <text x="120" y="146" text-anchor="middle" font-size="58" font-weight="700" fill="#6C7CFF" font-family="inherit">G</text>
        </svg>`;
    }

    function mount() {
        if (root && root.isConnected) {
            root.classList.remove('gh-finish');
            finishing = false;
            return root;
        }
        if (!document.body) return null;
        if (everReady) { progress = 2; everReady = false; }

        injectStyleOnce();
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.innerHTML =
            '<div class="gh-bg-glow"></div>' +
            '<div class="gh-bg-dots"></div>' +
            '<div class="gh-vignette"></div>' +
            '<div class="gh-badge-wrap">' + badgeSvg() + '</div>' +
            '<div class="gh-wordmark">' +
                '<p class="gh-title"><span class="gh-part1">Ghe</span><span class="gh-part2">loo</span></p>' +
                '<p class="gh-sub">LEET.CITY</p>' +
                '<p class="gh-version">' + (installedVersion ? 'v' + installedVersion : '') + '</p>' +
            '</div>' +
            '<div class="gh-bar-row">' +
                '<div class="gh-marker" id="gh-own-marker">G</div>' +
                '<div class="gh-bar-track"><div class="gh-bar-inner" id="gh-own-bar-inner"></div></div>' +
            '</div>' +
            '<div class="gh-percent" id="gh-own-percent">2%</div>';
        document.body.appendChild(root);

        barInnerEl = root.querySelector('#gh-own-bar-inner');
        markerEl   = root.querySelector('#gh-own-marker');
        percentEl  = root.querySelector('#gh-own-percent');
        applyProgress(progress);
        return root;
    }

    function readNativeProgress() {
        const loading = originalLoading();
        if (!loading) return null;
        const inner = loading.querySelector('.nitro-loading-bar-inner');
        if (inner && inner.style.width) {
            const n = parseFloat(inner.style.width);
            if (Number.isFinite(n)) return n;
        }
        try {
            const text = String(loading.textContent || '').replace(/\s+/g, ' ');
            const m = text.match(/(\d{1,3})\s*%/);
            if (m) return Math.max(0, Math.min(100, Number(m[1])));
        } catch (e) {}
        return null;
    }

    function applyProgress(value) {
        progress = Math.max(progress, Math.min(100, Number(value) || 0));
        if (!root) return;
        const pct = progress + '%';
        if (barInnerEl) barInnerEl.style.width = pct;
        if (markerEl) markerEl.style.left = pct;
        if (percentEl) percentEl.textContent = Math.round(progress) + '%';
    }

    function tickProgress() {
        if (!root || finishing) return;
        const real = readNativeProgress();
        if (real !== null) applyProgress(real);
    }

    function removeNow() {
        if (finishTimer) { clearTimeout(finishTimer); finishTimer = 0; }
        if (removeTimer) { clearTimeout(removeTimer); removeTimer = 0; }
        if (root) { try { root.remove(); } catch (e) {} }
        root = null; finishing = false;
    }

    function finish() {
        if (finishing) return;
        if (!root) { everReady = true; return; }
        finishing = true; everReady = true;
        applyProgress(100);
        finishTimer = setTimeout(() => {
            if (root) root.classList.add('gh-finish');
            removeTimer = setTimeout(removeNow, 400);
        }, 150);
    }

    function update() {
        rafQueued = false;
        if (!onHotel()) { removeNow(); return; }
        if (gameReady()) { finish(); return; }

        const loading = originalLoading();
        if (visible(loading) || !everReady) {
            if (removeTimer) { clearTimeout(removeTimer); removeTimer = 0; }
            mount();
            tickProgress();
            if (loading) loading.style.setProperty('display', 'none', 'important');
        }
    }

    function schedule() {
        if (rafQueued) return;
        rafQueued = true;
        requestAnimationFrame(update);
    }

    function start() {
        if (document.body) update();
        else document.addEventListener('DOMContentLoaded', update, { once: true });

        try {
            const observer = new MutationObserver(changes => {
                let external = false;
                for (let i = 0; i < changes.length; i++) {
                    const t = changes[i].target;
                    if (!(t && t.closest && t.closest('#' + ROOT_ID))) { external = true; break; }
                }
                if (external) schedule();
            });
            observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
        } catch (e) {}

        // Polling backstop — doesn't depend on MutationObserver firing at the right
        // moment, so a missed/late mutation can never leave the overlay stuck.
        pollTimer = setInterval(() => { update(); tickProgress(); }, 250);
    }

    start();
})();
