'use strict';

// An engine adapter that is not surea11y, the least one can be: what
// a11y-engine.new-adapter.test.js plugs into the lab to show that adding an
// engine is adding its adapter and naming it in a11y-engine.config.json.
const canonical = () => ({
    version: '1.0',
    page: { url: 'https://example.test/', title: null, viewport: null, timestamp: '2026-01-01T00:00:00.000Z' },
    scope: { include: ['html'], exclude: [] },
    runOptions: { standardTags: [], includeBestPractice: false, resultTypes: [], engineOptions: {} },
    summary: { outcomes: { fail: 1, cantTell: 0, pass: 0, notApplicable: 0 } },
    findings: [{
        uid: 'fail:stub-rule', id: 'stub-rule', ruleId: 'stub-rule', title: 'Stub rule', description: 'A stub rule',
        helpUrl: null, outcome: 'fail', severity: 'serious', confidence: 1,
        standards: { wcag: [{ ref: '1.1.1', level: 'A' }], tags: ['wcag2a', 'wcag111'], wcagLevel: 'A' },
        wcag: { sc: ['1.1.1'], scNormative: ['1.1.1'] },
        occurrences: [{ uid: 'occ:1', pageUrl: 'https://example.test/', target: ['img'], html: '<img>', failureSummary: 'No alt', summary: 'No alt' }],
        raw: null
    }],
    rules: [], raw: null,
    diagnostics: { durationMs: 0, estimatedNodes: 1, warnings: [], errors: [] }
});
module.exports = {
    engineId: 'stub', engineName: 'Stub', engineVersion: '0.0.1',
    capabilities: { selectsBy: 'tags', actions: { a11yScan: { label: true } } },
    getRulesCatalog: () => ({ version: '0.0.1', rules: [{ ruleId: 'stub-rule' }] }),
    runOnPage: async (page, opts) => ({ canonical: canonical(), seen: opts })
};
