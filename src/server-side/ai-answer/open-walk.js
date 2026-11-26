'use strict';

// The open walk (docs/design/ai-cant-tell-design.md, "Opening what the page
// opens"): after the focus walk, what a person does next for the keyboard and
// focus order checks: press each control that says it opens something on the
// page (a menu, a disclosure, a lightbox), and see whether the keyboard can
// use what opens and close it. Opt-in (`ai: { focus: true, open: true }`):
// unlike the focus walk, it operates the page, so it is held to more:
//
// - Only controls Tab reaches that say they open something here (and, with
//   open: "buttons", plain buttons outside a form whose name does not say
//   they act: buy, delete, send...): with
//   aria-expanded, aria-haspopup or aria-controls, a link to "#" (or to
//   javascript:), or a link with role=button. Never a submit button, a
//   control in a form, or a plain button (it may buy, delete or send).
// - While it runs, nothing leaves the page: every navigation of the page
//   (a link, a script, a form) is stopped and recorded as "would go to", and
//   every request that could change something on the server (not GET, HEAD,
//   OPTIONS) is stopped and recorded (`blockedRequests`).
// - Each control is pressed with its key (Enter; Space for a link with
//   role=button, whose own key is Space, then Enter if Space did nothing),
//   then what opened is walked with
//   Tab, Escape is tried, and whatever is still open is closed (the control
//   again, then a close control in it). Focus and scroll are put back.
// - Whether the page is truly as it was is checked by the caller with the
//   pass's fingerprint, as for the focus walk: if not, its answers are
//   dropped and the workflow warned.

const KEY = '__a11yOpenWalk';
const DEFAULTS = { maxControls: 10, maxTabs: 15, settleMs: 200, buttons: false };
// A plain button whose name says it does something beyond the page is never
// pressed, even with open: "buttons".
const ACTS_NAME = /\b(delete|remove|discard|erase|buy|pay|order|checkout|check out|purchase|book|send|submit|save|sign ?out|log ?out|subscribe|unsubscribe|clear|reset|confirm|accept|reject|decline|agree|donate|apply|upload|download|print|share|post|publish|cancel (my|the|order|subscription))\b/i;
// A close control's short name: "Close", "X", "×"... (no word boundary
// after a symbol, so the next letter is what must not follow).
const CLOSE_NAME = /^(close|×|✕|✖|x|dismiss|cancel|done|no|not now)(?![a-z])|close/i;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// In the page: the controls to press, the state to put back, and the guards.
function setUp(key, maxControls, closeSource, buttons, actsSource) {
    const CLOSE = new RegExp(closeSource, 'i');
    const ACTS = new RegExp(actsSource, 'i');
    const visible = (el) => {
        if (!el.isConnected) return false;
        if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const nameOf = (el) => ((el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || (el.querySelector('img[alt]') || {}).alt || '').replace(/\s+/g, ' ').trim()).slice(0, 80);
    const pathOf = (el) => {
        const parts = [];
        for (let e = el; e && e.nodeType === 1 && parts.length < 8; e = e.parentElement) {
            const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
            parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : same.length > 1 ? ':nth-of-type(' + (same.indexOf(e) + 1) + ')' : ''));
            if (e.id) break;
        }
        return parts.join('>');
    };
    const why = (el) => {
        const tag = el.tagName;
        const role = el.getAttribute('role');
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return null;
        if (tag === 'BUTTON' && (el.type === 'submit' || el.type === 'reset')) return null;
        if (el.closest('form') && !(tag === 'A' || (tag === 'BUTTON' && el.getAttribute('type') === 'button'))) return null;
        if (el.hasAttribute('aria-expanded')) return 'aria-expanded';
        const popup = el.getAttribute('aria-haspopup');
        if (popup && popup !== 'false') return 'aria-haspopup';
        if (el.hasAttribute('aria-controls')) return 'aria-controls';
        if (tag === 'A') {
            const href = (el.getAttribute('href') || '').trim();
            if (role === 'button') return 'role=button';
            if (href === '#' || /^javascript:/i.test(href)) return 'link to ' + (href === '#' ? '#' : 'javascript:');
        }
        // open: "buttons": a plain button (or role=button) outside a form,
        // unless its name says it acts (buy, delete, send...).
        if (buttons && (tag === 'BUTTON' || (role === 'button' && tag !== 'A')) && !el.closest('form') && !ACTS.test(nameOf(el))) return 'button';
        return null;
    };
    const all = [...document.querySelectorAll('a[href], button, [role="button"], [aria-expanded], [aria-haspopup], [aria-controls]')]
        .filter((el) => el.tabIndex >= 0 && !el.disabled && visible(el) && why(el));
    const controls = all.slice(0, maxControls);
    const st = {
        controls,
        active: document.activeElement && document.activeElement !== document.body ? document.activeElement : null,
        scrollX: window.scrollX, scrollY: window.scrollY,
        clicks: [], leaving: [],
        visible, nameOf, pathOf, CLOSE,
    };
    // Nothing leaves the page: a link's own navigation is stopped here (the
    // page's handlers still run); a script's or a form's, by the caller.
    st.onClick = (e) => {
        st.clicks.push(e.target);
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        e.preventDefault();
        // A link within the page ("#", "#top") does not leave it.
        if (a.href.split('#')[0] !== location.href.split('#')[0] && !/^javascript:/i.test(a.getAttribute('href') || '')) st.leaving.push(a.href);
    };
    st.onSubmit = (e) => { e.preventDefault(); st.leaving.push('a form submitted'); };
    window.addEventListener('click', st.onClick, true);
    window.addEventListener('submit', st.onSubmit, true);
    window[key] = st;
    return { total: all.length, controls: controls.map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || null, name: nameOf(el), path: pathOf(el), why: why(el) })) };
}

// In the page: before pressing control i, focus it and note what shows.
function beforePress(key, i) {
    const st = window[key];
    const el = st.controls[i];
    st.shown = new Set([...document.body.querySelectorAll('*')].filter(st.visible));
    st.clicks = []; st.leaving = [];
    st.expanded = el.getAttribute('aria-expanded');
    el.focus();
    return document.activeElement === el;
}

// In the page: after pressing: what opened (newly visible), what of it can
// take focus, its close control, and where focus is.
function afterPress(key, i) {
    const st = window[key];
    const el = st.controls[i];
    const now = [...document.body.querySelectorAll('*')].filter(st.visible);
    const fresh = now.filter((e) => !st.shown.has(e));
    // The tops of what opened: newly shown, with no newly shown parent.
    const freshSet = new Set(fresh);
    st.opened = fresh.filter((e) => !freshSet.has(e.parentElement));
    const inside = (e) => !!e && st.opened.some((o) => o.contains(e));
    const focusable = fresh.filter((e) => e.tabIndex >= 0 && !e.disabled && e.matches('a[href], button, input, select, textarea, [tabindex], summary, [contenteditable="true"]'));
    // A close control: short-named ("Close", "X", "×"), not a box whose text
    // only mentions closing.
    // A real control first; a span, a div or an icon only when it holds no
    // other element (not the dialog box whose text ends in "Close").
    const named = fresh.filter((e) => { const n = st.nameOf(e); return n.length <= 24 && st.CLOSE.test(n); });
    const closers = [
        ...named.filter((e) => e.matches('a, button, [role="button"]')),
        ...named.filter((e) => e.matches('span, div, img, i, svg') && !e.matches('[role="button"]') && e.children.length === 0),
    ];
    const a = document.activeElement;
    st.lastPlace = a === el ? 'control' : inside(a) ? 'inside' : !a || a === document.body ? 'nowhere' : 'elsewhere';
    const close = closers[0] || null;
    st.closer = close;
    return {
        activated: st.clicks.some((t) => t === el || el.contains(t)) || fresh.length > 0 || el.getAttribute('aria-expanded') !== st.expanded,
        expanded: [st.expanded, el.getAttribute('aria-expanded')],
        opened: fresh.length ? {
            elements: fresh.length,
            focusable: focusable.length,
            names: focusable.slice(0, 8).map(st.nameOf).filter(Boolean),
            dialog: st.opened.some((o) => o.matches('dialog, [role="dialog"], [role="alertdialog"]') || !!o.querySelector('dialog, [role="dialog"], [role="alertdialog"]')),
            close: close ? { name: st.nameOf(close), tag: close.tagName.toLowerCase(), focusable: close.tabIndex >= 0 && !close.disabled && !(close.tagName === 'A' && !close.hasAttribute('href') && !close.hasAttribute('tabindex')) } : null,
        } : null,
        focusAfter: st.lastPlace,
        wouldLeave: st.leaving.slice(0, 3),
    };
}

// In the page: where focus is now, against what opened.
function placeNow(key) {
    const st = window[key];
    const a = document.activeElement;
    const el = st.controls[st.current];
    if (a === el) return 'control';
    if (!a || a === document.body) return 'nowhere';
    return st.opened && st.opened.some((o) => o.contains(a)) ? 'inside' : 'elsewhere';
}

// In the page: is what opened still showing?
function stillOpen(key) {
    const st = window[key];
    return !!(st.opened && st.opened.some((o) => st.visible(o)));
}

// In the page: close what is still open, as a mouse user would: the control
// again (a toggle), then its close control.
function closeIt(key, i) {
    const st = window[key];
    const el = st.controls[i];
    const open = () => st.opened && st.opened.some((o) => st.visible(o));
    if (open() && el.getAttribute('aria-expanded') === 'true') el.click();
    if (open() && st.closer && st.closer.isConnected) st.closer.click();
    return !open();
}

// In the page: focus, scroll and the guards back.
function tearDown(key) {
    const st = window[key];
    if (!st) return false;
    window.removeEventListener('click', st.onClick, true);
    window.removeEventListener('submit', st.onSubmit, true);
    if (st.active && st.active.isConnected) st.active.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    window.scrollTo(st.scrollX, st.scrollY);
    delete window[key];
    return true;
}

/**
 * Presses what the page says opens something, walks what opens, and puts the
 * page back. Resolves with { tried, total, controls: [...], restored,
 * wouldLeave? } and never rejects: what fails is in `error`.
 */
async function openWalk(page, options = {}) {
    const opt = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options || {}).filter(([, v]) => v !== undefined)) };
    const result = { tried: 0, total: 0, controls: [], restored: false };
    if (!page || typeof page.evaluate !== 'function' || !page.keyboard) return { ...result, error: 'not-possible' };
    // A script's navigation or a form's is stopped at the request: the page
    // stays. Any request that could change something on the server (not GET,
    // HEAD or OPTIONS) is stopped too: a dialog that loads its content still
    // works, an action does not happen.
    const stopped = [];
    const blocked = [];
    let intercepting = false;
    const onRequest = (req) => {
        if (typeof req.isInterceptResolutionHandled === 'function' && req.isInterceptResolutionHandled()) return;
        try {
            if (req.isNavigationRequest() && req.frame() === page.mainFrame()) { stopped.push(req.url()); req.abort('aborted'); }
            else if (!['GET', 'HEAD', 'OPTIONS'].includes(String(req.method()).toUpperCase())) { blocked.push(req.method() + ' ' + req.url()); req.abort('aborted'); }
            else req.continue();
        } catch { /* already handled */ }
    };
    try {
        if (typeof page.setRequestInterception === 'function') {
            await page.setRequestInterception(true);
            page.on('request', onRequest);
            intercepting = true;
        }
        const found = await page.evaluate(setUp, KEY, opt.maxControls, CLOSE_NAME.source, opt.buttons === true, ACTS_NAME.source);
        result.total = found.total;
        for (let i = 0; i < found.controls.length; i++) {
            const c = { ...found.controls[i] };
            const key = c.why === 'role=button' ? 'Space' : 'Enter';
            const stoppedBefore = stopped.length;
            const blockedBefore = blocked.length;
            c.key = key;
            if (!(await page.evaluate(beforePress, KEY, i))) { c.skipped = 'could-not-focus'; result.controls.push(c); continue; }
            await page.evaluate((k, n) => { window[k].current = n; }, KEY, i);
            await page.keyboard.press(key === 'Space' ? ' ' : key);
            await wait(opt.settleMs);
            Object.assign(c, await page.evaluate(afterPress, KEY, i));
            if (stopped.length > stoppedBefore) c.wouldLeave = [...(c.wouldLeave || []), ...stopped.slice(stoppedBefore, stoppedBefore + 3)];
            if (c.wouldLeave && c.wouldLeave.length) c.activated = true;
            if (blocked.length > blockedBefore) { c.blockedRequests = blocked.slice(blockedBefore, blockedBefore + 3); c.activated = true; }
            // A link with role=button that ignores Space: does Enter work
            // (then the keyboard can still use it)?
            if (key === 'Space' && !c.activated) {
                await page.evaluate(beforePress, KEY, i);
                const before = stopped.length;
                await page.keyboard.press('Enter');
                await wait(opt.settleMs);
                const again = await page.evaluate(afterPress, KEY, i);
                const leaving = [...again.wouldLeave, ...stopped.slice(before, before + 3)];
                c.enter = { activated: again.activated || leaving.length > 0, ...(leaving.length ? { wouldLeave: leaving } : {}) };
                if (again.opened) Object.assign(c, { opened: again.opened, focusAfter: again.focusAfter, key: 'Enter' });
            }
            result.tried++;
            if (c.opened) {
                // Tab from where focus is: does it go into what opened, and
                // once in, does it stay?
                const places = [];
                for (let t = 0; t < opt.maxTabs; t++) {
                    await page.keyboard.press('Tab');
                    await wait(40);
                    places.push(await page.evaluate(placeNow, KEY));
                }
                // Once in, any Tab that takes focus out (to the page behind,
                // or out of the page to the browser) leaves it.
                const firstIn = places.indexOf('inside');
                const out = firstIn >= 0 ? places.findIndex((p, n) => n > firstIn && p !== 'inside') : -1;
                c.tabs = {
                    presses: places.length,
                    reachedInside: firstIn >= 0 ? firstIn + 1 : null,
                    leftAfter: out >= 0 ? out + 1 : null,
                    leftTo: out >= 0 ? places[out] : null,
                };
                await page.keyboard.press('Escape');
                await wait(opt.settleMs);
                c.escapeCloses = !(await page.evaluate(stillOpen, KEY));
                if (!c.escapeCloses) c.closedAfter = await page.evaluate(closeIt, KEY, i);
                await wait(opt.settleMs);
            }
            // aria-expanded not as it was (a section that started open and was
            // closed, or one opened that showed nothing): press it back.
            if (c.expanded && c.expanded[0] !== null) {
                const back = await page.evaluate((k, n, was) => { const el = window[k].controls[n]; if (el.getAttribute('aria-expanded') === was) return true; el.click(); return el.getAttribute('aria-expanded') === was; }, KEY, i, c.expanded[0]);
                if (!back) c.notPutBack = 'aria-expanded';
                await wait(opt.settleMs);
            }
            result.controls.push(c);
        }
        result.restored = await page.evaluate(tearDown, KEY);
    } catch (e) {
        result.error = String((e && e.message) || e).slice(0, 200);
        try { result.restored = await page.evaluate(tearDown, KEY); } catch { /* the fingerprint will say */ }
    } finally {
        if (intercepting) {
            page.off('request', onRequest);
            try { await page.setRequestInterception(false); } catch { /* the page is gone */ }
        }
    }
    if (stopped.length) result.wouldLeave = stopped.slice(0, 5);
    if (blocked.length) result.blockedRequests = blocked.slice(0, 5);
    return result;
}

module.exports = { openWalk, DEFAULTS, CLOSE_NAME, ACTS_NAME };
