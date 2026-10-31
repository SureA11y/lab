// How a person checks a criterion by hand: core's test procedures, which the
// server gives (/api/procedures, server-side/procedures.js). A criterion has
// facets, the things a person checks to assess it; each that a person has to
// check has steps, what they see if it passes and if it fails, and the tools
// it needs. A core without procedures gives none, and nothing is shown.

const cache = new Map(); // `${locale}|${id}` -> procedure | null

function esc(v) {
    return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** The locale a report's scans ran in, for its procedures: 'en' if none says. */
export function reportLocale(payload) {
    for (const scan of Array.isArray(payload?.scans) ? payload.scans : []) {
        const loc = scan?.canonical?.runOptions?.locale;
        const tag = typeof loc === 'string' ? loc : loc?.resolved;
        if (typeof tag === 'string' && tag.trim()) return tag.trim();
    }
    return 'en';
}

/**
 * The procedures of `ids`, in `locale`: { [id]: procedure }, or null when the
 * server's core has none. WCAG criteria by default; with `standard`
 * ('en301549') and its `version`, that standard's requirements, from its
 * pack. Asked once per requirement, standard, version and locale.
 */
export async function loadProcedures(ids, locale = 'en', { standard = 'wcag', version = '', fetchImpl = globalThis.fetch } = {}) {
    const keyOf = (id) => `${standard}|${version}|${locale}|${id}`;
    const wanted = [...new Set((ids || []).map(String))];
    const missing = wanted.filter((id) => !cache.has(keyOf(id)));
    if (missing.length) {
        let body = null;
        try {
            const query = `ids=${encodeURIComponent(missing.join(','))}&locale=${encodeURIComponent(locale)}`
                + (standard !== 'wcag' ? `&standard=${encodeURIComponent(standard)}&version=${encodeURIComponent(version)}` : '');
            const res = await fetchImpl(`/api/procedures?${query}`);
            body = res.ok ? await res.json() : null;
        } catch {
            body = null;
        }
        if (!body || !body.available) return null;
        for (const id of missing) cache.set(keyOf(id), body.procedures?.[id] || null);
    }
    const out = {};
    for (const id of wanted) out[id] = cache.get(keyOf(id)) || null;
    return out;
}

/** Forgets what was loaded (for tests). */
export function clearProceduresCache() {
    cache.clear();
    availability = null;
    knownAvailable = false;
}

const isText = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * A criterion's facets, as a person takes them: `forPerson`, those they check
 * (only a person can judge them, or rules decide only part), each once (a
 * facet another's procedure covers is left out); `automatic`, those rules
 * decide in full.
 */
export function splitFacets(procedure) {
    const facets = Array.isArray(procedure?.facets) ? procedure.facets : [];
    const forPerson = facets.filter((f) => f && !f.coveredBy && f.automation !== 'full' && f.procedure && Array.isArray(f.procedure.steps));
    const automatic = facets.filter((f) => f && f.automation === 'full' && isText(f.label));
    return { forPerson, automatic };
}

// A person's answer to a check, as the review keeps it.
export const ANSWERS = [
    ['', 'Not checked'],
    ['pass', 'Passes'],
    ['fail', 'Fails'],
    ['na', "Doesn't apply"],
];

const safeId = (v) => String(v).replace(/[^A-Za-z0-9_-]/g, '-');

/**
 * The result a person gave a check: 'pass', 'fail', 'na', or '' for none.
 * The review keeps each as { result, label }, the check's words with it, so
 * the conformance report can list it without the procedures.
 */
export function resultOf(answers, facetId) {
    const v = answers && answers[facetId];
    const result = typeof v === 'string' ? v : (v && typeof v === 'object' ? v.result : '');
    return ['pass', 'fail', 'na'].includes(result) ? result : '';
}

// The answer's radio buttons, when the facets are drawn to be answered:
// `name` is the group's, unique to the criterion and the facet.
function answerHTML(f, name, answer) {
    const options = ANSWERS.map(([value, label]) => {
        const id = `${name}-${value || 'none'}`;
        const checked = (answer || '') === value ? ' checked' : '';
        return `<span class="how-answer-option"><input type="radio" id="${esc(id)}" name="${esc(name)}" value="${value}" data-facet="${esc(f.id)}"${checked}/>`
            + `<label for="${esc(id)}">${esc(label)}</label></span>`;
    }).join('');
    return `<fieldset class="how-answer"><legend><span class="visually-hidden">${esc(f.label)}: </span>Result</legend>${options}</fieldset>`;
}

function facetHTML(f, { name = null, answer = '' } = {}) {
    const p = f.procedure;
    const steps = p.steps.filter(isText);
    const tools = (Array.isArray(f.tools) ? f.tools : []).map((t) => t && t.label).filter(isText);
    return `<li class="how-facet">`
        + `<p class="how-facet-label"><strong>${esc(f.label)}</strong>${f.automation === 'partial' ? ' <span class="how-facet-note">(automated checks decide part of it)</span>' : ''}</p>`
        + (tools.length ? `<p class="how-facet-tools"><span class="how-term">You need:</span> ${esc(tools.join(', '))}</p>` : '')
        + (steps.length ? `<ol class="how-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '')
        + (isText(p.passWhen) ? `<p class="how-when"><span class="how-term">Passes:</span> ${esc(p.passWhen)}</p>` : '')
        + (isText(p.failWhen) ? `<p class="how-when"><span class="how-term">Fails:</span> ${esc(p.failWhen)}</p>` : '')
        + (name ? answerHTML(f, `${name}-${safeId(f.id)}`, answer) : '')
        + `</li>`;
}

/** "2 of 3 answered", for a criterion's checks and a person's answers. */
export function answeredText(procedure, answers) {
    const { forPerson } = splitFacets(procedure);
    const done = forPerson.filter((f) => resultOf(answers, f.id)).length;
    return done ? `${done} of ${forPerson.length} answered` : '';
}

/**
 * "How to check it by hand", folded: what a person checks for a criterion,
 * step by step, and what automated checks decide in full. With `name`, each
 * check can be answered (Passes, Fails, Doesn't apply), `answers` being those
 * given so far ({ [facet]: 'pass' | 'fail' | 'na' }). '' when the procedure
 * has nothing for a person.
 */
export function buildHowToAssessHTML(procedure, { name = null, answers = null } = {}) {
    const { forPerson, automatic } = splitFacets(procedure);
    if (!forPerson.length) return '';
    const n = forPerson.length;
    const answered = name ? answeredText(procedure, answers) : '';
    return `<details class="how-assess">`
        + `<summary>How to check it by hand (${n} ${n === 1 ? 'check' : 'checks'})`
        + (name ? `<span class="how-answered" data-how-answered>${answered ? ` · ${esc(answered)}` : ''}</span>` : '')
        + `</summary>`
        + `<ol class="how-facets">${forPerson.map((f) => facetHTML(f, { name, answer: resultOf(answers, f.id) })).join('')}</ol>`
        + (automatic.length
            ? `<p class="how-automatic"><span class="how-term">Automated checks decide:</span></p><ul class="how-automatic-list">${automatic.map((f) => `<li>${esc(f.label)}</li>`).join('')}</ul>`
            : '')
        + `</details>`;
}

/**
 * What a person's answers suggest for a criterion, once every check is
 * answered: { conformance, remarks }, or null. A failure the scans found
 * counts as a check that fails. Every check passing (or not applying, with
 * at least one passing) and no failure from the scans: Supports. Failures and
 * passes: Partially Supports. Only failures: Does Not Support. Nothing that
 * applies, and no failure: Not Applicable. The person decides; this only
 * saves them the arithmetic and the typing.
 */
export function suggestFromAnswers(procedure, answers, draft = null) {
    const { forPerson } = splitFacets(procedure);
    if (!forPerson.length || !answers) return null;
    if (!forPerson.every((f) => resultOf(answers, f.id))) return null;
    const by = (value) => forPerson.filter((f) => resultOf(answers, f.id) === value);
    const passes = by('pass');
    const fails = by('fail');
    const na = by('na');
    const scansFailed = draft && draft.conformance === 'doesNotSupport';
    let conformance;
    if (!fails.length && !scansFailed) conformance = passes.length ? 'supports' : 'notApplicable';
    else conformance = passes.length ? 'partiallySupports' : 'doesNotSupport';
    // The checks themselves are listed beside the remarks in the conformance
    // report, so the remarks only count them.
    const counted = [[fails, 'fails', 'fail'], [passes, 'passes', 'pass'], [na, "doesn't apply", "don't apply"]]
        .filter(([list]) => list.length)
        .map(([list, one, many]) => `${list.length} ${list.length === 1 ? one : many}`);
    const parts = [];
    if (scansFailed && isText(draft.remarks)) parts.push(draft.remarks.trim());
    parts.push(forPerson.length === 1
        ? `Checked by hand: it ${counted[0].replace(/^1 /, '')}.`
        : `Checked by hand, ${forPerson.length} checks: ${counted.join(', ')}.`);
    return { conformance, remarks: parts.join(' ') };
}

/** Whether the server's core has procedures, asked once. */
let availability = null;
let knownAvailable = false;
export function proceduresAvailable({ fetchImpl = globalThis.fetch } = {}) {
    if (!availability) {
        availability = loadProcedures(['1.1.1'], 'en', { fetchImpl })
            .then((p) => { knownAvailable = !!p; return knownAvailable; })
            .catch(() => false);
    }
    return availability;
}

/** True once proceduresAvailable() has found them. */
export function proceduresKnownAvailable() {
    return knownAvailable;
}

/**
 * The standards of the server's packs, registered with the conformance
 * report's model (shared/conformance-report.js) so it builds their rows from
 * their packs: EN 301 549's own requirements, and the tables of any other
 * standard a report's scans checked against. Asked once; resolves to the
 * standards, or [] where the server has none (or no listings, with a core
 * without test procedures).
 */
let standardsLoad = null;
export function loadStandards({ fetchImpl = globalThis.fetch, model = globalThis.A11Y_CONFORMANCE_REPORT } = {}) {
    if (!standardsLoad) {
        standardsLoad = (async () => {
            let body = null;
            try {
                const res = await fetchImpl('/api/standards');
                body = res.ok ? await res.json() : null;
            } catch {
                body = null;
            }
            const standards = Array.isArray(body?.standards) ? body.standards : [];
            // Their profiles, as scan targets the app names (shared/conformance-targets.js).
            globalThis.A11Y_CONFORMANCE_TARGETS?.registerStandardProfiles?.(standards);
            for (const std of standards) {
                const profiles = (std.profiles || []).filter((p) => p && p.version).map((p) => [p.version, p.id]);
                for (const listing of Object.values(std.listings || {})) {
                    model?.registerStandard?.(listing, { profiles: profiles.filter(([v]) => v === listing.version).map(([, id]) => id) });
                }
            }
            return standards;
        })();
    }
    return standardsLoad;
}

/** Forgets the standards loaded (for tests). */
export function clearStandardsLoad() {
    standardsLoad = null;
}
