'use strict';

// The engines a report's findings came from. The lab runs surea11y alone, but
// a report saved before may hold findings of other engines: the results table
// then shows an Engine column (a11y-ui.rendering.js), so each row says which
// engine found it. No DOM, so these are unit-tested directly.

// The key an engine is known by: its id when the adapter reports one, else
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
 * The engines a report used, as [{key, label}] sorted by label.
 *
 * Built from the engines each scan declares AND from the findings themselves: an
 * engine that ran and reported nothing only appears in the declaration, and an
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
