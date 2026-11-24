'use strict';

// Tier 0 of the AI pass: reads the page, changes nothing
// (docs/design/ai-cant-tell-design.md, "Protecting the steps that follow").

const CONTEXT_CHARS = 350;
const TEXT_CHARS = 200;
const IMAGE_CHARS = 2000;

/**
 * What a person would look at to answer one occurrence: the page around the
 * element, the page's title and headings, an image's source. Never throws:
 * what could not be read is left out.
 */
async function collectEvidence(page, occurrence, wanted) {
    const target = Array.isArray(occurrence.target) ? occurrence.target[0] : null;
    const selector = typeof target === 'string' ? target : null;
    const out = {};
    if (wanted.includes('element')) {
        out.element = String(occurrence.html || '').slice(0, 1500);
        const facts = await readFacts(page, selector);
        if (facts) out.facts = facts;
    }
    if (!wanted.includes('context') && !wanted.includes('pageTitle') && !wanted.includes('image')) return out;
    try {
        const read = await page.evaluate((sel, want, ctxChars, imgChars) => {
            const res = {};
            let el = null;
            try { el = sel ? document.querySelector(sel) : null; } catch { el = null; }
            if (want.includes('context') && el) {
                let box = el.parentElement;
                const wide = new Set(['LI', 'SECTION', 'FORM', 'HEADER', 'MAIN', 'ARTICLE', 'FOOTER', 'NAV', 'BODY']);
                while (box && !wide.has(box.tagName) && box.parentElement) box = box.parentElement;
                const html = (box || el).outerHTML || '';
                const at = html.indexOf((el.outerHTML || '').slice(0, 60));
                res.context = at >= 0
                    ? html.slice(Math.max(0, at - ctxChars), at + (el.outerHTML || '').length + ctxChars)
                    : html.slice(0, ctxChars * 2);
            }
            if (want.includes('pageTitle')) {
                res.pageTitle = {
                    title: document.title,
                    headings: Array.from(document.querySelectorAll('h1,h2')).slice(0, 4).map((h) => h.textContent.trim().slice(0, 120)),
                };
            }
            if (want.includes('image') && el) {
                const img = el.matches('img') ? el : el.querySelector('img');
                res.image = img
                    ? { src: img.currentSrc || img.src, alt: img.getAttribute('alt'), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }
                    : { inlineSvg: el.matches('svg') || !!el.querySelector('svg') };
                res.imageSvgUrl = img && /\.svg(\?|$)/i.test(img.currentSrc || img.src) ? (img.currentSrc || img.src) : null;
            }
            return res;
        }, selector, wanted, CONTEXT_CHARS, IMAGE_CHARS);
        if (read.context) out.context = read.context;
        if (read.pageTitle) out.pageTitle = read.pageTitle;
        if (read.image) out.image = read.image;
        if (read.imageSvgUrl) {
            // An SVG's source says what is drawn; fetched in the page, so with
            // its cookies and only from the page's own origin.
            const svg = await page.evaluate(async (url, max) => {
                try {
                    if (new URL(url, location.href).origin !== location.origin) return null;
                    const r = await fetch(url, { credentials: 'same-origin' });
                    return r.ok ? (await r.text()).slice(0, max) : null;
                } catch { return null; }
            }, read.imageSvgUrl, IMAGE_CHARS);
            if (svg) out.image = { ...(out.image || {}), svgSource: svg };
        }
    } catch {
        // The page moved on or the element is gone: answer from what there is.
    }
    return out;
}

/**
 * The values a person would read off the element, as the page has them now:
 * its text, alt, label, link target, and the accessible name and role the
 * browser computes (for an image in a link or button, also the control's).
 * What the tool's HTML snippet may cut off or leave out. Null when the element
 * cannot be found.
 */
async function readFacts(page, selector) {
    if (!selector) return null;
    try {
        const facts = await page.evaluate((sel, chars) => {
            let el = null;
            try { el = document.querySelector(sel); } catch { return null; }
            if (!el) return null;
            const clip = (t) => (t == null ? null : String(t).replace(/\s+/g, ' ').trim().slice(0, chars));
            const attr = (n, e = el) => (e.hasAttribute(n) ? e.getAttribute(n) : undefined);
            const out = { tag: el.tagName.toLowerCase(), text: clip(el.innerText || el.textContent) };
            for (const n of ['alt', 'aria-label', 'aria-labelledby', 'title', 'placeholder', 'href', 'src', 'role', 'type', 'name', 'id']) {
                const v = attr(n);
                if (v !== undefined) out[n] = clip(v);
            }
            if (out['aria-labelledby']) {
                out.labelledByText = clip(out['aria-labelledby'].split(/\s+/).map((id) => { const r = document.getElementById(id); return r ? r.textContent : ''; }).join(' '));
            }
            if (el.labels && el.labels.length) out.labelText = clip(Array.from(el.labels).map((l) => l.textContent).join(' '));
            const control = el.closest('a,button,[role=button],[role=link]');
            if (control && control !== el) {
                out.control = { tag: control.tagName.toLowerCase(), text: clip(control.innerText || control.textContent), href: clip(attr('href', control)), ariaLabel: clip(attr('aria-label', control)), title: clip(attr('title', control)) };
            }
            const link = el.closest('a[href]');
            if (link) {
                const text = clip(link.innerText || link.textContent);
                if (text) {
                    const same = Array.from(document.querySelectorAll('a[href]')).filter((a) => a !== link && clip(a.innerText || a.textContent) === text);
                    out.sameTextLinks = { others: same.length, distinctTargets: Array.from(new Set(same.map((a) => a.getAttribute('href')))).slice(0, 5) };
                }
            }
            let h = null;
            for (let n = el; n && !h; n = n.parentElement) {
                for (let p = n.previousElementSibling; p && !h; p = p.previousElementSibling) {
                    if (/^H[1-6]$/.test(p.tagName)) h = p; else { const inner = p.querySelector && p.querySelector('h1,h2,h3,h4,h5,h6'); if (inner) h = inner; }
                }
            }
            if (h) out.nearestHeadingBefore = clip(h.textContent);
            const r = el.getBoundingClientRect();
            out.size = [Math.round(r.width), Math.round(r.height)];
            out.shown = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
            return out;
        }, selector, TEXT_CHARS);
        if (!facts) return null;
        try {
            const handle = await page.$(selector);
            if (handle) {
                const snap = await page.accessibility.snapshot({ root: handle, interestingOnly: false });
                if (snap) facts.accessibleName = { role: snap.role || null, name: snap.name == null ? null : String(snap.name).slice(0, TEXT_CHARS) };
                await handle.dispose();
            }
        } catch { /* the tree is not available: the rest stands */ }
        return facts;
    } catch {
        return null;
    }
}

/**
 * A fingerprint of what the AI pass must leave as it found it. Compared
 * before and after: a difference means the pass changed the page.
 */
async function fingerprint(page) {
    try {
        return await page.evaluate(() => {
            const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; };
            const a = document.activeElement;
            let ls = '', ss = '', ck = '';
            try { ls = JSON.stringify(localStorage); ss = JSON.stringify(sessionStorage); } catch { /* blocked */ }
            try { ck = document.cookie; } catch { /* blocked */ }
            return {
                url: location.href,
                dom: hash(document.documentElement.outerHTML),
                storage: hash(ls + '|' + ss),
                cookies: hash(ck),
                scroll: [Math.round(window.scrollX), Math.round(window.scrollY)],
                focus: a && a !== document.body ? (a.id || a.tagName) : null,
                viewport: [window.innerWidth, window.innerHeight],
            };
        });
    } catch {
        return null;
    }
}

function sameFingerprint(a, b) {
    return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
}

module.exports = { collectEvidence, readFacts, fingerprint, sameFingerprint };
