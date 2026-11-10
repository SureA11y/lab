'use strict';

/**
 * merged-scan.js
 * The scans a Merged scan step ran, folded into the one scan they are
 * (docs/design/merged-scan-design.md).
 *
 * Each scan inside the step is a context of it, named by its label. The
 * merged scan holds every context's findings: an occurrence with the same
 * result in several contexts is one occurrence listing them, and an
 * occurrence whose result differs - a contrast ratio that changes with the
 * theme, a target size that changes with the width - is one occurrence per
 * result, each with its own contexts. Everything else in the app then sees an
 * ordinary scan.
 *
 * Pure: the metric builders the runner uses are passed in, so this runs, and
 * is tested, without a browser.
 */

const { scanWcag, scanProfiles, scanProfilesLabel } = require('../shared/report-scan.js');


// The fold itself is shared with the report view, which folds the scans of
// several pages the same way (docs/design/scan-grouping-design.md §9.3); what
// is here is what only the runner needs: its collected scans, their
// screenshots as buffers, the live counts.
const {
    stableStringify,
    occurrenceIdentity,
    outcomeCounts,
    mergeCanonicals,
    mergeCoreResults,
    scoringView,
    sharedScanProfiles,
} = require('../shared/scan-fold.js');


// What a merged scan's contexts should share. They are merged anyway; the scan
// says where they differ.
const SHARED_SETTINGS = [
    ['url', 'Its contexts ended on different pages'],
    ['context', 'Its contexts scanned different parts of the page'],
    ['exclude', 'Its contexts excluded different parts of the page'],
    ['profile', 'Its contexts were checked against different profiles'],
];
// Not among them: the rules each context ran. Running every rule in one
// context and only some in another (the contrast rules in the dark theme) is
// what a Merged scan is for, and each failure already names its contexts.

// A setting as a notice says it: a profile by its label.
function showSetting(value) {
    if (value == null) return 'none';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value.label === 'string' && value.label) return value.label;
    return JSON.stringify(value);
}

function differenceNotices(entries, names) {
    const out = [];
    for (const [field, lead] of SHARED_SETTINGS) {
        // Profiles compare as a set, every one a context checked against, in
        // whatever order; the others as they are.
        const read = field === 'profile'
            ? (e) => (e.profile ? scanProfiles(e).map((p) => p.id || p.label).sort() : null)
            : (e) => e[field] ?? null;
        const values = entries.map((e) => stableStringify(read(e)));
        if (new Set(values).size < 2) continue;
        const shown = entries.map((e, i) => `${names[i]}: ${field === 'profile' && e.profile ? scanProfilesLabel(e) : showSetting(e[field])}`);
        out.push({
            code: 'merged-contexts-differ',
            field,
            message: `${lead} (${shown.join('; ')}). They are merged anyway, with the first context's settings.`,
        });
    }
    return out;
}

function contextName(entry, index, total) {
    const label = entry && typeof entry.label === 'string' ? entry.label.trim() : '';
    return label || `Scan ${index + 1} of ${total}`;
}

/**
 * A context's screenshot, as the payload builder takes it (a buffer, an
 * artifact with its buffer or public URL, a data URL), named by its context.
 */
function contextShot(shot, name, viewportRatio) {
    if (!shot) return null;
    const base = (Buffer.isBuffer(shot) || shot instanceof Uint8Array) ? { buffer: shot }
        : typeof shot === 'string' ? { dataUrl: shot.startsWith('data:') ? shot : 'data:image/jpeg;base64,' + shot }
            : typeof shot === 'object' ? shot : null;
    return base ? { ...base, name, label: name, viewportRatio: viewportRatio || null } : null;
}


/** One merged scan from the collected scans of one Merged scan step, in run order. */
function mergeGroup(entries, { buildCoverageAwareSummary, buildA11ySummary, automationCoverageForEngines } = {}) {
    const total = entries.length;
    const names = entries.map((e, i) => contextName(e, i, total));
    const first = entries[0];
    const group = first.mergedScan || {};
    const label = (typeof group.label === 'string' && group.label.trim()) || names[0] || 'Merged scan';

    const active = entries.map((e, i) => ({ e, name: names[i] })).filter(({ e }) => !e.skipped && e.canonical);

    const contexts = entries.map((e, i) => {
        const counts = e.canonical ? outcomeCounts(Array.isArray(e.canonical.findings) ? e.canonical.findings : []) : null;
        return {
            name: names[i],
            url: e.url || null,
            scanTags: Array.isArray(e.scanTags) && e.scanTags.length ? e.scanTags : null,
            skipped: !!e.skipped || !e.canonical,
            failCount: counts ? counts.fail : 0,
            reviewCount: counts ? counts.cantTell : 0,
            passesCount: counts ? counts.pass : 0,
        };
    });

    // The step's own tags; the scans inside describe their contexts, and give
    // all of theirs only when the step has none, as before it could have any.
    const stepTags = Array.isArray(group.scanTags) ? group.scanTags.filter(Boolean) : [];
    const scanTags = stepTags.length
        ? stepTags
        : [...new Set(entries.flatMap((e) => (Array.isArray(e.scanTags) ? e.scanTags : [])))];

    const merged = {
        id: first.id,
        scanId: first.scanId,
        orderKey: first.orderKey,
        iterationIndex: first.iterationIndex,
        scanIndex: first.scanIndex,
        label,
        scanTags: scanTags.length ? scanTags : null,
        mergedScan: true,
        // Which step's scans it was made from: how the merge is reported to the
        // live counts, scans having no id until the run's end. Not kept in the
        // payload, which picks its fields.
        mergedScanKey: group.key || null,
        contexts,
        results: null,
        nativeForReport: null,
        coreResult: null,
        screenshot: null,
        extraScreenshots: [],
    };

    if (!active.length) {
        const skipInfo = (entries.find((e) => e.skipInfo) || {}).skipInfo || null;
        return {
            ...pickSettings(first),
            ...merged,
            skipped: true,
            skipInfo,
            canonical: null,
            domMetrics: null,
            a11ySummary: null,
            coverageSummary: null,
            byEngineMetrics: null,
            screenshots: [],
            viewportRatio: first.viewportRatio || null,
        };
    }

    const lead = active[0].e;
    const contextsTotal = active.length;
    const canonical = mergeCanonicals(active.map(({ e, name }) => ({ canonical: e.canonical, context: name })), contextsTotal);
    canonical.notices = [...differenceNotices(active.map(({ e }) => e), active.map(({ name }) => name)), ...canonical.notices];

    // The page-size figures the scores divide by: the context with the most
    // elements, so one that hides part of the page does not shrink them.
    const domMetrics = active
        .map(({ e }) => e.domMetrics)
        .filter((d) => d && typeof d.totalElements === 'number')
        .sort((a, b) => b.totalElements - a.totalElements)[0] || null;

    // Coverage is measured against the widest context's scope, so a context
    // that ran only some rules does not narrow what the scan is judged on.
    // Contexts run by different engines are measured against what those
    // engines reach between them, as their findings are counted together.
    const inputs = widestContext(active.map(({ e }) => e))._metricInputs || {};
    const engineIds = [...new Set(active.flatMap(({ e }) => ((e._metricInputs && e._metricInputs.perEngine) || []).map((p) => p.engineId)))];
    let automationCoverage = inputs.automationCoverage || null;
    if (engineIds.length > 1 && typeof automationCoverageForEngines === 'function') {
        try {
            const { version, level } = scanWcag(lead);
            automationCoverage = automationCoverageForEngines(level, engineIds, version || undefined) || automationCoverage;
        } catch {
            // Keep the widest context's.
        }
    }
    let coverageSummary = null;
    let a11ySummary = null;
    try {
        if (typeof buildCoverageAwareSummary === 'function') {
            coverageSummary = buildCoverageAwareSummary({ canonical, automationCoverage });
        }
        if (typeof buildA11ySummary === 'function' && domMetrics) {
            a11ySummary = buildA11ySummary({ canonical: scoringView(canonical), domMetrics, coverageSummary, profiles: sharedScanProfiles(active.map(({ e }) => e)) });
        }
    } catch {
        coverageSummary = coverageSummary || null;
        a11ySummary = null;
    }

    // One set of metrics per engine when the contexts ran different engines,
    // for the report's engine filter: each engine's findings merged across
    // its contexts on their own, against its own coverage.
    let byEngineMetrics = null;
    try {
        if (engineIds.length > 1 && domMetrics && typeof buildCoverageAwareSummary === 'function' && typeof buildA11ySummary === 'function') {
            const out = {};
            for (const engineId of engineIds) {
                const parts = active
                    .map(({ e, name }) => {
                        const p = ((e._metricInputs && e._metricInputs.perEngine) || []).find((x) => x.engineId === engineId);
                        return p ? { canonical: p.canonical, context: name, p } : null;
                    })
                    .filter(Boolean);
                if (!parts.length) continue;
                const engineCanonical = mergeCanonicals(parts, contextsTotal);
                const engineCoverage = buildCoverageAwareSummary({ canonical: engineCanonical, automationCoverage: parts[0].p.automationCoverage || null });
                out[engineId] = {
                    engine: parts[0].p.engine,
                    a11ySummary: buildA11ySummary({ canonical: scoringView(engineCanonical), domMetrics, coverageSummary: engineCoverage, profiles: sharedScanProfiles(active.map(({ e }) => e)) }),
                    coverageSummary: engineCoverage,
                };
            }
            if (Object.keys(out).length > 1) byEngineMetrics = out;
        }
    } catch {
        byEngineMetrics = null;
    }

    // Every context's screenshots, each named by its context and keeping its
    // own aspect ratio: a mobile and a desktop screenshot are not alike.
    const screenshots = [];
    for (const { e, name } of active) {
        for (const shot of Array.isArray(e.extraScreenshots) ? e.extraScreenshots : []) {
            const entry = contextShot(shot, name, e.viewportRatio);
            if (entry) screenshots.push(entry);
        }
        const main = contextShot(e.screenshot, name, e.viewportRatio);
        if (main) screenshots.push(main);
    }

    const coreResult = mergeCoreResults(active.map(({ e, name }) => ({ result: e.coreResult, context: name })));

    return {
        ...pickSettings(lead),
        runOnly: combinedRunOnly(active.map(({ e }) => e)),
        ...merged,
        coreResult,
        skipped: false,
        skipInfo: null,
        canonical,
        domMetrics,
        a11ySummary,
        coverageSummary,
        byEngineMetrics,
        screenshots,
        viewportRatio: lead.viewportRatio || null,
    };
}

const includes = (runOnly) => {
    const r = runOnly && typeof runOnly === 'object' ? runOnly : {};
    return [...(Array.isArray(r.includeRuleIds) ? r.includeRuleIds : []), ...(Array.isArray(r.includeTags) ? r.includeTags : [])];
};

/** The context that ran the most: one that ran every rule of its level, else the first. */
function widestContext(entries) {
    return entries.find((e) => !includes(e.runOnly).length) || entries[0];
}

/**
 * The rules the merged scan ran: every rule of its level when a context ran
 * them all, else the rules and tags the contexts included, together. Excludes
 * are kept only where every context excluded them.
 */
function combinedRunOnly(entries) {
    const widest = widestContext(entries);
    if (!includes(widest.runOnly).length) return widest.runOnly || null;
    const union = (key) => [...new Set(entries.flatMap((e) => (e.runOnly && Array.isArray(e.runOnly[key]) ? e.runOnly[key] : [])))];
    const common = (key) => {
        const lists = entries.map((e) => (e.runOnly && Array.isArray(e.runOnly[key]) ? e.runOnly[key] : []));
        return lists.length ? lists[0].filter((x) => lists.every((l) => l.includes(x))) : [];
    };
    const out = { ...(widest.runOnly || {}), includeRuleIds: union('includeRuleIds'), excludeRuleIds: common('excludeRuleIds') };
    if (entries.some((e) => e.runOnly && Array.isArray(e.runOnly.includeTags))) out.includeTags = union('includeTags');
    if (entries.some((e) => e.runOnly && Array.isArray(e.runOnly.excludeTags))) out.excludeTags = common('excludeTags');
    return out;
}

function pickSettings(e) {
    return {
        context: e.context || null,
        exclude: e.exclude || null,
        tags: e.tags || null,
        profile: e.profile || null,
        ...(Array.isArray(e.profiles) && e.profiles.length > 1 ? { profiles: e.profiles } : {}),
        ...(Array.isArray(e.profilesNotRun) && e.profilesNotRun.length ? { profilesNotRun: e.profilesNotRun } : {}),
        wcag: e.wcag || null,
        runOnly: e.runOnly || null,
        url: e.url || null,
    };
}

/**
 * The collected scans of a run, with each Merged scan's scans folded into one,
 * at the place of its first. Scans outside a Merged scan pass through as they
 * are. A collected scan belongs to a Merged scan when it carries
 * `mergedScan: { key, label }`.
 */
function foldMergedScans(entries, deps, { onlyKey = null } = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const groupKey = (e) => {
        const key = e && e.mergedScan && e.mergedScan.key;
        return key && (!onlyKey || key === onlyKey) ? key : null;
    };
    const groups = new Map();
    for (const e of list) {
        const key = groupKey(e);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
    }
    if (!groups.size) return list;

    const out = [];
    const done = new Set();
    for (const e of list) {
        const key = groupKey(e);
        if (!key) {
            out.push(e);
            continue;
        }
        if (done.has(key)) continue;
        done.add(key);
        out.push(mergeGroup(groups.get(key), deps));
    }
    return out;
}

function scanSummary(canonical) {
    const c = outcomeCounts(canonical && Array.isArray(canonical.findings) ? canonical.findings : []);
    return { failCount: c.fail, reviewCount: c.cantTell, passesCount: c.pass };
}

/**
 * For the live totals: each merged scan of a run, with its counts and tags,
 * and those of the contexts it was made from that finished (and so were
 * counted as they did), so the totals can swap the one for the other.
 * Counted as the "a11yScan ready" progress entries count a scan.
 */
function describeMerges(collected, folded) {
    const groups = new Map();
    for (const e of Array.isArray(collected) ? collected : []) {
        const key = e && e.mergedScan && e.mergedScan.key;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
    }
    // Matched by the step's key: scans have no id until the run's end, and
    // groups folded earlier are already merged scans in `collected`, so
    // neither an id nor a position would find the right one.
    const merged = (Array.isArray(folded) ? folded : []).filter((e) => e && e.mergedScan === true);
    return [...groups.entries()].map(([key, entries]) => {
        const m = merged.find((x) => x.mergedScanKey === key) || {};
        return {
            key,
            label: m.label || null,
            scanId: m.scanId || null,
            scanTags: m.scanTags || null,
            summary: scanSummary(m.canonical),
            contexts: entries
                .filter((e) => !e.skipped && e.canonical)
                .map((e) => ({ label: e.label || null, scanTags: e.scanTags || null, summary: scanSummary(e.canonical) })),
        };
    });
}

module.exports = {
    describeMerges,
    foldMergedScans,
    mergeGroup,
    mergeCanonicals,
    mergeCoreResults,
    occurrenceIdentity,
};
