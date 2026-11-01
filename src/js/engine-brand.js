// How a report names the engine that ran it: surea11y, our own engine
// (@surea11y/core), with the design-system brand "tag" lockup (the mark tile
// flush-left, then the sure/a11y wordmark with the "core" product word and
// version, mono and muted: "core 1.3.0"), mirroring components/brand Logo
// variant="tag"; every other engine as plain "name version" text. Shared by
// the report view and the comparisons, in the browser and in Node, so it
// touches no DOM. The tag's styles are .engine-brand, in the app's and the
// report's stylesheets.

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Whether an engine ({ id, name }) is surea11y. Its id reaches a report in a
 * few forms: the server workflow writes the bare "surea11y", the browser
 * extension the npm scope "@surea11y" (the package is "@surea11y/core"), so a
 * leading "@" is dropped before matching.
 */
export function isSureA11yEngine(engine) {
    const key = String((engine && (engine.id || engine.name)) || '').trim().toLowerCase().replace(/^@/, '');
    return key === 'surea11y' || key.startsWith('surea11y');
}

/** The surea11y brand tag, with its version when there is one. */
export function sureA11yBrandTagHTML(version) {
    const v = String(version || '').trim();
    const ariaLabel = 'surea11y core' + (v ? ' ' + v : '');
    const versionHtml = v ? `<span class="engine-brand__version">${esc(v)}</span>` : '';

    return (
        `<a href="https://www.npmjs.com/package/@surea11y/core" class="engine-brand" aria-label="${esc(ariaLabel)}">` +
            `<span class="engine-brand__tile" aria-hidden="true">` +
                `<svg viewBox="0 0 64 64" focusable="false">` +
                    `<path d="M17 33.5 L27.5 44 L48 18" fill="none" stroke-width="10" ` +
                    `stroke-linecap="round" stroke-linejoin="round" />` +
                `</svg>` +
            `</span>` +
            `<span class="engine-brand__word" aria-hidden="true">` +
                `<span class="engine-brand__sure">sure</span>` +
                `<span class="engine-brand__a11y">a11y</span>` +
                `<span class="engine-brand__product"> core ${versionHtml}</span>` +
            `</span>` +
        `</a>`
    );
}

/** One engine ({ id, name, version }) as a report shows it. */
export function engineHTML(engine) {
    if (!engine) return '';
    if (isSureA11yEngine(engine)) return sureA11yBrandTagHTML(engine.version);
    const name = String(engine.name || engine.id || '').trim();
    return esc(engine.version ? `${name} ${engine.version}` : name);
}

// Where surea11y's accuracy is shown rather than claimed: its results on W3C's
// ACT test cases, kept current by core.
export const SUREA11Y_TESTED_URL = 'https://github.com/SureA11y/core#checked-against-the-act-corpus';

/** A link to how surea11y is tested, after the engine line; '' without surea11y. */
export function howTestedHTML(engines) {
    const list = Array.isArray(engines) ? engines : [];
    if (!list.some((e) => e && isSureA11yEngine(e))) return '';
    return ` · <a href="${SUREA11Y_TESTED_URL}">How surea11y is tested</a>`;
}

/** Every engine of a list, comma-separated; '' for none. */
export function enginesHTML(engines) {
    return (Array.isArray(engines) ? engines : []).map(engineHTML).filter(Boolean).join(', ');
}
