'use strict';

// A report as a package: its JSON names each picture by its path in the zip,
// the same file its HTML shows, and loads back with the pictures, no server.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');

let P;
let B;
async function load() {
    if (!P) P = await import('./report-package.js');
    if (!B) B = await import('./comparison-bundle.js');
    return { P, B };
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);
const dataUrl = (bytes, type) => `data:${type};base64,${bytes.toString('base64')}`;

/** A fetch that serves the lab's files: element pictures, an HTML report, and one gone. */
function lab() {
    const served = {
        '/reports/evidence/r/elements-scan/element-a.png': { type: 'image/png', bytes: PNG },
        '/reports/runs/r/report.html': { type: 'text/html', bytes: Buffer.from('<html>') },
        'blob:app/1': { type: 'image/jpeg', bytes: JPEG },
    };
    const calls = [];
    const fetchImpl = async (url) => {
        calls.push(url);
        const f = served[url];
        if (!f) return { ok: false, status: 404, statusText: 'Not Found', headers: new Map() };
        return { ok: true, headers: new Map([['content-type', f.type]]), arrayBuffer: async () => f.bytes };
    };
    return { fetchImpl, calls };
}

function report() {
    const element = { url: '/reports/evidence/r/elements-scan/element-a.png', cropped: false };
    return {
        url: 'https://shop.test/',
        scans: [{
            id: 's1',
            screenshots: [{ name: 'Main screenshot', dataUrl: dataUrl(JPEG, 'image/jpeg') }],
            canonical: { findings: [{ uid: 'r', occurrences: [{ html: '<img src="data:image/gif;base64,R0lGOD">', elementScreenshot: element }] }] },
        }],
        // The same picture again, in the merged findings: one file.
        findings: { fail: [{ uid: 'r', occurrences: [{ elementScreenshot: { ...element } }] }] },
        screenshots: [{ name: 'After', publicUrl: 'blob:app/1' }],
        htmlReport: '/reports/runs/r/report.html',
        gone: { elementScreenshot: { url: '/reports/evidence/r/elements-scan/gone.png' } },
    };
}

describe('report package', () => {
    test('names every picture by its path in the package, each stored once by its content', async () => {
        const { P } = await load();
        const zip = new JSZip();
        const store = P.createImageStore(zip);
        const { fetchImpl, calls } = lab();
        const { payload, missing } = await P.packPayloadImages(report(), store, { fetchImpl });

        const jpeg = payload.scans[0].screenshots[0].dataUrl;
        const png = payload.scans[0].canonical.findings[0].occurrences[0].elementScreenshot.url;
        assert.match(jpeg, /^images\/[0-9a-f]{20}\.jpg$/);
        assert.match(png, /^images\/[0-9a-f]{20}\.png$/);
        assert.equal(payload.findings.fail[0].occurrences[0].elementScreenshot.url, png, 'the same picture, the same file');
        assert.equal(payload.screenshots[0].publicUrl, jpeg, 'a loaded package\'s picture, the same bytes: the same file');
        assert.equal(store.size, 2);
        assert.deepEqual(Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort(), [jpeg, png].sort());

        assert.equal(payload.htmlReport, '/reports/runs/r/report.html', 'a link to something else is left');
        assert.equal(payload.scans[0].canonical.findings[0].occurrences[0].html, '<img src="data:image/gif;base64,R0lGOD">', 'markup is not a picture');
        assert.equal(payload.gone.elementScreenshot.url, '/reports/evidence/r/elements-scan/gone.png', 'one gone keeps its link');
        assert.deepEqual(missing.map((m) => [m.ref, m.error]), [['/reports/evidence/r/elements-scan/gone.png', '404 Not Found']]);
        assert.equal(calls.filter((u) => u.endsWith('element-a.png')).length, 1, 'fetched once');
    });

    test('the same names as the HTML extraction would give', async () => {
        const { P } = await load();
        const name = await P.createImageStore(new JSZip()).add(new Uint8Array(JPEG), 'image/jpeg');
        assert.equal(name, `${await P.createContentHash(new Uint8Array(JPEG))}.jpg`);
        assert.equal(await P.createImageStore(new JSZip()).add(new Uint8Array(JPEG), 'text/plain'), null);
    });

    test('loads back: each path becomes a link to the picture in the zip, with no server', async () => {
        const { P, B } = await load();
        const zip = new JSZip();
        const { payload } = await P.packPayloadImages(report(), P.createImageStore(zip), lab());
        zip.file('report.html', '<html></html>');
        zip.file('styles/report.css', 'body{}');
        zip.file('Shop.a11y-report.json', JSON.stringify(payload));
        const data = await zip.generateAsync({ type: 'uint8array' });

        const read = await B.readCompareZip(JSZip, data);
        assert.equal(read.kind, 'reports');
        assert.deepEqual(read.files.map((f) => f.name), ['Shop.a11y-report.json'], 'the stylesheet and pictures are not reports');
        const loaded = JSON.parse(read.files[0].text);
        const shot = loaded.scans[0].screenshots[0].dataUrl;
        assert.match(shot, /^blob:/);
        const bytes = new Uint8Array(await (await fetch(shot)).arrayBuffer());
        assert.deepEqual(Buffer.from(bytes), JPEG, 'the picture itself');
        assert.match(loaded.findings.fail[0].occurrences[0].elementScreenshot.url, /^blob:/);
    });

    test('a path with no picture in the zip is left, for the view to say so', async () => {
        const { P } = await load();
        const urls = new Map([['images/a.png', 'blob:x']]);
        assert.equal(P.resolveImageRefs('{"a":"images/a.png","b":"images/b.png","c":"see images/a.png"}', urls),
            '{"a":"blob:x","b":"images/b.png","c":"see images/a.png"}');
        assert.equal(P.resolveImageRefs('{"a":"images/a.png"}', new Map()), '{"a":"images/a.png"}');
    });

});

describe('a comparison saved with its reports', () => {
    test('carries their pictures as a package, and loads back with them', async () => {
        const { B } = await load();
        const { fetchImpl } = lab();
        const snapshot = {
            context: 'versions', order: 'given', document: { title: 'Shop', note: '', generatedAt: '2026-10-21T10:00:00.000Z' },
            reports: [
                // One loaded from a package: its picture a blob: link of that page.
                { name: 'a.a11y-report.json', report: { runId: 'a', scans: [{ id: 's', screenshots: [{ name: 'Main', dataUrl: 'blob:app/1' }] }] } },
                { name: 'b.a11y-report.json', report: { runId: 'b', scans: [{ id: 's', screenshots: [{ name: 'Main', dataUrl: dataUrl(JPEG, 'image/jpeg') }] }] } },
            ],
        };
        const data = await B.writeComparisonZip(JSZip, { html: '<html></html>', baseName: 'Shop', snapshot, type: 'uint8array', fetchImpl });

        const zip = await JSZip.loadAsync(data);
        const images = Object.keys(zip.files).filter((n) => n.startsWith('images/') && !zip.files[n].dir);
        assert.equal(images.length, 1, 'the same picture in both reports: one file');
        const saved = zip.file(Object.keys(zip.files).find((n) => n.endsWith('a.a11y-report.json')));
        assert.ok(!(await saved.async('string')).includes('blob:'), 'no link that only lived in the page');

        const read = await B.readCompareZip(JSZip, data);
        assert.equal(read.kind, 'comparison');
        for (const r of read.reports) {
            const shot = r.json.scans[0].screenshots[0].dataUrl;
            assert.match(shot, /^blob:/);
            assert.deepEqual(Buffer.from(new Uint8Array(await (await fetch(shot)).arrayBuffer())), JPEG);
        }
    });
});

describe('a report as its JSON file holds it', () => {
    test('leaves out the findings the app built from its scans to show it, and only those', async () => {
        const { P } = await load();
        const shown = { reportVersion: 3, runId: 'r', scans: [{ id: 's' }], metrics: { a: 1 }, findings: { fail: [] }, a11yGlobalFindings: { fail: [] } };
        assert.deepEqual(JSON.parse(P.storedReportJson(shown)), { reportVersion: 3, runId: 'r', scans: [{ id: 's' }], metrics: { a: 1 } });
        assert.ok('a11yGlobalFindings' in shown, 'the report shown keeps them');
    });

    test('a comparison saved with its reports writes them so', async () => {
        const { B } = await load();
        const report = { runId: 'a', scans: [{ id: 's' }], a11yGlobalFindings: { fail: [{ ruleId: 'image-alt' }] } };
        const snapshot = { context: 'versions', order: 'given', document: { title: 'Shop', note: '', generatedAt: null }, reports: [{ name: 'a.a11y-report.json', report }] };
        const zip = await JSZip.loadAsync(await B.writeComparisonZip(JSZip, { html: '', baseName: 'Shop', snapshot, type: 'uint8array' }));
        const saved = JSON.parse(await zip.file(Object.keys(zip.files).find((n) => n.endsWith('a.a11y-report.json'))).async('string'));
        assert.equal('a11yGlobalFindings' in saved, false);
    });
});

describe('a package\'s report with its pictures inline', () => {
    test('gives the report with each picture it names as a data URL, and only those', async () => {
        const { P } = await load();
        const zip = new JSZip();
        zip.file('Shop.a11y-report.json', JSON.stringify({ scans: [{ screenshot: 'images/aaa.jpg', shot: 'images/gone.png' }] }));
        zip.file('images/aaa.jpg', JPEG);
        zip.file('images/other.png', PNG);
        zip.file('Shop.html', '<html>');
        const got = await P.inlineReportFromZip(await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' })));
        assert.equal(got.name, 'Shop.a11y-report.json');
        const report = JSON.parse(got.text);
        assert.equal(report.scans[0].screenshot, dataUrl(JPEG, 'image/jpeg'));
        assert.equal(report.scans[0].shot, 'images/gone.png', 'a picture not in the package keeps its path');
        assert.ok(!got.text.includes(PNG.toString('base64')));
    });

    test('a CLI run\'s payload.json counts; a zip with no report gives null', async () => {
        const { P } = await load();
        const cli = new JSZip();
        cli.file('run/payload.json', '{"scans":[]}');
        assert.equal((await P.inlineReportFromZip(cli)).name, 'payload.json');
        const other = new JSZip();
        other.file('notes.txt', 'hi');
        assert.equal(await P.inlineReportFromZip(other), null);
    });
});
