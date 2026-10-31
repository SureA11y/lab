// The testing guide (guide.html): how a person checks each requirement of a
// standard by hand, from core's test procedures (listProcedures, through
// /api/procedures/list). A reference to read beside the site being tested:
// it records nothing. The standard, version, levels and filters are in the
// page's address, so a link can open it at one requirement
// (?standard=wcag&id=1.4.3).

const TOOL_LABELS = {
    'keyboard': 'A keyboard',
    'pointer': 'A mouse or other pointer',
    'screen-reader': 'A screen reader',
    'zoom': 'The browser\'s zoom',
    'contrast-theme': 'A high-contrast theme',
    'devtools': 'The browser\'s developer tools',
};

const AUTOMATION_WORDS = {
    full: 'Automated checks decide it',
    partial: 'Automated checks decide part of it',
    manual: 'Only a person can judge it',
};

const WCAG_VERSIONS = ['2.2', '2.1', '2.0'];

export function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';
const idOf = (prefix, id) => `${prefix}-${String(id).replace(/[^A-Za-z0-9_-]/g, '-')}`;

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

function facetHTML(requirement, f, { details }) {
    const p = f.procedure;
    const tools = (f.tools || []).map((t) => (t && (t.label || TOOL_LABELS[t.id])) || '').filter(isText);
    const covered = coveredBy(requirement, f);
    const technical = details
        ? `<div class="guide-technical">`
            + `<p><span class="guide-term">Facet:</span> <code>${esc(f.id)}</code></p>`
            + ((f.rules || []).length ? `<p><span class="guide-term">Rules that test it:</span> ${f.rules.map((r) => `<code>${esc(r)}</code>`).join(', ')}</p>` : '')
            + (covered.length ? `<p><span class="guide-term">Also assesses:</span> ${covered.map((c) => esc(c.label || c.id)).join('; ')}</p>` : '')
            + ((f.variants || []).length
                ? `<details class="guide-variants"><summary>What scans ask about one element (${f.variants.length})</summary><ul>`
                    + f.variants.map((v) => `<li><code>${esc(v.ruleId)}</code> <code>${esc(v.reasonCode)}</code>: ${esc((v.steps || []).join(' '))}</li>`).join('')
                    + `</ul></details>`
                : '')
            + `</div>`
        : '';
    return `<li class="guide-facet">`
        + `<h${requirement.facetLevel} class="guide-facet-title">${esc(f.label)}</h${requirement.facetLevel}>`
        + `<p class="guide-automation">${esc(AUTOMATION_WORDS[f.automation] || '')}</p>`
        + (tools.length ? `<p><span class="guide-term">You need:</span> ${esc(tools.join(', '))}</p>` : '')
        + `<ol class="guide-steps">${(p.steps || []).filter(isText).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
        + (isText(p.passWhen) ? `<p><span class="guide-term">Passes:</span> ${esc(p.passWhen)}</p>` : '')
        + (isText(p.failWhen) ? `<p><span class="guide-term">Fails:</span> ${esc(p.failWhen)}</p>` : '')
        + technical
        + `</li>`;
}

function requirementHTML(r, facets, level, { details }) {
    const lvl = Math.min(level, 6);
    const relates = Array.isArray(r.relatesTo) && r.relatesTo.length ? r.relatesTo : [];
    const meta = [
        r.level ? `Level ${esc(r.level)}` : '',
        r.wcag ? `Restates WCAG ${esc(r.wcag)}` : '',
        relates.length ? `Relates to WCAG ${esc(relates.join(', '))}` : '',
    ].filter(Boolean).join(' · ');
    const name = `${r.id} ${r.title || ''}`;
    const body = facets.length
        ? `<ol class="guide-facets">${facets.map((f) => facetHTML({ ...r, facetLevel: Math.min(lvl + 1, 6) }, f, { details })).join('')}</ol>`
        : `<p class="guide-none">No check of it matches what is chosen.</p>`;
    return `<section class="guide-req" id="${esc(idOf('req', r.id))}" aria-labelledby="${esc(idOf('reqh', r.id))}">`
        + `<h${lvl} id="${esc(idOf('reqh', r.id))}" tabindex="-1">${esc(name.trim())}</h${lvl}>`
        + (meta ? `<p class="guide-meta">${meta}</p>` : '')
        + body
        + `</section>`;
}

/**
 * The guide's content and contents for a listing and a state: { html, toc,
 * requirements, checks }, the counts of what is shown.
 */
export function renderGuide(listing, state) {
    const requirements = Array.isArray(listing && listing.requirements) ? listing.requirements : [];
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
        return requirementHTML(r, facets, level, { details: state.details });
    };

    const groupBlock = (g, depth) => {
        const level = 2 + depth;
        const own = (g.requirements || []).map((id) => reqBlock(id, level + 1)).join('');
        const inner = (g.groups || []).map((sub) => groupBlock(sub, depth + 1));
        const html = own + inner.map((x) => x.html).join('');
        if (!html) return { html: '', toc: '' };
        const gid = idOf('grp', g.id);
        const title = `${g.id} ${g.title || ''}`.trim();
        const tocInner = inner.map((x) => x.toc).filter(Boolean).join('');
        return {
            html: `<section class="guide-group" aria-labelledby="${esc(gid)}"><h${Math.min(level, 6)} id="${esc(gid)}">${esc(title)}</h${Math.min(level, 6)}>${html}</section>`,
            toc: `<li><a href="#${esc(gid)}">${esc(title)}</a>${tocInner ? `<ul>${tocInner}</ul>` : ''}</li>`,
        };
    };

    const groups = (listing && listing.groups) || [];
    const blocks = groups.map((g) => groupBlock(g, 0));
    // Requirements no group names, after the groups.
    const rest = requirements.filter((r) => !placed.has(r.id)).map((r) => reqBlock(r.id, 3)).join('');
    const restBlock = rest
        ? `<section class="guide-group" aria-labelledby="grp-rest"><h2 id="grp-rest">${groups.length ? 'Other requirements' : 'Requirements'}</h2>${rest}</section>`
        : '';
    return {
        html: blocks.map((b) => b.html).join('') + restBlock,
        toc: `<ul>${blocks.map((b) => b.toc).join('')}${rest ? `<li><a href="#grp-rest">${groups.length ? 'Other requirements' : 'Requirements'}</a></li>` : ''}</ul>`,
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

async function start() {
    const $ = (id) => document.getElementById(id);
    const form = $('guide-filters');
    const content = $('guide-content');
    const status = $('guide-status');
    const tocList = $('guide-toc-list');
    const save = $('guide-save');
    const state = stateFromQuery(location.search);
    let target = state.id;
    let widened = false;
    let listing = null;

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
        .map(([id, label]) => `<label><input type="checkbox" name="tool" value="${esc(id)}"${state.tools.includes(id) ? ' checked' : ''}> ${esc(label)}</label>`)
        .join(''));
    form.querySelector(`input[name="automation"][value="${state.automation}"]`).checked = true;
    $('guide-search').value = state.q;
    $('guide-details').checked = state.details;
    for (const box of form.querySelectorAll('input[name="level"]')) box.checked = state.levels.includes(box.value);

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

    const draw = () => {
        if (!listing) return;
        const out = renderGuide(listing, state);
        content.innerHTML = out.html || '<p class="guide-none">Nothing matches what is chosen.</p>';
        tocList.innerHTML = out.toc;
        const filtering = state.tools.length || state.automation || state.q.trim();
        const noun = state.standard === 'wcag' ? 'criteria' : 'requirements';
        status.textContent = `${standardName(state, standards)}${state.standard === 'wcag' ? `, Level ${state.levels.join(' and ')}` : ''}: `
            + (filtering ? `${out.requirements} of ${out.total} ${noun} shown, ${out.checks} checks.` : `${out.total} ${noun}, ${out.checks} checks.`);
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
                heading.scrollIntoView({ block: 'start' });
                heading.focus();
            }
        }
    };

    const load = async () => {
        status.textContent = 'Loading…';
        const query = new URLSearchParams({ standard: state.standard });
        if (state.version) query.set('version', state.version);
        if (state.standard === 'wcag') query.set('levels', state.levels.join(','));
        if (state.locale) query.set('locale', state.locale);
        const body = await getJSON(`/api/procedures/list?${query.toString()}`);
        if (!body || !body.available) {
            listing = null;
            content.innerHTML = '<p class="guide-none">The surea11y core the lab runs has no test procedures, so there is nothing to show.</p>';
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
        else if (el.name === 'automation') state.automation = el.value;
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
        } else if (el.name === 'level') {
            const levels = [...form.querySelectorAll('input[name="level"]:checked')].map((b) => b.value);
            state.levels = levels.length ? levels : ['A'];
            if (!levels.length) form.querySelector('input[name="level"][value="A"]').checked = true;
            load();
        }
    });
    form.addEventListener('submit', (event) => event.preventDefault());

    fillVersions();
    await load();
}

if (typeof document !== 'undefined' && document.getElementById('guide-filters')) start();
