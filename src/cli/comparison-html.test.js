'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildComparisonHtml } = require('./comparison-html');

const ASSETS = {
    template: '<!doctype html><html><head><title>{{COMPARISON_TITLE}}</title><meta name="description" content="{{COMPARISON_DESCRIPTION}}"></head><body>{{COMPARISON}}</body></html>',
    css: '.a{}',
    comparisonCss: '.b{}',
    js: 'var x = "$&";',
};

function report(runId, timestamp, targets) {
    return {
        url: 'https://example.com/',
        runId,
        timestamp,
        scenarioName: 'Checkout',
        scans: [{
            id: 's1',
            url: 'https://example.com/',
            canonical: {
                findings: [{
                    ruleId: 'image-alt', id: 'image-alt', title: 'Images need text', severity: 'serious', outcome: 'fail',
                    wcag: { sc: [{ ref: '1.1.1', level: 'A' }] },
                    occurrences: targets.map((t) => ({ pageUrl: 'https://example.com/', target: [t] })),
                }],
            },
        }],
        metrics: { a11ySummary: { scores: { avgPageAccessibility: 70, confidence: 90 } } },
    };
}

test('draws the comparison the app would, as a document of its own', async () => {
    const { html, missing } = await buildComparisonHtml(
        report('a', '2026-01-01T00:00:00Z', ['.a', '.b']),
        report('b', '2026-02-01T00:00:00Z', ['.b']),
        { title: 'Checkout', generatedAt: '2026-02-02T00:00:00Z', assets: ASSETS },
    );
    assert.equal(missing, undefined);
    assert.match(html, /<title>Checkout<\/title>/);
    assert.match(html, /<h1 class="doc-title">Checkout<\/h1>/);
    assert.equal((html.match(/<h1/g) || []).length, 1);
    assert.match(html, /class="cmp2/);
    assert.match(html, /Images need text/);
    // Inlined, and a "$&" in the script stays as it is.
    assert.match(html, /<style>\.a\{\}\n\.b\{\}<\/style><\/head>/);
    assert.match(html, /<script>var x = "\$&";<\/script><\/body>/);
});

test('says why there is no file when the assets are not built', async () => {
    const { html, missing } = await buildComparisonHtml(report('a', '2026-01-01T00:00:00Z', []), report('b', '2026-02-01T00:00:00Z', []), { assets: null });
    assert.equal(html, undefined);
    assert.match(missing, /npm run build:report/);
});
