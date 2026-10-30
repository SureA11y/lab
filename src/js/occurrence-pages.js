// Where an occurrence was found, as the details of a finding list it: a line
// under the occurrence's heading, never in it, that stays short whatever the
// addresses are like.
//
// An address is shown by its host and path, its query and fragment left out
// (a login redirect's one-time token tells the reader nothing), a long path
// shortened in the middle; the link still goes to the whole address. Three
// pages are named; the rest are a list to open. "Copy URLs" copies every
// address whole, one per line.

const SHOWN = 3;
const PATH_MAX = 60;

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function middle(text, max) {
    if (text.length <= max) return text;
    const head = Math.ceil((max - 1) * 0.55);
    return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
}

/**
 * An address as the list shows it: "shop.test/cart", "?…" after it when it
 * had a query or a fragment, a path past 60 characters shortened in the
 * middle. Anything that is not an http(s) address is shortened as it is.
 */
export function shortUrl(url) {
    const raw = String(url || '').trim();
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return middle(raw, 80);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return middle(raw, 80);
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    const more = parsed.search || parsed.hash ? '?…' : '';
    return `${parsed.host}${middle(path, PATH_MAX)}${more}`;
}

// The short form, unless another address of the list has the same one:
// those keep their query, shortened in the middle, so they can be told apart
// ("products.html?page=2").
function labelsFor(list) {
    const shorts = list.map(shortUrl);
    const seen = new Map();
    shorts.forEach((s) => seen.set(s, (seen.get(s) || 0) + 1));
    return new Map(list.map((url, i) => {
        if (seen.get(shorts[i]) < 2) return [url, shorts[i]];
        try {
            const u = new URL(url);
            const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
            return [url, `${u.host}${middle(path, PATH_MAX)}${middle(u.search || u.hash, 40)}`];
        } catch {
            return [url, shorts[i]];
        }
    }));
}

// Only addresses a browser opens as pages become links: a report can come
// from anywhere, and a javascript: address must not be one.
function link(url, label) {
    const raw = String(url || '');
    const safe = /^https?:\/\//i.test(raw);
    const text = esc(label || shortUrl(raw));
    return safe
        ? `<a href="${esc(raw)}" target="_blank" rel="noopener noreferrer" title="${esc(raw)}">${text}</a>`
        : `<span title="${esc(raw)}">${text}</span>`;
}

/** The pages line of an occurrence, or '' without any. */
export function occurrencePagesHtml(urls) {
    const list = [...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || '').trim()).filter(Boolean))];
    if (!list.length) return '';
    const labels = labelsFor(list);
    const shown = list.slice(0, SHOWN).map((u) => link(u, labels.get(u)));
    const rest = list.slice(SHOWN);
    const lead = list.length === 1 ? 'Found on' : `Found on ${list.length} pages:`;
    const named = rest.length
        ? `${shown.join(', ')} and ${rest.length} more`
        : (shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0]);
    const more = rest.length
        ? `<details class="node-pages-more"><summary>The other ${rest.length} page${rest.length === 1 ? '' : 's'}</summary>`
            + `<ul>${rest.map((u) => `<li>${link(u, labels.get(u))}</li>`).join('')}</ul></details>`
        : '';
    const copy = `<button type="button" class="copy-selector-btn copy-urls-btn" data-copy="${esc(list.join('\n'))}">${list.length === 1 ? 'Copy URL' : 'Copy URLs'}</button>`;
    return `<div class="node-pages"><p class="node-pages-line"><span class="node-pages-label">${esc(lead)}</span> ${named}</p>${copy}${more}</div>`;
}
