'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { createBatchImages, packResultImages, imagePathsInFile, pictureName } = require('./batch-package');
const { fileDataUrl } = require('./scan-spool');

let tmp;
let reportsRoot;
let sessionDir;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-package-'));
    reportsRoot = path.join(tmp, 'reports');
    sessionDir = path.join(reportsRoot, 'batches', '2026-10-21T10-00-00');
    fs.mkdirSync(sessionDir, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const JPEG2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 8, 9, 0xff, 0xd9]);
const JPEG3 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);
const nameOf = (bytes, ext) => `${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${ext}`;

function evidence(run, file, bytes) {
    const dir = path.join(reportsRoot, 'evidence', run, 'elements-scan');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), bytes);
    return `/reports/evidence/${run}/elements-scan/${file}`;
}

describe('batch package', () => {
    test('every picture a result holds becomes a file in images/, named as the app names it, and the result its path', async () => {
        const spooled = path.join(sessionDir, '.spool-x', '1.jpg');
        fs.mkdirSync(path.dirname(spooled));
        fs.writeFileSync(spooled, JPEG);
        const element = evidence('2026-10-21T10-00-01-000Z', 'element-a.png', PNG);
        const payload = {
            scans: [{
                screenshots: [{ name: 'Main', dataUrl: fileDataUrl(spooled) }],
                canonical: { findings: [{ occurrences: [{ html: '<img src="data:image/gif;base64,R0lGOD">', elementScreenshot: { url: element } }] }] },
            }],
            findings: { fail: [{ occurrences: [{ elementScreenshot: { url: element } }] }] },
            screenshots: [
                { name: 'After', dataUrl: { pictureBytes: JPEG2, toJSON: () => 'x' } },
                { name: 'Inline', dataUrl: `data:image/jpeg;base64,${JPEG3.toString('base64')}` },
            ],
        };
        const { runFolders, missing } = await packResultImages(payload, createBatchImages(sessionDir), { reportsRoot });

        assert.equal(payload.scans[0].screenshots[0].dataUrl, `images/${nameOf(JPEG, 'jpg')}`);
        assert.equal(payload.screenshots[0].dataUrl, `images/${nameOf(JPEG2, 'jpg')}`);
        assert.equal(payload.screenshots[1].dataUrl, `images/${nameOf(JPEG3, 'jpg')}`);
        const png = `images/${nameOf(PNG, 'png')}`;
        assert.equal(payload.scans[0].canonical.findings[0].occurrences[0].elementScreenshot.url, png);
        assert.equal(payload.findings.fail[0].occurrences[0].elementScreenshot.url, png);
        assert.equal(payload.scans[0].canonical.findings[0].occurrences[0].html, '<img src="data:image/gif;base64,R0lGOD">', 'markup is not a picture');
        assert.equal(pictureName(PNG, 'image/png'), nameOf(PNG, 'png'));

        assert.deepEqual(fs.readdirSync(path.join(sessionDir, 'images')).sort(), [nameOf(JPEG, 'jpg'), nameOf(JPEG2, 'jpg'), nameOf(JPEG3, 'jpg'), nameOf(PNG, 'png')].sort());
        assert.equal(fs.existsSync(spooled), false, 'the spooled picture moved in');
        const linked = fs.statSync(path.join(sessionDir, png));
        assert.equal(linked.ino, fs.statSync(path.join(reportsRoot, element.slice('/reports/'.length))).ino, 'the element picture is linked, not copied');

        assert.deepEqual(runFolders, ['evidence/2026-10-21T10-00-01-000Z']);
        assert.deepEqual(missing, []);
        assert.ok(!JSON.stringify(payload).includes('/reports/'));
    });

    test('a picture another run of the batch already put there is not written again', async () => {
        const images = createBatchImages(sessionDir);
        const a = { s: `data:image/jpeg;base64,${JPEG.toString('base64')}` };
        const b = { s: `data:image/jpeg;base64,${JPEG.toString('base64')}` };
        await packResultImages(a, images, { reportsRoot });
        const file = path.join(sessionDir, a.s);
        const before = fs.statSync(file).mtimeMs;
        await packResultImages(b, createBatchImages(sessionDir), { reportsRoot });
        assert.equal(b.s, a.s);
        assert.equal(fs.statSync(file).mtimeMs, before);
    });

    test('a link that would leave the reports root, or names no picture there, keeps its link', async () => {
        fs.writeFileSync(path.join(tmp, 'secret.png'), PNG);
        const payload = {
            out: '/reports/../secret.png',
            gone: '/reports/evidence/r1/elements-scan/gone.png',
            page: '/reports/runs/r2/report.html',
        };
        const { runFolders, missing } = await packResultImages(payload, createBatchImages(sessionDir), { reportsRoot });
        assert.equal(payload.out, '/reports/../secret.png');
        assert.equal(payload.gone, '/reports/evidence/r1/elements-scan/gone.png');
        assert.equal(payload.page, '/reports/runs/r2/report.html');
        assert.deepEqual(runFolders, ['evidence/r1', 'runs/r2'], "its folders are still the run's");
        assert.deepEqual(missing.map((m) => m.ref), ['/reports/evidence/r1/elements-scan/gone.png']);
        assert.equal(fs.existsSync(path.join(sessionDir, 'images')), false, 'no folder for nothing');
    });

    test('finds the pictures a result names, a chunk at a time', async () => {
        const file = path.join(sessionDir, 'big.json');
        const names = ['images/aaaa.png', 'images/bbbb.jpg'];
        // Long enough that a name falls across the 1 MB chunks.
        const pad = 'x'.repeat((1 << 20) - 10);
        fs.writeFileSync(file, `{"a":"${pad}","b":"${names[0]}","c":["${'y'.repeat(1 << 20)}","${names[1]}","${names[0]}"]}`);
        assert.deepEqual(await imagePathsInFile(file), names);
    });
});

describe('pictures named by a link the lab serves', () => {
    test('prefix is what each picture\'s name is given, in place of images/', async () => {
        const payload = { scans: [{ screenshots: [{ dataUrl: `data:image/jpeg;base64,${JPEG.toString('base64')}` }] }] };
        await packResultImages(payload, createBatchImages(path.join(reportsRoot, 'runs', 'run_1')), { reportsRoot, prefix: '/reports/runs/run_1/images/' });
        assert.equal(payload.scans[0].screenshots[0].dataUrl, `/reports/runs/run_1/images/${nameOf(JPEG, 'jpg')}`);
        assert.ok(fs.existsSync(path.join(reportsRoot, 'runs', 'run_1', 'images', nameOf(JPEG, 'jpg'))));
    });
});
