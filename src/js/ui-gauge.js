/**
 * Two gauge builders, matching the design system's ScoreGauge / RatingGauge split:
 *
 * - buildScoreGauge: a single-arc pass-rate reading. The number is the point;
 *   the arc is only ever a second reading of it. Always green ("pass") — a
 *   pass-rate gauge MUST also state its unresolved share in words, never show
 *   a bare percentage alone.
 *
 * - buildRatingGauge: the speedometer. A needle across up to four labelled
 *   bands (poor -> good), for rating a value against thresholds rather than
 *   reporting what a run found. The band name always prints beside the
 *   number — colour is the second reading, never the only one. Each band
 *   also carries a diagonal-stripe overlay so the reading survives greyscale
 *   without relying on the band label being read.
 *
 * Both keep a semantic <meter> in the DOM (visually hidden) for assistive
 * tech and print.
 *
 * Returns: HTMLElement (root container) or HTML string when asText === true
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function roundTo(n, decimals) {
    const p = Math.pow(10, decimals);
    return Math.round(n * p) / p;
}

function slugify(s) {
    return String(s)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'band';
}

function buildHiddenMeter({ idPrefix, min, max, value, labelId, low, high, optimum, fmtValue }) {
    const meter = document.createElement('meter');
    meter.className = 'scoreGauge__meter';
    meter.min = String(min);
    meter.max = String(max);
    meter.value = String(value);
    meter.setAttribute('aria-labelledby', labelId);
    if (typeof low === 'number') meter.low = low;
    if (typeof high === 'number') meter.high = high;
    if (typeof optimum === 'number') meter.optimum = optimum;
    meter.textContent = fmtValue(value);
    return meter;
}

function buildTop({ name, labelId, activeColor }) {
    const top = document.createElement('div');
    top.className = 'scoreGauge__top';

    const nameEl = document.createElement('h4');
    nameEl.className = 'scoreGauge__name';
    nameEl.id = labelId;
    nameEl.textContent = name;
    if (activeColor) nameEl.style.setProperty('--activeColor', activeColor);

    top.appendChild(nameEl);
    return top;
}

// "? 12% can't tell": the glyph repeats what the words already say, so it is
// decorative and must not be announced as a bare character.
function buildUnresolved({ className, text }) {
    const el = document.createElement(className === 'inline' ? 'span' : 'div');
    el.className = 'scoreGauge__unresolved';

    const glyph = document.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '?';

    el.append(glyph, ` ${text}`);
    return el;
}

function finalize(root, asText) {
    if (!asText) return root;
    const d = document.createElement('div');
    d.appendChild(root);
    return d.innerHTML;
}

/* ---------------- ScoreGauge: single arc, a pass-rate reading ---------------- */

export function buildScoreGauge({
                                     name = 'Score',
                                     value,
                                     min = 0,
                                     max = 100,
                                     isPercent = true,
                                     idPrefix = 'scoreGauge',
                                     asText = false,
                                     help = undefined,
                                     // Optional qualitative reading shown as text under the number
                                     // (e.g. "Strong") — kept because it's useful context, but this
                                     // never drives the arc's colour: green means pass, always.
                                     statusLabel = undefined,
                                     // Share of the same denominator that is unresolved. A pass-rate
                                     // reading must never stand alone as a bare percentage.
                                     unresolvedPct = undefined,
                                     // Free-text version of the same idea, for a reading whose caveat
                                     // is not a share of unresolved checks - "measured on 5% of
                                     // findings", say. Rendered in the same place, and only one of
                                     // the two is ever shown.
                                     qualifier = undefined,
                                     size = 168,
                                     thickness = 10
                                 } = {}) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error('buildScoreGauge: value must be a number');
    }
    if (max <= min) throw new Error('buildScoreGauge: max must be greater than min');

    const pct = clamp(((value - min) / (max - min)) * 100, 0, 100);
    const unitSuffix = isPercent ? '%' : '';
    const fmtNumber = (n) => (Number.isInteger(n) ? String(n) : String(roundTo(n, 2)));
    const fmtValue = (n) => `${fmtNumber(n)}${unitSuffix}`;

    const uid = `${idPrefix}-${Math.random().toString(36).slice(2, 9)}`;
    const labelId = `${uid}-label`;

    const root = document.createElement('article');
    root.className = 'scoreGauge scoreGauge--arc';
    root.setAttribute('aria-labelledby', labelId);

    const top = buildTop({ name, labelId, activeColor: 'var(--ok)' });
    root.appendChild(top);

    root.appendChild(buildHiddenMeter({
        idPrefix, min, max, value, labelId,
        low: min + (max - min) / 3, high: min + (max - min) * 2 / 3, optimum: max,
        fmtValue
    }));

    // ---- Visual: half-dial, track + single value arc ----
    const c = size / 2;
    const r = (size - thickness) / 2;
    const sweep = Math.PI * r;
    const height = c + thickness / 2;
    const path = `M ${thickness / 2} ${c} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${c}`;

    const visual = document.createElement('div');
    visual.className = 'scoreGauge__visual';
    // As wide as its card, up to its own size: a narrow card shrinks the dial
    // rather than cutting it off.
    visual.style.width = '100%';
    visual.style.maxWidth = `${size}px`;

    const svg = svgEl('svg', { width: size, height, viewBox: `0 0 ${size} ${height}`, 'aria-hidden': 'true' });
    svg.style.display = 'block';
    svg.style.width = '100%';
    svg.style.height = 'auto';

    svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: 'var(--border-soft)', 'stroke-width': thickness, 'stroke-linecap': 'butt' }));
    svg.appendChild(svgEl('path', {
        d: path, fill: 'none', stroke: 'var(--ok)', 'stroke-width': thickness, 'stroke-linecap': 'butt',
        'stroke-dasharray': `${(sweep * pct) / 100} ${sweep}`
    }));
    visual.appendChild(svg);

    const readout = document.createElement('div');
    readout.className = 'scoreGauge__readout';

    const valueStrong = document.createElement('span');
    valueStrong.className = 'scoreGauge__value';
    valueStrong.textContent = fmtNumber(Math.round(pct * (max - min) / 100 + min));

    const unitSpan = document.createElement('span');
    unitSpan.className = 'scoreGauge__unit';
    unitSpan.textContent = unitSuffix;

    readout.append(valueStrong, unitSpan);
    visual.appendChild(readout);
    root.appendChild(visual);

    const bottom = document.createElement('div');
    bottom.className = 'scoreGauge__bottom';

    if (typeof unresolvedPct === 'number' && unresolvedPct > 0) {
        bottom.appendChild(buildUnresolved({
            className: 'block',
            text: `${fmtNumber(roundTo(unresolvedPct, 0))}% can't tell`
        }));
    } else if (typeof qualifier === 'string' && qualifier.trim()) {
        bottom.appendChild(buildUnresolved({ className: 'block', text: qualifier.trim() }));
    }

    if (statusLabel) {
        const statusEl = document.createElement('div');
        statusEl.className = 'scoreGauge__status';
        statusEl.textContent = statusLabel;
        bottom.appendChild(statusEl);
    }

    root.appendChild(bottom);

    if (typeof help === 'string' && help.trim().length) {
        const helpEl = document.createElement('div');
        helpEl.className = 'scoreGauge__help';
        helpEl.innerHTML = help;
        root.appendChild(helpEl);
    }

    return finalize(root, asText);
}

/* ---------------- RatingGauge: the speedometer ---------------- */

// Low to good. The two greens are the accent's own light- and dark-surface
// tones, so "improving" is read as the accent getting brighter.
const RAMP = ['var(--danger)', 'var(--warn)', 'var(--ok-deep)', 'var(--ok)'];
const STRIPE_EVEN = 'rgba(255,255,255,.22)';
const STRIPE_ODD = 'rgba(0,0,0,.16)';

export function buildRatingGauge({
                                      name = 'Rating',
                                      value,
                                      min = 0,
                                      max = 100,
                                      intervals = [], // [{ from, to, label, key? }, ...] — up to ~4 bands, low to good
                                      isPercent = true,
                                      idPrefix = 'ratingGauge',
                                      asText = false,
                                      help = undefined,
                                      size = 200,
                                      thickness = 12,
                                      // Share of the same denominator that is unresolved. A pass-rate
                                      // reading must never stand alone as a bare percentage.
                                      unresolvedPct = undefined,
                                      // Free-text version of the same idea; see buildScoreGauge.
                                      qualifier = undefined
                                  } = {}) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error('buildRatingGauge: value must be a number');
    }
    if (max <= min) throw new Error('buildRatingGauge: max must be greater than min');

    const span = max - min;
    const clamped = clamp(value, min, max);
    const pct = ((clamped - min) / span) * 100;
    const unitSuffix = isPercent ? '%' : '';
    const fmtNumber = (n) => (Number.isInteger(n) ? String(n) : String(roundTo(n, 2)));
    const fmtValue = (n) => `${fmtNumber(n)}${unitSuffix}`;

    const sortedIntervals = (intervals.length ? intervals : [{ from: min, to: max, label: name }])
        .slice()
        .sort((a, b) => a.from - b.from);
    const bandCount = sortedIntervals.length;
    // Always span the full ramp low -> good, regardless of how many bands
    // this metric defines — a 3-band scale still reaches the brightest
    // green at its top band, same as a 4-band one, so "good" reads the
    // same way across every gauge.
    const rampIndexFor = (i) => bandCount > 1
        ? Math.round((i * (RAMP.length - 1)) / (bandCount - 1))
        : RAMP.length - 1;
    const bands = sortedIntervals.map((b, i) => ({
        from: clamp(b.from, min, max),
        to: clamp(b.to, min, max),
        label: b.label || `Band ${i + 1}`,
        key: b.key ? String(b.key) : slugify(b.label || `band-${i}`),
        color: RAMP[rampIndexFor(i)]
    }));

    const current = bands.find((b) => clamped >= b.from && clamped <= b.to) || bands[bands.length - 1];

    const uid = `${idPrefix}-${Math.random().toString(36).slice(2, 9)}`;
    const labelId = `${uid}-label`;

    const root = document.createElement('article');
    root.className = 'scoreGauge scoreGauge--rating';
    root.setAttribute('aria-labelledby', labelId);

    const top = buildTop({ name, labelId, activeColor: current.color });
    root.appendChild(top);

    root.appendChild(buildHiddenMeter({
        idPrefix, min, max, value: clamped, labelId,
        low: bands[0] ? bands[0].to : undefined,
        high: bands[bands.length - 1] ? bands[bands.length - 1].from : undefined,
        optimum: max,
        fmtValue
    }));

    // ---- Visual: half-dial, banded arcs + needle ----
    const c = size / 2;
    const r = (size - thickness) / 2;
    const sweep = Math.PI * r;
    const height = c + thickness / 2;
    const path = `M ${thickness / 2} ${c} A ${r} ${r} 0 0 1 ${size - thickness / 2} ${c}`;

    const visual = document.createElement('div');
    visual.className = 'scoreGauge__visual';
    // As wide as its card, up to its own size: a narrow card shrinks the dial
    // rather than cutting it off.
    visual.style.width = '100%';
    visual.style.maxWidth = `${size}px`;

    const svg = svgEl('svg', { width: size, height, viewBox: `0 0 ${size} ${height}`, 'aria-hidden': 'true' });
    svg.style.display = 'block';
    svg.style.width = '100%';
    svg.style.height = 'auto';

    svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: 'var(--border-soft)', 'stroke-width': thickness, 'stroke-linecap': 'butt' }));

    const defs = svgEl('defs');
    svg.appendChild(defs);

    bands.forEach((band, i) => {
        const from = ((band.from - min) / span) * 100;
        const to = ((band.to - min) / span) * 100;
        const dash = `${(sweep * (to - from)) / 100} ${sweep}`;
        const offset = -(sweep * from) / 100;

        svg.appendChild(svgEl('path', {
            d: path, fill: 'none', stroke: band.color, 'stroke-width': thickness, 'stroke-linecap': 'butt',
            'stroke-dasharray': dash, 'stroke-dashoffset': offset
        }));

        // Colorblind-safe redundancy: a diagonal-stripe overlay, alternating
        // direction per band, on top of the solid band colour.
        const patternId = `${uid}-stripe-${i}`;
        const pattern = svgEl('pattern', {
            id: patternId, width: 8, height: 8, patternUnits: 'userSpaceOnUse',
            patternTransform: `rotate(${i % 2 === 0 ? 135 : 45})`
        });
        pattern.appendChild(svgEl('rect', { width: 4, height: 8, fill: i % 2 === 0 ? STRIPE_EVEN : STRIPE_ODD }));
        defs.appendChild(pattern);

        svg.appendChild(svgEl('path', {
            d: path, fill: 'none', stroke: `url(#${patternId})`, 'stroke-width': thickness, 'stroke-linecap': 'butt',
            'stroke-dasharray': dash, 'stroke-dashoffset': offset
        }));
    });

    // Needle
    const angle = Math.PI * (1 - pct / 100);
    const nx = c + (r - thickness * 0.9) * Math.cos(angle);
    const ny = c - (r - thickness * 0.9) * Math.sin(angle);
    svg.appendChild(svgEl('line', { x1: c, y1: c, x2: nx, y2: ny, stroke: 'var(--text-main)', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    svg.appendChild(svgEl('circle', { cx: c, cy: c, r: 4, fill: 'var(--text-main)' }));

    visual.appendChild(svg);

    const readout = document.createElement('div');
    readout.className = 'scoreGauge__readout scoreGauge__readout--rating';

    const readoutMain = document.createElement('div');
    readoutMain.className = 'scoreGauge__readoutMain';

    const valueStrong = document.createElement('span');
    valueStrong.className = 'scoreGauge__value';
    valueStrong.textContent = fmtValue(Math.round(clamped));

    const statusEl = document.createElement('span');
    statusEl.className = 'scoreGauge__status';
    statusEl.dataset.band = current.key;
    statusEl.style.color = current.color;
    statusEl.textContent = current.label;

    readoutMain.append(valueStrong, statusEl);
    readout.appendChild(readoutMain);

    // Sits beside the value instead of on its own line, so a gauge with
    // unresolvedPct doesn't grow taller than one without it.
    if (typeof unresolvedPct === 'number' && unresolvedPct > 0) {
        readout.appendChild(buildUnresolved({
            className: 'inline',
            text: `${fmtNumber(roundTo(unresolvedPct, 0))}% can't tell`
        }));
    } else if (typeof qualifier === 'string' && qualifier.trim()) {
        readout.appendChild(buildUnresolved({ className: 'inline', text: qualifier.trim() }));
    }

    visual.appendChild(readout);
    root.appendChild(visual);

    if (typeof help === 'string' && help.trim().length) {
        const helpEl = document.createElement('div');
        helpEl.className = 'scoreGauge__help';
        helpEl.innerHTML = help;
        root.appendChild(helpEl);
    }

    return finalize(root, asText);
}
