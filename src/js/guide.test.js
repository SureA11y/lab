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
    assert.match(out.html, /<h2 id="grp-1" class="guide-group-title">1 Perceivable<\/h2>[\s\S]*<h3 id="grp-1-1" class="guide-group-title">1\.1 Text Alternatives<\/h3>[\s\S]*<h4 id="reqh-1-1-1" tabindex="-1"><span class="guide-req-id">1\.1\.1<\/span> Non-text Content<\/h4>/);
    assert.match(out.html, /Copy link<span class="visually-hidden"> to 1\.1\.1<\/span>/);
    assert.match(out.html, /<span class="guide-pill guide-pill-level">Level A<\/span>/);
    // A check: its title a heading whose button unfolds it (folded at first), its badges, steps, and what passes and fails.
    assert.match(out.html, /<h5 class="guide-facet-title"><button type="button" class="guide-toggle" aria-expanded="false" aria-controls="chk-1-1-1-alt-mechanism">[\s\S]*<span>Label of alt-mechanism<\/span><\/button><\/h5>/);
    assert.match(out.html, /data-automation="partial">Partly automated<\/span><span class="guide-needs">Needs<\/span><span class="guide-badge guide-badge-tool" title="The browser&#39;s developer tools">/);
    assert.match(out.html, /<div class="guide-check-body" id="chk-1-1-1-alt-mechanism" hidden="until-found"><ol class="guide-steps"><li>Step for alt-mechanism\.<\/li><\/ol>/);
    assert.match(out.html, /<span aria-hidden="true">✓<\/span> Passes<\/p><p>alt-mechanism passes\.<\/p>[\s\S]*<span aria-hidden="true">✗<\/span> Fails<\/p><p>alt-mechanism fails\.<\/p>/);
    assert.match(out.html, /data-automation="manual">A person judges</);
    assert.match(out.html, /data-automation="full">Automated</);
    assert.doesNotMatch(out.html, /guide-technical/, 'technical details only when asked');
    assert.match(out.toc, /<a href="#grp-1" data-toc="grp-1"><span class="guide-toc-title">1 Perceivable<\/span> <span class="guide-toc-count">2<\/span><\/a><ul><li><a href="#grp-1-1"/);

    const details = renderGuide(LISTING, { ...all, details: true });
    assert.match(details.html, /Facet<\/span> <code>alt-mechanism<\/code>[\s\S]*Rules that test it<\/span> <code>rule-alt-mechanism<\/code>[\s\S]*Also assesses<\/span> Label of img-alt/);
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
    assert.match(out.html, /<h2 id="grp-rest" class="guide-group-title">Other requirements<\/h2>[\s\S]*Restates WCAG 1\.1\.1/);
    assert.match(out.html, /<h3 id="reqh-9-6" tabindex="-1"><span class="guide-req-id">9\.6<\/span> WCAG conformance requirements<\/h3>/);
});

test('text is escaped', async () => {
    const { renderGuide } = await load();
    const listing = { requirements: [{ id: '1', title: '<b>x</b>', facets: [facet('a', 'manual', [], { label: '<i>' })] }], groups: [] };
    const out = renderGuide(listing, all);
    assert.doesNotMatch(out.html, /<b>x<\/b>|<i>/);
    assert.match(out.html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('the languages are offered by their own names, and one the standard is not all in says how much is not', async () => {
    const { languageOption, languageName, pickLanguage } = await load();
    assert.equal(languageName('fr'), 'French');
    assert.equal(languageOption({ locale: 'en', complete: true, missing: 0 }), 'English');
    assert.equal(languageOption({ locale: 'fr', complete: true, missing: 0 }), 'français (French)');
    assert.equal(languageOption({ locale: 'de', complete: false, missing: 1 }), 'Deutsch (German), 1 text in English');
    assert.equal(languageOption({ locale: 'ja', complete: false, missing: 3 }, 'fr'), '日本語 (Japanese), 3 texts in French');

    const languages = [{ locale: 'en', complete: true }, { locale: 'fr', complete: true }];
    assert.deepEqual(pickLanguage('', languages), { language: languages[0], fellBack: false }, 'none asked: the standard\'s own');
    assert.deepEqual(pickLanguage('FR-ca', languages), { language: languages[1], fellBack: false });
    assert.deepEqual(pickLanguage('pt', languages), { language: languages[0], fellBack: true }, 'one it lacks: its own, saying so');
    assert.equal(pickLanguage('fr', []), null, 'a core that does not say');
});

test('what core gives is marked with the language it was read in, and a part in another with its own', async () => {
    const { renderGuide, stateFromQuery } = await load();
    const listing = {
        ...LISTING,
        locale: 'fr',
        requirements: [
            ...LISTING.requirements,
            { id: '4.1.1', title: 'Parsing', titleLang: 'en', level: 'A', facets: [facet('ids-unique', 'manual', [])] },
        ],
        groups: [...LISTING.groups, { id: '4', title: 'Robuste', requirements: ['4.1.1'], groups: [] }],
    };
    const { html, toc } = renderGuide(listing, stateFromQuery(''));
    assert.match(html, /<span class="guide-req-id">1\.1\.1<\/span> <span lang="fr">Non-text Content<\/span>/);
    assert.match(html, /<span class="guide-req-id">4\.1\.1<\/span> Parsing<\/h3>/, 'a title core has no translation of is English, as the page');
    assert.match(html, /<span lang="fr">Label of ids-unique<\/span><\/button>/);
    assert.match(html, /<ol class="guide-steps" lang="fr">/);
    assert.match(html, /<p lang="fr">ids-unique passes\.<\/p>/);
    assert.match(html, /class="guide-group-title">4 <span lang="fr">Robuste<\/span>/);
    assert.match(toc, /<span class="guide-toc-title">4 <span lang="fr">Robuste<\/span><\/span>/);
    assert.match(html, /<p class="guide-outcome-head"><span aria-hidden="true">✓<\/span> Passes<\/p>/, 'the guide\'s own words stay the page\'s');

    const pack = renderGuide({ ...listing, locale: 'en', requirements: [{ id: '12.1', title: 'Informations', titleLang: 'fr', facets: [facet('docs', 'manual', [], { lang: 'fr' })] }], groups: [] }, stateFromQuery(''));
    assert.match(pack.html, /<span lang="fr">Informations<\/span>/);
    assert.match(pack.html, /<ol class="guide-steps" lang="fr">/, 'a pack\'s own facet in its language');
});

test('a variant core says is in English, in a guide in another language, is not marked with it', async () => {
    const { renderGuide, stateFromQuery } = await load();
    const variants = [
        { ruleId: 'rule-a', reasonCode: 'CODE_FR', steps: ['Étape.'], passWhen: 'Oui.', failWhen: 'Non.' },
        { ruleId: 'rule-b', reasonCode: 'CODE_EN', steps: ['Step.'], passWhen: 'Yes.', failWhen: 'No.', lang: 'en' },
    ];
    const listing = { ...LISTING, locale: 'fr', requirements: [{ id: '1.1.1', title: 'Contenu non textuel', level: 'A', facets: [facet('alt', 'partial', [], { variants })] }] };
    const { html } = renderGuide(listing, stateFromQuery('details=1'));
    assert.match(html, /<code>CODE_FR<\/code> <span lang="fr">Étape\.<\/span><\/li>/);
    assert.match(html, /<code>CODE_EN<\/code> Step\.<\/li>/);
});
