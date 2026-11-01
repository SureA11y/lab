'use strict';

// The addresses a crawl works with: normalising one, its origin, the include
// and exclude patterns, the links a page has, and whether a step goes to a
// web address at all.

const {isNonEmptyString} = require('./utils');

/** ------------------------------- crawl helpers ------------------------------- */

function safeGetOrigin(u) {
    try {
        return new URL(String(u)).origin;
    } catch {
        return null;
    }
}

/** Normalize a candidate URL (relative or absolute) against a base. Returns absolute URL string, without hash. */
/** Whether a url is a web page's (http or https), the only ones a run opens. */
function isWebUrl(raw) {
    try {
        const { protocol } = new URL(String(raw || '').trim());
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

function normalizeUrlCandidate(raw, baseUrl) {
    try {
        const s = String(raw || '').trim();
        if (!s) return null;
        if (s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('javascript:')) return null;
        const abs = baseUrl ? new URL(s, baseUrl) : new URL(s);
        // Web pages only: a crawled page's links to file: urls had the crawl
        // open the server's own files.
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
        abs.hash = '';
        // normalize trailing slash (except root)
        let out = abs.toString();
        if (out.endsWith('/') && abs.pathname !== '/' && !abs.search) out = out.slice(0, -1);
        return out;
    } catch {
        return null;
    }
}

function parsePatternLines(text) {
    if (!isNonEmptyString(text)) return [];
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(compilePattern);
}

function compilePattern(pat) {
    // /regex/flags
    if (pat.startsWith('/') && pat.lastIndexOf('/') > 0) {
        const last = pat.lastIndexOf('/');
        const body = pat.slice(1, last);
        const flags = pat.slice(last + 1);
        try {
            return {type: 'regex', re: new RegExp(body, flags || undefined), raw: pat};
        } catch {
        }
    }
    // wildcard * and ?
    return {type: 'wild', raw: pat};
}

function testPattern(patObj, url) {
    if (!patObj) return false;
    if (patObj.type === 'regex') {
        try {
            return patObj.re.test(url);
        } catch {
            return false;
        }
    }
    // simple wildcard matching
    const esc = (s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');
    const rx = '^' + esc(patObj.raw).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$';
    try {
        return new RegExp(rx, 'i').test(url);
    } catch {
        return false;
    }
}

function applyIncludeExclude(urls, includePatterns, excludePatterns) {
    let out = Array.isArray(urls) ? urls.slice() : [];
    if (includePatterns && includePatterns.length) {
        out = out.filter(u => includePatterns.some(p => testPattern(p, u)));
    }
    if (excludePatterns && excludePatterns.length) {
        out = out.filter(u => !excludePatterns.some(p => testPattern(p, u)));
    }
    return out;
}

function normalizeAndFilterUrls(urls, {baseUrl, sameOriginOnly, baseOrigin, dedupe}) {
    let out = (Array.isArray(urls) ? urls : []).map(u => normalizeUrlCandidate(u, baseUrl)).filter(Boolean);
    if (sameOriginOnly && baseOrigin) out = out.filter(u => safeGetOrigin(u) === baseOrigin);
    if (dedupe) {
        const seen = new Set();
        out = out.filter(u => (seen.has(u) ? false : (seen.add(u), true)));
    }
    return out;
}

async function collectHrefsFromPage(page, {containerSelector = null, linkSelector = 'a[href]', maxLinks = 500} = {}) {
    const lim = Math.max(0, Number(maxLinks) || 0);
    try {
        return await page.evaluate((containerSel, linkSel, limit) => {
            const root = containerSel ? document.querySelector(containerSel) : document;
            if (!root) return [];
            const els = Array.from(root.querySelectorAll(linkSel));
            const out = [];
            for (const el of els) {
                const href = el.getAttribute('href') || '';
                if (!href) continue;
                out.push(href);
                if (limit && out.length >= limit) break;
            }
            return out;
        }, containerSelector, linkSelector, lim);
    } catch {
        return [];
    }
}

module.exports = {
    isWebUrl,
    safeGetOrigin,
    normalizeUrlCandidate,
    compilePattern,
    parsePatternLines,
    testPattern,
    applyIncludeExclude,
    normalizeAndFilterUrls,
    collectHrefsFromPage
};
