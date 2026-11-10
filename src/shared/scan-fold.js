'use strict';

// Folding several scans into one (docs/design/merged-scan-design.md §4,
// docs/design/scan-grouping-design.md §9.3): their findings, their outcome
// counts, surea11y's own result and the view the score reads, as one scan's.
//
// Two folds share it. A Merged scan step folds one view's scans under several
// conditions, its contexts, at the end of a run (src/server-side/
// merged-scan.js, which keeps what only the runner needs). A merged group
// folds the scans of several pages made from one template, in the report
// view. They differ only in what an occurrence says it is on and whether its
// page is part of what makes it one failure (DIMENSIONS).
//
// Pure and DOM-free, with no dependencies.
//
// Browser: available as globalThis.A11Y_SCAN_FOLD.
// Node:    module.exports.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.A11Y_SCAN_FOLD = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

    const LISTED_OUTCOMES = new Set(['fail', 'cantTell']);

    function stableStringify(value) {
        if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
        if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
        return '{' + Object.keys(value).sort()
            .filter((k) => value[k] !== undefined)
            .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    }

    /**
     * What is folded, and what an occurrence of the fold says it is on.
     * - contexts: the scans of one view under several conditions (a Merged scan
     *   step). An occurrence lists the contexts it is in; the page is part of
     *   what makes two occurrences one, as it is one page.
     * - scans: scans of different pages made from one template (a merged group,
     *   docs/design/scan-grouping-design.md §9.3). An occurrence lists the scans
     *   it is in, by key (their ids: two scans can be of one page); the page is
     *   left out of what makes two occurrences one, or no two pages would join,
     *   and the contexts a member scan already folded are part of it instead.
     */
    const DIMENSIONS = Object.freeze({
        contexts: Object.freeze({
            id: 'contexts', list: 'contexts', total: 'contextsTotal', targets: 'contextTargets',
            picture: 'context', samePage: true,
        }),
        scans: Object.freeze({
            id: 'scans', list: 'scans', total: 'scansTotal', targets: 'scanTargets',
            picture: 'scan', samePage: false,
        }),
    });

    function dimensionOf(value) {
        if (value && typeof value === 'object' && DIMENSIONS[value.id] === value) return value;
        const d = DIMENSIONS[value || 'contexts'];
        if (!d) throw new TypeError(`Unknown fold dimension: ${value}`);
        return d;
    }

    // What, besides the element and its result, an occurrence's identity holds:
    // its page when the fold is of one page, the contexts it was already in when
    // it is of several.
    function placeOf(o, dim) {
        return dim.samePage
            ? { pageUrl: o.pageUrl || null }
            : { contexts: Array.isArray(o.contexts) ? o.contexts : null };
    }

    /**
     * What makes two occurrences the same result: the same element on the same
     * page, failing (or left undecided) for the same reasons - its summary, hint,
     * uncertainty, the atomic check behind it and the values the rule measured.
     * The markup is not part of it: an element whose HTML differs by context
     * (a theme class) but fails identically is one failure. Folding the scans of
     * several pages, the page is not part of it (DIMENSIONS).
     */
    function occurrenceIdentity(occ, dimension) {
        const o = occ && typeof occ === 'object' ? occ : {};
        return stableStringify({
            ...placeOf(o, dimensionOf(dimension)),
            target: Array.isArray(o.target) ? o.target : [],
            shadowHostSelectors: Array.isArray(o.shadowHostSelectors) ? o.shadowHostSelectors : null,
            outcome: o.occurrenceOutcome || o.outcome || null,
            failureSummary: o.failureSummary || o.summary || null,
            hint: o.hint || null,
            uncertainty: o.uncertainty || null,
            details: o.details || null,
            atomicCheckId: o.atomicCheckId || null,
            sourceAtomicRules: Array.isArray(o.sourceAtomicRules) ? o.sourceAtomicRules : null,
            // What each check of a rollup said about the element, when several did.
            checks: Array.isArray(o.checks) ? o.checks : null,
        });
    }

    // A framework numbers the ids it makes as it goes: the options of a list
    // opened three times in a run are mat-option-0.., mat-option-142.. and
    // mat-option-284.., so the same element of two contexts has another id and
    // selector, and does not match. Once no exact match is left, an occurrence of
    // another context is so taken for the same element when everything but its
    // ids is the same: its page, outcome, checks and what they said, and its
    // markup. One to one, in the order the contexts list them: an element is
    // never joined with two of another context, nor with one of its own. The
    // attributes are those src/js/occurrence-elements.js leaves out to count
    // elements.
    const ID_ATTRIBUTES = [
        'id', 'for', 'headers', 'form', 'list',
        'aria-activedescendant', 'aria-controls', 'aria-describedby', 'aria-details',
        'aria-errormessage', 'aria-flowto', 'aria-labelledby', 'aria-owns',
    ];
    const ID_ATTRIBUTE_RE = new RegExp(
        `\\s(${ID_ATTRIBUTES.join('|')})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`,
        'gi'
    );
    const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    /**
     * What an occurrence is once its ids are left out: `fields` with the ids its
     * markup holds or points at replaced, and that markup without them. Null
     * without markup, where there is nothing to tell the element by.
     */
    function withoutIds(html, fields) {
        if (typeof html !== 'string' || !html.trim()) return null;
        const ids = new Set();
        const markup = html.replace(ID_ATTRIBUTE_RE, (_, _name, dq, sq, bare) => {
            for (const id of String(dq ?? sq ?? bare ?? '').split(/\s+/)) if (id) ids.add(id);
            return '';
        }).replace(/\s+/g, ' ').trim();
        let text = stableStringify(fields);
        // Longest first, so mat-option-28 does not eat into mat-option-284.
        for (const id of [...ids].sort((a, b) => b.length - a.length)) {
            text = text.replace(new RegExp(`(?<![\\w-])${escapeRe(id)}(?![\\w-])`, 'g'), '\u0000id');
        }
        return `${markup}\n${text}`;
    }

    function occurrenceWithoutIds(occ, dimension) {
        const o = occ && typeof occ === 'object' ? occ : {};
        return withoutIds(o.html, {
            ...placeOf(o, dimensionOf(dimension)),
            shadowHostSelectors: Array.isArray(o.shadowHostSelectors) ? o.shadowHostSelectors : null,
            outcome: o.occurrenceOutcome || o.outcome || null,
            failureSummary: o.failureSummary || o.summary || null,
            hint: o.hint || null,
            uncertainty: o.uncertainty || null,
            details: o.details || null,
            atomicCheckId: o.atomicCheckId || null,
            sourceAtomicRules: Array.isArray(o.sourceAtomicRules) ? o.sourceAtomicRules : null,
            checks: Array.isArray(o.checks) ? o.checks : null,
        });
    }

    const sameTarget = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

    /**
     * The first occurrence of `candidates` that is the element `occ` is, by
     * withoutIds, in another context: with another selector, and none of
     * `contexts` among its own.
     */
    function sameElementOf(candidates, occ, keys, targetOf, list = 'contexts') {
        return (candidates || []).find((c) => !sameTarget(targetOf(c), targetOf(occ))
            && !keys.some((key) => (c[list] || []).includes(key))) || null;
    }

    function outcomeCounts(findings) {
        const out = { fail: 0, cantTell: 0, pass: 0, notApplicable: 0 };
        for (const f of findings) {
            if (f && Object.prototype.hasOwnProperty.call(out, f.outcome)) out[f.outcome] += 1;
        }
        return out;
    }

    function contributorsOf(f) {
        const rollup = f && f.evidence && f.evidence.rollup;
        return rollup && Array.isArray(rollup.contributors) ? rollup.contributors : null;
    }

    function withContributors(f, contributors) {
        return { ...f, evidence: { ...f.evidence, rollup: { ...f.evidence.rollup, contributors } } };
    }

    // The picture of an occurrence's element, naming the context it was taken
    // in, or null when it has none: one occurrence of several contexts keeps
    // one picture, and the report says which context it shows.
    function pictureOf(occ, context, field = 'context') {
        const shot = occ && occ.elementScreenshot;
        if (!shot || typeof shot !== 'object' || typeof shot.url !== 'string') return null;
        return shot[field] || !context ? shot : { ...shot, [field]: context };
    }

    // Its pictures in the state its finding was made in (the text spacing),
    // naming the context as pictureOf() does, or null: they go with the
    // picture of the same context, so the two show the same page.
    function statePicturesOf(occ, context, field = 'context') {
        const list = occ && occ.elementStateScreenshots;
        if (!Array.isArray(list) || !list.length) return null;
        return list.map((shot) => (shot && typeof shot === 'object' && typeof shot.url === 'string' && !shot[field] && context
            ? { ...shot, [field]: context }
            : shot));
    }

    // The element `occ` is, in the context it comes from, when it has another
    // selector there: in `contextTargets`, by context.
    function noteContextTarget(seen, occ, contexts, field = 'contextTargets') {
        const targets = { ...(seen[field] || {}) };
        for (const c of contexts) if (!(c in targets)) targets[c] = Array.isArray(occ.target) ? [...occ.target] : [];
        seen[field] = targets;
    }

    function rememberWithoutIds(entry, copy) {
        const key = occurrenceWithoutIds(copy, entry.dim);
        if (key === null) return;
        if (!entry.loose.has(key)) entry.loose.set(key, []);
        entry.loose.get(key).push(copy);
    }

    /**
     * Adds a context's occurrence to a merged finding. `loosely`: no exact match
     * being left, it may join the same element of another context by
     * occurrenceWithoutIds; it returns false when it found none, and adds nothing.
     */
    function addOccurrence(entry, occ, context, listed, contextsTotal, loosely = false) {
        const dim = entry.dim;
        const key = occurrenceIdentity(occ, dim);
        let seen = entry.occ.get(key);
        if (!seen && loosely) {
            const contexts = occ[dim.list] || [context];
            seen = sameElementOf(entry.loose.get(occurrenceWithoutIds(occ, dim)), occ, contexts, (o) => o.target, dim.list);
            if (!seen) return false;
            noteContextTarget(seen, occ, contexts, dim.targets);
        }
        if (seen) {
            if (listed) {
                for (const c of occ[dim.list] || [context]) if (!seen[dim.list].includes(c)) seen[dim.list].push(c);
                // A picture from a later context, where the first had none.
                const picture = !pictureOf(seen, null) ? pictureOf(occ, context, dim.picture) : null;
                if (picture) {
                    seen.elementScreenshot = picture;
                    const inState = statePicturesOf(occ, context, dim.picture);
                    if (inState) seen.elementStateScreenshots = inState;
                    else delete seen.elementStateScreenshots;
                }
            }
            return true;
        }
        const copy = listed
            ? { ...occ, [dim.list]: occ[dim.list] ? [...occ[dim.list]] : [context], [dim.total]: contextsTotal }
            : { ...occ };
        const picture = listed ? pictureOf(occ, context, dim.picture) : null;
        if (picture) copy.elementScreenshot = picture;
        const inState = listed ? statePicturesOf(occ, context, dim.picture) : null;
        if (inState) copy.elementStateScreenshots = inState;
        entry.occ.set(key, copy);
        if (listed) rememberWithoutIds(entry, copy);
        entry.finding.occurrences.push(copy);
        return true;
    }

    /**
     * Findings of several contexts, merged by finding uid (engine, outcome, rule).
     * Occurrences of fail and can't-tell findings carry `contexts` (the names of
     * the contexts they occur in) and `contextsTotal`; others are only unioned.
     *
     * A check then counts once, with the worst outcome any context gave it, as it
     * does in one scan: a rule's findings are split by outcome, each holding the
     * checks (rollup contributors) that came out that way, and a check passing
     * in one context and failing in another would otherwise sit in both. The
     * worse finding keeps it; the elements the better one left undecided move
     * into it, keeping their own outcome, and its passing elements are dropped.
     * A finding left with no checks goes. Findings without contributors are
     * treated the same way, a rule standing for its one check, unless a context
     * reported that rule with more than one outcome (an engine listing a rule's
     * passing and failing elements apart), where they are only unioned.
     */
    function mergeFindingLists(parts, contextsTotal, dimension) {
        const dim = dimensionOf(dimension);
        const byUid = new Map();
        const order = [];
        const ruleKey = (f) => `${f.engineId || ''}|${f.ruleId || f.id}`;
        const splitRules = new Set();

        for (const { findings, context } of parts) {
            const outcomesByRule = new Map();
            for (const f of Array.isArray(findings) ? findings : []) {
                if (!f || typeof f !== 'object') continue;
                if (!contributorsOf(f)) {
                    const seen = outcomesByRule.get(ruleKey(f)) || new Set();
                    seen.add(f.outcome);
                    outcomesByRule.set(ruleKey(f), seen);
                }
                const uid = f.uid || `${f.engineId || ''}:${f.outcome}:${f.ruleId || f.id}`;
                let entry = byUid.get(uid);
                if (!entry) {
                    entry = { finding: { ...f, occurrences: [] }, occ: new Map(), loose: new Map(), dim };
                    byUid.set(uid, entry);
                    order.push(uid);
                } else if (contributorsOf(f) && contributorsOf(entry.finding)) {
                    const known = new Set(contributorsOf(entry.finding).map((c) => c && c.testId));
                    const more = contributorsOf(f).filter((c) => c && !known.has(c.testId));
                    if (more.length) entry.finding = withContributors(entry.finding, [...contributorsOf(entry.finding), ...more]);
                }
                const listed = LISTED_OUTCOMES.has(f.outcome);
                // Exact matches first, so none is taken by an element that only
                // looks like it; then the rest, each the same element of another
                // context if there is one, else an occurrence of its own.
                const rest = [];
                for (const occ of Array.isArray(f.occurrences) ? f.occurrences : []) {
                    if (!listed || entry.occ.has(occurrenceIdentity(occ, dim))) addOccurrence(entry, occ, context, listed, contextsTotal);
                    else rest.push(occ);
                }
                for (const occ of rest) {
                    if (!addOccurrence(entry, occ, context, listed, contextsTotal, true)) addOccurrence(entry, occ, context, listed, contextsTotal);
                }
            }
            for (const [key, outcomes] of outcomesByRule) if (outcomes.size > 1) splitRules.add(key);
        }

        const entries = order.map((uid) => byUid.get(uid));

        // Each check's worst outcome: by rule and contributor for a rollup, by
        // rule for a finding that stands for its one check.
        const checkKey = (f, testId) => `${ruleKey(f)}|${testId == null ? '' : testId}`;
        const worst = new Map();
        const note = (key, outcome) => {
            if (!worst.has(key) || coreRank(outcome) < coreRank(worst.get(key))) worst.set(key, outcome);
        };
        for (const { finding: f } of entries) {
            const contributors = contributorsOf(f);
            if (contributors) {
                for (const c of contributors) if (c) note(checkKey(f, c.testId), c.outcome || f.outcome);
            } else if (!splitRules.has(ruleKey(f))) {
                note(checkKey(f, null), f.outcome);
            }
        }

        // Where a check that lost ends up: the finding that kept it.
        const keeperOf = (f, testId) => entries.find(({ finding: k }) => {
            if (ruleKey(k) !== ruleKey(f) || k.outcome !== worst.get(checkKey(f, testId))) return false;
            const contributors = contributorsOf(k);
            return testId == null ? !contributors : !!contributors && contributors.some((c) => c && c.testId === testId);
        });

        const dropped = new Set();
        for (const entry of entries) {
            const f = entry.finding;
            const contributors = contributorsOf(f);
            let moved = [];
            if (contributors) {
                const keep = contributors.filter((c) => !c || (c.outcome || f.outcome) === worst.get(checkKey(f, c.testId)));
                moved = contributors.filter((c) => !keep.includes(c)).map((c) => c.testId);
                if (!moved.length) continue;
                if (keep.length) {
                    entry.finding = withContributors(f, keep);
                    // A partly checked criterion: the checks another context ran
                    // are no longer among those not selected.
                    if (f.partlyChecked && typeof f.partlyChecked === 'object') {
                        entry.finding.partlyChecked = { ...f.partlyChecked, notSelected: keep.filter((c) => c && c.notSelected).length };
                    }
                } else {
                    dropped.add(entry);
                }
            } else if (!splitRules.has(ruleKey(f)) && f.outcome !== worst.get(checkKey(f, null))) {
                moved = [null];
                dropped.add(entry);
            } else {
                continue;
            }

            const movedSet = new Set(moved);
            const stays = [];
            for (const occ of entry.finding.occurrences) {
                const testId = contributors ? (occ.atomicCheckId != null ? occ.atomicCheckId : null) : null;
                const goes = dropped.has(entry) || (testId != null && movedSet.has(testId));
                if (!goes) { stays.push(occ); continue; }
                const outcome = occ.occurrenceOutcome || occ.outcome || f.outcome;
                if (!LISTED_OUTCOMES.has(outcome)) continue;
                const keeper = keeperOf(f, contributors ? (testId != null ? testId : moved[0]) : null);
                if (keeper && keeper !== entry) {
                    addOccurrence(keeper, { ...occ, occurrenceOutcome: outcome }, null, true, contextsTotal);
                }
            }
            entry.finding.occurrences = stays;
            entry.occ = new Map(stays.map((o) => [occurrenceIdentity(o, dim), o]));
            entry.loose = new Map();
            for (const o of stays) if (LISTED_OUTCOMES.has(o.occurrenceOutcome || o.outcome || f.outcome)) rememberWithoutIds(entry, o);
        }

        return entries.filter((e) => !dropped.has(e)).map((e) => e.finding);
    }

    /**
     * The notices or margins of several contexts: one entry per distinct item,
     * with the contexts it came from (their keys, and their names to show), in
     * the order first seen. An identical note in every context is the scan's
     * note, as it would be with one context.
     */
    function joinByContext(list, field) {
        const out = [];
        const index = new Map();
        for (const { canonical, context, name } of list) {
            const shown = name == null ? context : name;
            for (const item of Array.isArray(canonical[field]) ? canonical[field] : []) {
                const key = stableStringify(item);
                const known = index.get(key);
                if (known) {
                    if (!known.contexts.includes(context)) {
                        known.contexts.push(context);
                        known.names.push(shown);
                    }
                    continue;
                }
                const entry = { item, contexts: [context], names: [shown] };
                index.set(key, entry);
                out.push(entry);
            }
        }
        return out;
    }

    /**
     * The outcome counts, as a scan of one context counts them. surea11y counts
     * its checks, not the findings it lists, and hands each check's outcome along
     * (summary.checks, not enumerable); a check then counts once, with the worst
     * outcome any context gave it. Other engines count their findings, and so
     * does a merged scan whose contexts did not all hand their checks along.
     */
    function mergedSummary(list, findings, bestPractices) {
        const all = list.map((p) => p.canonical.summary && p.canonical.summary.checks);
        if (!all.every(Array.isArray)) {
            return { outcomes: outcomeCounts(findings), bestPractices: outcomeCounts(bestPractices) };
        }
        const worst = new Map();
        for (const checks of all) {
            for (const c of checks) {
                if (!c) continue;
                const key = `${c.bestPractice ? 'bp' : 'req'}|${c.ruleId}`;
                const known = worst.get(key);
                if (!known || coreRank(c.outcome) < coreRank(known.outcome)) worst.set(key, c);
            }
        }
        const merged = [...worst.values()];
        return {
            outcomes: outcomeCounts(merged.filter((c) => !c.bestPractice)),
            bestPractices: outcomeCounts(merged.filter((c) => c.bestPractice)),
        };
    }

    /**
     * The canonicals of a merged scan's contexts as one: page, scope and run
     * options from the first; findings and best practices merged; notices and
     * margins kept with their context; summary and findingsByKind rebuilt.
     *
     * `parts` are [{ canonical, context, name }]: `context` the key an occurrence
     * lists, `name` how a notice names it (the key, when not given).
     * `options.dimension`: 'contexts' (the default), or 'scans' to fold the scans
     * of several pages (DIMENSIONS), whose occurrences then list `scans`.
     */
    function mergeCanonicals(parts, contextsTotal, options = {}) {
        const dim = dimensionOf(options && options.dimension);
        const list = (Array.isArray(parts) ? parts : []).filter((p) => p && p.canonical && typeof p.canonical === 'object');
        if (!list.length) return null;
        const base = list[0].canonical;

        const findings = mergeFindingLists(list.map((p) => ({ findings: p.canonical.findings, context: p.context })), contextsTotal, dim);
        const bestPractices = mergeFindingLists(list.map((p) => ({ findings: p.canonical.bestPractices, context: p.context })), contextsTotal, dim);

        const engines = [];
        const seenEngines = new Set();
        for (const { canonical } of list) {
            for (const e of Array.isArray(canonical.engines) ? canonical.engines : []) {
                const id = e && e.id ? String(e.id) : '';
                if (!id || seenEngines.has(id)) continue;
                seenEngines.add(id);
                engines.push(e);
            }
        }

        return {
            ...base,
            engines: engines.length ? engines : base.engines,
            findings,
            bestPractices,
            notices: joinByContext(list, 'notices').map(({ item, contexts, names }) => (
                contexts.length === list.length
                    ? { ...item, [dim.list]: contexts }
                    : { ...item, [dim.list]: contexts, message: `${names.join(', ')}: ${item && item.message ? item.message : ''}` }
            )),
            margins: joinByContext(list, 'margins').map(({ item, contexts }) => ({ ...item, [dim.list]: contexts })),
            summary: mergedSummary(list, findings, bestPractices),
            findingsByKind: {
                composite: findings.filter((f) => f && f.meta && f.meta.atomic === false),
                atomic: findings.filter((f) => !f || !f.meta || f.meta.atomic !== false),
            },
        };
    }

    // surea11y's raw result ---------------------------------------------------
    //
    // The CLI's SARIF, JUnit and EARL exports and its baseline read surea11y's own
    // result, not the canonical findings, so a merged scan needs that merged too.
    // Each rule (checksResults, and the composite rollups in rulesResults) is
    // merged by id: it takes the worst outcome any context gave it, and its
    // failing and can't-tell occurrences are joined as the canonical ones are -
    // the same result in several contexts once, a different result once per
    // result. Each says in which contexts it occurs, in `contexts` and at the end
    // of its hint, which is what the exports show beside the summary.

    const CORE_OUTCOME_RANK = ['fail', 'cantTell', 'pass', 'notApplicable'];

    function coreRank(outcome) {
        const i = CORE_OUTCOME_RANK.indexOf(outcome);
        return i < 0 ? CORE_OUTCOME_RANK.length : i;
    }

    // As core's reporters read it: the occurrence's own outcome when it has one,
    // else its rule's, and only fail and can't-tell count.
    function coreOccurrenceOutcome(check, occ) {
        for (const value of [occ && occ.occurrenceOutcome, occ && occ.outcome, check && check.outcome]) {
            if (LISTED_OUTCOMES.has(value)) return value;
        }
        return null;
    }

    function coreOccurrenceIdentity(occ, outcome) {
        const o = occ && typeof occ === 'object' ? occ : {};
        return stableStringify({
            selector: o.selector || null,
            outcome: outcome || null,
            summary: o.summary || null,
            hint: o.hint || null,
            details: (o.data && o.data.details) || null,
        });
    }

    function coreOccurrenceWithoutIds(occ, outcome) {
        const o = occ && typeof occ === 'object' ? occ : {};
        return withoutIds(o.html, {
            outcome: outcome || null,
            summary: o.summary || null,
            hint: o.hint || null,
            details: (o.data && o.data.details) || null,
        });
    }

    function contextsText(contexts, total) {
        return contexts.length === total && total > 1
            ? `In all ${total} contexts.`
            : `In: ${contexts.join(', ')}.`;
    }

    /**
     * A criterion's rollup across contexts, worked out as core works it out for one
     * scan, from its checks: each check (contributor) with the worst outcome a
     * context gave it, a check that did not run (`missing`) losing to any that
     * ran. Then fail if one failed; else cantTell if one was undecided, or if one
     * ran in no context (not selected, when that is why); notApplicable if none
     * applied; else pass. So a context that ran only some of the criterion's
     * checks does not make it partial where another context ran them all.
     */
    function mergeCoreRollup(base, seen) {
        const byTest = new Map();
        for (const { check } of seen) {
            const contributors = (check.data && check.data.details && check.data.details.contributors) || [];
            for (const c of contributors) {
                if (!c || !c.testId) continue;
                const known = byTest.get(c.testId);
                if (!known || coreRank(c.outcome) < coreRank(known.outcome)) {
                    byTest.set(c.testId, c);
                } else if (known.outcome === 'missing' && c.outcome === 'missing' && known.notSelected && !c.notSelected) {
                    // Missing for another reason in one context: not only unselected.
                    byTest.set(c.testId, c);
                }
            }
        }
        const contributors = [...byTest.values()];
        const count = (o) => contributors.filter((c) => c.outcome === o).length;
        const metrics = {
            failCount: count('fail'),
            cantTellCount: count('cantTell'),
            notApplicableCount: count('notApplicable'),
            passCount: count('pass'),
            missingCount: count('missing'),
        };
        let outcome = 'pass';
        let reasonCode = 'composite.rollup.pass.otherwise';
        if (metrics.failCount) {
            outcome = 'fail';
            reasonCode = 'composite.rollup.fail.anyFail';
        } else if (metrics.cantTellCount) {
            outcome = 'cantTell';
            reasonCode = 'composite.rollup.cantTell.anyCantTell';
        } else if (metrics.missingCount) {
            outcome = 'cantTell';
            reasonCode = contributors.some((c) => c.outcome === 'missing' && c.notSelected)
                ? 'composite.rollup.cantTell.notSelectedChild'
                : 'composite.rollup.cantTell.missingChild';
        } else if (contributors.length && metrics.notApplicableCount === contributors.length) {
            outcome = 'notApplicable';
            reasonCode = 'composite.rollup.notApplicable.allInapplicable';
        }
        const details = (base.data && base.data.details) || {};
        return {
            ...base,
            outcome,
            data: {
                ...base.data,
                details: {
                    ...details,
                    reasonCode,
                    checksIds: contributors.map((c) => c.testId),
                    contributors,
                    metrics: { ...(details.metrics || {}), ...metrics },
                },
            },
            ...(base.i18nParams ? { i18nParams: { ...base.i18nParams, reasonCode } } : {}),
        };
    }

    function mergeCoreChecks(parts, field, total) {
        const order = [];
        const byId = new Map();
        for (const { result, context } of parts) {
            for (const check of Array.isArray(result[field]) ? result[field] : []) {
                if (!check || !check.ruleId) continue;
                if (!byId.has(check.ruleId)) {
                    byId.set(check.ruleId, []);
                    order.push(check.ruleId);
                }
                byId.get(check.ruleId).push({ check, context });
            }
        }

        return order.map((ruleId) => {
            const seen = byId.get(ruleId);
            // The worst outcome, the first context to give it breaking ties: its
            // entry is the base, so a rule error or a rollup's data comes with it.
            const base = seen.reduce((a, b) => (coreRank(b.check.outcome) < coreRank(a.check.outcome) ? b : a)).check;
            if (field === 'rulesResults' && seen.some(({ check }) => Array.isArray(check.data && check.data.details && check.data.details.contributors))) {
                return mergeCoreRollup(base, seen);
            }
            const listed = LISTED_OUTCOMES.has(base.outcome);
            const occurrences = [];
            const index = new Map();
            const loose = new Map();
            const add = (occ, outcome, key, context) => {
                const copy = listed ? { ...occ, occurrenceOutcome: outcome, contexts: [context] } : { ...occ };
                index.set(key, copy);
                occurrences.push(copy);
                const without = listed ? coreOccurrenceWithoutIds(occ, outcome) : null;
                if (without !== null) {
                    if (!loose.has(without)) loose.set(without, []);
                    loose.get(without).push(copy);
                }
            };

            for (const { check, context } of seen) {
                // As mergeFindingLists does: exact matches first, then the same
                // element of another context, by its markup without ids.
                const rest = [];
                for (const occ of Array.isArray(check.occurrences) ? check.occurrences : []) {
                    if (!occ) continue;
                    const outcome = listed ? coreOccurrenceOutcome(check, occ) : null;
                    // A rule that fails in one context keeps only what failed or
                    // was left undecided: a passing context's occurrences would
                    // otherwise be read as failures of the merged rule.
                    if (listed && !outcome) continue;
                    const key = coreOccurrenceIdentity(occ, outcome);
                    const known = index.get(key);
                    if (known) {
                        if (listed && !known.contexts.includes(context)) known.contexts.push(context);
                        continue;
                    }
                    if (listed) rest.push({ occ, outcome, key });
                    else add(occ, outcome, key, context);
                }
                for (const { occ, outcome, key } of rest) {
                    const same = sameElementOf(loose.get(coreOccurrenceWithoutIds(occ, outcome)), occ, [context], (o) => o.selector);
                    if (!same) { add(occ, outcome, key, context); continue; }
                    same.contexts.push(context);
                    same.contextSelectors = { ...(same.contextSelectors || {}), [context]: occ.selector || null };
                }
            }

            if (listed) {
                for (const occ of occurrences) {
                    const where = contextsText(occ.contexts, total);
                    occ.hint = typeof occ.hint === 'string' && occ.hint.trim() ? `${occ.hint.trim()} ${where}` : where;
                }
            }
            return { ...base, occurrences };
        });
    }

    /**
     * The surea11y results of a merged scan's contexts as one: page, engine and
     * options from the first, every rule merged by id. Null when no context kept
     * one (the run was not asked for exports, or surea11y did not run).
     */
    function mergeCoreResults(parts) {
        const list = (Array.isArray(parts) ? parts : [])
            .filter((p) => p && p.result && Array.isArray(p.result.checksResults));
        if (!list.length) return null;
        const total = list.length;
        return {
            ...list[0].result,
            checksResults: mergeCoreChecks(list, 'checksResults', total),
            rulesResults: mergeCoreChecks(list, 'rulesResults', total),
        };
    }

    /**
     * The merged findings as the score reads them: each rule's elements once. An
     * element failing differently in two contexts is two failures in the lists,
     * but one failing element on the page, so a view checked under more
     * conditions does not score worse for that alone.
     */
    function scoringView(canonical) {
        const elementKey = (o) => stableStringify({
            pageUrl: (o && o.pageUrl) || null,
            target: Array.isArray(o && o.target) ? o.target : [],
            shadowHostSelectors: Array.isArray(o && o.shadowHostSelectors) ? o.shadowHostSelectors : null,
        });
        return {
            ...canonical,
            findings: canonical.findings.map((f) => {
                const seen = new Set();
                const occurrences = (Array.isArray(f.occurrences) ? f.occurrences : []).filter((o) => {
                    const key = elementKey(o);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                return { ...f, occurrences };
            }),
        };
    }

    /**
     * The profiles a merged scan's contexts all checked, when they checked
     * several and the same ones: its score is then its worst profile's
     * (a11y-summary.js). [] otherwise, which scores the merged findings as one.
     */
    function sharedScanProfiles(entries) {
        const idsOf = (e) => (Array.isArray(e && e.profiles) ? e.profiles : []).map((p) => String((p && (p.id || p.label)) || p || '')).filter(Boolean).sort();
        const first = idsOf(entries[0]);
        if (first.length < 2) return [];
        return entries.every((e) => idsOf(e).join('|') === first.join('|')) ? first : [];
    }

    return {
        DIMENSIONS,
        LISTED_OUTCOMES,
        stableStringify,
        occurrenceIdentity,
        occurrenceWithoutIds,
        outcomeCounts,
        coreRank,
        mergeFindingLists,
        mergeCanonicals,
        mergeCoreResults,
        scoringView,
        sharedScanProfiles,
    };
}));
