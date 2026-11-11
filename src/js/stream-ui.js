'use strict';

import {createImg} from './a11y-ui.utils.js';
import {resultGlyphEl} from './result-glyph.js';

/** Small, reusable URL row block */
export function buildUrlRow(url, {escapeHtml, escapeAttr}) {
    const row = document.createElement('div');
    row.className = 'stream-url line-ellipsis one-line-ellipsis';
    const escapedURL = escapeHtml(url);
    row.innerHTML = `<a href="${escapeAttr(url)}" target="_blank" title="${escapedURL}" rel="noopener noreferrer">${escapedURL}</a>`;
    return row;
}

/* ==================== Internal helpers ==================== */

function createCard(kind) {
    const card = document.createElement('article');
    card.className = 'stream-card';
    card.dataset.kind = kind;
    return card;
}

// Each state's count takes its own state colour, same as ResultBadge —
// never a single flat muted tone for a multi-state tally.
function buildCountsNodes(counts) {
    const fail = counts?.violations ?? 0;
    const cantTell = counts?.incomplete ?? 0;
    const pass = counts?.passes ?? 0;

    // None failing is said as such: "0 fail" beside the red glyph read as a failure.
    const failEl = document.createElement('span');
    failEl.className = fail === 0 ? 'stream-nofail' : 'stream-fail';
    if (fail === 0) failEl.textContent = 'No failures';
    else failEl.append(resultGlyphEl('fail'), ` ${fail} fail`);

    const cantTellEl = document.createElement('span');
    cantTellEl.className = 'stream-cantTell';
    cantTellEl.append(resultGlyphEl('cantTell'), ` ${cantTell} can't tell`);

    const passEl = document.createElement('span');
    passEl.className = 'stream-pass';
    passEl.append(resultGlyphEl('pass'), ` ${pass} pass`);

    return [failEl, ', ', cantTellEl, ', ', passEl];
}

function buildMetaLine({context}, children = []) {
    const meta = document.createElement('div');
    meta.className = 'stream-meta';

    const bits = [];
    if (context) bits.push(`Context: ${context}`);

    const normalizedChildren = (Array.isArray(children) ? children : [children]).filter((child) => child != null);

    meta.textContent = bits.join(' · ');
    if (bits.length && normalizedChildren.length) meta.append(document.createTextNode(': '));
    normalizedChildren.forEach((child) => {
        if (child == null) return;
        meta.append(child.nodeType ? child : document.createTextNode(child));
    });
    return meta;
}

// A screenshot's text alternative: "Screenshot: Home", which also names the
// button that opens it larger, for a scan ("Scan: Home") or a caption.
export function screenshotAlt(name) {
    const n = String(name || '').replace(/^Scan:\s*/, '').trim();
    if (!n) return 'Screenshot';
    return /screenshot/i.test(n) ? n : `Screenshot: ${n}`;
}

// Builds the framed thumbnail used by every stream card: a `.screenshot-btn`
// wrapper holding an aspect-ratio-locked box around the image. `tag` picks the
// element — a <button> for the live cards (which open the lightbox) or an <a>
// for the "all scans" dialog cards, where the image itself is the link to the
// scan's result section.
function buildThumbFrame({previewUrl, alt, viewportRatio, tag = 'button'}) {
    const frame = document.createElement(tag);
    if (tag === 'button') frame.type = 'button';
    frame.className = 'screenshot-btn';

    const inner = document.createElement('span');
    inner.style.aspectRatio = viewportRatio;
    if (viewportRatio > 1) {
        inner.style.width = '100%';
        inner.style.height = 'auto';
    } else {
        inner.style.width = 'auto';
        inner.style.height = '100%';
    }

    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = alt || 'Screenshot';

    inner.appendChild(img);
    frame.appendChild(inner);
    return {frame, img};
}

function buildPreviewButton({previewUrl, alt, dialogs, viewportRatio}) {
    const preview = document.createElement('div');
    const {liveStreamDialog} = dialogs;
    preview.className = 'stream-preview';

    const {frame} = buildThumbFrame({previewUrl, alt, viewportRatio, tag: 'button'});
    frame.onclick = () => {
        liveStreamDialog.openById(previewUrl);
    };

    preview.appendChild(frame);
    return preview;
}

function safeJsonStringify(value, fallback = '{}') {
    try {
        return JSON.stringify(value);
    } catch {
        return fallback;
    }
}

function renderCaptionDebugIfNeeded({card, rawCaption, localVars, deps}) {
    if (!deps.isDebug?.()) return;

    const unresolved = deps.findUnresolvedVars?.(deps.resolveLabelTemplate(rawCaption, localVars || {})) || [];
    const existingDbg = card.querySelector('.stream-caption-debug');

    if (unresolved.length) {
        const dbg = existingDbg || document.createElement('div');
        dbg.className = 'stream-caption-debug';
        dbg.textContent = `Unresolved vars: ${unresolved.join(', ')}`;
        dbg.style.fontSize = '12px';
        dbg.style.opacity = '0.7';
        dbg.style.marginTop = '4px';
        if (!existingDbg) card.appendChild(dbg);
    } else if (existingDbg) {
        existingDbg.remove();
    }
}

function formatTopRules(list, maxItems = 6) {
    const arr = Array.isArray(list) ? list : [];
    return arr
        .slice(0, Math.max(0, maxItems))
        .map((x) => {
            const id = x && x.id ? String(x.id) : '';
            const nodes = Number(x && x.nodes);
            if (!id) return '';
            return Number.isFinite(nodes) && nodes >= 0 ? `${id} (${nodes})` : id;
        })
        .filter(Boolean)
        .join(', ');
}

function formatImpactCounts(counts) {
    if (!counts || typeof counts !== 'object') return '';
    const order = ['critical', 'serious', 'moderate', 'minor', 'unknown'];
    const parts = [];
    for (const k of order) {
        const n = Number(counts[k]);
        if (Number.isFinite(n) && n > 0) parts.push(`${k} ${n}`);
    }
    return parts.join(', ');
}

/* ==================== Card renderers ==================== */

// Appends the shared textual body of a scan card — title, the state-coloured
// counts line, the "⏱ duration · DOM nodes" line, optional top-violations, and
// the URL row — to `card`. The live-preview card and the "all scans" dialog card
// both build on this so their content stays pixel-identical; only the thumbnail
// treatment differs (a lightbox button live, a plain image in the dialog).
function buildScanCardTitle(props, {resolveLabelTemplate}) {
    const titleEl = document.createElement('div');
    titleEl.className = 'stream-card-title line-ellipsis two-line-ellipsis';
    const content = 'Scan: ' + (resolveLabelTemplate(props.label) || 'a11y scan');
    titleEl.textContent = content;
    titleEl.setAttribute('title', content);
    titleEl.dataset.rawLabel = props.label || '';
    return titleEl;
}

export function appendScanCardContent(card, props, deps) {
    const titleEl = buildScanCardTitle(props, deps);
    card.appendChild(titleEl);

    card.appendChild(buildMetaLine({
        context: props.context
    }, buildCountsNodes(props.counts)));
    if (props.meta && typeof props.meta === 'object') {
        const bits = [];

        const ms = Number(props.meta.durationMs);
        if (Number.isFinite(ms) && ms >= 0) {
            // keep it readable, in seconds when large
            const sec = ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
            bits.push(`⏱ ${sec}`);
        }

        const dom = Number(props.meta.estimatedNodes);
        if (Number.isFinite(dom) && dom > 0) bits.push(`DOM ${dom}`);
        if (bits.length) {
            const info = document.createElement('div');
            info.className = 'stream-counts line-ellipsis two-line-ellipsis';
            const txt = bits.join(' · ');
            info.textContent = txt;
            info.setAttribute('title', txt);
            card.appendChild(info);
        }
    }
    // Optional lightweight scan preview (top rules, impact counts)
    if (props.preview && typeof props.preview === 'object') {
        const vio = formatTopRules(props.preview.violationsTop, 6);
        if (vio) {
            const el = document.createElement('div');
            el.className = 'stream-counts line-ellipsis two-line-ellipsis';
            const txt = `Top violations: ${vio}`;
            el.textContent = txt;
            el.setAttribute('title', txt);
            card.appendChild(el);
        }
    }

    if (props.url) card.appendChild(buildUrlRow(props.url, deps));

    return titleEl;
}

/** In place of an image the server no longer keeps for the live view. */
function appendDroppedNote(card, props) {
    if (props.previewUrl || !props.screenshotDropped) return;
    const note = document.createElement('p');
    note.className = 'stream-note';
    note.textContent = 'Screenshot not kept for the live view. It is in the report.';
    card.appendChild(note);
}

export function renderScanCard(props, deps) {
    const card = createCard('scan');

    const titleEl = appendScanCardContent(card, props, deps);

    if (props.previewUrl) {
        const {liveStreamDialog, scansDialog, screenshotsDialog} = deps.dialogs;
        const alt = screenshotAlt(titleEl.textContent);
        card.appendChild(
            buildPreviewButton({
                previewUrl: props.previewUrl,
                alt,
                dialogs: deps.dialogs,
                viewportRatio: props.viewportRatio
            })
        );

        createImg({src: props.previewUrl, alt}, [liveStreamDialog, scansDialog]);
    }
    appendDroppedNote(card, props);

    return card;
}

export function renderScreenshotCard(props, deps) {
    const {resolveLabelTemplate} = deps;

    const card = createCard('screenshot');

    const resolvedCaption = resolveLabelTemplate(props.caption || 'Screenshot', props.localVars);

    const titleEl = document.createElement('div');
    titleEl.className = 'stream-caption stream-card-title line-ellipsis two-line-ellipsis';
    titleEl.dataset.rawCaption = props.caption || 'Screenshot';
    titleEl.dataset.localVars = safeJsonStringify(props.localVars || {}, '{}');
    titleEl.textContent = 'Screenshot' + (resolvedCaption !== 'Screenshot' ? ': ' + resolvedCaption : '');
    card.appendChild(titleEl);

    if (props.url) card.appendChild(buildUrlRow(props.url, deps));

    renderCaptionDebugIfNeeded({
        card,
        rawCaption: titleEl.dataset.rawCaption,
        localVars: props.localVars || {},
        deps
    });

    if (props.previewUrl) {
        const {liveStreamDialog, scansDialog, screenshotsDialog} = deps.dialogs;
        card.appendChild(
            buildPreviewButton({
                previewUrl: props.previewUrl,
                alt: screenshotAlt(resolvedCaption),
                dialogs: deps.dialogs,
                viewportRatio: props.viewportRatio
            })
        );

        createImg({src: props.previewUrl, alt: screenshotAlt(resolvedCaption)}, [liveStreamDialog, screenshotsDialog]);
    }
    appendDroppedNote(card, props);

    return card;
}

export function renderSkippedCard(props, deps) {
    const {resolveLabelTemplate} = deps;

    const card = createCard('skipped');

    const h3 = document.createElement('h3');
    h3.textContent = 'Scan skipped: ' + (resolveLabelTemplate(props.label) || 'a11y scan');
    card.appendChild(h3);

    if (props.url) card.appendChild(buildUrlRow(props.url, deps));

    card.appendChild(buildMetaLine({context: props.context}));

    const reasonEl = document.createElement('div');
    reasonEl.className = 'stream-counts';

    const reasonTxt = [];
    if (props.localVars?.reason) reasonTxt.push(props.localVars.reason);
    if (props.localVars?.estimatedNodes != null && props.localVars?.threshold != null) {
        reasonTxt.push(`estimated nodes: ${props.localVars.estimatedNodes} (threshold: ${props.localVars.threshold})`);
    }
    reasonEl.textContent = reasonTxt.join(' · ');
    card.appendChild(reasonEl);

    const ul = document.createElement('ul');
    (Array.isArray(props.localVars?.suggestions) ? props.localVars.suggestions : []).forEach((s) => {
        const li = document.createElement('li');
        li.textContent = s;
        ul.appendChild(li);
    });
    card.appendChild(ul);

    return card;
}

/**
 * Builds one card for the "View all scans" dialog.
 *
 * The card itself is a plain <article> — same design and contents as the
 * live-preview scan card (title, counts, "⏱ duration · DOM nodes", and the
 * scanned-page URL as a real link). Only the screenshot is interactive: it is
 * the link to the scan's result section (#sc-<id>), mirroring the live card
 * where the image is the clickable element. The anchor navigation works in the
 * app and the exported HTML alike; JS only closes the dialog on that click.
 *
 * The card carries the same marker classes the summary list rows use
 * (`scan-filtered-out`, `scan-summary-excluded`) so the tag-filter /
 * hide-excluded toggles and the report exporter treat it identically to the
 * matching list row.
 */
export function renderAllScansCard(props, deps) {
    const card = document.createElement('article');
    card.className = 'stream-card all-scans-card';
    card.dataset.kind = 'scan';
    // Lets a reorder retarget this card by id instead of rebuilding the dialog.
    if (props.scanId) card.dataset.scanId = props.scanId;
    if (props.sort) {
        card.setAttribute('data-sort-order', String(props.sort.order));
        card.setAttribute('data-sort-failures', String(props.sort.failures));
        card.setAttribute('data-sort-occurrences', String(props.sort.occurrences));
    }
    if (props.filteredOut) card.classList.add('scan-filtered-out');
    if (props.excluded) card.classList.add('scan-summary-excluded');
    if (props.skipped) card.classList.add('all-scans-card-skipped');
    if (props.failureFree) card.classList.add('scan-no-failures');

    if (props.skipped) {
        // Skipped scans have no counts/duration/DOM/thumbnail — mirror the
        // summary list, which shows them as "skipped, <reason>".
        card.appendChild(buildScanCardTitle(props, deps));
        const line = document.createElement('div');
        line.className = 'stream-counts line-ellipsis two-line-ellipsis';
        const reason = props.skipInfo && props.skipInfo.reason ? props.skipInfo.reason : 'reason not provided';
        const txt = `Skipped — ${reason}`;
        line.textContent = txt;
        line.setAttribute('title', txt);
        card.appendChild(line);
        if (props.url) card.appendChild(buildUrlRow(props.url, deps));
    } else {
        appendScanCardContent(card, props, deps);
    }

    if (props.excluded) {
        const badge = document.createElement('span');
        badge.className = 'scan-excluded-badge';
        badge.textContent = 'Excluded';
        card.appendChild(badge);
    }

    if (props.previewUrl) {
        const preview = document.createElement('div');
        preview.className = 'stream-preview';
        const label = deps.resolveLabelTemplate(props.label) || 'this scan';
        // The image is the click target that jumps to the scan's result section.
        const {frame, img} = buildThumbFrame({
            previewUrl: props.previewUrl,
            alt: 'Scan: ' + label + ' preview',
            viewportRatio: props.viewportRatio,
            tag: 'a'
        });
        frame.classList.add('all-scans-thumb');
        if (props.scanId) frame.setAttribute('href', `#sc-${props.scanId}`);
        frame.setAttribute('aria-label', `Go to results for ${label}`);
        // Many thumbnails may be off-screen in the grid until scrolled to.
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        preview.appendChild(frame);
        card.appendChild(preview);
    }

    return card;
}

/**
 * Factory that returns addStreamCard(props).
 * It resolves the grid + section at call time so it works after resets.
 */
export function createStreamCardAdder(deps) {
    return function addStreamCard(props) {
        if (!deps.getUseLiveStream?.()) return;

        let grid = deps.getGrid?.();
        const stream = deps.getStream?.();
        const carousel = deps.carousel;
        if (carousel) {
            grid = carousel;
        }
        if (!grid || !stream) return;

        let card = null;
        if (props.kind === 'scan') card = renderScanCard(props, deps);
        else if (props.kind === 'screenshot') card = renderScreenshotCard(props, deps);
        else if (props.kind === 'skipped') card = renderSkippedCard(props, deps);

        if (!card) return;

        grid.append(card);
        stream.style.display = 'block';
    };
}
