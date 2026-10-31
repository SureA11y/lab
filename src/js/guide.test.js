'use strict';

// The testing guide (guide.html): what it shows of a standard's procedures,
// and the address that keeps its choices.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, 'guide.js')).href);

const facet = (id, automation, tools, extra = {}) => ({
    id, label: `Label of ${id}`, automation, rules: automation === 'manual' ? [] : [`rule-${id}`], variants: [],
    tools: tools.map((t) => ({ id: t, label: `Tool ${t}` })),
    procedure: { steps: [`Step for ${id}.`], passWhen: `${id} passes.`, failWhen: `${id} fails.` },
    ...extra,
});

const LISTING = {
    standard: 'wcag', version: '2.2',
    requirements: [
        { id: '1.1.1', title: 'Non-text Content', level: 'A', facets: [
            facet('alt-mechanism', 'partial', ['devtools']),
            facet('img-alt', 'full', [], { coveredBy: 'alt-mechanism', procedure: null }),
        ] },
        { id: '1.4.13', title: 'Content on Hover or Focus', level: 'AA', facets: [
            facet('dismissible', 'manual', ['pointer', 'keyboard']),
            facet('hoverable', 'manual', ['pointer']),
        ] },
        { id: '2.4.7', title: 'Focus Visible', level: 'AA', facets: [facet('focus-shown', 'full', ['keyboard'])] },
    ],
    groups: [
        { id: '1', title: 'Perceivable', requirements: [], groups: [
            { id: '1.1', title: 'Text Alternatives', requirements: ['1.1.1'], groups: [] },
            { id: '1.4', title: 'Distinguishable', requirements: ['1.4.13'], groups: [] },
        ] },
        { id: '2', title: 'Operable', requirements: [], groups: [{ id: '2.4', title: 'Navigable', requirements: ['2.4.7'], groups: [] }] },
    ],
};

const all = { tools: [], automation: '', q: '', details: false };

test('the address keeps the choices, and gives them back', async () => {
    const { stateFromQuery, queryFromState } = await load();
    const s = stateFromQuery('?standard=en301549&version=V4.1.1&tools=screen-reader,bogus&automation=person&q=focus&details=1&id=4.2.1');
    assert.deepEqual(s, { standard: 'en301549', version: 'V4.1.1', levels: ['A', 'AA'], tools: ['screen-reader'], automation: 'person', q: 'focus', details: true, id: '4.2.1', locale: '' });
    assert.equal(queryFromState(s), 'standard=en301549&version=V4.1.1&tools=screen-reader&automation=person&q=focus&details=1');
    assert.deepEqual(stateFromQuery('').levels, ['A', 'AA']);
    assert.match(queryFromState(stateFromQuery('?levels=A,AAA')), /levels=A%2CAAA/);
});

test('a requirement shows its checks with a procedure of their own, filtered as chosen', async () => {
    const { facetsShown } = await load();
    const [r1, r2, r3] = LISTING.requirements;
    assert.deepEqual(facetsShown(r1, all).map((f) => f.id), ['alt-mechanism'], 'a technology facet is assessed by the one covering it');
    assert.deepEqual(facetsShown(r2, { ...all, tools: ['keyboard'] }).map((f) => f.id), ['dismissible']);
    assert.deepEqual(facetsShown(r3, { ...all, automation: 'person' }), [], 'decided in full by automated checks');
    assert.deepEqual(facetsShown(r2, { ...all, q: 'hover' }).map((f) => f.id), ['dismissible', 'hoverable'], 'the title matches: every check');
    assert.deepEqual(facetsShown(r2, { ...all, q: 'step for hoverable' }).map((f) => f.id), ['hoverable'], 'the words of a step');
});

test('the guide is drawn in the standard\'s groups, with contents and counts', async () => {
    const { renderGuide } = await load();
    const out = renderGuide(LISTING, all);
    assert.equal(out.requirements, 3);
    assert.equal(out.total, 3);
    assert.equal(out.checks, 4);
    assert.match(out.html, /<h2 id="grp-1">1 Perceivable<\/h2>[\s\S]*<h3 id="grp-1-1">1\.1 Text Alternatives<\/h3>[\s\S]*<h4 id="reqh-1-1-1" tabindex="-1">1\.1\.1 Non-text Content<\/h4>/);
    assert.match(out.html, /<h5 class="guide-facet-title">Label of alt-mechanism<\/h5>/);
    assert.match(out.html, /Automated checks decide part of it[\s\S]*You need:<\/span> Tool devtools[\s\S]*<li>Step for alt-mechanism\.<\/li>[\s\S]*Fails:<\/span> alt-mechanism fails\./);
    assert.doesNotMatch(out.html, /Facet:|Rules that test it/, 'technical details only when asked');
    assert.match(out.toc, /<a href="#grp-1">1 Perceivable<\/a><ul><li><a href="#grp-1-1">/);

    const details = renderGuide(LISTING, { ...all, details: true });
    assert.match(details.html, /Facet:<\/span> <code>alt-mechanism<\/code>[\s\S]*Rules that test it:<\/span> <code>rule-alt-mechanism<\/code>[\s\S]*Also assesses:<\/span> Label of img-alt/);
});

test('filtered, it leaves out what nothing matches, groups too, and counts what is left', async () => {
    const { renderGuide } = await load();
    const out = renderGuide(LISTING, { ...all, tools: ['pointer'] });
    assert.equal(out.requirements, 1);
    assert.equal(out.checks, 2);
    assert.doesNotMatch(out.html, /Operable|Non-text Content/);
    assert.doesNotMatch(out.toc, /Operable/);
    assert.equal(renderGuide(LISTING, { ...all, q: 'nothing like this' }).html, '');
});

test('a pack\'s standard with requirements no group names lists them after its groups', async () => {
    const { renderGuide } = await load();
    const listing = {
        requirements: [{ id: '9.6', title: 'WCAG conformance requirements', relatesTo: ['1.4.2'], facets: [facet('full-pages', 'manual', [])] }, { id: '9.1.1.1', title: 'Non-text content', wcag: '1.1.1', facets: [facet('x', 'partial', [])] }],
        groups: [{ id: '9', title: 'Web', requirements: ['9.6'], groups: [] }],
    };
    const out = renderGuide(listing, all);
    assert.match(out.html, /Relates to WCAG 1\.4\.2/);
    assert.match(out.html, /<h2 id="grp-rest">Other requirements<\/h2>[\s\S]*Restates WCAG 1\.1\.1/);
    assert.match(out.html, /<h3 id="reqh-9-6" tabindex="-1">9\.6 WCAG conformance requirements<\/h3>/);
});

test('text is escaped', async () => {
    const { renderGuide } = await load();
    const listing = { requirements: [{ id: '1', title: '<b>x</b>', facets: [facet('a', 'manual', [], { label: '<i>' })] }], groups: [] };
    const out = renderGuide(listing, all);
    assert.doesNotMatch(out.html, /<b>x<\/b>|<i>/);
    assert.match(out.html, /&lt;b&gt;x&lt;\/b&gt;/);
});
