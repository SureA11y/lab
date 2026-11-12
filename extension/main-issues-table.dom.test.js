'use strict';

// DOM tests for the extension's issues table under jsdom, covering the
// per-occurrence selector actions in the "details" dialog: copying the selector
// to the clipboard, and — only inside the DevTools panel — selecting the element
// in the Elements panel. The renderer is a plain script that installs
// globalThis.A11Y_ISSUES_TABLE, so the DOM globals are set up before loading it.
// node's test runner isolates each file in its own process.

const {test, describe, before, beforeEach, afterEach} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');

let ISSUES_TABLE;
let outEl;
let clipboardWrites;
let clipboardShouldReject;
let execCommandCalls;
let execCommandResult;
let evalCalls;
let evalResponder;

before(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
    const win = dom.window;
    globalThis.window = win;
    globalThis.document = win.document;
    globalThis.Node = win.Node;
    globalThis.HTMLElement = win.HTMLElement;
    globalThis.isSecureContext = true;

    // Captured by reference when the script loads, so per-test toggling of
    // `chrome.devtools` decides whether the Inspect button is offered.
    globalThis.chrome = {};

    Object.defineProperty(win.navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: (text) => {
                clipboardWrites.push(text);
                return clipboardShouldReject ? Promise.reject(new Error('denied')) : Promise.resolve();
            },
        },
    });
    // node defines globalThis.navigator as a getter, so it has to be replaced
    // rather than assigned for the renderer to see jsdom's.
    Object.defineProperty(globalThis, 'navigator', {configurable: true, value: win.navigator});

    win.document.execCommand = (cmd) => {
        execCommandCalls.push(cmd);
        return execCommandResult;
    };

    // jsdom has no dialog implementation.
    win.HTMLDialogElement = win.HTMLDialogElement || function () {};
    win.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    win.HTMLElement.prototype.close = function () { this.removeAttribute('open'); };

    // Loaded before it, as panel.html and popup.html do.
    globalThis.A11Y_REPORT_SCAN = require('./report-scan.js');
    require('./main-issues-table.js');
    ISSUES_TABLE = globalThis.A11Y_ISSUES_TABLE;
});

beforeEach(() => {
    document.body.innerHTML = '<div id="out"></div>';
    outEl = document.getElementById('out');
    clipboardWrites = [];
    clipboardShouldReject = false;
    execCommandCalls = [];
    execCommandResult = true;
    evalCalls = [];
    evalResponder = (_expr, cb) => cb(true, null);
    delete globalThis.chrome.devtools;
});

afterEach(() => {
    delete globalThis.chrome.devtools;
});

function enableDevtools() {
    globalThis.chrome.devtools = {
        inspectedWindow: {
            eval: (expr, cb) => {
                evalCalls.push(expr);
                evalResponder(expr, cb);
            },
        },
    };
}

function scanWith(target, html = '<img class="hero">') {
    return {
        id: 'scan-1',
        label: 'Scan',
        url: 'https://example.test/',
        canonical: {
            page: {url: 'https://example.test/'},
            findings: [{
                id: 'image-alt',
                ruleId: 'image-alt',
                outcome: 'fail',
                severity: 'critical',
                title: 'Images must have alternative text',
                provenance: {engine: {name: 'Engine B'}},
                occurrences: [{target, html, failureSummary: 'Fix this', outcome: 'fail'}],
            }],
        },
    };
}

const render = (scan) => ISSUES_TABLE.renderInto(outEl, scan, {enableDialogs: true});
const copyBtn = () => outEl.querySelector('.copy-selector-btn');
const inspectBtn = () => outEl.querySelector('.inspect-selector-btn');

function click(el) {
    el.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('selector actions in the occurrence dialog', () => {
    test('renders a copy button carrying the occurrence selector', () => {
        render(scanWith(['img.hero']));

        assert.ok(copyBtn());
        assert.equal(copyBtn().getAttribute('data-selector'), 'img.hero');
        assert.equal(copyBtn().textContent, 'Copy selector');
    });

    test('joins a multi-part target into one selector', () => {
        render(scanWith(['img.hero', 'img.banner']));

        assert.equal(copyBtn().getAttribute('data-selector'), 'img.hero, img.banner');
    });

    test('offers no selector actions when the occurrence has no target', () => {
        render(scanWith([]));

        assert.equal(copyBtn(), null);
        assert.equal(inspectBtn(), null);
        assert.match(outEl.innerHTML, /\(no target selector\)/);
    });

    test('copying writes the selector to the clipboard and confirms on the button', async () => {
        render(scanWith(['img.hero']));

        click(copyBtn());
        await settle();

        assert.deepEqual(clipboardWrites, ['img.hero']);
        assert.equal(copyBtn().textContent, 'Copied');
        assert.ok(copyBtn().classList.contains('is-ok'));
    });

    test('a rejected clipboard falls back to execCommand and still confirms', async () => {
        clipboardShouldReject = true;
        render(scanWith(['img.hero']));

        click(copyBtn());
        await settle();

        assert.deepEqual(execCommandCalls, ['copy']);
        assert.equal(copyBtn().textContent, 'Copied');
    });

    test('a failed fallback reports the failure rather than a false success', async () => {
        clipboardShouldReject = true;
        execCommandResult = false;
        render(scanWith(['img.hero']));

        click(copyBtn());
        await settle();

        assert.equal(copyBtn().textContent, 'Copy failed');
        assert.ok(copyBtn().classList.contains('is-failed'));
    });

    test('the copy fallback leaves no stray textarea behind', async () => {
        clipboardShouldReject = true;
        render(scanWith(['img.hero']));

        click(copyBtn());
        await settle();

        assert.equal(document.querySelectorAll('textarea').length, 0);
    });
});

describe('occurrence dialog backdrop-close listener', () => {
    test('reopening the same dialog does not stack a new backdrop-close listener each time', () => {
        render(scanWith(['img.hero']));

        const trigger = outEl.querySelector('.src-dialog-trigger');
        const dlg = document.getElementById(trigger.getAttribute('data-dialog-id'));

        let addedClickListeners = 0;
        const realAddEventListener = dlg.addEventListener.bind(dlg);
        dlg.addEventListener = (type, ...rest) => {
            if (type === 'click') addedClickListeners += 1;
            return realAddEventListener(type, ...rest);
        };

        click(trigger);
        dlg.close();
        click(trigger);
        dlg.close();
        click(trigger);

        assert.equal(addedClickListeners, 1);
    });
});

describe('inspect action availability', () => {
    test('is absent outside DevTools, where the popup cannot reach the inspector', () => {
        render(scanWith(['img.hero']));

        assert.equal(inspectBtn(), null);
        assert.ok(copyBtn(), 'copying still works in the popup');
    });

    test('is offered inside the DevTools panel', () => {
        enableDevtools();
        render(scanWith(['img.hero']));

        assert.ok(inspectBtn());
        assert.equal(inspectBtn().getAttribute('data-selector'), 'img.hero');
    });
});

describe('inspecting an occurrence', () => {
    test('evaluates a lookup that selects the element in the Elements panel', async () => {
        enableDevtools();
        render(scanWith(['img.hero']));

        click(inspectBtn());
        await settle();

        assert.equal(evalCalls.length, 1);
        assert.match(evalCalls[0], /root\.querySelector\("img\.hero"\)/);
        assert.match(evalCalls[0], /inspect\(el\)/);
    });

    // Runs the expression the panel hands DevTools in a page, with
    // inspect() standing in for the console's.
    function runInPage(expr, html, setup) {
        const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {runScripts: 'outside-only'});
        if (setup) setup(dom.window.document);
        let inspected = null;
        dom.window.inspect = (el) => { inspected = el; };
        return {result: dom.window.eval(expr), inspected};
    }

    test('follows the shadow hosts to an element inside a web component', async () => {
        enableDevtools();
        const scan = scanWith(['img.hero']);
        scan.canonical.findings[0].occurrences[0].shadowHostSelectors = ['my-app', 'x-card'];
        render(scan);
        assert.equal(inspectBtn().getAttribute('data-shadow-hosts'), '["my-app","x-card"]');

        click(inspectBtn());
        await settle();

        const {result, inspected} = runInPage(evalCalls[0], '<img class="hero" id="light"><my-app></my-app>', (doc) => {
            const card = doc.createElement('x-card');
            doc.querySelector('my-app').attachShadow({mode: 'open'}).appendChild(card);
            const img = doc.createElement('img');
            img.className = 'hero';
            img.id = 'shadowed';
            card.attachShadow({mode: 'open'}).appendChild(img);
        });
        assert.equal(result, true);
        assert.equal(inspected.id, 'shadowed', 'not the light-DOM image with the same selector');
    });

    test('a lookup without hosts selects in the document, and reports a missing host', async () => {
        enableDevtools();
        render(scanWith(['img.hero']));
        click(inspectBtn());
        await settle();
        assert.equal(runInPage(evalCalls[0], '<img class="hero" id="light">').inspected.id, 'light');

        const scan = scanWith(['img.hero']);
        scan.canonical.findings[0].occurrences[0].shadowHostSelectors = ['my-app'];
        render(scan);
        click(inspectBtn());
        await settle();
        assert.equal(runInPage(evalCalls[1], '<img class="hero">').result, false);
    });

    test('embeds a quoted selector safely rather than breaking the expression', async () => {
        enableDevtools();
        render(scanWith(['[data-id="a\'b"]']));

        click(inspectBtn());
        await settle();

        const expr = evalCalls[0];
        assert.match(expr, /\[data-id=\\"a'b\\"\]/);
        assert.doesNotThrow(() => new Function('inspect', 'document', expr));
    });

    test('closes the dialog so the Elements panel is not covered', async () => {
        enableDevtools();
        render(scanWith(['img.hero']));

        const dlg = inspectBtn().closest('dialog');
        dlg.showModal();
        assert.ok(dlg.hasAttribute('open'));

        click(inspectBtn());
        await settle();

        assert.equal(dlg.hasAttribute('open'), false);
    });

    test('reports when the selector matches nothing on the page', async () => {
        enableDevtools();
        evalResponder = (_expr, cb) => cb(false, null);
        render(scanWith(['img.gone']));

        click(inspectBtn());
        await settle();

        assert.equal(inspectBtn().textContent, 'Not on page');
        assert.ok(inspectBtn().classList.contains('is-failed'));
    });

    test('reports an eval exception as a failure', async () => {
        enableDevtools();
        evalResponder = (_expr, cb) => cb(null, {isException: true, value: 'boom'});
        render(scanWith(['img.hero']));

        click(inspectBtn());
        await settle();

        assert.equal(inspectBtn().textContent, 'Not on page');
    });

    test('survives an eval that throws synchronously', async () => {
        enableDevtools();
        globalThis.chrome.devtools.inspectedWindow.eval = () => { throw new Error('detached'); };
        render(scanWith(['img.hero']));

        click(inspectBtn());
        await settle();

        assert.equal(inspectBtn().textContent, 'Not on page');
    });

    test('confirms on the button when the element is found', async () => {
        enableDevtools();
        render(scanWith(['img.hero']));

        click(inspectBtn());
        await settle();

        assert.equal(inspectBtn().textContent, 'Inspecting');
        assert.ok(inspectBtn().classList.contains('is-ok'));
    });

    test('copy and inspect sit side by side and act independently', async () => {
        enableDevtools();
        render(scanWith(['img.hero']));

        click(copyBtn());
        await settle();

        assert.equal(copyBtn().textContent, 'Copied');
        assert.equal(inspectBtn().textContent, 'Inspect');
        assert.equal(evalCalls.length, 0);
    });
});

describe('occurrence hint and uncertainty in the details dialog', () => {
    function scanWithOccurrence(occ) {
        const scan = scanWith(['a.more']);
        scan.canonical.findings[0].occurrences = [Object.assign({target: ['a.more'], html: '<a class="more">', failureSummary: 'Check it'}, occ)];
        return scan;
    }

    test('shows the engine hint as "How to fix"', () => {
        render(scanWithOccurrence({hint: 'Underline the link.'}));

        const hint = document.querySelector('.node-hint');
        assert.ok(hint);
        assert.match(hint.textContent, /How to fix:\s*Underline the link\./);
    });

    test('explains why a cantTell occurrence is undecided and what would settle it', () => {
        render(scanWithOccurrence({
            occurrenceOutcome: 'cantTell',
            uncertainty: {code: 'not-computable', needed: 'Measure it by hand.'},
        }));

        const block = document.querySelector('.node-uncertainty');
        assert.ok(block);
        assert.match(block.textContent, /could not read what it needed/);
        assert.match(block.textContent, /not-computable/);
        assert.match(block.textContent, /To settle it:\s*Measure it by hand\./);
    });

    test('an unknown code is still shown, without an explanation', () => {
        render(scanWithOccurrence({uncertainty: {code: 'something-new'}}));

        const block = document.querySelector('.node-uncertainty');
        assert.match(block.textContent, /Why it is undecided:\s*something-new/);
    });

    test('adds nothing when the occurrence has neither', () => {
        render(scanWithOccurrence({}));

        assert.equal(document.querySelector('.node-hint'), null);
        assert.equal(document.querySelector('.node-uncertainty'), null);
    });
});

describe('questions that lean, and how to check them', () => {
    function question(ruleId, occurrences) {
        return {id: ruleId, ruleId, outcome: 'cantTell', severity: 'moderate', title: ruleId,
            provenance: {engine: {name: 'surea11y'}},
            occurrences: occurrences.map((o, i) => Object.assign({target: ['#q' + i], html: '<h3>', failureSummary: 'Check it', occurrenceOutcome: 'cantTell'}, o))};
    }
    function scanOf(findings) {
        return {id: 'scan-1', label: 'Scan', url: 'https://example.test/', canonical: {page: {url: 'https://example.test/'}, findings}};
    }

    test('a question shows its lean, its caution and its steps', () => {
        render(scanOf([question('heading-order', [{
            lean: {toward: 'fail', why: 'The heading skips a level.', caution: 'A design may intend it.', measured: {agreed: 9, cases: 10}},
            howToCheck: {steps: ['Find the heading.', 'Compare its level.'], passWhen: 'No level is skipped.', failWhen: 'A level is skipped.'},
        }])]));
        const lean = document.querySelector('.node-lean.node-lean-fail');
        assert.equal(lean.textContent, 'Likely fails: The heading skips a level. (right in 9 of 10 known cases)Caution: A design may intend it.');
        const how = document.querySelector('.node-how-to-check');
        assert.deepEqual(Array.from(how.querySelectorAll('li')).map((li) => li.textContent), ['Find the heading.', 'Compare its level.']);
        assert.equal(how.querySelector('details').open, false);
        assert.equal(how.querySelector('summary').textContent, 'How to check (2 steps)');
        assert.equal(how.querySelectorAll('p')[0].textContent, 'Passes when: No level is skipped.');
    });

    test('rows that likely fail come first, each marked', () => {
        render(scanOf([
            question('link-name-quality', [{}]),
            question('aria-checked-state-mismatch', [{lean: {toward: 'pass', why: 'Ignored.'}}]),
            question('heading-order', [{}, {lean: {toward: 'fail', why: 'Skips.'}}]),
        ]));
        const rows = Array.from(document.querySelectorAll('tr.cantTell'));
        assert.deepEqual(rows.map((r) => (r.textContent.match(/Rule: (\S+)/) || [])[1]), ['heading-order', 'aria-checked-state-mismatch', 'link-name-quality']);
        assert.deepEqual(rows.map((r) => r.querySelector('td.issue-status .lean-badge')?.textContent || ''), ['likely fails', 'likely passes', '']);
        assert.deepEqual(rows.map((r) => r.classList.contains('lean-fail')), [true, false, false]);
        // In the row's list, the likely failure first.
        assert.deepEqual(Array.from(rows[0].querySelectorAll('.example-node h2')).map((h) => h.querySelector('.lean-badge')?.textContent || ''), ['likely fails', '']);
    });
});

describe('findings written in another language', () => {
    test('their title, summary and hint are marked with it; the English labels are not', () => {
        const scan = scanWith(['img.hero']);
        Object.assign(scan.canonical.findings[0], {lang: 'de', title: 'Bilder brauchen Alternativtext'});
        scan.canonical.findings[0].occurrences[0].hint = 'Fügen Sie ein alt-Attribut hinzu.';
        render(scan);

        const title = [...outEl.querySelectorAll('span[lang="de"]')].find((el) => el.textContent === 'Bilder brauchen Alternativtext');
        assert.ok(title, 'the row title should carry lang="de"');
        assert.equal(document.querySelector('.node-detail[lang="de"]')?.textContent.trim(), 'Fix this');
        const hint = document.querySelector('.node-hint');
        assert.equal(hint.querySelector('span[lang="de"]').textContent, 'Fügen Sie ein alt-Attribut hinzu.');
        assert.equal(hint.getAttribute('lang'), null);
    });

    test('an English finding adds no lang', () => {
        render(scanWith(['img.hero']));
        assert.equal(outEl.querySelector('[lang]'), null);
        assert.equal(document.querySelector('.node-detail[lang]'), null);
    });
});

describe('EN 301 549 clauses next to the WCAG criteria', () => {
    const pills = () => [...outEl.querySelectorAll('.tag-pill')].map((el) => el.textContent);

    test('shows the clauses the server added, naming the version when only one has it', () => {
        const scan = scanWith(['img.hero']);
        Object.assign(scan.canonical.findings[0], {
            wcag: {sc: ['1.1.1', '2.5.8']},
            en301549: [
                {clause: '9.1.1.1', title: 'Non-text content', versions: ['V3.2.1', 'V4.1.1']},
                {clause: '9.2.5.8', title: 'Target size (minimum)', versions: ['V4.1.1']}
            ]
        });
        render(scan);

        assert.deepEqual(pills(), ['WCAG 1.1.1', 'WCAG 2.5.8', 'EN 301 549 9.1.1.1', 'EN 301 549 9.2.5.8 (V4.1.1)']);
    });

    test('falls back to the engine\'s own EN 301 549 mappings', () => {
        const scan = scanWith(['img.hero']);
        Object.assign(scan.canonical.findings[0], {
            wcag: {sc: ['1.1.1']},
            standards: {normativeMappings: [
                {standard: 'WCAG', requirement: '1.1.1'},
                {standard: 'EN 301 549', version: 'V3.2.1', requirement: '9.1.1.1', title: 'Non-text content'},
                {standard: 'EN 301 549', version: 'V4.1.1', requirement: '9.1.1.1', title: 'Non-text content'}
            ]}
        });
        render(scan);

        assert.deepEqual(pills(), ['WCAG 1.1.1', 'EN 301 549 9.1.1.1']);
    });
});

describe('EN 301 549 clauses follow the scan\'s conformance target', () => {
    const pills = () => [...outEl.querySelectorAll('.tag-pill')].map((el) => el.textContent);

    function scanTargeting(targetId) {
        const scan = scanWith(['img.hero']);
        if (targetId) scan.conformanceProfile = {id: targetId, label: targetId};
        Object.assign(scan.canonical.findings[0], {
            wcag: {sc: ['WCAG 2.5.8', 'WCAG 4.1.1']},
            en301549: [
                {clause: '9.2.5.8', versions: ['V4.1.1']},
                {clause: '9.4.1.1', versions: ['V3.2.1']}
            ]
        });
        return scan;
    }

    test('without a standard, every clause is shown as a cross-reference', () => {
        render(scanTargeting(null));
        assert.deepEqual(pills(), ['WCAG 2.5.8', 'WCAG 4.1.1', 'EN 301 549 9.2.5.8 (V4.1.1)', 'EN 301 549 9.4.1.1 (V3.2.1)']);
    });

    test('an EN 301 549 target shows only its own clauses, without repeating the version', () => {
        render(scanTargeting('en301549-v3.2.1'));
        assert.deepEqual(pills(), ['WCAG 2.5.8', 'WCAG 4.1.1', 'EN 301 549 9.4.1.1']);
    });

    test('Section 508 shows WCAG only', () => {
        render(scanTargeting('section508'));
        assert.deepEqual(pills(), ['WCAG 2.5.8', 'WCAG 4.1.1']);
    });

    test('a WCAG profile is no standard: every clause, as a cross-reference', () => {
        render(scanTargeting('wcag22-aa'));
        assert.deepEqual(pills(), ['WCAG 2.5.8', 'WCAG 4.1.1', 'EN 301 549 9.2.5.8 (V4.1.1)', 'EN 301 549 9.4.1.1 (V3.2.1)']);
    });
});

describe('RGAA criteria next to the WCAG criteria', () => {
    test('shows one pill per RGAA criterion the finding carries, and no EN 301 549 clause', () => {
        const scan = scanWith(['img.hero']);
        scan.conformanceProfile = {id: 'rgaa-4.1.2', label: 'RGAA 4.1.2'};
        Object.assign(scan.canonical.findings[0], {
            wcag: {sc: ['1.1.1']},
            en301549: [{clause: '9.1.1.1', versions: ['V3.2.1', 'V4.1.1']}],
            rgaa: [{criterion: '1.1', tests: ['1.1.1'], version: '4.1.2'}]
        });
        render(scan);

        assert.deepEqual([...outEl.querySelectorAll('.tag-pill')].map((el) => el.textContent), ['WCAG 1.1.1', 'RGAA 1.1']);
    });
});

describe('criteria grouped by standard', () => {
    test('names each standard once, over pills holding only the numbers', () => {
        const scan = scanWith(['img.hero']);
        Object.assign(scan.canonical.findings[0], {
            wcag: {sc: ['1.1.1', '2.5.8']},
            en301549: [
                {clause: '9.1.1.1', versions: ['V3.2.1', 'V4.1.1']},
                {clause: '9.2.5.8', versions: ['V4.1.1']}
            ]
        });
        render(scan);

        const groups = [...outEl.querySelectorAll('.crit-group')].map((g) => ({
            name: g.querySelector('.crit-group__name').textContent,
            hiddenName: g.querySelector('.crit-group__name').getAttribute('aria-hidden'),
            shown: [...g.querySelectorAll('.tag-pill')].map((el) => el.lastChild.textContent),
            heard: [...g.querySelectorAll('.tag-pill .visually-hidden')].map((el) => el.textContent)
        }));
        assert.deepEqual(groups, [
            {name: 'WCAG', hiddenName: 'true', shown: ['1.1.1', '2.5.8'], heard: ['WCAG ', 'WCAG ']},
            {name: 'EN 301 549', hiddenName: 'true', shown: ['9.1.1.1', '9.2.5.8 (V4.1.1)'], heard: ['EN 301 549 ', 'EN 301 549 ']}
        ]);
    });
});

describe('notes, margins and details in the panel', () => {
    const margin = (o) => ({ruleId: 'contrast-minimum', title: 'Text contrast', unit: 'ratio', limit: 'min', threshold: 4.5, value: 4.52, headroom: 0.02, selector: 'p.lead', ...o});

    test('shows the scan notes and the closest passes, as the lab does', () => {
        const scan = scanWith(['img.hero']);
        scan.canonical.notices = [{code: 'page-not-ready', message: 'The page was still loading.'}];
        scan.canonical.margins = [margin({ruleId: 'target-size-minimum', title: 'Targets', unit: 'px', threshold: 24, value: 30, headroom: 6}), margin()];
        render(scan);

        assert.equal(outEl.querySelector('.scan-notices li').textContent, 'The page was still loading.');
        const box = outEl.querySelector('.a11y-margins');
        assert.equal(box.open, false);
        assert.equal(box.querySelector('summary').textContent, 'Closest to the limit (1 near miss)');
        const first = Array.from(box.querySelectorAll('tbody tr')[0].children).map((c) => c.textContent.trim());
        assert.deepEqual(first, ['Text contrast contrast-minimum', '4.52:1', 'at least 4.5:1', '0.02 near miss', 'p.lead']);
    });

    test('puts the notes on what the scan could not see last, collapsed', () => {
        const scan = scanWith(['img.hero']);
        scan.canonical.notices = [{code: 'listener-hook', message: 'surea11y could not see which elements respond to clicks.'}];
        scan.canonical.margins = [margin()];
        render(scan);
        assert.equal(outEl.querySelector('.scan-notices'), null);
        const box = outEl.querySelector('.scan-notices-after');
        assert.equal(box.open, false);
        assert.equal(box.querySelector('summary').textContent, 'What this scan could not see (1 note)');
        assert.equal(outEl.querySelector('.a11y-margins').nextElementSibling, box);
    });

    test('adds neither when the scan has none', () => {
        render(scanWith(['img.hero']));
        assert.equal(outEl.querySelector('.scan-notices'), null);
        assert.equal(outEl.querySelector('.a11y-margins'), null);
        assert.equal(outEl.querySelector('.scan-notices-after'), null);
    });

    test('lists what the engine found for an occurrence', () => {
        const scan = scanWith(['img.hero']);
        scan.canonical.findings[0].occurrences[0].details = {altSignal: 'file-name', truncated: false};
        render(scan);
        assert.deepEqual(
            Array.from(outEl.querySelectorAll('.node-details-list > div')).map((d) => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]),
            [['Alt signal', 'file-name'], ['Truncated', 'no']]
        );
    });

    test('formats margins exactly as the lab\'s margins.js does', async () => {
        const lab = await import('../src/js/margins.js');
        const cases = [
            margin(), margin({headroom: 0.004}), margin({headroom: 0.099}), margin({headroom: 2.3456, value: 6.8456}),
            margin({unit: 'px', threshold: 24, value: 24.4, headroom: 0.4}), margin({unit: 'px', limit: 'max', threshold: 7.5, value: 3.2, headroom: 4.3}),
        ];
        for (const m of cases) {
            for (const fn of ['formatMarginValue', 'formatMarginLimit', 'formatMarginRoom', 'isNearMiss']) {
                assert.equal(ISSUES_TABLE[fn](m), lab[fn](m), `${fn}(${JSON.stringify(m)})`);
            }
        }
    });
});

describe('best practices section', () => {
    const bp = (ruleId, outcome) => ({
        id: ruleId, ruleId, outcome, severity: 'moderate', title: ruleId, bestPractice: true,
        provenance: {engine: {name: 'surea11y'}},
        occurrences: [{target: ['main'], html: '<main>', outcome}],
    });

    test('lists them below the requirements, with their own counts', () => {
        const s = scanWith(['img.hero']);
        s.canonical.bestPractices = [bp('region', 'fail'), bp('heading-order', 'cantTell')];
        render(s);
        const section = outEl.querySelector('.best-practices');
        assert.ok(section);
        assert.equal(section.querySelector('h2').textContent, 'Best practices');
        assert.equal(section.getAttribute('aria-labelledby'), section.querySelector('h2').id);
        assert.match(section.querySelector('.best-practices-note').textContent, /^1 failing, 1 to review\. /);
        assert.ok(!section.textContent.includes('Images must have alternative text'));
        assert.ok(outEl.textContent.indexOf('Images must have alternative text') < outEl.textContent.indexOf('Best practices'));
    });

    test('gives each scan\'s section its own heading id', () => {
        const a = scanWith(['img']);
        a.canonical.bestPractices = [bp('region', 'fail')];
        render(a);
        const first = outEl.querySelector('.best-practices h2').id;
        render(a);
        assert.notEqual(outEl.querySelector('.best-practices h2').id, first);
    });

    test('adds nothing without best practices to show', () => {
        render(scanWith(['img']));
        assert.equal(outEl.querySelector('.best-practices'), null);
    });
});

describe('the picture of an occurrence\'s element', () => {
    function scanWithShot(elementScreenshot) {
        const scan = scanWith(['img.hero']);
        scan.canonical.findings[0].occurrences[0].elementScreenshot = elementScreenshot;
        return scan;
    }

    test('shows in its occurrence, named for it', () => {
        render(scanWithShot({dataUrl: 'data:image/png;base64,iVBORw0KGgo=', box: {x: 16, y: 16, width: 8, height: 8}}));
        const img = outEl.querySelector('.example-node .node-screenshot img');
        assert.equal(img.getAttribute('src'), 'data:image/png;base64,iVBORw0KGgo=');
        assert.equal(img.getAttribute('alt'), 'Occurrence 1: the flagged img element, with a box drawn around it');
        assert.equal(outEl.querySelector('.node-screenshot figcaption'), null, 'nothing to say of a whole element');
    });

    test('says when only part of the element fits', () => {
        render(scanWithShot({dataUrl: 'data:image/png;base64,iVBORw0KGgo=', box: null, cropped: true}));
        assert.equal(outEl.querySelector('.node-screenshot figcaption').textContent, 'Only part of the element fits in the picture.');
    });

    test('says why there is none, as the lab does', () => {
        render(scanWithShot({skipped: 'max-reached', max: 50}));
        assert.equal(outEl.querySelector('.example-node .node-screenshot-none').textContent, 'No picture: the scan reached its limit of 50 pictures.');
        assert.equal(outEl.querySelector('.node-screenshot'), null);
    });

    test('takes no address but a picture\'s', () => {
        render(scanWithShot({dataUrl: 'javascript:alert(1)'}));
        assert.equal(outEl.querySelector('.node-screenshot'), null);
    });
});
