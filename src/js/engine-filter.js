'use strict';

// Pure helpers backing the "Engine" select in the results toolbar. No DOM, so
// they're unit-tested directly; the report UI holds the live selection and calls
// these to list the engines a report used and to narrow it to one of them.
//
// A run can use several engines at once, and every finding already records the
// engine that produced it, so narrowing is a filter over findings rather than
// over scans: one scan can hold findings from two engines, and picking one has
// to leave that scan in place with only its half of the findings.
//
// Everything the report derives - the results tables, the failure and can't-tell
// counts, the summary rows, the sort keys - is computed from those findings, so
// filtering them at the source is what makes the whole view follow the select.
//
// The metric scores are the one thing that cannot be filtered here: they are
// computed FROM the findings (severity-weighted breadth and depth, normalized by
// page size), so they are as engine-specific as the findings are, but the model
// that computes them lives on the server. A multi-engine scan therefore ships
// one set of metrics per engine, in `scan.metrics.byEngine`, and this module
// swaps the right one in rather than recomputing anything. A scan that ran a
// single engine needs nothing: its own metrics are already that engine's.

export const ALL_ENGINES = 'all';

// The key an engine is selected by: its id when the adapter reports one, else
// its name. Lowercased, because the two shapes below don't always agree on
// casing and a report can mix findings written by different versions.
function engineKey(engine) {
    if (!engine || typeof engine !== 'object') return '';
    const id = typeof engine.id === 'string' ? engine.id.trim() : '';
    const name = typeof engine.name === 'string' ? engine.name.trim() : '';
    return (id || name).toLowerCase();
}

function engineLabel(engine) {
    if (!engine || typeof engine !== 'object') return '';
    const name = typeof engine.name === 'string' ? engine.name.trim() : '';
    const id = typeof engine.id === 'string' ? engine.id.trim() : '';
    return name || id;
}

// The engine that produced a finding, as {id, name}.
//
// Two provenance shapes are in circulation and a server-produced finding carries
// both: the engine adapters write a flat `{engineId, engineName, engineVersion}`,
// and the facade merges a nested `engine: {id, name, version}` on top when it
// stamps provenance. Reports from the extension only ever have the flat one.
export function findingEngine(finding) {
    if (!finding || typeof finding !== 'object') return null;

    const provenance = finding.provenance && typeof finding.provenance === 'object'
        ? finding.provenance
        : null;

    const nested = provenance && provenance.engine && typeof provenance.engine === 'object'
        ? provenance.engine
        : null;

    const id = (nested && typeof nested.id === 'string' && nested.id.trim())
        || (provenance && typeof provenance.engineId === 'string' && provenance.engineId.trim())
        || (typeof finding.engineId === 'string' && finding.engineId.trim())
        || '';

    const name = (nested && typeof nested.name === 'string' && nested.name.trim())
        || (provenance && typeof provenance.engineName === 'string' && provenance.engineName.trim())
        || '';

    if (!id && !name) return null;
    return { id: id || null, name: name || id };
}

// The engines a scan declares having run, as {id, name} - `canonical.engines`
// (current shape, one entry per engine of a multi-engine run) with the single
// `canonical.engine` older payloads carry as a fallback.
function declaredEngines(scan) {
    const canonical = scan && scan.canonical && typeof scan.canonical === 'object' ? scan.canonical : null;
    if (!canonical) return [];

    const list = Array.isArray(canonical.engines)
        ? canonical.engines
        : (canonical.engine ? [canonical.engine] : []);

    return list
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({ id: typeof e.id === 'string' && e.id.trim() ? e.id.trim() : null, name: engineLabel(e) }))
        .filter((e) => e.name);
}

/**
 * The engines a report used, as [{key, label}] sorted by label - what the select
 * offers below "All engines".
 *
 * Built from the engines each scan declares AND from the findings themselves. An
 * engine that ran and reported nothing only appears in the declaration, and
 * picking it (to see that it found nothing) is a legitimate thing to want; an
 * imported report whose scans lost their engine list still has its findings.
 */
export function collectEngineOptions(scans) {
    const seen = new Map(); // key -> label

    (Array.isArray(scans) ? scans : []).forEach((scan) => {
        declaredEngines(scan).forEach((engine) => {
            const key = engineKey(engine);
            if (key && !seen.has(key)) seen.set(key, engine.name);
        });

        const findings = scan && scan.canonical && Array.isArray(scan.canonical.findings)
            ? scan.canonical.findings
            : [];

        findings.forEach((finding) => {
            const engine = findingEngine(finding);
            if (!engine) return;
            const key = engineKey(engine);
            if (key && !seen.has(key)) seen.set(key, engine.name);
        });
    });

    return Array.from(seen.entries())
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

export function isEngineFilterActive(engineFilter) {
    return typeof engineFilter === 'string'
        && engineFilter.trim() !== ''
        && engineFilter !== ALL_ENGINES;
}

// The label for a selected key, for messages and the toolbar hint. Falls back to
// the key itself so a selection that outlived its report still reads as
// something.
export function engineLabelFor(scans, engineFilter) {
    if (!isEngineFilterActive(engineFilter)) return null;
    const match = collectEngineOptions(scans).find((o) => o.key === engineFilter);
    return match ? match.label : engineFilter;
}

// Fail findings and their occurrences, the two counts every summary row and the
// scan sort read. Kept here so the filtered scan carries numbers that agree with
// its own findings instead of the ones the report was written with.
function summaryCountsFor(findings) {
    let failCount = 0;
    let passesCount = 0;
    let reviewCount = 0;
    let occurrenceCount = 0;

    for (const finding of findings) {
        const outcome = finding && finding.outcome;
        if (outcome === 'fail') {
            failCount += 1;
            occurrenceCount += Array.isArray(finding.occurrences) ? finding.occurrences.length : 0;
        } else if (outcome === 'pass') {
            passesCount += 1;
        } else if (outcome === 'cantTell') {
            reviewCount += 1;
        }
    }

    return { failCount, passesCount, reviewCount, occurrenceCount };
}

/**
 * The metrics for one engine, or null when this scan cannot supply them.
 *
 * Two ways it can:
 *  - the scan ran several engines and the server scored each one separately
 *    (`metrics.byEngine`, written per scan at run time);
 *  - the scan ran only the selected engine, so the metrics it already carries
 *    are that engine's - which is the case for a report that merges several
 *    single-engine runs.
 *
 * Null means an older multi-engine report, written before per-engine metrics
 * existed: its scores cover every engine that ran and cannot be taken apart
 * here. Callers use `engineScoresFollow` to say so rather than showing a score
 * that silently disagrees with the findings beside it.
 */
function metricsForEngine(scan, engineFilter) {
    const metrics = scan && scan.metrics && typeof scan.metrics === 'object' ? scan.metrics : null;

    const perEngine = metrics && metrics.byEngine && typeof metrics.byEngine === 'object'
        ? metrics.byEngine[engineFilter]
        : null;

    if (perEngine && typeof perEngine === 'object') {
        return {
            ...metrics,
            a11ySummary: perEngine.a11ySummary || null,
            coverageSummary: perEngine.coverageSummary || null,
        };
    }

    const engines = declaredEngines(scan);
    if (engines.length === 1 && engineKey(engines[0]) === engineFilter) return metrics;

    // A scan with no engine recorded at all contributes no findings to this
    // selection either, so it has no metrics to disagree with.
    if (!engines.length && !metrics) return null;

    return null;
}

/**
 * Whether every scan can report the selected engine's own metric scores.
 *
 * False for an older multi-engine report whose scans were scored once, over all
 * the engines that ran. The report still filters - findings, counts, tables -
 * but its gauges keep covering everything, and the UI should say so.
 */
export function engineScoresFollow(scans, engineFilter) {
    if (!isEngineFilterActive(engineFilter)) return true;

    return (Array.isArray(scans) ? scans : []).every((scan) => {
        // A scan the selection excludes entirely contributes no score either.
        const engines = declaredEngines(scan);
        if (engines.length && !engines.some((engine) => engineKey(engine) === engineFilter)) return true;

        const metrics = scan && scan.metrics && typeof scan.metrics === 'object' ? scan.metrics : null;
        if (!metrics || !metrics.a11ySummary) return true; // nothing to be wrong

        return metricsForEngine(scan, engineFilter) !== null;
    });
}

/**
 * One scan seen through the selected engine: the same scan, with only that
 * engine's findings, the counts derived from them, and - where the scan can
 * supply them - that engine's own metrics.
 *
 * Copies rather than mutates - the payload it reads from stays whole, so
 * switching back to "All engines" is just another read of the same source, and
 * an edit made while a filter is on still lands on the real report.
 */
export function scanForEngine(scan, engineFilter) {
    if (!scan || typeof scan !== 'object') return scan;
    if (!isEngineFilterActive(engineFilter)) return scan;

    const canonical = scan.canonical && typeof scan.canonical === 'object' ? scan.canonical : null;
    if (!canonical) return scan;

    const findings = Array.isArray(canonical.findings) ? canonical.findings : [];
    const kept = findings.filter((finding) => {
        const engine = findingEngine(finding);
        return !!engine && engineKey(engine) === engineFilter;
    });

    // Narrowed from the canonical's own entries, not from the normalized copies
    // `declaredEngines` returns: the meta line renders "name version", so the
    // entries have to keep everything they came with.
    const declared = (Array.isArray(canonical.engines)
        ? canonical.engines
        : (canonical.engine ? [canonical.engine] : []))
        .filter((engine) => engineKey(engine) === engineFilter);

    const nextCanonical = { ...canonical, findings: kept };
    if (Array.isArray(canonical.bestPractices)) {
        nextCanonical.bestPractices = canonical.bestPractices.filter((finding) => {
            const engine = findingEngine(finding);
            return !!engine && engineKey(engine) === engineFilter;
        });
    }

    // The report meta line reads the engine list off the canonical, so narrow it
    // too: while one engine is selected, the report says it ran that one.
    if (Array.isArray(canonical.engines)) nextCanonical.engines = declared;
    if (canonical.engine) nextCanonical.engine = declared[0] || null;

    const out = {
        ...scan,
        canonical: nextCanonical,
        summary: { ...(scan.summary && typeof scan.summary === 'object' ? scan.summary : null), ...summaryCountsFor(kept) },
    };

    // The scores the metrics panel renders, and that the global summary averages
    // across scans. Left as they were when this scan cannot supply the engine's
    // own - the alternative is a blank panel where the report has real numbers.
    const metrics = metricsForEngine(scan, engineFilter);
    if (metrics) out.metrics = metrics;

    return out;
}

/** `scanForEngine` across a list. Returns the list untouched for "All engines". */
export function scansForEngine(scans, engineFilter) {
    const list = Array.isArray(scans) ? scans : [];
    if (!isEngineFilterActive(engineFilter)) return list;
    return list.map((scan) => scanForEngine(scan, engineFilter));
}
