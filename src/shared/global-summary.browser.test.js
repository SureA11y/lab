'use strict';

// The run summary's modules as the app loads them: plain scripts, in order,
// each registering a global, with no module system. The app builds a report's
// summary again with them (over the scans the report includes), so it must
// give what the server gives.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { buildGlobalSummary } = require('./global-summary.js');

const SCRIPTS = ['a11y-metric-defs.js', 'a11y-summary.js', 'coverage-summary.js', 'occurrence-mining.js', 'global-summary.js'];

function loadAsTheAppDoes() {
    const context = vm.createContext({});
    context.globalThis = context;
    for (const file of SCRIPTS) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
    }
    return context;
}

// A page with a few findings and too little to be scored on its own.
function scan(url, uid) {
    return {
        url,
        canonical: {
            findings: [{
                uid, ruleId: uid, outcome: 'fail', severity: 'serious',
                occurrences: [{ pageUrl: url, target: ['img'], html: '<img>' }],
            }],
        },
        metrics: {
            domMetrics: { totalElements: 40, counts: {} },
            a11ySummary: { scores: { avgPageAccessibility: null, evaluationState: 'notMeasurable', confidence: 75 } },
        },
    };
}

describe('the run summary in the browser', () => {
    const context = loadAsTheAppDoes();

    test('each module registers its global', () => {
        for (const name of ['A11Y_SUMMARY', 'A11Y_COVERAGE_SUMMARY', 'A11Y_OCCURRENCE_MINING', 'A11Y_GLOBAL_SUMMARY']) {
            assert.equal(typeof context[name], 'object', name);
        }
    });

    test('gives the same summary as the server', () => {
        const scans = [scan('https://shop.test/', 'fail:img-alt'), scan('https://shop.test/cart', 'fail:label')];
        const options = { domP90: 90, useMinConfidence: false };
        const inBrowser = JSON.parse(JSON.stringify(context.A11Y_GLOBAL_SUMMARY.buildGlobalSummary({ scans, options })));
        const onServer = JSON.parse(JSON.stringify(buildGlobalSummary({ scans, options })));
        assert.deepEqual(inBrowser, onServer);
    });

    test('scores a run whose pages are too small to score alone', () => {
        const scans = [scan('https://shop.test/', 'fail:img-alt'), scan('https://shop.test/cart', 'fail:label')];
        const { a11ySummary } = context.A11Y_GLOBAL_SUMMARY.buildGlobalSummary({ scans, options: { useMinConfidence: false } });
        assert.equal(typeof a11ySummary.scores.avgPageAccessibility, 'number');
    });
});
