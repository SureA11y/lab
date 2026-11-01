'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

let G;
let groupings;
before(async () => {
    G = await import('./grouping-spec.js');
    ({ groupings } = await import('./config/groupings.js'));
});

const principles = () => groupings.find((g) => g.id === 'wcag-principles').groups;
const names = (result) => result.buckets.filter((b) => b.items.length).map((b) => b.group);

describe('grouping items', () => {
    test('a group may name the requirements of any standard, and needs at least one', () => {
        assert.deepEqual(G.cleanGroupingItem({ group: 'Forms', WCAG: 'WCAG 3.3.2', RGAA: ['11', ' 11.1 '], 'EN 301 549': ['9.3.3.2'] }).item,
            { group: 'Forms', WCAG: ['3.3.2'], 'EN 301 549': ['9.3.3.2'], RGAA: ['11', '11.1'] });
        assert.match(G.cleanGroupingItem({ group: 'Empty', WCAG: [] }).error, /names no requirement/);
        assert.match(G.cleanGroupingItem({ WCAG: ['1.1.1'] }, 3).error, /index 3 is missing "group"/);
    });

    test('every built-in grouping is valid', () => {
        for (const g of groupings) assert.equal(G.isValidGroupingSpecShape(g.groups), true, g.id);
    });
});

describe('grouping issues', () => {
    const wcagIssue = { id: 'contrast', SC: ['1.4.3'] };
    const enIssue = { id: 'en301549-V4.1.1-9.1.1.1', SC: [], EN: [{ clause: '9.1.1.1', wcagSc: ['1.1.1'] }] };
    const rgaaIssue = { id: 'rgaa-4.1.2-11.1', SC: [], RGAA: [{ criterion: '11.1', wcagSc: ['1.3.1', '2.4.6', '2.5.3', '3.3.2'] }] };
    const rgaaUnlinked = { id: 'rgaa-x', SC: [], RGAA: [{ criterion: '8.1' }] };

    test('a standard\'s requirement goes in the WCAG groups of the criteria it corresponds to', () => {
        const r = G.groupIssuesBySpec([wcagIssue, enIssue, rgaaIssue], principles());
        const byGroup = Object.fromEntries(r.buckets.map((b) => [b.group, b.items.map((i) => i.id)]));
        assert.deepEqual(byGroup.Perceivable, ['contrast', 'en301549-V4.1.1-9.1.1.1', 'rgaa-4.1.2-11.1']);
        assert.ok(byGroup.Operable.includes('rgaa-4.1.2-11.1'));
        assert.deepEqual(r.unmatched, []);
        assert.deepEqual(r.notInWcag, []);
    });

    test('an RGAA issue of an earlier report goes by its criterion, as any standard\'s', () => {
        const r = G.groupIssuesBySpec([rgaaIssue, rgaaUnlinked], [{ group: 'Forms', RGAA: ['11'] }]);
        assert.deepEqual(names(r), ['Forms']);
    });

    test('a requirement no group takes is "Not in WCAG" when it corresponds to no WCAG criterion, else Others', () => {
        const r = G.groupIssuesBySpec([rgaaUnlinked, { id: 'other-only', SC: ['1.4.6'] }, { id: 'none', SC: [] }], [{ group: 'Contrast', WCAG: ['1.4.3'] }]);
        assert.deepEqual(r.notInWcag.map((i) => i.id), ['rgaa-x']);
        assert.deepEqual(r.unmatched.map((i) => i.id), ['other-only', 'none']);
    });

    test('a WCAG criterion matches exactly, a clause or RGAA criterion also by its start', () => {
        assert.equal(G.issueMatchesGroup({ SC: ['1.4.10'] }, { WCAG: ['1.4.1'] }), false);
        assert.equal(G.issueMatchesGroup(enIssue, { 'EN 301 549': ['9.1'] }), true);
        assert.equal(G.issueMatchesGroup(rgaaIssue, { RGAA: ['1'] }), false);
        assert.equal(G.issueMatchesGroup(rgaaIssue, { RGAA: ['11'] }), true);
    });
});

describe('a standard from a pack, named by its name', () => {
    test('a grouping item may name it, and its issues go in the group', async () => {
        const { cleanGroupingItem, groupIssuesBySpec, requirementsOf } = await import('./grouping-spec.js');
        assert.deepEqual(cleanGroupingItem({ group: 'Links', 'Sample Standard': ['2', 'x', 3] }).item, { group: 'Links', 'Sample Standard': ['2', '3'] });
        const issue = { SC: [], STANDARDS: [{ standard: 'Sample Standard', requirement: '3', wcagSc: [] }, { standard: 'Sample Standard', requirement: '2', wcagSc: ['2.4.4'] }] };
        assert.deepEqual(requirementsOf(issue)['Sample Standard'], ['3', '2']);
        assert.deepEqual(requirementsOf(issue).WCAG, ['2.4.4'], 'and the WCAG criteria it corresponds to');
        const { buckets } = groupIssuesBySpec([issue], [{ group: 'Links', 'Sample Standard': ['3'] }, { group: 'By WCAG', WCAG: ['2.4.4'] }]);
        assert.deepEqual(buckets.map((b) => b.items.length), [1, 1]);
    });

    test('an issue of it no group takes, and no WCAG criterion, is "Not in WCAG"', async () => {
        const { groupIssuesBySpec } = await import('./grouping-spec.js');
        const issue = { SC: [], STANDARDS: [{ standard: 'Sample Standard', requirement: '3', wcagSc: [] }] };
        const out = groupIssuesBySpec([issue], [{ group: 'Images', WCAG: ['1.1.1'] }]);
        assert.equal(out.notInWcag.length, 1);
    });
});
