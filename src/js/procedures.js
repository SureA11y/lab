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
 * The procedures of `ids` (WCAG criteria), in `locale`: { [id]: procedure },
 * or null when the server's core has none. Asked once per criterion and
 * locale.
 */
export async function loadProcedures(ids, locale = 'en', { fetchImpl = globalThis.fetch } = {}) {
    const wanted = [...new Set((ids || []).map(String))];
    const missing = wanted.filter((id) => !cache.has(`${locale}|${id}`));
    if (missing.length) {
        let body = null;
        try {
            const res = await fetchImpl(`/api/procedures?ids=${encodeURIComponent(missing.join(','))}&locale=${encodeURIComponent(locale)}`);
            body = res.ok ? await res.json() : null;
        } catch {
            body = null;
        }
        if (!body || !body.available) return null;
        for (const id of missing) cache.set(`${locale}|${id}`, body.procedures?.[id] || null);
    }
    const out = {};
    for (const id of wanted) out[id] = cache.get(`${locale}|${id}`) || null;
    return out;
}

/** Forgets what was loaded (for tests). */
export function clearProceduresCache() {
    cache.clear();
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

function facetHTML(f) {
    const p = f.procedure;
    const steps = p.steps.filter(isText);
    const tools = (Array.isArray(f.tools) ? f.tools : []).map((t) => t && t.label).filter(isText);
    return `<li class="how-facet">`
        + `<p class="how-facet-label"><strong>${esc(f.label)}</strong>${f.automation === 'partial' ? ' <span class="how-facet-note">(automated checks decide part of it)</span>' : ''}</p>`
        + (tools.length ? `<p class="how-facet-tools"><span class="how-term">You need:</span> ${esc(tools.join(', '))}</p>` : '')
        + (steps.length ? `<ol class="how-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '')
        + (isText(p.passWhen) ? `<p class="how-when"><span class="how-term">Passes:</span> ${esc(p.passWhen)}</p>` : '')
        + (isText(p.failWhen) ? `<p class="how-when"><span class="how-term">Fails:</span> ${esc(p.failWhen)}</p>` : '')
        + `</li>`;
}

/**
 * "How to check it by hand", folded: what a person checks for a criterion,
 * step by step, and what automated checks decide in full. '' when the
 * procedure has nothing for a person.
 */
export function buildHowToAssessHTML(procedure) {
    const { forPerson, automatic } = splitFacets(procedure);
    if (!forPerson.length) return '';
    const n = forPerson.length;
    return `<details class="how-assess">`
        + `<summary>How to check it by hand (${n} ${n === 1 ? 'check' : 'checks'})</summary>`
        + `<ol class="how-facets">${forPerson.map(facetHTML).join('')}</ol>`
        + (automatic.length
            ? `<p class="how-automatic"><span class="how-term">Automated checks decide:</span></p><ul class="how-automatic-list">${automatic.map((f) => `<li>${esc(f.label)}</li>`).join('')}</ul>`
            : '')
        + `</details>`;
}
