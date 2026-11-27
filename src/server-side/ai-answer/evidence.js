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
// A copy of a plain object whose JSON stays under `max` characters: long
// strings are cut, long lists shortened, then keys dropped from the end.
function boundedCopy(value, max) {
    const cut = (v, depth) => {
        if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v;
        if (Array.isArray(v)) return v.slice(0, 10).map((x) => cut(x, depth + 1));
        if (v && typeof v === 'object' && depth < 3) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x, depth + 1)]));
        return v && typeof v === 'object' ? '…' : v;
    };
    const out = cut(value, 0);
    while (JSON.stringify(out).length > max && Object.keys(out).length > 1) delete out[Object.keys(out).pop()];
    return out;
}

function elidePaths(html) {
    return html.replace(/\s(d|points)="[^"]{40,}"/g, ' $1="…"');
}

async function collectEvidence(page, occurrence, wanted) {
    const target = Array.isArray(occurrence.target) ? occurrence.target[0] : null;
    const selector = typeof target === 'string' ? target : null;
    const out = {};
    if (wanted.includes('element')) {
        // Long path data says nothing a reader can use: it is elided, so the
        // rest of the element fits.
        out.element = elidePaths(String(occurrence.html || '')).slice(0, 1500);
        const facts = await readFacts(page, selector);
        if (facts) out.facts = facts;
        const proof = await captureProof(page, selector);
        if (proof) out.screenshot = proof;
    }
    // What the checker itself reported for this occurrence (the values its
    // documentation lists under @reports: the other fields sharing a label,
    // where same-named links go...), bounded.
    if (wanted.includes('reported') && occurrence.details && typeof occurrence.details === 'object') {
        out.reported = boundedCopy(occurrence.details, 1500);
    }
    if (wanted.includes('pixels')) {
        const px = await measurePixels(page, typeof target === 'string' ? target : null);
        if (px) out.pixels = px;
    }
    if (!['context', 'pageTitle', 'image', 'table', 'outline', 'landmarks'].some((w) => wanted.includes(w))) return out;
    try {
        const read = await page.evaluate(async (sel, want, ctxChars, imgChars) => {
            const res = {};
            let el = null;
            try { el = sel ? document.querySelector(sel) : null; } catch { el = null; }
            if (want.includes('context') && el) {
                let box = el.parentElement;
                const wide = new Set(['LI', 'SECTION', 'FORM', 'HEADER', 'MAIN', 'ARTICLE', 'FOOTER', 'NAV', 'BODY']);
                while (box && !wide.has(box.tagName) && box.parentElement) box = box.parentElement;
                // Path data elided before the cut, so a cut never lands in it.
                const elide = (h) => h.replace(/\s(d|points)="[^"]{40,}"/g, ' $1="…"');
                const html = elide((box || el).outerHTML || '');
                const own = elide(el.outerHTML || '');
                const at = html.indexOf(own.slice(0, 60));
                res.context = at >= 0
                    ? html.slice(Math.max(0, at - ctxChars), at + own.length + ctxChars)
                    : html.slice(0, ctxChars * 2);
            }
            const clipText = (t, n) => (t || '').replace(/\s+/g, ' ').trim().slice(0, n);
            // The table the element is in (or is): its caption and first rows,
            // each cell marked header (th, with its scope) or data.
            if (want.includes('table') && el) {
                const table = el.closest('table') || el.querySelector('table');
                if (table) {
                    const rows = [...table.rows];
                    res.table = {
                        caption: table.caption ? clipText(table.caption.textContent, 120) : null,
                        role: table.getAttribute('role'), ariaLabel: table.getAttribute('aria-label'),
                        rowCount: rows.length, columnCount: Math.max(0, ...rows.map((r) => r.cells.length)),
                        rows: rows.slice(0, 6).map((r) => [...r.cells].slice(0, 8).map((c) => (c.tagName === 'TH' ? 'th' + (c.getAttribute('scope') ? '[' + c.getAttribute('scope') + ']' : '') + ': ' : '') + clipText(c.textContent, 40) + (c === el || c.contains(el) ? ' ←' : ''))),
                        nestedTables: table.querySelectorAll('table').length,
                    };
                }
            }
            // The page's headings in order, the element's marked.
            if (want.includes('outline')) {
                const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')];
                res.outline = hs.slice(0, 40).map((h) => {
                    const level = Number(h.getAttribute('aria-level')) || Number(h.tagName.slice(1)) || 2;
                    return 'h' + level + ' ' + clipText(h.textContent, 80) + (el && (h === el || h.contains(el)) ? ' ←' : '');
                });
            }
            // The page's landmarks (role, name, its first text), its skip links
            // and how much is outside every landmark.
            if (want.includes('landmarks')) {
                const roleOf = (e) => e.getAttribute('role') || ({ HEADER: e.closest('article,aside,main,nav,section') ? null : 'banner', FOOTER: e.closest('article,aside,main,nav,section') ? null : 'contentinfo', NAV: 'navigation', MAIN: 'main', ASIDE: 'complementary', SEARCH: 'search', FORM: (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby')) ? 'form' : null, SECTION: (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby')) ? 'region' : null })[e.tagName] || null;
                const marks = [...document.querySelectorAll('header,footer,nav,main,aside,search,form,section,[role]')].filter((e) => /^(banner|contentinfo|navigation|main|complementary|search|form|region)$/.test(roleOf(e) || ''));
                const skip = [...document.querySelectorAll('a[href^="#"]')].slice(0, 3).filter((a) => /skip|jump|main|content/i.test(a.textContent)).map((a) => ({ text: clipText(a.textContent, 60), to: a.getAttribute('href'), targetExists: !!document.getElementById(a.getAttribute('href').slice(1)) }));
                const inLandmark = (n) => marks.some((m) => m.contains(n));
                const outside = [...document.body.children].filter((c) => !/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(c.tagName) && !inLandmark(c) && !marks.includes(c) && clipText(c.textContent, 1)).slice(0, 5).map((c) => '<' + c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') + (c.className && typeof c.className === 'string' ? '.' + c.className.split(' ')[0] : '') + '> ' + clipText(c.textContent, 60));
                res.landmarks = {
                    list: marks.slice(0, 15).map((m) => ({ role: roleOf(m), name: m.getAttribute('aria-label') || null, firstText: clipText(m.textContent, 60), isElement: el ? (m === el || m.contains(el)) : false })),
                    skipLinks: skip, outsideLandmarks: outside,
                    headings: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
                };
            }
            if (want.includes('pageTitle')) {
                res.pageTitle = {
                    title: document.title,
                    headings: Array.from(document.querySelectorAll('h1,h2')).slice(0, 4).map((h) => h.textContent.trim().slice(0, 120)),
                };
            }
            if (want.includes('image') && el) {
                // The picture behind the element: its own, or for an image map
                // area the <img usemap> of its map, or for an image button its
                // src, loaded off the page to read its pixels.
                let img = el.matches('img') ? el : el.querySelector('img');
                let area = null;
                if (el.matches('area')) {
                    const map = el.closest('map');
                    const key = map ? '#' + (map.getAttribute('name') || map.id) : null;
                    img = key ? [...document.querySelectorAll('img[usemap]')].find((i) => i.getAttribute('usemap') === key) || null : null;
                    const nameOfArea = (a) => (a.getAttribute('aria-label') || a.getAttribute('alt') || a.getAttribute('title') || '').trim().slice(0, 120);
                    area = {
                        shape: el.getAttribute('shape') || 'rect', coords: el.getAttribute('coords'), href: el.getAttribute('href'),
                        alt: el.getAttribute('alt'), title: el.getAttribute('title'), ariaLabel: el.getAttribute('aria-label'),
                        otherAreas: map ? [...map.querySelectorAll('area')].filter((a) => a !== el).slice(0, 10).map((a) => ({ name: nameOfArea(a), href: a.getAttribute('href'), coords: a.getAttribute('coords') })) : [],
                    };
                } else if (el.matches('input[type="image" i]')) {
                    const loaded = new Image();
                    loaded.src = el.src;
                    try { await loaded.decode(); } catch { /* not loadable */ }
                    img = loaded;
                }
                // An object, embed or video: what it embeds, and the picture
                // it shows when that is an image (a video's poster).
                let embedded = null;
                if (el.matches('object, embed, video, canvas')) {
                    const tag = el.tagName.toLowerCase();
                    const url = tag === 'object' ? el.getAttribute('data') : tag === 'embed' ? el.getAttribute('src') : tag === 'video' ? el.getAttribute('poster') : null;
                    const type = el.getAttribute('type');
                    embedded = {
                        tag, type, url,
                        ...(tag === 'video' ? { src: el.currentSrc || el.getAttribute('src') || (el.querySelector('source') || {}).src || null, controls: el.hasAttribute('controls') } : {}),
                        fallbackText: tag === 'object' || tag === 'canvas' ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null,
                        title: el.getAttribute('title'), ariaLabel: el.getAttribute('aria-label'),
                    };
                    const looksImage = url && (/^image\//i.test(type || '') || /\.(png|jpe?g|gif|webp|svg|avif|bmp)(\?|#|$)/i.test(url) || tag === 'video');
                    if (looksImage) {
                        const loaded = new Image();
                        loaded.src = new URL(url, location.href).href;
                        try { await loaded.decode(); } catch { /* not loadable */ }
                        img = loaded;
                    }
                }
                // What the picture shows, read from a canvas never added to the
                // page: blank (transparent), one colour, or how many. A spacer
                // then reads as one. An image from another site cannot be read
                // (the browser keeps its pixels from the page): said so.
                const lookOf = (im) => {
                    if (!im.complete || !im.naturalWidth) return { readable: false, why: 'not loaded' };
                    try {
                        const w = Math.min(im.naturalWidth, 64);
                        const h = Math.min(im.naturalHeight, 64);
                        const canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(im.draw || im, 0, 0, w, h);
                        const d = ctx.getImageData(0, 0, w, h).data;
                        let transparent = 0;
                        const colours = new Map();
                        for (let i = 0; i < d.length; i += 4) {
                            if (d[i + 3] < 16) { transparent++; continue; }
                            const k = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4);
                            colours.set(k, (colours.get(k) || 0) + 1);
                        }
                        const n = d.length / 4;
                        const visible = n - transparent;
                        let top = null;
                        for (const e of colours) if (!top || e[1] > top[1]) top = e;
                        const r2 = (x) => Math.round(x * 100) / 100;
                        return {
                            readable: true,
                            blank: transparent / n >= 0.99,
                            transparentShare: r2(transparent / n),
                            colours: colours.size,
                            ...(top ? { mainColour: '#' + top[0].split(',').map((v) => (Number(v) * 17).toString(16).padStart(2, '0')).join(''), mainColourShare: r2(top[1] / visible) } : {}),
                        };
                    } catch {
                        return { readable: false, why: 'from another site: the browser does not let the page read its pixels' };
                    }
                };
                // An inline SVG: what says what it draws, not its path data:
                // its title and desc, the symbols it uses (an icon sprite's
                // "#icon-search"), its classes and role, and its markup with
                // the path data left out.
                const svgOf = (svg) => {
                    const text = (sel2) => { const n = svg.querySelector(sel2); return n ? n.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : null; };
                    const uses = [...svg.querySelectorAll('use')].map((u) => u.getAttribute('href') || u.getAttribute('xlink:href')).filter(Boolean).slice(0, 5);
                    const markup = svg.outerHTML.replace(/\s(d|points|transform)="[^"]{24,}"/g, ' $1="…"').replace(/>\s+</g, '><');
                    return {
                        title: text('title'), desc: text('desc'), uses,
                        classes: svg.getAttribute('class') || null, role: svg.getAttribute('role'),
                        viewBox: svg.getAttribute('viewBox'), size: [Math.round(svg.getBoundingClientRect().width), Math.round(svg.getBoundingClientRect().height)],
                        shapes: svg.querySelectorAll('path,circle,rect,ellipse,line,polyline,polygon,text,image,use').length,
                        texts: [...svg.querySelectorAll('text')].map((t) => t.textContent.trim()).filter(Boolean).slice(0, 5),
                        markup: markup.slice(0, 600),
                    };
                };
                const svgEl = !img && (el.matches('svg') ? el : el.querySelector('svg'));
                res.image = el.matches('canvas')
                    ? { canvas: true, width: el.width, height: el.height, look: lookOf({ complete: true, naturalWidth: el.width, naturalHeight: el.height, draw: el }), ...(embedded ? { embedded } : {}) }
                    : img
                    ? { src: img.currentSrc || img.src, alt: el.matches('input') ? el.getAttribute('alt') : img.getAttribute('alt'), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, look: lookOf(img), ...(area ? { area } : {}), ...(embedded ? { embedded } : {}) }
                    : embedded ? { embedded }
                    : { inlineSvg: !!svgEl, ...(svgEl ? { svg: svgOf(svgEl) } : {}) };
                res.imageSvgUrl = img && /\.svg(\?|$)/i.test(img.currentSrc || img.src) ? (img.currentSrc || img.src) : null;
            }
            return res;
        }, selector, wanted, CONTEXT_CHARS, IMAGE_CHARS);
        if (read.context) out.context = read.context;
        if (read.pageTitle) out.pageTitle = read.pageTitle;
        if (read.table) out.table = read.table;
        if (read.outline) out.outline = read.outline;
        if (read.landmarks) out.landmarks = read.landmarks;
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

const PROOF_MAX = { width: 1000, height: 700 };

/**
 * A small picture of the element as the page shows it, as a data URL, for a
 * person judging the answer: the proof beside the facts. Taken without
 * scrolling (so the page is as it was left), and only of an element that is
 * shown; null otherwise. Never throws.
 */
/**
 * The contrast of an element's text against what is drawn behind it, read
 * from a picture of it as it is on screen (nothing on the page is changed):
 * pixels unlike the text's colour are taken as its background, and the
 * ratio of the text colour against each is summed up. For text over an
 * image, a gradient, a blend or a filter, which the checker cannot compute.
 * Antialiased edges mix both colours, so the lowest values run low: the
 * tenth percentile is given, not the minimum. Null when not measurable.
 */
async function measurePixels(page, selector) {
    // Exact when the page allows it: the background under each glyph, read
    // with the text made transparent for a moment; by colour otherwise.
    const exact = await measureContrastExact(page, selector);
    if (exact) return exact;
    const byColour = await measurePixelsByColour(page, selector);
    return byColour ? { method: 'colour', ...byColour } : null;
}

/**
 * The contrast of an element's text against the background under its
 * glyphs, read exactly: a picture with the text, then the same picture with
 * the text made transparent (its colour, shadow and stroke, on it and in
 * it, transitions off), so each glyph's pixels show what lies under them.
 * The page is changed for that moment only: every touched style attribute
 * is put back as it was, and a fingerprint before and after must show the
 * same page, or the measurement is dropped (null, and the caller falls back
 * to the colour method). Never throws.
 */
async function measureContrastExact(page, selector) {
    if (!selector || typeof page.screenshot !== 'function') return null;
    const before = await fingerprint(page);
    if (!before) return null;
    let touched = false;
    try {
        const box = await page.evaluate((sel) => {
            let el = null;
            try { el = document.querySelector(sel); } catch { return null; }
            if (!el) return null;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return null;
            const cs = getComputedStyle(el);
            const m = cs.color.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/);
            if (!m) return null;
            return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height, color: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]), fontSize: parseFloat(cs.fontSize), fontWeight: Number(cs.fontWeight) || 400 };
        }, selector);
        if (!box) return null;
        const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 800), height: Math.min(box.height, 300) };
        const sharp = require('sharp');
        const raw = async () => (await sharp(await page.screenshot({ type: 'png', clip, captureBeyondViewport: true })).removeAlpha().raw().toBuffer());
        const withText = await raw();
        touched = true;
        await page.evaluate((sel, key) => {
            const el = document.querySelector(sel);
            const all = [el, ...el.querySelectorAll('*')];
            window[key] = all.map((e) => [e, e.getAttribute('style')]);
            for (const e of all) {
                for (const [k, v] of [['transition', 'none'], ['color', 'transparent'], ['-webkit-text-fill-color', 'transparent'], ['text-shadow', 'none'], ['-webkit-text-stroke-color', 'transparent'], ['caret-color', 'transparent']]) e.style.setProperty(k, v, 'important');
            }
        }, selector, '__a11yContrastStyles');
        const without = await raw();
        await page.evaluate((key) => {
            for (const [e, style] of window[key] || []) { if (style === null) e.removeAttribute('style'); else e.setAttribute('style', style); }
            delete window[key];
        }, '__a11yContrastStyles');
        touched = false;
        const after = await fingerprint(page);
        const changed = viewChanges(before, after);
        if (!after || (changed && changed.length) || before.dom !== after.dom) return null;
        if (withText.length !== without.length) return null;
        const lum = (r, g, b) => { const c = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
        const text = lum(...box.color);
        const under = [];
        for (let i = 0; i < withText.length; i += 3) {
            const d = Math.abs(withText[i] - without[i]) + Math.abs(withText[i + 1] - without[i + 1]) + Math.abs(withText[i + 2] - without[i + 2]);
            if (d < 60) continue; // no glyph here
            const l = lum(without[i], without[i + 1], without[i + 2]);
            under.push((Math.max(l, text) + 0.05) / (Math.min(l, text) + 0.05));
        }
        if (under.length < 10) return null;
        under.sort((a, b) => a - b);
        const at = (q) => Math.round(under[Math.floor(q * (under.length - 1))] * 100) / 100;
        const share = (t) => Math.round((under.filter((x) => x < t).length / under.length) * 100) / 100;
        return {
            method: 'exact', measured: true,
            textColour: '#' + box.color.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), textAlpha: box.alpha,
            fontSize: box.fontSize, fontWeight: box.fontWeight,
            ratioP10: at(0.1), ratioMedian: at(0.5), ratioMin: at(0), shareBelow4_5: share(4.5), shareBelow3: share(3), glyphPixels: under.length,
        };
    } catch {
        if (touched) {
            try {
                await page.evaluate((key) => { for (const [e, style] of window[key] || []) { if (style === null) e.removeAttribute('style'); else e.setAttribute('style', style); } delete window[key]; }, '__a11yContrastStyles');
            } catch { /* the fingerprint of the pass will say */ }
        }
        return null;
    }
}

// By colour: pixels unlike the text's colour are taken as its background.
async function measurePixelsByColour(page, selector) {
    if (!selector || typeof page.screenshot !== 'function') return null;
    try {
        const box = await page.evaluate((sel) => {
            let el = null;
            try { el = document.querySelector(sel); } catch { return null; }
            if (!el) return null;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return null;
            const m = getComputedStyle(el).color.match(/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/);
            if (!m) return null;
            return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height, color: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]), fontSize: parseFloat(getComputedStyle(el).fontSize), fontWeight: Number(getComputedStyle(el).fontWeight) || 400 };
        }, selector);
        if (!box) return null;
        const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 800), height: Math.min(box.height, 300) };
        const png = await page.screenshot({ type: 'png', clip, captureBeyondViewport: true });
        const sharp = require('sharp');
        const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const lum = (r, g, b) => { const c = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b); };
        const text = lum(...box.color);
        const ratios = [];
        let near = 0;
        for (let i = 0; i < data.length; i += 3) {
            const l = lum(data[i], data[i + 1], data[i + 2]);
            const ratio = (Math.max(l, text) + 0.05) / (Math.min(l, text) + 0.05);
            if (ratio >= 1.3) ratios.push(ratio); else near++;
        }
        // Pixels almost the text's colour: the glyphs, and any background of
        // that colour. Glyphs cover about a fifth of a text box; far more
        // means the background itself is close to the text colour.
        const nearTextShare = Math.round((near / (data.length / 3)) * 100) / 100;
        if (ratios.length < 20) return { measured: true, nearTextShare, why: 'nearly everything is the text colour' };
        ratios.sort((a, b) => a - b);
        const at = (q) => Math.round(ratios[Math.floor(q * (ratios.length - 1))] * 100) / 100;
        const share = (t) => Math.round((ratios.filter((x) => x < t).length / ratios.length) * 100) / 100;
        return {
            measured: true, textColour: '#' + box.color.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), textAlpha: box.alpha,
            fontSize: box.fontSize, fontWeight: box.fontWeight,
            nearTextShare, ratioP10: at(0.1), ratioMedian: at(0.5), shareBelow4_5: share(4.5), shareBelow3: share(3), backgroundPixels: ratios.length,
        };
    } catch {
        return null;
    }
}

async function captureProof(page, selector) {
    if (!selector || typeof page.screenshot !== 'function') return null;
    try {
        const box = await page.evaluate((sel) => {
            let el = null;
            try { el = document.querySelector(sel); } catch { return null; }
            if (!el) return null;
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === 'hidden') return null;
            return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
        }, selector);
        if (!box) return null;
        const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, PROOF_MAX.width), height: Math.min(box.height, PROOF_MAX.height), scale: 1 };
        const data = await page.screenshot({ type: 'jpeg', quality: 60, clip, captureBeyondViewport: true, encoding: 'base64' });
        return data ? 'data:image/jpeg;base64,' + data : null;
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
            // What the page shows: its elements in order, its rendered text
            // (innerText holds only what is shown) and how many elements are
            // visible. An attribute a component sets as focus passes
            // (focus="none", a roving tabindex) does not change it; something
            // left open, added or removed does.
            let view = 0;
            try {
                const all = [...document.body.querySelectorAll('*')];
                const shown = all.filter((e) => (typeof e.checkVisibility === 'function' ? e.checkVisibility() : true)).length;
                view = hash(all.map((e) => e.tagName).join(',') + '|' + document.body.innerText + '|' + shown);
            } catch { /* no body */ }
            return {
                url: location.href,
                dom: hash(document.documentElement.outerHTML),
                view,
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

// For the walks: the same page as far as anyone can see or use it, its
// markup aside (`dom` left out: a component's attribute changed as focus
// passed is not a changed page). Returns the keys that differ, [] when the
// same, or null when one could not be read.
function viewChanges(a, b) {
    if (!a || !b) return null;
    return Object.keys(b).filter((k) => k !== 'dom' && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

module.exports = { collectEvidence, readFacts, captureProof, measurePixels, fingerprint, sameFingerprint, viewChanges };
