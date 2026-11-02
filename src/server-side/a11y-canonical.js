'use strict';

/**
 * Canonical, engine-agnostic accessibility result model + converters.
 *
 * This file keeps server-only helpers (like findingsByOutcome),
 * and the shared CANON_VERSION.
 */

const { CANON_VERSION } = require('../shared/canonical-shared');

function findingsByOutcome(scans) {
    const grouped = (Array.isArray(scans) ? scans : []).reduce((acc, scan) => {
        const findings = scan?.canonical?.findings;
        if (!Array.isArray(findings)) return acc;

        const scanUrl = scan?.url;
        for (const finding of findings) {
            const key = finding?.outcome;
            if (!acc[key]) continue;

            // Push a copy, do not mutate the original finding
            acc[key].push({
                ...finding,
                url: typeof scanUrl === 'string' ? scanUrl : undefined
            });
        }
        return acc;
    }, {
        fail: [],
        pass: [],
        cantTell: [],
        notApplicable: []
    });

    // Apply "merge by uid" to each outcome bucket
    for (const key of Object.keys(grouped)) {
        grouped[key] = mergeFindingsByUid(grouped[key]);
    }

    return grouped;
}

/**
 * Merge findings that share the same uid.
 * - occurrences: union (deduped)
 * - url: array of strings (deduped)
 * - other props: first-seen wins
 *
 * Each merged finding keeps the keys of the urls and occurrences it holds,
 * so a finding met on every scan of a long run is merged in time linear in
 * its occurrences. Rebuilding them on every merge made a 150-scan result
 * take a third of a second, holding the server's event loop throughout.
 */
function defaultOccurrenceKey(o) {
    const named = namedOccurrenceKey(o);
    if (named !== null) return named;
    try { return JSON.stringify(o); } catch { return String(o); }
}

/** The key an occurrence is known by when it carries one, else null. */
function namedOccurrenceKey(o) {
    if (o && typeof o === 'object') {
        if (typeof o.uid === 'string') return `uid:${o.uid}`;
        if (typeof o.key === 'string') return `key:${o.key}`;
        // A selector holds only inside the shadow root it was written for, so
        // the hosts it is inside are part of its name.
        const hosts = (Array.isArray(o.frameSelectors) && o.frameSelectors.length ? `${o.frameSelectors.join(' |>| ')} |>| ` : '')
            + (Array.isArray(o.shadowHostSelectors) && o.shadowHostSelectors.length
                ? `${o.shadowHostSelectors.join(' >>> ')} >>> `
                : '');
        if (typeof o.selector === 'string' && typeof o.html === 'string') return `sel+html:${hosts}${o.selector}::${o.html}`;
        if (typeof o.selector === 'string') return `sel:${hosts}${o.selector}`;
    }
    return null;
}

/**
 * What two occurrences with the same JSON always share: their page, target
 * and html. Occurrences that differ in it are different, with no need to
 * serialize them; those that share it are told apart by their JSON.
 */
function occurrenceShape(o) {
    const page = o && typeof o.pageUrl === 'string' ? o.pageUrl : '';
    const hosts = (o && Array.isArray(o.shadowHostSelectors) ? o.shadowHostSelectors.join('\u0002') : '')
        + (o && Array.isArray(o.frameSelectors) ? `\u0004${o.frameSelectors.join('\u0002')}` : '');
    const target = (o && Array.isArray(o.target) ? o.target.join('\u0001') : '') + (hosts ? `\u0003${hosts}` : '');
    const html = o && typeof o.html === 'string' ? o.html : '';
    return `${page}\u0000${target}\u0000${html}`;
}

/**
 * The occurrences a merged finding holds, by defaultOccurrenceKey, serializing
 * an occurrence only once another of the same shape turns up. Every
 * occurrence lands in a result, which is JSON, so JSON.stringify does not
 * throw on one, and the same JSON means the same shape.
 */
function createOccurrenceSet() {
    const named = new Set();
    const byShape = new Map(); // shape -> { json: Set<string>|null, first: occurrence }

    return {
        /** Adds `o` and says whether it was new. */
        add(o) {
            const key = namedOccurrenceKey(o);
            if (key !== null) {
                if (named.has(key)) return false;
                named.add(key);
                return true;
            }
            const shape = occurrenceShape(o);
            const bucket = byShape.get(shape);
            if (!bucket) {
                byShape.set(shape, { json: null, first: o });
                return true;
            }
            if (!bucket.json) bucket.json = new Set([defaultOccurrenceKey(bucket.first)]);
            const json = defaultOccurrenceKey(o);
            if (bucket.json.has(json)) return false;
            bucket.json.add(json);
            return true;
        },
    };
}

function mergeFindingsByUid(findings, { occurrenceKey = null } = {}) {
    if (!Array.isArray(findings)) return [];

    const byUid = new Map();
    const seenOf = new Map(); // merged finding -> { urls, occurrences }: the keys it holds
    const order = [];

    for (const f of findings) {
        if (!f || typeof f !== 'object') continue;

        const uidRaw = f.uid;
        const uid = (uidRaw === null || uidRaw === undefined) ? '' : String(uidRaw);

        // No uid, keep as unique
        if (!uid) {
            const k = `__no_uid__:${order.length}`;
            byUid.set(k, normalize(f));
            order.push(k);
            continue;
        }

        if (!byUid.has(uid)) {
            byUid.set(uid, normalize(f));
            order.push(uid);
        } else {
            mergeInto(byUid.get(uid), f);
        }
    }

    return order.map((k) => byUid.get(k));

    function urlsOf(finding) {
        const urls = [];
        if (Array.isArray(finding.url)) {
            for (const u of finding.url) if (typeof u === 'string' && u) urls.push(u);
        } else if (typeof finding.url === 'string' && finding.url) {
            urls.push(finding.url);
        }
        return urls;
    }

    function occurrenceSet() {
        if (!occurrenceKey) return createOccurrenceSet();
        const keys = new Set();
        return { add: (o) => { const k = occurrenceKey(o); if (keys.has(k)) return false; keys.add(k); return true; } };
    }

    function normalize(finding) {
        const out = { ...finding };
        const seen = { urls: new Set(), occurrences: occurrenceSet() };

        // url -> array
        out.url = [];
        addUrls(out.url, urlsOf(finding), seen.urls);

        // occurrences -> array + dedupe
        out.occurrences = [];
        addOccurrences(out.occurrences, Array.isArray(finding.occurrences) ? finding.occurrences : [], seen.occurrences);

        seenOf.set(out, seen);
        return out;
    }

    function mergeInto(target, incoming) {
        const seen = seenOf.get(target);
        // Elements a rule counted and did not list, scan by scan.
        if (Number(incoming.unlisted) > 0) target.unlisted = (Number(target.unlisted) || 0) + Number(incoming.unlisted);
        addUrls(target.url, urlsOf(incoming), seen.urls);
        addOccurrences(target.occurrences, Array.isArray(incoming.occurrences) ? incoming.occurrences : [], seen.occurrences);
    }

    function addUrls(list, urls, seen) {
        for (const u of urls) {
            const k = String(u);
            if (seen.has(k)) continue;
            seen.add(k);
            list.push(u);
        }
    }

    function addOccurrences(list, occurrences, seen) {
        for (const o of occurrences) if (seen.add(o)) list.push(o);
    }
}

module.exports = {
    CANON_VERSION,
    findingsByOutcome
};
