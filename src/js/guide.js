// The testing guide (guide.html): how a person checks each requirement of a
// standard by hand, from core's test procedures (listProcedures, through
// /api/procedures/list). A reference to read beside the site being tested:
// it records nothing. The standard, version, levels and filters are in the
// page's address, so a link can open it at one requirement
// (?standard=wcag&id=1.4.3).

import { installGuideBar } from './guide-bar.js';

const TOOL_LABELS = {
    'keyboard': 'A keyboard',
    'pointer': 'A mouse or other pointer',
    'screen-reader': 'A screen reader',
    'zoom': 'The browser\'s zoom',
    'contrast-theme': 'A high-contrast theme',
    'devtools': 'The browser\'s developer tools',
};

// Short names for the badges a check carries, with the tools' icons.
const TOOL_SHORT = {
    'keyboard': 'Keyboard',
    'pointer': 'Pointer',
    'screen-reader': 'Screen reader',
    'zoom': 'Zoom',
    'contrast-theme': 'Contrast theme',
    'devtools': 'Developer tools',
};

const TOOL_ICONS = {
    'keyboard': '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    'pointer': '<path d="M5 3l14 8-6 2-2 6z"/>',
    'screen-reader': '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
    'zoom': '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>',
    'contrast-theme': '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor"/>',
    'devtools': '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
};

// What automated checks do of a check, as its badge says it.
const AUTOMATION_BADGE = {
    full: 'Automated',
    partial: 'Partly automated',
    manual: 'A person judges',
};

const WCAG_VERSIONS = ['2.2', '2.1', '2.0'];

export function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const idOf = (prefix, id) => `${prefix}-${String(id).replace(/[^A-Za-z0-9_-]/g, '-')}`;

function toolIcon(id) {
    const path = TOOL_ICONS[id];
    return path
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`
        : '';
}

// The page's own words are English; what core gives is in the language it
// was read in, and each part says so where that differs (WCAG 3.1.2).
const PAGE_LANG = 'en';
const langAttr = (lang) => (isText(lang) && lang.toLowerCase() !== PAGE_LANG ? ` lang="${esc(lang)}"` : '');
// Escaped text, in a span that says its language where that isn't the page's.
const inLang = (lang, text) => (langAttr(lang) ? `<span${langAttr(lang)}>${esc(text)}</span>` : esc(text));

// A language's name, in English or in itself ('Français'): the tag where
// the browser has no name for it.
function nameOf(locale, inLocale = PAGE_LANG) {
    try {
        const name = new Intl.DisplayNames([inLocale], { type: 'language' }).of(locale);
        return name && name.toLowerCase() !== String(locale).toLowerCase() ? name : String(locale);
    } catch {
        return String(locale);
    }
}

/** A language's name in English: 'French'. */
export function languageName(locale) {
    return nameOf(locale);
}

/**
 * A language as the picker offers it: its own name, with the English one
 * ('Français (French)'), and, where the standard isn't all in it, how many
 * texts are shown in the standard's own language instead ('Français
 * (French), 1 text in English'). `own` is that language.
 */
export function languageOption(language, own = PAGE_LANG) {
    const english = nameOf(language.locale);
    const self = nameOf(language.locale, language.locale);
    const name = self.toLowerCase() === english.toLowerCase() ? english : `${self} (${english})`;
    if (language.complete) return name;
    const n = Number(language.missing) || 0;
    return `${name}, ${n || 'some'} ${n === 1 ? 'text' : 'texts'} in ${nameOf(own)}`;
}

/**
 * The language of `languages` (core's procedureLanguages, its own first) a
 * wanted tag is read in: the tag's, else its base language's ('fr-ca',
 * then 'fr'); the standard's own where it is none of them, with `fellBack`.
 */
export function pickLanguage(wanted, languages) {
    const list = Array.isArray(languages) ? languages : [];
    if (!list.length) return null;
    const tag = String(wanted || '').trim().toLowerCase();
    if (!tag) return { language: list[0], fellBack: false };
    const found = list.find((l) => l.locale === tag) || list.find((l) => l.locale === tag.split('-')[0]);
    return found ? { language: found, fellBack: false } : { language: list[0], fellBack: true };
}

/** The guide's state from its address: { standard, version, levels, tools, automation, q, details, id, locale }. */
export function stateFromQuery(search) {
    const p = new URLSearchParams(search || '');
    const list = (k) => (p.get(k) || '').split(',').map((x) => x.trim()).filter(Boolean);
    return {
        standard: p.get('standard') || 'wcag',
        version: p.get('version') || '',
        levels: p.has('levels') ? list('levels') : ['A', 'AA'],
        tools: list('tools').filter((t) => TOOL_LABELS[t]),
        automation: p.get('automation') === 'person' ? 'person' : '',
        q: p.get('q') || '',
        details: p.get('details') === '1',
        id: p.get('id') || '',
        locale: p.get('locale') || '',
    };
}

/** The address of a state, as the guide keeps it current. */
export function queryFromState(s) {
    const p = new URLSearchParams();
    p.set('standard', s.standard);
    if (s.version) p.set('version', s.version);
    if (s.standard === 'wcag') p.set('levels', s.levels.join(','));
    if (s.tools.length) p.set('tools', s.tools.join(','));
    if (s.automation) p.set('automation', s.automation);
    if (s.q) p.set('q', s.q);
    if (s.details) p.set('details', '1');
    if (s.locale) p.set('locale', s.locale);
    return p.toString();
}

/**
 * A requirement's facets as the guide shows them, filtered: those with a
 * procedure of their own (a technology facet is assessed by the facet it is
 * covered by, which lists it), that need one of `tools` (any, when none is
 * chosen), that a person must judge (with `automation: 'person'`), and that
 * mention `q`, unless the requirement's own number or title does.
 */
export function facetsShown(requirement, { tools = [], automation = '', q = '' } = {}) {
    const facets = Array.isArray(requirement && requirement.facets) ? requirement.facets : [];
    const query = String(q || '').trim().toLowerCase();
    const headMatches = !query || `${requirement.id} ${requirement.title || ''}`.toLowerCase().includes(query);
    return facets.filter((f) => {
        if (!f || f.coveredBy || !f.procedure) return false;
        if (automation === 'person' && f.automation === 'full') return false;
        if (tools.length && !(f.tools || []).some((t) => tools.includes(t && t.id))) return false;
        if (headMatches) return true;
        const p = f.procedure;
        return [f.label, ...(p.steps || []), p.passWhen, p.failWhen].some((t) => isText(t) && t.toLowerCase().includes(query));
    });
}

// The technology facets a facet's procedure also assesses.
function coveredBy(requirement, facet) {
    return (requirement.facets || []).filter((f) => f && f.coveredBy === facet.id);
}

function badgesHTML(f) {
    const tools = (f.tools || []).filter((t) => t && t.id);
    return `<p class="guide-badges">`
        + `<span class="guide-badge guide-badge-auto" data-automation="${esc(f.automation || '')}">${esc(AUTOMATION_BADGE[f.automation] || '')}</span>`
        + (tools.length
            ? `<span class="guide-needs">Needs</span>` + tools.map((t) => `<span class="guide-badge guide-badge-tool" title="${esc(TOOL_LABELS[t.id] || t.label || '')}">${toolIcon(t.id)}${esc(TOOL_SHORT[t.id] || t.label || t.id)}</span>`).join('')
            : '')
        + `</p>`;
}

function facetHTML(requirement, f, { details, level, lang }) {
    const p = f.procedure;
    const labelLang = langAttr(f.lang || lang);
    const textLang = langAttr(f.procedureLang || f.lang || lang);
    const covered = coveredBy(requirement, f);
    const bodyId = idOf('chk', `${requirement.id}-${f.id}`);
    const technical = details
        ? `<div class="guide-technical">`
            + `<p><span class="guide-term">Facet</span> <code>${esc(f.id)}</code></p>`
            + ((f.rules || []).length ? `<p><span class="guide-term">Rules that test it</span> ${f.rules.map((r) => `<code>${esc(r)}</code>`).join(' ')}</p>` : '')
            + (covered.length ? `<p><span class="guide-term">Also assesses</span> ${covered.map((c) => inLang(c.lang || lang, c.label || c.id)).join('; ')}</p>` : '')
            + ((f.variants || []).length
                ? `<details class="guide-variants"><summary>What scans ask about one element (${f.variants.length})</summary><ul>`
                    + f.variants.map((v) => `<li><code>${esc(v.ruleId)}</code> <code>${esc(v.reasonCode)}</code> ${inLang(v.lang || lang, (v.steps || []).join(' '))}</li>`).join('')
                    + `</ul></details>`
                : '')
            + `</div>`
        : '';
    return `<li class="guide-check">`
        + `<div class="guide-check-head">`
        + `<h${level} class="guide-facet-title"><button type="button" class="guide-toggle" aria-expanded="false" aria-controls="${esc(bodyId)}">`
        + `<svg class="guide-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>`
        + `<span${labelLang}>${esc(f.label)}</span></button></h${level}>`
        + badgesHTML(f)
        + `</div>`
        + `<div class="guide-check-body" id="${esc(bodyId)}" hidden="until-found">`
        + `<ol class="guide-steps"${textLang}>${(p.steps || []).filter(isText).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
        + `<div class="guide-outcomes">`
        + (isText(p.passWhen) ? `<div class="guide-outcome guide-pass"><p class="guide-outcome-head"><span aria-hidden="true">✓</span> Passes</p><p${textLang}>${esc(p.passWhen)}</p></div>` : '')
        + (isText(p.failWhen) ? `<div class="guide-outcome guide-fail"><p class="guide-outcome-head"><span aria-hidden="true">✗</span> Fails</p><p${textLang}>${esc(p.failWhen)}</p></div>` : '')
        + `</div>`
        + technical
        + `</div>`
        + `</li>`;
}

function requirementHTML(r, facets, level, { details, lang }) {
    const lvl = Math.min(level, 6);
    const relates = Array.isArray(r.relatesTo) && r.relatesTo.length ? r.relatesTo : [];
    const pills = [
        r.level ? `<span class="guide-pill guide-pill-level">Level ${esc(r.level)}</span>` : '',
        r.wcag ? `<span class="guide-pill">Restates WCAG ${esc(r.wcag)}</span>` : '',
        relates.length ? `<span class="guide-pill">Relates to WCAG ${esc(relates.join(', '))}</span>` : '',
    ].filter(Boolean).join('');
    const body = facets.length
        ? `<ol class="guide-checks">${facets.map((f) => facetHTML(r, f, { details, lang, level: Math.min(lvl + 1, 6) })).join('')}</ol>`
        : `<p class="guide-none">No check of it matches what is chosen.</p>`;
    return `<section class="guide-req" id="${esc(idOf('req', r.id))}" aria-labelledby="${esc(idOf('reqh', r.id))}">`
        + `<div class="guide-req-head">`
        + `<h${lvl} id="${esc(idOf('reqh', r.id))}" tabindex="-1"><span class="guide-req-id">${esc(r.id)}</span> ${r.title ? inLang(r.titleLang || lang, r.title) : ''}</h${lvl}>`
        + `<button type="button" class="guide-copy" data-copy="${esc(r.id)}">`
        + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>`
        + `Copy link<span class="visually-hidden"> to ${esc(r.id)}</span></button>`
        + `</div>`
        + (pills ? `<p class="guide-pills">${pills}</p>` : '')
        + body
        + `</section>`;
}

/**
 * The guide's content and contents for a listing and a state: { html, toc,
 * requirements, total, checks }, the counts of what is shown.
 */
export function renderGuide(listing, state) {
    const requirements = Array.isArray(listing && listing.requirements) ? listing.requirements : [];
    // The language core read the standard in; each part that is in another says so.
    const lang = (listing && isText(listing.locale) && listing.locale) || PAGE_LANG;
    const byId = new Map(requirements.map((r) => [String(r.id), r]));
    const filters = { tools: state.tools, automation: state.automation, q: state.q };
    const filtering = state.tools.length || state.automation || String(state.q || '').trim();
    const placed = new Set();
    let shownRequirements = 0;
    let shownChecks = 0;

    const reqBlock = (id, level) => {
        const r = byId.get(String(id));
        if (!r || placed.has(r.id)) return '';
        placed.add(r.id);
        const facets = facetsShown(r, filters);
        if (filtering && !facets.length) return '';
        shownRequirements += 1;
        shownChecks += facets.length;
        return requirementHTML(r, facets, level, { details: state.details, lang });
    };

    const groupBlock = (g, depth) => {
        const level = 2 + depth;
        const before = shownRequirements;
        const own = (g.requirements || []).map((id) => reqBlock(id, level + 1)).join('');
        const inner = (g.groups || []).map((sub) => groupBlock(sub, depth + 1));
        const html = own + inner.map((x) => x.html).join('');
        if (!html) return { html: '', toc: '' };
        const count = shownRequirements - before;
        const gid = idOf('grp', g.id);
        const title = `${esc(g.id)}${g.title ? ` ${inLang(g.titleLang || lang, g.title)}` : ''}`;
        const tocInner = inner.map((x) => x.toc).filter(Boolean).join('');
        return {
            html: `<section class="guide-group guide-group-${depth}" aria-labelledby="${esc(gid)}"><h${Math.min(level, 6)} id="${esc(gid)}" class="guide-group-title">${title}</h${Math.min(level, 6)}>${html}</section>`,
            toc: `<li><a href="#${esc(gid)}" data-toc="${esc(gid)}"><span class="guide-toc-title">${title}</span> <span class="guide-toc-count">${count}</span></a>${tocInner ? `<ul>${tocInner}</ul>` : ''}</li>`,
        };
    };

    const groups = (listing && listing.groups) || [];
    const blocks = groups.map((g) => groupBlock(g, 0));
    // Requirements no group names, after the groups.
    const before = shownRequirements;
    const rest = requirements.filter((r) => !placed.has(r.id)).map((r) => reqBlock(r.id, 3)).join('');
    const restTitle = groups.length ? 'Other requirements' : 'Requirements';
    const restBlock = rest
        ? `<section class="guide-group guide-group-0" aria-labelledby="grp-rest"><h2 id="grp-rest" class="guide-group-title">${restTitle}</h2>${rest}</section>`
        : '';
    return {
        html: blocks.map((b) => b.html).join('') + restBlock,
        toc: `<ul>${blocks.map((b) => b.toc).join('')}${rest ? `<li><a href="#grp-rest" data-toc="grp-rest"><span class="guide-toc-title">${restTitle}</span> <span class="guide-toc-count">${shownRequirements - before}</span></a></li>` : ''}</ul>`,
        requirements: shownRequirements,
        total: requirements.length,
        checks: shownChecks,
    };
}

// ---- The page ----------------------------------------------------------------

function standardName(state, standards) {
    if (state.standard === 'wcag') return `WCAG ${state.version || WCAG_VERSIONS[0]}`;
    if (state.standard === 'best-practice') return 'Best practices';
    const std = standards.find((s) => s.key === state.standard);
    return `${std ? std.name : state.standard}${state.version ? ` ${state.version}` : ''}`;
}

async function getJSON(url) {
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

// The colour theme, as the app's switch has it: Auto, Light, Dark, kept in
// the same place, so the two pages agree.
function initTheme() {
    const KEY = 'a11y-lab-theme';
    const ORDER = ['auto', 'light', 'dark'];
    const LABELS = { auto: 'Auto', light: 'Light', dark: 'Dark' };
    const btn = document.querySelector('[data-theme-toggle]');
    let current = 'light';
    try {
        const stored = localStorage.getItem(KEY);
        if (ORDER.includes(stored)) current = stored;
    } catch {
        // the default
    }
    const apply = () => {
        if (current === 'auto') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = current;
        if (btn) {
            btn.dataset.choice = current;
            btn.setAttribute('aria-label', `Colour theme: ${LABELS[current]}`);
            btn.title = `Colour theme: ${LABELS[current]}`;
        }
    };
    apply();
    btn?.addEventListener('click', () => {
        current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
        try {
            localStorage.setItem(KEY, current);
        } catch {
            // the choice still applies for this view
        }
        apply();
    });
}

async function start() {
    const $ = (id) => document.getElementById(id);
    const form = $('guide-filters');
    const content = $('guide-content');
    const status = $('guide-status');
    const announce = $('guide-announce');
    const tocList = $('guide-toc-list');
    const tocToggle = $('guide-toc-toggle');
    const save = $('guide-save');
    const more = $('guide-more');
    const moreCount = $('guide-more-count');
    const state = stateFromQuery(location.search);
    let target = state.id;
    let widened = false;
    let listing = null;
    // The language asked for, kept while a standard lacks it, so the next
    // standard that has it is read in it again.
    let wanted = state.locale;

    initTheme();

    const standards = (await getJSON('/api/standards'))?.standards || [];
    const standardSelect = $('guide-standard');
    standardSelect.innerHTML = [
        `<option value="wcag">WCAG</option>`,
        ...standards.map((s) => `<option value="${esc(s.key)}">${esc(s.name)}</option>`),
        `<option value="best-practice">Best practices</option>`,
    ].join('');
    if (![...standardSelect.options].some((o) => o.value === state.standard)) state.standard = 'wcag';
    standardSelect.value = state.standard;

    $('guide-tools').insertAdjacentHTML('beforeend', Object.entries(TOOL_LABELS)
        .map(([id, label]) => `<label class="guide-chip"><input type="checkbox" name="tool" value="${esc(id)}"${state.tools.includes(id) ? ' checked' : ''}><span>${toolIcon(id)}${esc(label)}</span></label>`)
        .join(''));
    form.querySelector('input[name="automation"]').checked = state.automation === 'person';
    $('guide-search').value = state.q;
    $('guide-details').checked = state.details;
    for (const box of form.querySelectorAll('input[name="level"]')) box.checked = state.levels.includes(box.value);

    // How many filters are on, on the Filters disclosure; open when any is.
    const showFilters = () => {
        const n = state.tools.length + (state.automation ? 1 : 0) + (state.details ? 1 : 0);
        moreCount.textContent = n ? ` (${n} on)` : '';
        $('guide-clear').hidden = !n;
    };
    if (state.tools.length || state.automation || state.details) more.open = true;

    // The versions of the chosen standard, the latest first; the levels for
    // WCAG alone.
    const fillVersions = () => {
        const versionSelect = $('guide-version');
        const versions = state.standard === 'wcag' ? WCAG_VERSIONS
            : state.standard === 'best-practice' ? []
                : [...(standards.find((s) => s.key === state.standard)?.versions || [])].reverse();
        versionSelect.innerHTML = versions.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
        if (!versions.includes(state.version)) state.version = versions[0] || '';
        versionSelect.value = state.version;
        versionSelect.closest('.guide-field').hidden = !versions.length;
        $('guide-levels').hidden = state.standard !== 'wcag';
    };

    const keepAddress = () => {
        history.replaceState(null, '', `${location.pathname}?${queryFromState(state)}${target ? '' : location.hash}`);
        const page = new URLSearchParams(queryFromState(state));
        page.delete('q');
        page.delete('details');
        save.href = `/api/procedures/page?${page.toString()}`;
    };

    // The contents link of the part of the guide on screen.
    let tocLinks = [];
    let tocTargets = [];
    const markCurrent = () => {
        let current = null;
        for (const h of tocTargets) {
            if (h.getBoundingClientRect().top <= 140) current = h.id;
            else break;
        }
        for (const a of tocLinks) {
            if (a.dataset.toc === current) a.setAttribute('aria-current', 'location');
            else a.removeAttribute('aria-current');
        }
    };
    let scrolling = false;
    window.addEventListener('scroll', () => {
        if (scrolling) return;
        scrolling = true;
        requestAnimationFrame(() => { scrolling = false; markCurrent(); });
    }, { passive: true });

    // A check folds and unfolds; all of them at once from the bar above. The
    // guide opens with every check folded to its title. A folded check stays
    // findable: the browser's find in page opens the one it finds a word in
    // (hidden="until-found", and beforematch below).
    const setOpen = (button, open) => {
        button.setAttribute('aria-expanded', String(open));
        const body = document.getElementById(button.getAttribute('aria-controls'));
        if (!body) return;
        if (open) body.removeAttribute('hidden');
        else body.setAttribute('hidden', 'until-found');
    };
    content.addEventListener('beforematch', (event) => {
        const body = event.target.closest('.guide-check-body');
        const toggle = body && content.querySelector(`.guide-toggle[aria-controls="${CSS.escape(body.id)}"]`);
        if (toggle) toggle.setAttribute('aria-expanded', 'true');
    });

    const draw = () => {
        if (!listing) return;
        const out = renderGuide(listing, state);
        content.innerHTML = out.html || '<p class="guide-none guide-empty">Nothing matches what is chosen. Clear the filters or the search to see more.</p>';
        tocList.innerHTML = out.toc;
        tocLinks = [...tocList.querySelectorAll('a[data-toc]')];
        tocTargets = tocLinks.map((a) => document.getElementById(a.dataset.toc)).filter(Boolean);
        markCurrent();
        const filtering = state.tools.length || state.automation || state.q.trim();
        const noun = state.standard === 'wcag' ? 'criteria' : 'requirements';
        status.textContent = `${standardName(state, standards)}${state.standard === 'wcag' ? `, Level ${state.levels.join(' and ')}` : ''}: `
            + (filtering ? `${out.requirements} of ${out.total} ${noun} shown, ${out.checks} checks.` : `${out.total} ${noun}, ${out.checks} checks.`);
        showFilters();
        keepAddress();
        if (target) {
            const heading = document.getElementById(idOf('reqh', target));
            // Opened at a criterion the levels chosen leave out (a link from
            // a AAA finding): every level, so it is there.
            if (!heading && state.standard === 'wcag' && state.levels.length < 3 && !widened) {
                widened = true;
                state.levels = ['A', 'AA', 'AAA'];
                for (const box of form.querySelectorAll('input[name="level"]')) box.checked = true;
                load();
                return;
            }
            target = '';
            if (heading) {
                // Opened at one requirement: its checks open, the rest stay folded.
                for (const b of heading.closest('.guide-req')?.querySelectorAll('.guide-toggle') || []) setOpen(b, true);
                heading.scrollIntoView({ block: 'start' });
                heading.focus();
            }
        }
    };

    // The languages the chosen standard and version can be read in, from
    // core: the picker offers those alone, the standard's own first, and
    // says of one the standard isn't all in how much is in its own. A
    // language it lacks reads in its own, and the guide says so. A core
    // that doesn't say leaves the picker out and reads the locale asked for.
    const languageField = $('guide-language-field');
    const languageSelect = $('guide-language');
    const languageNote = $('guide-language-note');
    const fillLanguages = async () => {
        const query = new URLSearchParams({ standard: state.standard });
        if (state.version) query.set('version', state.version);
        const body = await getJSON(`/api/procedures/languages?${query.toString()}`);
        const languages = body && body.available && Array.isArray(body.languages) && body.languages.length ? body.languages : null;
        // One language is no choice: the picker is left out (the lab reads
        // procedures in English alone, for now).
        languageField.hidden = !languages || languages.length < 2;
        languageNote.hidden = true;
        languageNote.textContent = '';
        languageSelect.removeAttribute('aria-describedby');
        if (!languages) {
            state.locale = wanted;
            return;
        }
        const own = languages[0].locale;
        const { language, fellBack } = pickLanguage(wanted, languages);
        state.locale = language.locale === own ? '' : language.locale;
        languageSelect.innerHTML = languages
            .map((l) => `<option value="${esc(l.locale)}">${esc(languageOption(l, own))}</option>`)
            .join('');
        languageSelect.value = language.locale;
        const name = standardName(state, standards);
        let note = '';
        if (fellBack) {
            note = `${name} has no ${languageName(wanted)} translation, so it is shown in ${languageName(own)}.`;
            announce.textContent = note;
        } else if (!language.complete) {
            const n = Number(language.missing) || 0;
            note = `${n || 'Some'} ${n === 1 ? 'text' : 'texts'} of ${name} ${n === 1 ? 'has' : 'have'} no ${languageName(language.locale)} translation yet, so ${n === 1 ? 'it is' : 'they are'} shown in ${languageName(own)}.`;
        }
        if (note) {
            languageNote.textContent = note;
            languageNote.hidden = false;
            languageSelect.setAttribute('aria-describedby', 'guide-language-note');
        }
    };

    const load = async () => {
        status.textContent = 'Loading…';
        await fillLanguages();
        content.setAttribute('aria-busy', 'true');
        const query = new URLSearchParams({ standard: state.standard });
        if (state.version) query.set('version', state.version);
        if (state.standard === 'wcag') query.set('levels', state.levels.join(','));
        if (state.locale) query.set('locale', state.locale);
        const body = await getJSON(`/api/procedures/list?${query.toString()}`);
        content.removeAttribute('aria-busy');
        if (!body || !body.available) {
            listing = null;
            content.innerHTML = '<p class="guide-none guide-empty">The surea11y core the lab runs has no test procedures, so there is nothing to show.</p>';
            tocList.innerHTML = '';
            status.textContent = 'No test procedures.';
            return;
        }
        listing = body.listing || { requirements: [], groups: [] };
        draw();
    };

    let typing = null;
    form.addEventListener('input', (event) => {
        const el = event.target;
        if (el.name === 'q') {
            state.q = el.value;
            clearTimeout(typing);
            typing = setTimeout(draw, 250);
            return;
        }
        if (el.name === 'tool') state.tools = [...form.querySelectorAll('input[name="tool"]:checked')].map((b) => b.value);
        else if (el.name === 'automation') state.automation = el.checked ? 'person' : '';
        else if (el.name === 'details') state.details = el.checked;
        else return;
        draw();
    });
    form.addEventListener('change', (event) => {
        const el = event.target;
        if (el.name === 'standard') {
            state.standard = el.value;
            state.version = '';
            fillVersions();
            load();
        } else if (el.name === 'version') {
            state.version = el.value;
            load();
        } else if (el.name === 'locale') {
            // The standard's own language is no choice to keep: the next
            // standard is read in its own.
            wanted = el.selectedIndex === 0 ? '' : el.value;
            load();
        } else if (el.name === 'level') {
            const levels = [...form.querySelectorAll('input[name="level"]:checked')].map((b) => b.value);
            state.levels = levels.length ? levels : ['A'];
            if (!levels.length) form.querySelector('input[name="level"][value="A"]').checked = true;
            load();
        }
    });
    form.addEventListener('submit', (event) => event.preventDefault());

    $('guide-clear').addEventListener('click', () => {
        state.tools = [];
        state.automation = '';
        state.details = false;
        for (const box of form.querySelectorAll('input[name="tool"], input[name="automation"], input[name="details"]')) box.checked = false;
        draw();
        more.querySelector('summary').focus();
    });

    content.addEventListener('click', async (event) => {
        const toggle = event.target.closest('.guide-toggle');
        if (toggle) {
            setOpen(toggle, toggle.getAttribute('aria-expanded') !== 'true');
            return;
        }
        const copy = event.target.closest('.guide-copy');
        if (copy) {
            const link = new URL(location.pathname, location.href);
            const q = new URLSearchParams({ standard: state.standard, ...(state.version ? { version: state.version } : {}), ...(state.locale ? { locale: state.locale } : {}), id: copy.dataset.copy });
            link.search = q.toString();
            let ok = false;
            try {
                await navigator.clipboard.writeText(link.href);
                ok = true;
            } catch {
                ok = false;
            }
            announce.textContent = ok ? `Link to ${copy.dataset.copy} copied.` : `Copy this link: ${link.href}`;
            copy.classList.toggle('is-copied', ok);
            setTimeout(() => copy.classList.remove('is-copied'), 1500);
        }
    });
    $('guide-expand').addEventListener('click', () => {
        for (const b of content.querySelectorAll('.guide-toggle')) setOpen(b, true);
        announce.textContent = 'Every check expanded.';
    });
    $('guide-collapse').addEventListener('click', () => {
        for (const b of content.querySelectorAll('.guide-toggle')) setOpen(b, false);
        announce.textContent = 'Every check collapsed to its title.';
    });

    // The contents fold away on a narrow screen, to come before the guide
    // without pushing it down; on a wide one they stay beside it.
    const narrow = window.matchMedia('(max-width: 760px)');
    const setToc = (open) => {
        tocToggle.setAttribute('aria-expanded', String(open));
        tocToggle.textContent = open ? 'Hide' : 'Show';
        tocList.classList.toggle('is-collapsed', !open);
    };
    setToc(!narrow.matches);
    narrow.addEventListener?.('change', (e) => setToc(!e.matches));
    tocToggle.addEventListener('click', () => setToc(tocToggle.getAttribute('aria-expanded') !== 'true'));
    tocList.addEventListener('click', (event) => {
        if (event.target.closest('a') && narrow.matches) setToc(false);
    });

    installGuideBar({
        bar: $('guide-bar'),
        hero: document.querySelector('.guide-hero'),
        filters: form,
        status,
        expand: $('guide-expand'),
        collapse: $('guide-collapse'),
        search: $('guide-search'),
        tocList,
    });

    fillVersions();
    await load();
}

if (typeof document !== 'undefined' && document.getElementById('guide-filters')) start();
