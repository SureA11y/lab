'use strict';

// The scan step's own engine: the step shows what its engine uses, as the
// server describes the engines (scan-engine-field.js). A field the engine
// does not use is hidden and not saved; a conformance target it cannot check
// is not offered, and a saved step that has one is flagged. Drives the REAL
// builder under jsdom, as actions-builder.rule-ids.dom.test.js does.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS } = require('../workflow/action-definitions.js');
const { withEngineChoices } = require('../server-side/scan-engine-field.js');
const { scanTargetsFor } = require('../shared/conformance-targets.js');

let createActionsBuilder;
let win;

before(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
    win = dom.window;

    globalThis.window = win;
    for (const key of Object.getOwnPropertyNames(win)) {
        if (key in globalThis) continue;
        try { globalThis[key] = win[key]; } catch { /* getters-only */ }
    }
    globalThis.document = win.document;
    globalThis.CSS = win.CSS || { escape: (s) => String(s) };
    globalThis.getComputedStyle = win.getComputedStyle.bind(win);
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    if (!globalThis.IntersectionObserver) {
        globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    }
    // No rule id lists: nothing to check typed ids against.
    globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });

    ({ createActionsBuilder } = await import('./actions-builder.module.js'));
});

// Three engines as the facade describes them: surea11y applies standards and
// uses every field, axe-core selects by version and has no locale, Alfa
// selects by level.
const ENGINES = {
    surea11y: { name: 'surea11y', selectsBy: 'standard', fields: { locale: true } },
    axe: { name: 'axe-core', selectsBy: 'version', fields: { locale: false } },
    alfa: { name: 'Alfa', selectsBy: 'level', fields: { locale: false } },
};
const fakeFacade = {
    listEngines: () => ({
        engines: Object.entries(ENGINES).map(([id, e]) => ({ id, name: e.name, loadable: true })),
        defaultEngineId: 'surea11y',
    }),
    getCapabilities: (id) => ({
        capabilities: { actions: { a11yScan: ENGINES[id].fields } },
        conformanceTargets: scanTargetsFor(ENGINES[id].selectsBy),
    }),
};
const DEFS = withEngineChoices(ACTION_DEFINITIONS, fakeFacade);

function newBuilder(actions) {
    const actionsEl = win.document.createElement('div');
    const toolbarEl = win.document.createElement('div');
    win.document.body.append(actionsEl, toolbarEl);
    const builder = createActionsBuilder({
        defs: DEFS,
        actionsEl,
        toolbarEl,
        options: { useHorizontalStepper: false },
    });
    builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
    return { builder, actionsEl };
}

const fieldOf = (actionsEl, name) => actionsEl.querySelector(`.line .field[data-field-name="${name}"]`);
const controlOf = (actionsEl, name) => fieldOf(actionsEl, name).querySelector('select, input, textarea');
const errorOf = (actionsEl, name) => {
    const err = fieldOf(actionsEl, name).querySelector('.error');
    return err && !err.hidden ? err.textContent : '';
};
// The profiles a step can choose; "The run's profile" ('') is always there.
const enabledTargets = (actionsEl) =>
    Array.from(controlOf(actionsEl, 'profile').options).filter((o) => !o.disabled && o.value && o.value !== '__token__').map((o) => o.value);
const saved = (builder) => builder.getValue({ validate: false }).value[0];

function chooseEngine(actionsEl, id) {
    const select = controlOf(actionsEl, 'engine');
    select.value = id;
    select.dispatchEvent(new win.Event('change', { bubbles: true }));
}

describe('the scan step\'s engine', () => {
    test('offers the engines installed, the default one first chosen', () => {
        const { actionsEl } = newBuilder([{ type: 'a11yScan' }]);
        const select = controlOf(actionsEl, 'engine');
        assert.deepEqual(Array.from(select.options).map((o) => [o.value, o.textContent]), [
            ['surea11y', 'surea11y'], ['axe', 'axe-core'], ['alfa', 'Alfa'],
        ]);
        assert.equal(select.value, 'surea11y');
    });

    test('a step saved with an engine loads with it, and saves it', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', engine: 'axe' }]);
        assert.equal(controlOf(actionsEl, 'engine').value, 'axe');
        assert.equal(saved(builder).engine, 'axe');
    });

    test('hides the fields the engine does not use, and leaves them out of the step', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', engine: 'axe', locale: 'fr', elementScreenshots: 'fail' }]);
        // locale: axe-core says it does not use it. Element screenshots: only
        // surea11y takes them, as the field itself says.
        for (const name of ['locale', 'elementScreenshots']) {
            assert.equal(fieldOf(actionsEl, name).hidden, true, name);
            assert.equal(name in saved(builder), false, name);
        }
        assert.equal(builder.validate().ok, true);
    });

    test('shows them again when the step changes to an engine that uses them', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', engine: 'axe' }]);
        chooseEngine(actionsEl, 'surea11y');
        // Back among the step's fields; it sits in "More options", so it
        // shows when those do.
        assert.equal(fieldOf(actionsEl, 'elementScreenshots').classList.contains('is-unsupported'), false);
        actionsEl.querySelector('.line .fields-toggle').click();
        assert.equal(fieldOf(actionsEl, 'elementScreenshots').hidden, false);
        assert.equal(saved(builder).elementScreenshots, 'fail');
    });

    test('offers only the profiles the engine can check', () => {
        const { actionsEl } = newBuilder([{ type: 'a11yScan' }]);
        assert.deepEqual(enabledTargets(actionsEl), scanTargetsFor('standard'));

        chooseEngine(actionsEl, 'axe');
        assert.deepEqual(enabledTargets(actionsEl), ['wcag22-a', 'wcag22-aa', 'wcag22-aaa', 'en301549-v4.1.1']);

        chooseEngine(actionsEl, 'alfa');
        assert.deepEqual(enabledTargets(actionsEl), ['wcag22-a', 'wcag22-aa', 'wcag22-aaa', 'en301549-v4.1.1']);
    });

    test('flags a saved profile the step\'s engine cannot check, naming both', () => {
        const { builder, actionsEl } = newBuilder([{ type: 'a11yScan', engine: 'axe', profile: 'en301549-v3.2.1' }]);
        assert.equal(builder.validate().ok, false);
        assert.equal(errorOf(actionsEl, 'profile'), 'axe-core cannot check EN 301 549 V3.2.1. Choose another profile, or another engine.');

        chooseEngine(actionsEl, 'surea11y');
        assert.equal(builder.validate().ok, true);
    });

    test('with nothing known about the engines, shows every field and profile', () => {
        const actionsEl = win.document.createElement('div');
        const toolbarEl = win.document.createElement('div');
        win.document.body.append(actionsEl, toolbarEl);
        const builder = createActionsBuilder({ defs: ACTION_DEFINITIONS, actionsEl, toolbarEl, options: { useHorizontalStepper: false } });
        builder.loadActions([{ type: 'a11yScan', engine: 'axe', profile: 'en301549-v3.2.1' }], { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
        assert.equal(enabledTargets(actionsEl).length, 5);
        assert.equal(builder.validate().ok, true);
    });
});

describe('with surea11y the only engine', () => {
    const onlySurea11y = {
        listEngines: () => ({ engines: [{ id: 'surea11y', name: 'surea11y', loadable: true }], defaultEngineId: 'surea11y' }),
        getCapabilities: () => ({ capabilities: { actions: { a11yScan: ENGINES.surea11y.fields } }, conformanceTargets: scanTargetsFor('standard') }),
    };
    function soloBuilder(actions) {
        const actionsEl = win.document.createElement('div');
        const toolbarEl = win.document.createElement('div');
        win.document.body.append(actionsEl, toolbarEl);
        const builder = createActionsBuilder({
            defs: withEngineChoices(ACTION_DEFINITIONS, onlySurea11y),
            actionsEl,
            toolbarEl,
            options: { useHorizontalStepper: false },
        });
        builder.loadActions(actions, { clearFirst: true, focusFirst: false, injectDefaultWhenEmpty: false });
        return { builder, actionsEl };
    }

    test('there is nothing to choose, so the Engine field does not show', () => {
        const { builder, actionsEl } = soloBuilder([{ type: 'a11yScan' }]);
        assert.equal(fieldOf(actionsEl, 'engine').hidden, true);
        assert.equal(builder.validate().ok, true);
    });

    test('a step naming an engine that is not installed keeps it, shows it, and does not pass', () => {
        const { builder, actionsEl } = soloBuilder([{ type: 'a11yScan', engine: 'axe' }]);
        assert.equal(fieldOf(actionsEl, 'engine').hidden, false);
        assert.equal(saved(builder).engine, 'axe');
        assert.equal(controlOf(actionsEl, 'engine').selectedOptions[0].textContent, 'axe (not installed)');
        assert.equal(builder.validate().ok, false);
        assert.match(errorOf(actionsEl, 'engine'), /The engine "axe" is not installed here: it comes with an add-on/);
    });
});
