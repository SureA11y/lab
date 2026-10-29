'use strict';

// Real-Chrome test: the conditions a page is shown under stay as set until a
// step changes them again, whatever runs in between.
//
// Set viewport, Set color scheme, Emulate vision deficiency and Set language
// each set one,
// and the steps after them - navigating, refreshing, going back, scanning,
// steps inside a Repeat, an If, a Group or a custom step - must not undo it. A
// scan re-applies the viewport before it runs, so a viewport set inside a
// composite or a custom step has to be the one it re-applies.
//
// The workflow runs end to end (executeWorkflowRun, as the app and the CLI do)
// against a page that writes its width, color scheme and reduced motion into
// the DOM, read back with getText. Vision deficiency only shows in pixels: a
// red swatch has to come out grey in the screenshots after it is set.
//
// Not named *.test.js, so `npm test` does not need Chrome; run with
//   npm run test:dom

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const sharp = require('sharp');

const { executeWorkflowRun } = require('./workflow-run');
const { closeBrowser } = require('./a11y-runner');

const PAGE = `<!doctype html><html lang="en"><head><title>Conditions</title>
<style>#swatch{width:200px;height:200px;background:#ff0000}</style></head>
<body><main><h1>Conditions</h1><p id="state"></p><p id="fc"></p><div id="swatch"></div></main>
<script>
const dark = matchMedia('(prefers-color-scheme: dark)'), motion = matchMedia('(prefers-reduced-motion: reduce)');
const show = () => { document.getElementById('state').textContent =
  'w=' + innerWidth + ' scheme=' + (dark.matches ? 'dark' : 'light') + ' rm=' + motion.matches; };
dark.addEventListener('change', show); motion.addEventListener('change', show); addEventListener('resize', show); show();
const forced = matchMedia('(forced-colors: active)');
const showForced = () => { document.getElementById('fc').textContent = 'fc=' + forced.matches; };
forced.addEventListener('change', showForced); showForced();
</script></body></html>`;

// The language a site sees: the header its server gets (written into the
// page as served), navigator.language(s) and the format of a number.
const LANG_PAGE = (acceptLanguage) => `<!doctype html><html lang="en"><head><title>Language</title></head>
<body><main><h1>Language</h1><p id="state"></p></main>
<script>
document.getElementById('state').textContent = 'header=' + ${JSON.stringify(String(acceptLanguage || ''))}
  + ' nav=' + navigator.language + ' navs=' + navigator.languages.join(',') + ' num=' + (1234.5).toLocaleString();
</script></body></html>`;

let server;
let base;

before(async () => {
    server = http.createServer((req, res) => {
        const known = req.url.startsWith('/cond') || req.url.startsWith('/lang');
        res.writeHead(known ? 200 : 404, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end(req.url.startsWith('/cond') ? PAGE : req.url.startsWith('/lang') ? LANG_PAGE(req.headers['accept-language']) : '');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    // The runner keeps its browser for the next run; this file is the last.
    await closeBrowser();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

const read = (name) => ({ type: 'getText', selector: '#state', var: name });

/** How many clearly red pixels a screenshot holds. */
async function redPixels(dataUrl) {
    const { data, info } = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).raw().toBuffer({ resolveWithObject: true });
    let count = 0;
    for (let i = 0; i < data.length; i += info.channels) {
        if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) count += 1;
    }
    return count;
}

describe('page conditions persist until changed', () => {
    test('viewport, color scheme and vision deficiency survive navigation, scans and composite steps', async () => {
        const names = ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'];
        const spec = {
            url: `${base}/cond.html`,
            scenarioName: 'Page conditions',
            customSteps: [{ id: 'go-tablet', name: 'Go tablet', inputs: [], actions: [{ type: 'setViewport', preset: 'tablet' }] }],
            actions: [
                read('s0'),
                { type: 'screenshot', label: 'before' },
                { type: 'repeat', repetitions: 1, actions: [{ type: 'setViewport', preset: 'mobile' }] },
                read('s1'),
                { type: 'if', selectorExists: '#state', actions: [{ type: 'setColorScheme', colorScheme: 'dark' }] },
                read('s2'),
                { type: 'group', actions: [{ type: 'emulateVisionDeficiency', deficiency: 'achromatopsia' }] },
                { type: 'screenshot', label: 'after-group' },
                { type: 'navigate', url: `${base}/cond.html?b` },
                read('s3'),
                { type: 'refresh' },
                read('s4'),
                { type: 'a11yScan', label: 'scan-1' },
                read('s5'),
                { type: 'goBack' },
                read('s6'),
                { type: 'runCustomStep', customStepId: 'go-tablet' },
                read('s7'),
                { type: 'a11yScan', label: 'scan-2' },
                read('s8'),
                { type: 'screenshot', label: 'end' },
                { type: 'setColorScheme', colorScheme: 'default' },
                read('s9'),
                { type: 'collectOutput', key: 'states', value: names.map((n) => `{var:${n}}`).join(' | ') },
            ],
        };

        const { status, payload } = await executeWorkflowRun(spec);
        assert.equal(status, 'done');

        const states = payload.collectedOutputs.find((o) => o.key === 'states').value.split(' | ');
        assert.deepEqual(states, [
            'w=1280 scheme=light rm=true', // as the run starts
            'w=375 scheme=light rm=true',  // Set viewport inside a Repeat
            'w=375 scheme=dark rm=true',   // Set color scheme inside an If
            'w=375 scheme=dark rm=true',   // after navigating
            'w=375 scheme=dark rm=true',   // after refreshing
            'w=375 scheme=dark rm=true',   // after a scan, which re-applies the viewport
            'w=375 scheme=dark rm=true',   // after going back
            'w=768 scheme=dark rm=true',   // Set viewport inside a custom step
            'w=768 scheme=dark rm=true',   // after a scan: the custom step's viewport, not an earlier one
            'w=768 scheme=light rm=true',  // Browser default: the browser's own scheme, reduced motion kept
        ]);

        // As the app and the queue get it: written. Until then a screenshot is
        // a buffer, whose data URL is made as the result is written.
        const written = JSON.parse(JSON.stringify(payload));
        const shots = Object.fromEntries(written.screenshots.map((s) => [s.name, s.dataUrl]));
        const shot = (label) => shots[Object.keys(shots).find((k) => k.includes(label))];
        assert.ok(await redPixels(shot('before')) > 30000, 'the swatch is red before the emulation');
        assert.equal(await redPixels(shot('after-group')), 0, 'grey once set inside a Group');
        assert.equal(await redPixels(shot('end')), 0, 'still grey after navigation, scans and a custom step');
    });

    test('the language survives navigation, refreshes and scans, and Browser default puts back the first one', async () => {
        const names = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6'];
        const spec = {
            url: `${base}/lang.html`,
            scenarioName: 'Language',
            customSteps: [{ id: 'to-french', name: 'To French', inputs: [], actions: [{ type: 'setLanguage', customLanguage: '{var:lang}' }] }],
            actions: [
                read('l0'),
                { type: 'if', selectorExists: '#state', actions: [{ type: 'setLanguage', language: 'de-DE' }] },
                read('l1'),
                { type: 'navigate', url: `${base}/lang.html?b` },
                read('l2'),
                { type: 'refresh' },
                read('l3'),
                { type: 'a11yScan', label: 'in-german' },
                { type: 'setVar', key: 'lang', value: 'fr-CA' },
                { type: 'runCustomStep', customStepId: 'to-french' },
                read('l4'),
                { type: 'setLanguage', language: 'es-ES', reload: false },
                read('l5'),
                { type: 'setLanguage', language: 'default' },
                read('l6'),
                { type: 'a11yScan', label: 'by-default' },
                { type: 'collectOutput', key: 'states', value: names.map((n) => `{var:${n}}`).join(' | ') },
            ],
        };

        const { status, payload } = await executeWorkflowRun(spec);
        assert.equal(status, 'done');

        const states = payload.collectedOutputs.find((o) => o.key === 'states').value.split(' | ');
        const start = states[0];
        // The run's own Accept-Language (A11Y_ACCEPT_LANGUAGE), or with
        // A11Y_STEALTH=1 the stealth plugin's, which overrides it.
        assert.match(start, /^header=en-US,en;q=0\.[89] nav=en-US navs=en-US(,en)? num=1,234\.5$/, 'as the run starts');
        const german = 'header=de-DE,de;q=0.9 nav=de-DE navs=de-DE,de num=1.234,5';
        assert.equal(states[1], german, 'set inside an If, the open page reloaded');
        assert.equal(states[2], german, 'after navigating');
        assert.equal(states[3], german, 'after refreshing');
        assert.match(states[4], /^header=fr-CA,fr;q=0\.9 nav=fr-CA navs=fr-CA,fr num=1\s234,5$/, 'from a variable, in a custom step');
        assert.equal(states[5], states[4], 'without a reload, the open page keeps the language it loaded in');
        assert.equal(states[6], start, 'Browser default: as the run started');

        // A scan says the language it was taken in, and warns that this page
        // (lang="en") did not follow it; one taken in the browser's own says nothing.
        const scan = (label) => payload.scans.find((s) => s.label === label || s.canonical?.label === label);
        const german_scan = scan('in-german');
        assert.deepEqual(german_scan.canonical.page.language, { requested: 'de-DE', declared: 'en' });
        assert.ok(german_scan.canonical.notices.some((n) => n.code === 'language-mismatch'));
        const plain = scan('by-default');
        assert.equal(plain.canonical.page.language, undefined);
        assert.ok(!(plain.canonical.notices || []).some((n) => n.code === 'language-mismatch'));
    });

    test('the run starts as its configuration says, from the first page, and Run default comes back to it', async () => {
        const names = ['c0', 'c1', 'c2', 'l0', 'l1', 'l2'];
        const spec = {
            url: `${base}/cond.html`,
            scenarioName: 'Run conditions',
            colorScheme: 'dark',
            highContrast: 'on',
            language: '{var:lang}',
            vars: { lang: 'de-DE' },
            actions: [
                read('c0'),
                { type: 'getText', selector: '#fc', var: 'fc0' },
                { type: 'setColorScheme', colorScheme: 'light', highContrast: 'off' },
                read('c1'),
                { type: 'setColorScheme', colorScheme: 'default', highContrast: 'default' },
                read('c2'),
                { type: 'getText', selector: '#fc', var: 'fc2' },
                { type: 'navigate', url: `${base}/lang.html` },
                read('l0'),
                { type: 'setLanguage', language: 'fr-FR' },
                read('l1'),
                { type: 'setLanguage', language: 'default' },
                read('l2'),
                { type: 'collectOutput', key: 'states', value: names.map((n) => `{var:${n}}`).join(' | ') + ' | {var:fc0} {var:fc2}' },
            ],
        };

        const { status, payload } = await executeWorkflowRun(spec);
        assert.equal(status, 'done');

        const states = payload.collectedOutputs.find((o) => o.key === 'states').value.split(' | ');
        assert.equal(states[0], 'w=1280 scheme=dark rm=true', 'dark from the first page');
        assert.equal(states[1], 'w=1280 scheme=light rm=true', 'a step changes it');
        assert.equal(states[2], 'w=1280 scheme=dark rm=true', 'Run default: the run\'s dark, not the browser\'s light');
        assert.equal(states[6], 'fc=true fc=true', 'in high contrast from the start, and back to it');
        const german = 'header=de-DE,de;q=0.9 nav=de-DE navs=de-DE,de num=1.234,5';
        assert.equal(states[3], german, 'the run\'s language, from a variable');
        assert.match(states[4], /^header=fr-FR,fr;q=0\.9 nav=fr-FR/, 'a step changes it');
        assert.equal(states[5], german, 'Run default: the run\'s German');
    });
});
