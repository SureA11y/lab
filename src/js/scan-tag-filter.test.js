'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// The module is ESM-with-`export`; import() it once for the whole suite.
let mod;
async function load() {
    if (!mod) mod = await import('./scan-tag-filter.js');
    return mod;
}

const scan = (scanTags) => ({ id: 's', scanTags });

describe('collectScanTags', () => {
    test('returns distinct tags (first-seen casing) sorted, plus hasUntagged', async () => {
        const { collectScanTags } = await load();
        const out = collectScanTags([
            scan(['Desktop', 'checkout']),
            scan(['desktop', 'mobile']),
            scan([]),
            scan(null),
        ]);
        assert.deepEqual(out.tags, ['checkout', 'Desktop', 'mobile']);
        assert.equal(out.hasUntagged, true);
    });

    test('hasUntagged is false when every scan carries a tag', async () => {
        const { collectScanTags } = await load();
        const out = collectScanTags([scan(['a']), scan(['b'])]);
        assert.deepEqual(out.tags, ['a', 'b']);
        assert.equal(out.hasUntagged, false);
    });

    test('is safe with empty/invalid input', async () => {
        const { collectScanTags } = await load();
        assert.deepEqual(collectScanTags([]), { tags: [], hasUntagged: false });
        assert.deepEqual(collectScanTags(undefined), { tags: [], hasUntagged: false });
    });
});

describe('isTagFilterActive', () => {
    test('inactive when nothing is selected', async () => {
        const { makeTagFilter, isTagFilterActive } = await load();
        assert.equal(isTagFilterActive(makeTagFilter({})), false);
    });

    test('active when tags or untagged are selected', async () => {
        const { makeTagFilter, isTagFilterActive } = await load();
        assert.equal(isTagFilterActive(makeTagFilter({ tags: ['a'] })), true);
        assert.equal(isTagFilterActive(makeTagFilter({ untagged: true })), true);
    });
});

describe('scanMatchesTagFilter', () => {
    test('everything matches when the filter is inactive', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({});
        assert.equal(scanMatchesTagFilter(scan(['a']), f), true);
        assert.equal(scanMatchesTagFilter(scan([]), f), true);
    });

    test('OR semantics across selected tags, case-insensitive', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({ tags: ['desktop', 'mobile'] });
        assert.equal(scanMatchesTagFilter(scan(['DESKTOP']), f), true);
        assert.equal(scanMatchesTagFilter(scan(['mobile', 'checkout']), f), true);
        assert.equal(scanMatchesTagFilter(scan(['tablet']), f), false);
        assert.equal(scanMatchesTagFilter(scan([]), f), false);
    });

    test('untagged selection matches only tagless scans', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({ untagged: true });
        assert.equal(scanMatchesTagFilter(scan([]), f), true);
        assert.equal(scanMatchesTagFilter(scan(null), f), true);
        assert.equal(scanMatchesTagFilter(scan(['desktop']), f), false);
    });

    test('tags + untagged combine (desktop OR untagged)', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({ tags: ['desktop'], untagged: true });
        assert.equal(scanMatchesTagFilter(scan(['desktop']), f), true);
        assert.equal(scanMatchesTagFilter(scan([]), f), true);
        assert.equal(scanMatchesTagFilter(scan(['tablet']), f), false);
    });

    test('mode defaults to OR when unspecified or unknown', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        assert.equal(makeTagFilter({ tags: ['a'] }).mode, 'or');
        assert.equal(makeTagFilter({ tags: ['a'], mode: 'nonsense' }).mode, 'or');
        // An unknown mode behaves as OR: any one selected tag is enough.
        const f = makeTagFilter({ tags: ['desktop', 'mobile'], mode: 'nonsense' });
        assert.equal(scanMatchesTagFilter(scan(['mobile']), f), true);
    });

    test('AND semantics require every selected tag, case-insensitive', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({ tags: ['desktop', 'checkout'], mode: 'and' });
        assert.equal(scanMatchesTagFilter(scan(['DESKTOP', 'Checkout']), f), true);
        assert.equal(scanMatchesTagFilter(scan(['desktop', 'checkout', 'extra']), f), true);
        assert.equal(scanMatchesTagFilter(scan(['desktop']), f), false);
        assert.equal(scanMatchesTagFilter(scan(['checkout']), f), false);
        assert.equal(scanMatchesTagFilter(scan([]), f), false);
    });

    test('AND with a single tag matches like OR', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({ tags: ['desktop'], mode: 'and' });
        assert.equal(scanMatchesTagFilter(scan(['desktop', 'mobile']), f), true);
        assert.equal(scanMatchesTagFilter(scan(['mobile']), f), false);
    });

    test('AND with only untagged matches tagless scans', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({ untagged: true, mode: 'and' });
        assert.equal(scanMatchesTagFilter(scan([]), f), true);
        assert.equal(scanMatchesTagFilter(scan(null), f), true);
        assert.equal(scanMatchesTagFilter(scan(['desktop']), f), false);
    });

    test('AND with a tag plus untagged is contradictory and matches nothing', async () => {
        const { makeTagFilter, scanMatchesTagFilter } = await load();
        const f = makeTagFilter({ tags: ['desktop'], untagged: true, mode: 'and' });
        assert.equal(scanMatchesTagFilter(scan(['desktop']), f), false);
        assert.equal(scanMatchesTagFilter(scan([]), f), false);
        assert.equal(scanMatchesTagFilter(scan(['desktop', 'mobile']), f), false);
    });
});

describe('applyScanTagsEdit', () => {
    const payloadWith = (...scans) => ({ scans });

    test('normalizes and writes the edited tags onto the scan', async () => {
        const { applyScanTagsEdit } = await load();
        const payload = payloadWith({ id: 'a', scanTags: ['old'] });

        const out = applyScanTagsEdit(payload, 'a', ['  Desktop ', 'checkout', 'DESKTOP', '']);

        assert.deepEqual(out.next, ['Desktop', 'checkout']);
        assert.deepEqual(out.previous, ['old']);
        assert.deepEqual(payload.scans[0].scanTags, ['Desktop', 'checkout']);
    });

    test('accepts a comma-separated string', async () => {
        const { applyScanTagsEdit } = await load();
        const payload = payloadWith({ id: 'a', scanTags: null });

        applyScanTagsEdit(payload, 'a', 'desktop, checkout');

        assert.deepEqual(payload.scans[0].scanTags, ['desktop', 'checkout']);
    });

    test('stores null rather than an empty array when every tag is cleared', async () => {
        const { applyScanTagsEdit } = await load();
        const payload = payloadWith({ id: 'a', scanTags: ['desktop'] });

        const out = applyScanTagsEdit(payload, 'a', []);

        assert.deepEqual(out.previous, ['desktop']);
        assert.deepEqual(out.next, []);
        assert.equal(payload.scans[0].scanTags, null);
    });

    test('reports an empty previous list for a scan that had no tags', async () => {
        const { applyScanTagsEdit } = await load();
        const payload = payloadWith({ id: 'a', scanTags: null });

        const out = applyScanTagsEdit(payload, 'a', ['desktop']);

        assert.deepEqual(out.previous, []);
        assert.equal(out.scan, payload.scans[0]);
    });

    test('edits only the addressed scan', async () => {
        const { applyScanTagsEdit } = await load();
        const payload = payloadWith(
            { id: 'a', scanTags: ['desktop'] },
            { id: 'b', scanTags: ['mobile'] },
        );

        applyScanTagsEdit(payload, 'b', ['tablet']);

        assert.deepEqual(payload.scans[0].scanTags, ['desktop']);
        assert.deepEqual(payload.scans[1].scanTags, ['tablet']);
    });

    test('returns null for an unknown scan, a missing id or a payload without scans', async () => {
        const { applyScanTagsEdit } = await load();
        assert.equal(applyScanTagsEdit(payloadWith({ id: 'a' }), 'nope', ['x']), null);
        assert.equal(applyScanTagsEdit(payloadWith({ id: 'a' }), '', ['x']), null);
        assert.equal(applyScanTagsEdit({}, 'a', ['x']), null);
        assert.equal(applyScanTagsEdit(null, 'a', ['x']), null);
    });

    test('an edit feeds straight back into the filter helpers', async () => {
        const { applyScanTagsEdit, collectScanTags, makeTagFilter, scanMatchesTagFilter } = await load();
        const payload = payloadWith(
            { id: 'a', scanTags: ['desktop'] },
            { id: 'b', scanTags: ['mobile'] },
        );

        applyScanTagsEdit(payload, 'a', ['mobile']);

        assert.deepEqual(collectScanTags(payload.scans), { tags: ['mobile'], hasUntagged: false });
        const f = makeTagFilter({ tags: ['mobile'] });
        assert.equal(scanMatchesTagFilter(payload.scans[0], f), true);
    });

    test('clearing the last holder of a tag makes the scan untagged', async () => {
        const { applyScanTagsEdit, collectScanTags } = await load();
        const payload = payloadWith(
            { id: 'a', scanTags: ['desktop'] },
            { id: 'b', scanTags: ['desktop', 'checkout'] },
        );

        applyScanTagsEdit(payload, 'b', ['desktop']);
        assert.deepEqual(collectScanTags(payload.scans), { tags: ['desktop'], hasUntagged: false });

        applyScanTagsEdit(payload, 'a', []);
        assert.deepEqual(collectScanTags(payload.scans), { tags: ['desktop'], hasUntagged: true });
    });
});
