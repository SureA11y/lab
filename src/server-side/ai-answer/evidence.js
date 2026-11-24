'use strict';

// Tier 0 of the AI pass: reads the page, changes nothing
// (docs/design/ai-cant-tell-design.md, "Protecting the steps that follow").

const CONTEXT_CHARS = 350;
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
    if (wanted.includes('element')) out.element = String(occurrence.html || '').slice(0, 1500);
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

module.exports = { collectEvidence, fingerprint, sameFingerprint };
