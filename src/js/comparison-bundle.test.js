'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

let B;
async function load() {
    if (!B) B = await import('./comparison-bundle.js');
    return B;
}

function snapshot(over = {}) {
    return {
        context: 'versions',
        order: 'given',
        document: { title: 'Checkout', note: 'Before and after the redesign', generatedAt: '2026-10-01T09:00:00.000Z' },
        reports: [
            { name: 'v1.3.a11y-report.json', report: { runId: 'b', scans: [{ id: 's1' }] } },
            { name: 'v1.2.json', report: { runId: 'a', scans: [{ id: 's2' }] } },
            { name: 'v1.3.a11y-report.json', report: { runId: 'c', scans: [] } },
        ],
        ...over,
    };
}

describe('comparison bundle', () => {
    test('names report files by column, keeping same-named reports apart', async () => {
        const { reportFileNames } = await load();
        assert.deepEqual(reportFileNames(['v1.3.a11y-report.json', 'v1.2.json', 'v1.3.a11y-report.json', 'a/b: c']), [
            'reports/01 v1.3.a11y-report.json',
            'reports/02 v1.2.a11y-report.json',
            'reports/03 v1.3.a11y-report.json',
            'reports/04 a-b- c.a11y-report.json',
        ]);
        assert.match(reportFileNames(Array(120).fill('x'))[0], /^reports\/001 x/);
    });

    test('writes the comparison, comparison.json and each report, and reads them back as they were', async () => {
        const { writeComparisonZip, readComparisonZip } = await load();
        const data = await writeComparisonZip(JSZip, {
            html: '<!doctype html><title>Checkout</title>', baseName: 'Checkout 2026-10-01', snapshot: snapshot(), type: 'uint8array',
        });

        const zip = await JSZip.loadAsync(data);
        assert.deepEqual(Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort(), [
            'Checkout 2026-10-01.html',
            'comparison.json',
            'reports/01 v1.3.a11y-report.json',
            'reports/02 v1.2.a11y-report.json',
            'reports/03 v1.3.a11y-report.json',
        ]);

        const back = await readComparisonZip(JSZip, data);
        assert.equal(back.context, 'versions');
        assert.equal(back.order, 'given');
        assert.deepEqual(back.document, snapshot().document);
        assert.deepEqual(back.reports.map((r) => [r.name, r.json.runId]), [
            ['v1.3.a11y-report.json', 'b'],
            ['v1.2.json', 'a'],
            ['v1.3.a11y-report.json', 'c'],
        ]);
    });

    test('keeps a default order as null', async () => {
        const { writeComparisonZip, readComparisonZip } = await load();
        const data = await writeComparisonZip(JSZip, { html: '', baseName: 'x', snapshot: snapshot({ context: 'time', order: null }), type: 'uint8array' });
        const back = await readComparisonZip(JSZip, data);
        assert.equal(back.context, 'time');
        assert.equal(back.order, null);
    });

    test('refuses a zip that is not a downloaded comparison, saying why', async () => {
        const { readComparisonZip } = await load();
        const plain = new JSZip();
        plain.file('report.json', '{}');
        await assert.rejects(readComparisonZip(JSZip, await plain.generateAsync({ type: 'uint8array' })),
            /not a downloaded comparison: it has no comparison\.json/);

        await assert.rejects(readComparisonZip(JSZip, new Uint8Array([1, 2, 3])), /not a readable zip file/);

        const missing = new JSZip();
        missing.file('comparison.json', JSON.stringify({ type: 'a11y-comparison', version: 1, reports: [{ file: 'reports/01 a.a11y-report.json' }] }));
        await assert.rejects(readComparisonZip(JSZip, await missing.generateAsync({ type: 'uint8array' })),
            /reports\/01 a\.a11y-report\.json is listed in comparison\.json but missing from the zip/);
    });

    test('readCompareZip tells a downloaded comparison from a zip of reports', async () => {
        const { writeComparisonZip, readCompareZip } = await load();
        const data = await writeComparisonZip(JSZip, { html: '', baseName: 'x', snapshot: snapshot(), type: 'uint8array' });
        const back = await readCompareZip(JSZip, data);
        assert.equal(back.kind, 'comparison');
        assert.equal(back.reports.length, 3);
    });

    test('a plain zip gives its JSON files in path order, leaving out folders, dotfiles and other files', async () => {
        const { readCompareZip } = await load();
        const zip = new JSZip();
        zip.file('b/second.json', '{"runId":"2"}');
        zip.file('a first.a11y-report.json', '{"runId":"1"}');
        zip.file('notes.txt', 'hello');
        zip.file('.hidden.json', '{}');
        zip.file('__MACOSX/._a first.a11y-report.json', 'x');
        const back = await readCompareZip(JSZip, await zip.generateAsync({ type: 'uint8array' }));
        assert.equal(back.kind, 'reports');
        assert.equal(back.ordered, false);
        assert.deepEqual(back.files.map((f) => [f.path, f.name, JSON.parse(f.text).runId]), [
            ['a first.a11y-report.json', 'a first.a11y-report.json', '1'],
            ['b/second.json', 'second.json', '2'],
        ]);
    });

    test('a queue zip leaves batch.json out and keeps its runs in the order they were queued', async () => {
        const { readCompareZip } = await load();
        const zip = new JSZip();
        zip.file('batch.json', JSON.stringify({
            type: 'a11y-queue-session', version: 1,
            items: [{ file: 'Release-C.json', row: 1 }, { file: 'Release-A.json', row: 2 }, { file: null, row: 3 }],
        }));
        zip.file('Release-A.json', '{"runId":"a"}');
        zip.file('Release-C.json', '{"runId":"c"}');
        zip.file('extra.json', '{"runId":"x"}');
        const back = await readCompareZip(JSZip, await zip.generateAsync({ type: 'uint8array' }));
        assert.equal(back.ordered, true);
        assert.equal(back.rows, true);
        assert.deepEqual(back.files.map((f) => f.name), ['Release-C.json', 'Release-A.json', 'extra.json']);
    });

    test('a batch.json that is not a queue\'s is just another file', async () => {
        const { readCompareZip } = await load();
        const zip = new JSZip();
        zip.file('batch.json', '{"runId":"b"}');
        const back = await readCompareZip(JSZip, await zip.generateAsync({ type: 'uint8array' }));
        assert.equal(back.ordered, false);
        assert.deepEqual(back.files.map((f) => f.name), ['batch.json']);
    });

    test('a zip with no JSON in it is refused', async () => {
        const { readCompareZip } = await load();
        const zip = new JSZip();
        zip.file('notes.txt', 'hello');
        await assert.rejects(readCompareZip(JSZip, await zip.generateAsync({ type: 'uint8array' })), /it holds no JSON reports/);
    });

    test('readManifest checks the type and version, and falls back on unknown choices', async () => {
        const { readManifest } = await load();
        assert.throws(() => readManifest({ type: 'other' }), /not a comparison description/);
        assert.throws(() => readManifest({ type: 'a11y-comparison', version: 2, reports: [{ file: 'a' }] }), /version 2/);
        assert.throws(() => readManifest({ type: 'a11y-comparison', version: 1, reports: [] }), /lists no report files/);
        const m = readManifest({ type: 'a11y-comparison', version: 1, context: 'nope', order: 'sideways', reports: [{ file: 'a' }] });
        assert.equal(m.context, 'time');
        assert.equal(m.order, null);
        assert.deepEqual(m.document, { title: '', note: '', generatedAt: null });
    });
});
