'use strict';

/**
 * Turns axe-core's results into the lab's canonical result format, for the
 * scans the lab server runs with that engine (engines/axe-engine.js, through
 * a11y-canonical.js). Server only: the extension scans with surea11y alone.
 * The format's own helpers are in ../shared/canonical-shared.js.
 */

const {
    CANON_VERSION,
    isoNow,
    normalizeSelectorList,
    normalizeOutcome,
    normalizeSeverity,
    makeFindingUid,
    makeOccurrenceUid,
    tagsToStandards
} = require('../shared/canonical-shared');

function fromAxeResults(collectedScans, meta = {}) {
    const engine = meta.engine || { id: 'axe', version: null, name: 'axe-core' };

    const pageUrl =
        (meta.page && meta.page.url) ||
        (collectedScans && collectedScans.url) ||
        null;

    const page = {
        url: pageUrl,
        title: meta.page ? (meta.page.title || null) : null,
        viewport: meta.page ? (meta.page.viewport || null) : null,
        timestamp: (meta.page && meta.page.timestamp) ? meta.page.timestamp : isoNow()
    };

    const scope = {
        include: normalizeSelectorList(meta.scope && meta.scope.include ? meta.scope.include : ['html']),
        exclude: normalizeSelectorList(meta.scope && meta.scope.exclude ? meta.scope.exclude : [])
    };

    const runOptions = {
        standardTags: normalizeSelectorList(meta.runOptions && meta.runOptions.standardTags ? meta.runOptions.standardTags : []),
        includeBestPractice: !!(meta.runOptions && meta.runOptions.includeBestPractice),
        resultTypes: Array.isArray(meta.runOptions && meta.runOptions.resultTypes) ? meta.runOptions.resultTypes : [],
        engineOptions: (meta.runOptions && meta.runOptions.engineOptions && typeof meta.runOptions.engineOptions === 'object')
            ? meta.runOptions.engineOptions
            : {}
    };

    const diagnostics = {
        durationMs: (meta.diagnostics && Number.isFinite(meta.diagnostics.durationMs)) ? meta.diagnostics.durationMs : 0,
        estimatedNodes: (meta.diagnostics && Number.isFinite(meta.diagnostics.estimatedNodes)) ? meta.diagnostics.estimatedNodes : 0,
        warnings: Array.isArray(meta.diagnostics && meta.diagnostics.warnings) ? meta.diagnostics.warnings : [],
        errors: Array.isArray(meta.diagnostics && meta.diagnostics.errors) ? meta.diagnostics.errors : []
    };

    const categories = [
        { key: 'violations', outcome: 'fail' },
        { key: 'incomplete', outcome: 'cantTell' },
        { key: 'passes', outcome: 'pass' },
        { key: 'inapplicable', outcome: 'notApplicable' }
    ];

    const findings = [];

    for (const cat of categories) {
        const list = Array.isArray(collectedScans && collectedScans[cat.key]) ? collectedScans[cat.key] : [];
        for (const item of list) {
            const ruleId = String(item && item.id ? item.id : '').trim();
            if (!ruleId) continue;

            const outcome = normalizeOutcome(cat.outcome);
            const severity = normalizeSeverity(item && item.impact ? item.impact : 'unknown');

            const tags = Array.isArray(item && item.tags) ? item.tags : [];
            const standards = tagsToStandards(tags);

            const occurrences = [];
            const nodes = Array.isArray(item && item.nodes) ? item.nodes : [];
            for (const node of nodes) {
                const occTarget = Array.isArray(node && node.target) ? node.target : (node && node.target ? [String(node.target)] : []);
                const html = (node && typeof node.html === 'string') ? node.html : null;
                const occ = {
                    uid: makeOccurrenceUid({
                        ruleId,
                        outcome,
                        pageUrl: (node && (node.url || node.pageUrl)) ? String(node.url || node.pageUrl) : pageUrl,
                        target: occTarget,
                        html: html || ''
                    }),
                    pageUrl: (node && (node.url || node.pageUrl)) ? String(node.url || node.pageUrl) : pageUrl,
                    target: occTarget,
                    html,
                    failureSummary: (node && typeof node.failureSummary === 'string') ? node.failureSummary : null,
                    summary: (node && typeof node.failureSummary === 'string') ? node.failureSummary : null,
                    evidence: {
                        engineNode: (node && typeof node === 'object') ? node : null
                    }
                };
                occurrences.push(occ);
            }

            findings.push({
                uid: makeFindingUid(engine.id, outcome, ruleId),
                id: ruleId,
                ruleId,

                provenance: {
                    engineId: engine.id,
                    engineName: engine.name || null,
                    engineVersion: engine.version || null
                },

                title: (item && typeof item.help === 'string') ? item.help : (item && typeof item.description === 'string' ? item.description : null),
                description: (item && typeof item.description === 'string') ? item.description : null,
                helpUrl: (item && typeof item.helpUrl === 'string') ? item.helpUrl : null,
                outcome,
                severity,
                confidence: 1.0,
                standards: {
                    wcag: standards.wcag,
                    tags: standards.tags,
                    wcagLevel: standards.wcagLevel
                },
                wcag: {
                    sc: Array.isArray(item && item.SC) ? item.SC : (Array.isArray(standards.wcag) ? standards.wcag.map(w => w && w.ref ? String(w.ref) : '').filter(Boolean) : [])
                },
                occurrences,
                // axe-core tags the rules that test no WCAG criterion best-practice.
                ...(tags.some((t) => String(t).toLowerCase() === 'best-practice') ? { bestPractice: true } : {}),
            });
        }
    }

    // One finding per axe rule and outcome. The requirements' counts leave
    // the best practices out; theirs are kept apart.
    const countOutcomes = (list) => {
        const out = { fail: 0, cantTell: 0, pass: 0, notApplicable: 0 };
        for (const f of list) if (Object.prototype.hasOwnProperty.call(out, f.outcome)) out[f.outcome] += 1;
        return out;
    };
    const outcomes = countOutcomes(findings.filter((f) => !f.bestPractice));
    const bestPractices = countOutcomes(findings.filter((f) => f.bestPractice));

    const rules = Array.isArray(collectedScans && collectedScans.rules) ? collectedScans.rules : [];

    return {
        version: CANON_VERSION,
        engine,
        page,
        scope,
        runOptions,
        summary: { outcomes, bestPractices },
        findings,
        rules,
        diagnostics
    };
}

module.exports = { fromAxeResults };
