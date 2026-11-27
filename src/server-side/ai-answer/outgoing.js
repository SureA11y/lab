'use strict';

// What the AI pass may send, and in what form (docs/design/
// ai-cant-tell-data-and-agents.md). All of it is set on the server, never by a
// workflow or a report:
// - A11Y_AI_ALLOWED_SITES: the sites the pass may send questions about, by
//   host, separated by commas ("shop.example, example.org"); a host also allows
//   its subdomains. Unset: every site. Set but empty of hosts: none.
// - A11Y_AI_MASK: personal data masked in what is sent (on unless "off"):
//   e-mail addresses, IBANs, card-like and phone-like numbers. Only what is
//   sent is masked; the report keeps what was read from the page.
// - A11Y_AI_PREVIEW: every run previews (nothing is sent), whatever its steps
//   say. A step can also ask for a preview itself (`ai: { preview: true }`).
// - A11Y_AI_PICTURES: whether the element's picture may go to the model with
//   the questions that use one, for a step that asks (`ai: { pictures: true }`).
//   Unset or "off": never. "on": on every site the pass may send about. Hosts
//   ("shop.example, example.org"): on those only (and their subdomains).

const off = (v) => /^(0|false|no|off)$/i.test(String(v == null ? '' : v).trim());
const on = (v) => /^(1|true|yes|on)$/i.test(String(v == null ? '' : v).trim());

/** The allowed hosts, or null when every site is allowed. */
function allowedSitesOf(env = process.env) {
    if (env.A11Y_AI_ALLOWED_SITES === undefined) return null;
    return String(env.A11Y_AI_ALLOWED_SITES)
        .split(/[\s,]+/)
        .map((h) => h.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, ''))
        .filter(Boolean);
}

/** Whether a page's address is on a site the list allows (null: all are). */
function siteAllowed(pageUrl, allowed) {
    if (!allowed) return true;
    let host;
    try { host = new URL(pageUrl).hostname.toLowerCase().replace(/\.$/, ''); } catch { return false; }
    return allowed.some((h) => host === h || host.endsWith('.' + h));
}

function maskingOn(env = process.env) {
    return !off(env.A11Y_AI_MASK);
}

function previewForced(env = process.env) {
    return on(env.A11Y_AI_PREVIEW);
}

// In order: an IBAN before the numbers in it, an e-mail address before the
// digits in it, then long numbers (cards, accounts) and phone numbers.
const PATTERNS = [
    [/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, '[iban]'],
    [/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi, '[email]'],
    [/\b\d(?:[ -]?\d){12,18}\b/g, '[number]'],
    // Nine digits or more, with the separators phone numbers are written with.
    [/(?<![\w/=])\+?\(?\d(?:[\d ()./-]*\d)?(?![\w/])/g, (m) => ((m.match(/\d/g) || []).length >= 9 ? '[phone]' : m)],
];

/**
 * Whether the element's picture may be sent about this page: never unless
 * A11Y_AI_PICTURES says so, on every site with "on", else on the hosts it
 * lists.
 */
function picturesAllowed(pageUrl, env = process.env) {
    const v = String(env.A11Y_AI_PICTURES == null ? '' : env.A11Y_AI_PICTURES).trim();
    if (!v || off(v)) return false;
    if (on(v) || /^all$/i.test(v)) return true;
    const hosts = v.split(/[\s,]+/).map((h) => h.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')).filter(Boolean);
    return hosts.length > 0 && siteAllowed(pageUrl, hosts);
}

/** A string with personal data masked, and how many were. */
function maskText(text) {
    let count = 0;
    let out = String(text);
    for (const [re, to] of PATTERNS) {
        out = out.replace(re, (m) => {
            const r = typeof to === 'function' ? to(m) : to;
            if (r !== m) count++;
            return r;
        });
    }
    return { text: out, count };
}

/**
 * A copy of `value` with personal data masked in every string, except an
 * element's picture (a data URL, sent only when turned on).
 */
function maskDeep(value) {
    let count = 0;
    const walk = (v, key) => {
        if (typeof v === 'string') {
            if (key === 'screenshot') return v;
            const m = maskText(v);
            count += m.count;
            return m.text;
        }
        if (Array.isArray(v)) return v.map((x) => walk(x, key));
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
        return v;
    };
    return { value: walk(value, ''), count };
}

/** A copy of `value` without any picture (a `screenshot`), at any depth. */
function withoutPictures(value) {
    if (Array.isArray(value)) return value.map(withoutPictures);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'screenshot').map(([k, v]) => [k, withoutPictures(v)]));
    }
    return value;
}

module.exports = { allowedSitesOf, siteAllowed, picturesAllowed, maskingOn, previewForced, maskText, maskDeep, withoutPictures };
