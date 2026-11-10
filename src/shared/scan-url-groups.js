'use strict';

// The URL group source: scans whose URLs repeat a shape, as pages made from
// one template do (docs/design/scan-grouping-design.md §4, §5).
//
// A source for scan-groups.js: createUrlGroupSource() gives the object that
// findGroups takes in `sources`. Everything about URLs is here: how a URL is
// read (its signature), which shapes count as a pattern, and the thresholds,
// which are options so they can be tuned without touching the rules.
//
// A pattern is a repetition, or it is nothing (D9): several distinct URLs
// sharing a shape under a literal anchor. A run whose URLs repeat nothing
// gets no patterns.
//
// Pure and DOM-free; uses the WHATWG URL parser, present in Node and in
// browsers.
//
// Browser: available as globalThis.A11Y_SCAN_URL_GROUPS.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_URL_GROUPS = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const SOURCE_ID = 'url';

    // Thresholds and lists, not truths: tune them here (design notes §5.3).
    const DEFAULTS = Object.freeze({
        // Distinct URLs a pattern needs. Scans of one URL count once.
        minUrls: 2,
        // Distinct values a wildcard needs where it starts.
        minVariants: 2,
        // Query keys that only track a visit, left out of the signature.
        trackingKeys: Object.freeze(['gclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga']),
        trackingKeyPrefixes: Object.freeze(['utm_']),
    });

    function settings(options) {
        const o = { ...DEFAULTS, ...(options || {}) };
        o.minUrls = Math.max(2, Number.isFinite(o.minUrls) ? o.minUrls : DEFAULTS.minUrls);
        o.minVariants = Math.max(2, Number.isFinite(o.minVariants) ? o.minVariants : DEFAULTS.minVariants);
        o.trackingKeys = new Set(Array.isArray(o.trackingKeys) ? o.trackingKeys : DEFAULTS.trackingKeys);
        o.trackingKeyPrefixes = Array.isArray(o.trackingKeyPrefixes)
            ? o.trackingKeyPrefixes : DEFAULTS.trackingKeyPrefixes;
        return o;
    }

    function safeDecode(text) {
        try { return decodeURIComponent(text); } catch { return text; }
    }

    function splitPath(path) {
        return String(path || '').split('/').filter(Boolean).map(safeDecode);
    }

    function isTracking(key, o) {
        return o.trackingKeys.has(key) || o.trackingKeyPrefixes.some((p) => key.startsWith(p));
    }

    // ---------------------------------------------------------------- signature

    /**
     * What a URL is for grouping (design notes §4), or null when it cannot be
     * grouped: { host, segments, queryKeys, identity }.
     * - host: lowercased, with a port only when it is not the default one;
     * - segments: the path's, decoded, empty ones dropped, then a hash
     *   route's (#/… or #!/…);
     * - queryKeys: sorted, tracking keys left out;
     * - identity: the URL itself as far as grouping is concerned (host, path
     *   and query with values), the same for two URLs of one page.
     */
    function urlSignature(raw, options) {
        const o = settings(options);
        if (typeof raw !== 'string' || !raw.trim()) return null;
        let url;
        try { url = new URL(raw.trim()); } catch { return null; }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        const host = url.host.toLowerCase();
        if (!host) return null;

        const segments = splitPath(url.pathname);
        const params = [...url.searchParams];
        const route = /^#!?\//.exec(url.hash);
        if (route) {
            const rest = url.hash.slice(route[0].length);
            const q = rest.indexOf('?');
            segments.push(...splitPath(q < 0 ? rest : rest.slice(0, q)));
            if (q >= 0) params.push(...new URLSearchParams(rest.slice(q + 1)));
        }

        const query = params.filter(([k]) => k && !isTracking(k, o));
        const queryKeys = [...new Set(query.map(([k]) => k))].sort();
        const enc = encodeURIComponent;
        const queryText = query.map(([k, v]) => `${enc(k)}=${enc(v)}`).sort().join('&');
        const identity = `${host}/${segments.map(enc).join('/')}${queryText ? `?${queryText}` : ''}`;
        return { host, segments, queryKeys, identity };
    }

    // ------------------------------------------------------------------ labels

    const WILDCARD = null;

    // What a wildcard is called: {id} when every value at it is a number,
    // {slug} when every one is a lowercase word or hyphenated words, else {*}.
    function wildcardName(values) {
        if (values.length && values.every((v) => /^\d+$/.test(v))) return '{id}';
        if (values.length && values.every((v) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v))) return '{slug}';
        return '{*}';
    }

    function patternKey(p) {
        const path = p.segments.map((s) => (s === WILDCARD ? '{*}' : encodeURIComponent(s))).join('/');
        return `${p.host}/${path}${p.kind === 'prefix' ? '/…' : ''}`
            + (p.queryKeys.length ? `?${p.queryKeys.map(encodeURIComponent).join('&')}` : '');
    }

    function patternLabel(p, memberSegments) {
        const path = p.segments.map((s, i) => (s === WILDCARD
            ? wildcardName(memberSegments.map((segs) => segs[i]))
            : s)).join('/');
        const query = p.queryKeys.map((k) => `${k}=…`).join('&');
        return `/${path}${p.kind === 'prefix' ? (path ? '/…' : '…') : ''}${query ? `?${query}` : ''}`;
    }

    // ----------------------------------------------------------------- finding

    function matchesShape(shape, segments) {
        return segments.length === shape.length
            && shape.every((s, i) => s === WILDCARD || s === segments[i]);
    }

    // A wildcard needs something fixed to hang on (D9): a literal segment
    // before or after it, or query keys. `/{*}`, which every top-level page
    // matches, has none.
    function isAnchored(shape, queryKeys) {
        return queryKeys.length > 0 || shape.some((s) => s !== WILDCARD);
    }

    // `/products/a/{*}` over `/products/a/reviews` and `/products/a/specs`,
    // when every other product has reviews and specs too: the values under
    // the wildcard are a fixed vocabulary repeated across its siblings, not
    // content, so the template is the other way round (`/products/{*}/reviews`)
    // and this is the same pages seen sideways - one per product, all noise.
    // It is dropped when every value it varies over also appears under
    // another parent at that place.
    function isTransposed(shape, paths) {
        const start = shape.indexOf(WILDCARD);
        if (start < 1) return false;
        const parent = start - 1;
        const values = new Set();
        const elsewhere = new Set();
        for (const p of paths) {
            const s = p.segments;
            if (s.length !== shape.length) continue;
            let samePrefix = true;
            for (let i = 0; i < parent; i++) if (s[i] !== shape[i]) { samePrefix = false; break; }
            if (!samePrefix) continue;
            if (s[parent] === shape[parent]) {
                if (matchesShape(shape, s)) values.add(s[start]);
            } else {
                elsewhere.add(s[start]);
            }
        }
        if (!values.size) return false;
        for (const v of values) if (!elsewhere.has(v)) return false;
        return true;
    }

    /**
     * The URL patterns among the entries ([{ id, url }]), as the source
     * proposes them to findGroups: [{ key, label, members, specificity,
     * evidence }]. Evidence: { kind ('shape', 'query' or 'prefix'), host,
     * segments (null for a wildcard), queryKeys, urls (distinct URLs) }.
     */
    function findUrlPatterns(entries, options) {
        const o = settings(options);

        // host -> { entries: [{ id, sig }], partitions: queryKeys -> paths }
        // A path holds the ids of each distinct URL on it.
        const hosts = new Map();
        for (const e of Array.isArray(entries) ? entries : []) {
            if (!e || e.id == null) continue;
            const sig = urlSignature(e.url, options);
            if (!sig) continue;
            let h = hosts.get(sig.host);
            if (!h) hosts.set(sig.host, (h = { entries: [], partitions: new Map() }));
            h.entries.push({ id: e.id, sig });
            const pk = sig.queryKeys.join('&');
            let part = h.partitions.get(pk);
            if (!part) h.partitions.set(pk, (part = { queryKeys: sig.queryKeys, paths: new Map() }));
            const pathKey = sig.segments.map(encodeURIComponent).join('/');
            let path = part.paths.get(pathKey);
            if (!path) part.paths.set(pathKey, (path = { segments: sig.segments, urls: new Map() }));
            if (!path.urls.has(sig.identity)) path.urls.set(sig.identity, []);
            path.urls.get(sig.identity).push(e.id);
        }

        const out = [];
        for (const [host, h] of hosts) {
            const patterns = [];
            for (const part of h.partitions.values()) {
                patterns.push(...shapePatterns(host, part, o));
            }
            patterns.push(...prefixPatterns(host, h, patterns));
            out.push(...patterns.map(toProposal));
        }
        return out;
    }

    // Shapes within one host and one set of query keys (§5.3 steps 1, 2, 4).
    function shapePatterns(host, part, o) {
        const paths = [...part.paths.values()];
        const found = new Map();

        const consider = (shape) => {
            if (!isAnchored(shape, part.queryKeys)) return;
            if (isTransposed(shape, paths)) return;
            const members = paths.filter((p) => matchesShape(shape, p.segments));
            const urls = members.reduce((n, p) => n + p.urls.size, 0);
            if (urls < o.minUrls) return;
            const pattern = {
                kind: shape.includes(WILDCARD) ? 'shape' : 'query',
                host,
                segments: shape,
                queryKeys: part.queryKeys,
                paths: members,
                urls,
            };
            const key = patternKey(pattern);
            if (!found.has(key)) found.set(key, pattern);
        };

        // The shape of some paths from position `start`: literal where they
        // all agree, a wildcard where they do not. Null when they do not
        // vary where the wildcard would start, as that shape belongs to a
        // deeper node.
        const shapeOf = (group, start) => {
            const distinct = new Set(group.map((p) => p.segments[start]));
            if (distinct.size < o.minVariants) return null;
            return group[0].segments.map((s, i) => (i < start
                || group.every((p) => p.segments[i] === s) ? s : WILDCARD));
        };

        // Paths that share their first `d` segments and their length.
        const buckets = new Map();
        for (const p of paths) {
            const L = p.segments.length;
            for (let d = 0; d < L; d++) {
                const key = `${L}|${p.segments.slice(0, d).map(encodeURIComponent).join('/')}`;
                let b = buckets.get(key);
                if (!b) buckets.set(key, (b = { start: d, paths: [] }));
                b.paths.push(p);
            }
        }
        for (const b of buckets.values()) {
            const shape = shapeOf(b.paths, b.start);
            if (!shape) continue;
            consider(shape);
            // A literal tail shared by some of them: /products/{*}/reviews
            // beside /products/{*}/specs. One level of refinement.
            for (let i = b.start + 1; i < shape.length; i++) {
                if (shape[i] !== WILDCARD) continue;
                const byValue = new Map();
                for (const p of b.paths) {
                    const v = p.segments[i];
                    if (!byValue.has(v)) byValue.set(v, []);
                    byValue.get(v).push(p);
                }
                for (const group of byValue.values()) {
                    const refined = shapeOf(group, b.start);
                    if (refined) consider(refined);
                }
            }
        }

        // One path, many query values: product.php?id=… (the file name and
        // the keys are the anchor).
        if (part.queryKeys.length) {
            for (const p of paths) consider(p.segments.slice());
        }
        return [...found.values()];
    }

    // Prefixes (§5.3 step 3): `node/…` where the patterns below the node are
    // more than one, and not the whole host.
    function prefixPatterns(host, h, shapes) {
        const all = h.entries;
        const nodes = new Map();
        for (const { sig } of all) {
            for (let d = 1; d < sig.segments.length; d++) {
                const node = sig.segments.slice(0, d);
                nodes.set(node.map(encodeURIComponent).join('/'), node);
            }
        }
        const ordered = [...nodes.values()].sort((a, b) => b.length - a.length);
        const found = [];
        const idsOf = (p) => new Set(p.paths.flatMap((x) => [...x.urls.values()].flat()));
        const below = (p, node) => p.segments.length > node.length
            && node.every((s, i) => p.segments[i] === s);

        for (const node of ordered) {
            const under = [...shapes, ...found].filter((p) => below(p, node));
            if (under.length < 2) continue;
            // Patterns with the same members count once: they are one group.
            const sets = [...new Map(under.map(idsOf)
                .map((set) => [[...set].map(String).sort().join('\n'), set])).values()];
            const maximal = sets.filter((set) => !sets.some((other) => other.size > set.size
                && [...set].every((id) => other.has(id))));
            if (maximal.length < 2) continue;
            const members = all.filter(({ sig }) => sig.segments.length >= node.length
                && node.every((s, i) => sig.segments[i] === s));
            // A prefix holding the whole host is the host, which is not a group.
            if (members.length === all.length) continue;
            const paths = new Map();
            for (const { id, sig } of members) {
                const key = sig.segments.map(encodeURIComponent).join('/');
                if (!paths.has(key)) paths.set(key, { segments: sig.segments, urls: new Map() });
                const urls = paths.get(key).urls;
                if (!urls.has(sig.identity)) urls.set(sig.identity, []);
                urls.get(sig.identity).push(id);
            }
            const list = [...paths.values()];
            found.push({
                kind: 'prefix',
                host,
                segments: node,
                queryKeys: [],
                paths: list,
                urls: list.reduce((n, p) => n + p.urls.size, 0),
            });
        }
        return found;
    }

    // A literal segment says more than a wildcard, and a shape more than a
    // prefix over the same literals.
    function specificityOf(p) {
        const literals = p.segments.filter((s) => s !== WILDCARD).length;
        return p.kind === 'prefix' ? 2 * literals - 1 : 2 * literals + p.queryKeys.length;
    }

    function toProposal(p) {
        const members = p.paths.flatMap((x) => [...x.urls.values()].flat());
        return {
            key: patternKey(p),
            label: patternLabel(p, p.paths.map((x) => x.segments)),
            members,
            specificity: specificityOf(p),
            evidence: {
                kind: p.kind,
                host: p.host,
                segments: p.segments.slice(),
                queryKeys: p.queryKeys.slice(),
                urls: p.urls,
            },
        };
    }

    // ------------------------------------------------------------------ source

    /**
     * The URL group source for findGroups. Options: the thresholds above,
     * and `getUrl(item)` to read an item's URL (a scan's `url` by default).
     */
    function createUrlGroupSource(options = {}) {
        const getUrl = typeof options.getUrl === 'function'
            ? options.getUrl : (item) => (item ? item.url : null);
        return {
            id: SOURCE_ID,
            propose(items, context) {
                const entries = (Array.isArray(items) ? items : [])
                    .map((item) => ({ id: context.getId(item), url: getUrl(item) }));
                return findUrlPatterns(entries, options);
            },
        };
    }

    return {
        SOURCE_ID,
        DEFAULTS,
        urlSignature,
        findUrlPatterns,
        createUrlGroupSource,
        // Exposed for tests.
        _internal: { wildcardName },
    };
}));
