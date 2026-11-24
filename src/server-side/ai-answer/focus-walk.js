'use strict';

// The focus walk (docs/design/ai-cant-tell-design.md, "Focus questions"):
// what a person does for the focus checks, pressing Tab through the page and
// watching where focus goes. It is the AI pass's only step that acts on the
// page (tier 1), so it puts the page back as it found it:
//
// 1. Before: remembers the element that has focus (or none), the page's scroll
//    position and that of every box that scrolls.
// 2. Starts from the top of the page, as a fresh visit would, and presses Tab
//    up to `maxStops` times. Only Tab: never Enter, Space or an arrow key, so
//    nothing is operated. At each stop: the element, its name and role, where it
//    is, its landmark and the heading it comes under, what looks different on
//    it (or its parent, or its ::before/::after) while focused, whether
//    something covers it, and a small picture.
// 3. Ends when focus leaves the page, comes back to an element it already
//    visited, or the limit is reached.
// 4. After: focus back where it was (or nowhere), every scroll position back.
// 5. Looks (read only) for what a mouse user can use but Tab never reaches.
// 6. A picture of the whole page, for the person to see the order at a glance.
//
// Whether the page is truly as it was is checked by the caller with the
// pass's fingerprint (evidence.js). What it cannot put back: when nothing had
// focus, the point a next Tab starts from is the page's top, not wherever the
// workflow last clicked.

const KEY = '__a11yFocusWalk';
const START = 'data-a11y-focus-walk-start';

const DEFAULTS = { maxStops: 40, maxPictures: 20, settleMs: 80 };
const PICTURE_MAX = { width: 420, height: 200 };
// The page's picture with the stops on it: at most this much of the page.
const MAP_MAX = { width: 1600, height: 8000 };
// The most controls that Tab cannot reach listed (all are counted).
const MAX_UNREACHABLE = 30;
const PAD = 8;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Walks the page's focus order and puts the page back. Resolves with
 * { stops, ended, endedAt?, limit, restored, startedWithFocus } and never
 * rejects: what fails is in `error`.
 */
async function walkFocus(page, options = {}) {
    // An option left out (or undefined) keeps its default.
    const opt = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options || {}).filter(([, v]) => v !== undefined)) };
    const result = { stops: [], ended: null, limit: opt.maxStops, restored: false, startedWithFocus: false };
    if (!page || typeof page.evaluate !== 'function' || !page.keyboard) return { ...result, ended: 'not-possible' };
    try {
        // 1. What to put back; and the walk's start, at the top of the page.
        result.startedWithFocus = await page.evaluate((key, start) => {
            // The styles that can show focus, of an element, its parent and its
            // ::before/::after, read focused and unfocused to compare. Kept on
            // the window for the later steps (no eval: a page's CSP may forbid it).
            // What is drawn, so a change that cannot be seen (an outline's
            // offset with no outline, a border's colour at no width) is not one.
            const pick = (c) => {
                if (!c) return {};
                const px = (v) => parseFloat(v) || 0;
                const outline = c.outlineStyle !== 'none' && px(c.outlineWidth) > 0;
                const border = ['Top', 'Right', 'Bottom', 'Left'].map((side) => (c['border' + side + 'Style'] !== 'none' && px(c['border' + side + 'Width']) > 0
                    ? c['border' + side + 'Width'] + ' ' + c['border' + side + 'Style'] + ' ' + c['border' + side + 'Color'] : '')).join('|');
                const underline = /underline|overline|line-through/.test(c.textDecorationLine);
                return {
                    outline: outline ? [c.outlineStyle, c.outlineWidth, c.outlineColor, c.outlineOffset].join(' ') : '',
                    'box shadow': c.boxShadow === 'none' ? '' : c.boxShadow,
                    border,
                    background: c.backgroundColor + ' ' + c.backgroundImage,
                    'text colour': c.color,
                    underline: underline ? c.textDecorationLine + ' ' + c.textDecorationColor : '',
                    'size or position': c.transform,
                    opacity: c.opacity,
                    // A pseudo-element counts only while it is drawn.
                    shown: c.content === undefined ? '' : String(c.content),
                };
            };
            const read = (el) => ({
                self: pick(getComputedStyle(el)),
                parent: el.parentElement ? pick(getComputedStyle(el.parentElement)) : {},
                before: pick(getComputedStyle(el, '::before')),
                after: pick(getComputedStyle(el, '::after')),
            });
            const changed = (a, b) => {
                const out = [];
                for (const part of ['self', 'parent', 'before', 'after']) {
                    const x = a[part] || {};
                    const y = b[part] || {};
                    if ((part === 'before' || part === 'after') && (x.shown === 'none' || x.shown === 'normal') && (y.shown === 'none' || y.shown === 'normal')) continue;
                    for (const name of Object.keys(x)) {
                        if (name === 'shown' || x[name] === y[name]) continue;
                        out.push(part === 'self' ? name : `${name} (${part === 'parent' ? 'parent' : '::' + part})`);
                    }
                    if ((part === 'before' || part === 'after') && x.shown !== y.shown) out.push(`content (::${part})`);
                }
                return out;
            };
            const reader = { read, changed };
            const scrollers = [];
            for (const el of document.querySelectorAll('*')) {
                if (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth) scrollers.push([el, el.scrollTop, el.scrollLeft]);
            }
            const active = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
            window[key] = { active, scrollX: window.scrollX, scrollY: window.scrollY, scrollers, visited: [], focusedStyles: [], reader };
            const mark = document.createElement('span');
            mark.tabIndex = -1;
            mark.setAttribute(start, '');
            document.body.prepend(mark);
            mark.focus({ preventScroll: true });
            return !!active;
        }, KEY, START);

        // 2. Tab, stop by stop.
        for (let i = 0; i < opt.maxStops; i++) {
            await page.keyboard.press('Tab');
            await wait(opt.settleMs);
            const stop = await page.evaluate((key, start, first) => {
                const st = window[key];
                // The start mark is gone as soon as focus has left it.
                if (first) document.querySelector(`[${start}]`)?.remove();
                let a = document.activeElement;
                while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
                if (!a || a === document.body || a === document.documentElement) return { end: 'left-page' };
                const last = st.visited[st.visited.length - 1];
                // Inside an iframe, focus moves where the page cannot see: one stop.
                if (a === last && a.tagName === 'IFRAME') return { insideFrame: true };
                const seen = st.visited.indexOf(a);
                if (seen >= 0) return { end: 'came-back', index: seen };
                st.visited.push(a);
                st.focusedStyles.push(st.reader.read(a));
                const clip = (t, n = 80) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);
                const attr = (n) => a.getAttribute(n);
                const labelled = attr('aria-labelledby') ? attr('aria-labelledby').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
                const name = clip(attr('aria-label') || labelled || (a.labels && a.labels[0] && a.labels[0].textContent) || attr('alt') || a.innerText || attr('title') || attr('placeholder') || attr('value') || (a.querySelector && a.querySelector('img[alt]')?.getAttribute('alt')) || '');
                const r = a.getBoundingClientRect();
                const cx = r.left + r.width / 2;
                const cy = r.top + r.height / 2;
                let top = null;
                try { top = document.elementFromPoint(cx, cy); } catch { top = null; }
                const describe = (el) => el ? clip(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList && el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''), 60) : null;
                const inView = r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
                const covered = inView && top && !(top === a || a.contains(top) || top.contains(a)) ? describe(top) : null;
                const selector = a.id ? '#' + CSS.escape(a.id) : describe(a);
                // Where the stop is: its landmark, and the heading it comes under.
                const LANDMARKS = { HEADER: 'header', NAV: 'navigation', MAIN: 'main', FOOTER: 'footer', ASIDE: 'complementary', FORM: 'form', SECTION: 'region', DIALOG: 'dialog' };
                const ROLES = { banner: 'header', navigation: 'navigation', main: 'main', contentinfo: 'footer', complementary: 'complementary', search: 'search', form: 'form', region: 'region', dialog: 'dialog', alertdialog: 'dialog' };
                const lm = a.closest('header,nav,main,footer,aside,form[aria-label],form[aria-labelledby],section[aria-label],section[aria-labelledby],dialog,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=search],[role=form],[role=region],[role=dialog],[role=alertdialog]');
                const lmLabel = lm ? clip(lm.getAttribute('aria-label') || (lm.getAttribute('aria-labelledby') ? lm.getAttribute('aria-labelledby').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : ''), 40) : '';
                const landmark = lm ? (ROLES[lm.getAttribute('role')] || LANDMARKS[lm.tagName] || 'region') + (lmLabel ? ' “' + lmLabel + '”' : '') : null;
                let heading = null;
                for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')) {
                    if (h === a || h.contains(a) || (h.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) heading = h;
                    else break;
                }
                const level = heading ? (heading.getAttribute('aria-level') || (/^H[1-6]$/.test(heading.tagName) ? heading.tagName[1] : '')) : '';
                return {
                    landmark,
                    heading: heading ? clip((level ? 'h' + level + ' ' : '') + '“' + clip(heading.textContent, 60) + '”', 70) : null,
                    tag: a.tagName.toLowerCase(),
                    role: attr('role') || null,
                    name,
                    selector,
                    href: a.tagName === 'A' ? clip(attr('href'), 120) : undefined,
                    x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
                    width: Math.round(r.width), height: Math.round(r.height),
                    inView,
                    covered,
                    hidden: r.width < 1 || r.height < 1 || getComputedStyle(a).visibility === 'hidden',
                };
            }, KEY, START, i === 0);
            if (stop.insideFrame) { result.stops[result.stops.length - 1].insideFrame = true; continue; }
            if (stop.end) {
                result.ended = stop.end;
                if (stop.end === 'came-back') result.endedAt = stop.index + 1;
                break;
            }
            stop.n = result.stops.length + 1;
            if (result.stops.length < opt.maxPictures && !stop.hidden && stop.width > 0 && stop.height > 0 && typeof page.screenshot === 'function') {
                try {
                    const clip = {
                        x: Math.max(0, stop.x - PAD), y: Math.max(0, stop.y - PAD),
                        width: Math.min(stop.width + PAD * 2, PICTURE_MAX.width), height: Math.min(stop.height + PAD * 2, PICTURE_MAX.height),
                    };
                    const data = await page.screenshot({ type: 'jpeg', quality: 55, clip, captureBeyondViewport: true, encoding: 'base64' });
                    if (data) stop.screenshot = 'data:image/jpeg;base64,' + data;
                } catch { /* no picture */ }
            }
            result.stops.push(stop);
        }
        if (!result.ended) result.ended = 'limit';
    } catch (e) {
        result.error = String((e && e.message) || e).slice(0, 200);
    } finally {
        // 4. Put the page back, then read each stop unfocused to compare.
        try {
            const unfocused = await page.evaluate(async (key, start, settleMs) => {
                const st = window[key];
                document.querySelector(`[${start}]`)?.remove();
                if (!st) return null;
                if (st.active && st.active.isConnected) st.active.focus({ preventScroll: true });
                else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
                for (const [el, top, left] of st.scrollers) { el.scrollTop = top; el.scrollLeft = left; }
                window.scrollTo(st.scrollX, st.scrollY);
                await new Promise((r) => setTimeout(r, settleMs * 2));
                const changes = st.visited.map((el, i) => (el === st.active ? null : st.reader.changed(st.focusedStyles[i], st.reader.read(el))));
                delete window[key];
                return changes;
            }, KEY, START, opt.settleMs);
            if (Array.isArray(unfocused)) {
                result.restored = true;
                result.stops.forEach((s, i) => { s.changesOnFocus = unfocused[i]; });
            }
        } catch (e) {
            result.error = result.error || String((e && e.message) || e).slice(0, 200);
        }
    }
    // 5. What looks usable by mouse but Tab can never reach: read only.
    if (result.restored && opt.unreachable !== false) {
        try {
            result.unreachable = await page.evaluate(unreachableControls, MAX_UNREACHABLE);
        } catch { /* not read */ }
    }
    // 6. A picture of the whole page as it is again, for the person: the
    // review draws the stops' numbers and path over it. Nothing is drawn on
    // the page itself.
    if (result.restored && result.stops.length && opt.mapPicture !== false && typeof page.screenshot === 'function') {
        try {
            const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
            const width = Math.max(1, Math.min(size.w, MAP_MAX.width));
            const height = Math.max(1, Math.min(size.h, MAP_MAX.height));
            const data = await page.screenshot({ type: 'jpeg', quality: 45, clip: { x: 0, y: 0, width, height }, captureBeyondViewport: true, encoding: 'base64' });
            if (data) result.map = { screenshot: 'data:image/jpeg;base64,' + data, width, height };
        } catch { /* no map */ }
    }
    return result;
}

/* In the page: the controls a mouse user can use that Tab never reaches.
   Read only. Each with why it looks usable: a control's role, a click
   attribute, a pointer cursor, or a link, button or field taken out of the Tab
   order. One inside, or holding, something Tab reaches is left out (a card
   whose link is reachable), as are hidden, disabled and inert ones.
   -> { total, items: [...] } */
function unreachableControls(max) {
    const ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'combobox', 'textbox', 'searchbox', 'treeitem', 'gridcell']);
    const NATIVE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [contenteditable=""], [contenteditable="true"]';
    const reachable = (el) => el.tabIndex >= 0 && !el.matches('[disabled]');
    const clip = (t, n = 60) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);
    const items = [];
    let total = 0;
    for (const el of document.body ? document.body.querySelectorAll('*') : []) {
        if (el.closest('[inert], [aria-disabled="true"], [disabled]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
        const role = el.getAttribute('role');
        let why = null;
        if (el.matches(NATIVE) && el.tabIndex < 0) why = 'taken out of the Tab order (tabindex="' + el.getAttribute('tabindex') + '")';
        else if (reachable(el)) continue;
        else if (role && ROLES.has(role)) why = 'has the role ' + role + ' but cannot take focus';
        else if (el.hasAttribute('onclick') || el.hasAttribute('onmousedown') || el.hasAttribute('onmouseup')) why = 'has a click attribute but cannot take focus';
        else if (cs.cursor === 'pointer' && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer')) why = 'shows a pointer cursor but cannot take focus';
        if (!why) continue;
        // Reached through something around or inside it: not a mouse-only control.
        if (el.parentElement && el.parentElement.closest(NATIVE + ', [tabindex]:not([tabindex="-1"])')) continue;
        if (el.matches('label') || [...el.querySelectorAll(NATIVE + ', [tabindex]')].some(reachable)) continue;
        total++;
        if (items.length >= max) continue;
        items.push({
            tag: el.tagName.toLowerCase(), role: role || null,
            name: clip(el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.getAttribute('alt') || ''),
            selector: el.id ? '#' + CSS.escape(el.id) : clip(el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''), 60),
            x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.round(r.height),
            why,
        });
    }
    return { total, items };
}

module.exports = { walkFocus, unreachableControls, DEFAULTS };
