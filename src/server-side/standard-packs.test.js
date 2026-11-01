'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadPacks, describeStandard, installedStandards } = require('./standard-packs');

const PACK = {
    name: '@surea11y/pack-demo',
    standard: {
        key: 'demo', standard: 'Demo Standard', versions: ['1.0', '2.0'],
        profiles: { 'demo-2.0': { version: '2.0', wcagVersion: '2.2' }, 'demo-1.0': { version: '1.0', wcagVersion: '2.1' } },
    },
};

test('the packs the lab depends on are loaded, and those named in A11Y_PACKS', () => {
    const tried = [];
    const load = (name) => { tried.push(name); if (name === '@surea11y/pack-missing') throw new Error('not installed'); return { name }; };
    const pkg = { dependencies: { '@surea11y/core': '1', '@surea11y/pack-en301549': '1', express: '5' }, optionalDependencies: { '@surea11y/pack-missing': '1' } };
    const { names, packs } = loadPacks({ pkg, env: '@surea11y/pack-rgaa, ./local-pack, @surea11y/pack-en301549', load });
    assert.deepEqual(names.slice(0, 3), ['@surea11y/pack-en301549', '@surea11y/pack-missing', '@surea11y/pack-rgaa']);
    assert.equal(names[3], path.resolve(__dirname, '..', '..', 'local-pack'), 'a path from the lab\'s folder');
    assert.equal(names.length, 4, 'each once');
    assert.deepEqual(packs.map((p) => p.name), ['@surea11y/pack-en301549', '@surea11y/pack-rgaa', names[3]], 'one that does not load is left out');
    assert.deepEqual(tried.filter((n) => n === '@surea11y/core'), [], 'only packs');
});

test('a pack\'s standard is described from the pack itself', () => {
    assert.deepEqual(describeStandard(PACK), {
        key: 'demo', name: 'Demo Standard', package: '@surea11y/pack-demo', versions: ['1.0', '2.0'],
        profiles: [
            { id: 'demo-2.0', label: 'Demo Standard 2.0', version: '2.0', wcagVersion: '2.2' },
            { id: 'demo-1.0', label: 'Demo Standard 1.0', version: '1.0', wcagVersion: '2.1' },
        ],
    });
    assert.equal(describeStandard({ name: 'rules-only' }), null, 'a pack of rules only has no standard');
});

test('EN 301 549\'s pack, installed, gives its two profiles as the lab has always named them', (t) => {
    const en = installedStandards().find((s) => s.key === 'en301549');
    if (!en) return t.skip('the EN 301 549 pack is not installed');
    assert.equal(en.name, 'EN 301 549');
    assert.deepEqual(en.profiles.map((p) => [p.id, p.label]).sort(), [['en301549-v3.2.1', 'EN 301 549 V3.2.1'], ['en301549-v4.1.1', 'EN 301 549 V4.1.1']]);
});

test('two profiles of one version say their ids', () => {
    const std = describeStandard({ standard: { key: 'demo', standard: 'Demo', versions: ['1.0'], profiles: { 'demo-1.0': { version: '1.0' }, 'demo-1.0-wcag': { version: '1.0' } } } });
    assert.deepEqual(std.profiles.map((p) => p.label), ['Demo 1.0 (demo-1.0)', 'Demo 1.0 (demo-1.0-wcag)']);
});

test('a pack\'s profiles become scan targets and step options; ones the lab knows stay as they are', () => {
    const { registerProfiles } = require('./standard-packs');
    const added = [];
    const targets = { registerStandardProfiles: (standards) => { const ids = standards.flatMap((s) => s.profiles.map((p) => p.id)).filter((id) => id !== 'en301549-v4.1.1'); added.push(...ids); return ids; } };
    const actions = { a11yScan: { fields: { profile: { options: [{ value: 'en301549-v4.1.1', label: 'EN 301 549 V4.1.1' }] } } } };
    const out = registerProfiles([
        { profiles: [{ id: 'en301549-v4.1.1', label: 'Other label' }] },
        { profiles: [{ id: 'demo-2.0', label: 'Demo Standard 2.0' }] },
    ], { targets, actions });
    assert.deepEqual(out, ['demo-2.0']);
    assert.deepEqual(actions.a11yScan.fields.profile.options, [{ value: 'en301549-v4.1.1', label: 'EN 301 549 V4.1.1' }, { value: 'demo-2.0', label: 'Demo Standard 2.0' }]);
});
