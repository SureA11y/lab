'use strict';

/**
 * merged-scan.js
 * The scans a Merged scan step ran, folded into the one scan they are
 * (docs/design/merged-scan-design.md).
 *
 * Each scan inside the step is a context of it, named by its label. The
 * merged scan holds every context's findings: an occurrence with the same
 * result in several contexts is one occurrence listing them, and an
 * occurrence whose result differs - a contrast ratio that changes with the
 * theme, a target size that changes with the width - is one occurrence per
 * result, each with its own contexts. Everything else in the app then sees an
 * ordinary scan.
 *
 * Pure: the metric builders the runner uses are passed in, so this runs, and
 * is tested, without a browser.
 */

const { scanWcag } = require('../shared/report-scan.js');

const LISTED_OUTCOMES = new Set(['fail', 'cantTell']);

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/**
 * What makes two occurrences the same result: the same element on the same
 * page, failing (or left undecided) for the same reasons - its summary, hint,
 * uncertainty, the atomic check behind it and the values the rule measured.
 * The markup is not part of it: an element whose HTML differs by context
 * (a theme class) but fails identically is one failure.
 */
function occurrenceIdentity(occ) {
    const o = occ && typeof occ === 'object' ? occ : {};
    return stableStringify({
        pageUrl: o.pageUrl || null,
        target: Array.isArray(o.target) ? o.target : [],
        shadowHostSelectors: Array.isArray(o.shadowHostSelectors) ? o.shadowHostSelectors : null,
        outcome: o.occurrenceOutcome || o.outcome || null,
        failureSummary: o.failureSummary || o.summary || null,
        hint: o.hint || null,
        uncertainty: o.uncertainty || null,
        details: o.details || null,
        atomicCheckId: o.atomicCheckId || null,
        sourceAtomicRules: Array.isArray(o.sourceAtomicRules) ? o.sourceAtomicRules : null,
    });
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
function pictureOf(occ, context) {
    const shot = occ && occ.elementScreenshot;
    if (!shot || typeof shot !== 'object' || typeof shot.url !== 'string') return null;
    return shot.context || !context ? shot : { ...shot, context };
}

function addOccurrence(entry, occ, context, listed, contextsTotal) {
    const key = occurrenceIdentity(occ);
    const seen = entry.occ.get(key);
    if (seen) {
        if (listed) {
            for (const c of occ.contexts || [context]) if (!seen.contexts.includes(c)) seen.contexts.push(c);
            // A picture from a later context, where the first had none.
            const picture = !pictureOf(seen, null) ? pictureOf(occ, context) : null;
            if (picture) seen.elementScreenshot = picture;
        }
        return;
    }
    const copy = listed ? { ...occ, contexts: occ.contexts ? [...occ.contexts] : [context], contextsTotal } : { ...occ };
    const picture = listed ? pictureOf(occ, context) : null;
    if (picture) copy.elementScreenshot = picture;
    entry.occ.set(key, copy);
    entry.finding.occurrences.push(copy);
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
function mergeFindingLists(parts, contextsTotal) {
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
                entry = { finding: { ...f, occurrences: [] }, occ: new Map() };
                byUid.set(uid, entry);
                order.push(uid);
            } else if (contributorsOf(f) && contributorsOf(entry.finding)) {
                const known = new Set(contributorsOf(entry.finding).map((c) => c && c.testId));
                const more = contributorsOf(f).filter((c) => c && !known.has(c.testId));
                if (more.length) entry.finding = withContributors(entry.finding, [...contributorsOf(entry.finding), ...more]);
            }
            const listed = LISTED_OUTCOMES.has(f.outcome);
            for (const occ of Array.isArray(f.occurrences) ? f.occurrences : []) {
                addOccurrence(entry, occ, context, listed, contextsTotal);
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
        entry.occ = new Map(stays.map((o) => [occurrenceIdentity(o), o]));
    }

    return entries.filter((e) => !dropped.has(e)).map((e) => e.finding);
}

/**
 * The notices or margins of several contexts: one entry per distinct item,
 * with the contexts it came from, in the order first seen. An identical note
 * in every context is the scan's note, as it would be with one context.
 */
function joinByContext(list, field) {
    const out = [];
    const index = new Map();
    for (const { canonical, context } of list) {
        for (const item of Array.isArray(canonical[field]) ? canonical[field] : []) {
            const key = stableStringify(item);
            const known = index.get(key);
            if (known) {
                if (!known.contexts.includes(context)) known.contexts.push(context);
                continue;
            }
            const entry = { item, contexts: [context] };
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
 */
function mergeCanonicals(parts, contextsTotal) {
    const list = (Array.isArray(parts) ? parts : []).filter((p) => p && p.canonical && typeof p.canonical === 'object');
    if (!list.length) return null;
    const base = list[0].canonical;

    const findings = mergeFindingLists(list.map((p) => ({ findings: p.canonical.findings, context: p.context })), contextsTotal);
    const bestPractices = mergeFindingLists(list.map((p) => ({ findings: p.canonical.bestPractices, context: p.context })), contextsTotal);

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
        notices: joinByContext(list, 'notices').map(({ item, contexts }) => (
            contexts.length === list.length
                ? { ...item, contexts }
                : { ...item, contexts, message: `${contexts.join(', ')}: ${item && item.message ? item.message : ''}` }
        )),
        margins: joinByContext(list, 'margins').map(({ item, contexts }) => ({ ...item, contexts })),
        summary: mergedSummary(list, findings, bestPractices),
        findingsByKind: {
            composite: findings.filter((f) => f && f.meta && f.meta.atomic === false),
            atomic: findings.filter((f) => !f || !f.meta || f.meta.atomic !== false),
        },
    };
}

// What a merged scan's contexts should share. They are merged anyway; the scan
// says where they differ.
const SHARED_SETTINGS = [
    ['url', 'Its contexts ended on different pages'],
    ['context', 'Its contexts scanned different parts of the page'],
    ['exclude', 'Its contexts excluded different parts of the page'],
    ['profile', 'Its contexts were checked against different profiles'],
];
// Not among them: the rules each context ran. Running every rule in one
// context and only some in another (the contrast rules in the dark theme) is
// what a Merged scan is for, and each failure already names its contexts.

// A setting as a notice says it: a profile by its label.
function showSetting(value) {
    if (value == null) return 'none';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && typeof value.label === 'string' && value.label) return value.label;
    return JSON.stringify(value);
}

function differenceNotices(entries, names) {
    const out = [];
    for (const [field, lead] of SHARED_SETTINGS) {
        const values = entries.map((e) => stableStringify(e[field] ?? null));
        if (new Set(values).size < 2) continue;
        const shown = entries.map((e, i) => `${names[i]}: ${showSetting(e[field])}`);
        out.push({
            code: 'merged-contexts-differ',
            field,
            message: `${lead} (${shown.join('; ')}). They are merged anyway, with the first context's settings.`,
        });
    }
    return out;
}

function contextName(entry, index, total) {
    const label = entry && typeof entry.label === 'string' ? entry.label.trim() : '';
    return label || `Scan ${index + 1} of ${total}`;
}

/**
 * A context's screenshot, as the payload builder takes it (a buffer, an
 * artifact with its buffer or public URL, a data URL), named by its context.
 */
function contextShot(shot, name, viewportRatio) {
    if (!shot) return null;
    const base = (Buffer.isBuffer(shot) || shot instanceof Uint8Array) ? { buffer: shot }
        : typeof shot === 'string' ? { dataUrl: shot.startsWith('data:') ? shot : 'data:image/jpeg;base64,' + shot }
            : typeof shot === 'object' ? shot : null;
    return base ? { ...base, name, label: name, viewportRatio: viewportRatio || null } : null;
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

        for (const { check, context } of seen) {
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
                const copy = listed ? { ...occ, occurrenceOutcome: outcome, contexts: [context] } : { ...occ };
                index.set(key, copy);
                occurrences.push(copy);
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

/** One merged scan from the collected scans of one Merged scan step, in run order. */
function mergeGroup(entries, { buildCoverageAwareSummary, buildA11ySummary, automationCoverageForEngines } = {}) {
    const total = entries.length;
    const names = entries.map((e, i) => contextName(e, i, total));
    const first = entries[0];
    const group = first.mergedScan || {};
    const label = (typeof group.label === 'string' && group.label.trim()) || names[0] || 'Merged scan';

    const active = entries.map((e, i) => ({ e, name: names[i] })).filter(({ e }) => !e.skipped && e.canonical);

    const contexts = entries.map((e, i) => {
        const counts = e.canonical ? outcomeCounts(Array.isArray(e.canonical.findings) ? e.canonical.findings : []) : null;
        return {
            name: names[i],
            url: e.url || null,
            scanTags: Array.isArray(e.scanTags) && e.scanTags.length ? e.scanTags : null,
            skipped: !!e.skipped || !e.canonical,
            failCount: counts ? counts.fail : 0,
            reviewCount: counts ? counts.cantTell : 0,
            passesCount: counts ? counts.pass : 0,
        };
    });

    // The step's own tags; the scans inside describe their contexts, and give
    // all of theirs only when the step has none, as before it could have any.
    const stepTags = Array.isArray(group.scanTags) ? group.scanTags.filter(Boolean) : [];
    const scanTags = stepTags.length
        ? stepTags
        : [...new Set(entries.flatMap((e) => (Array.isArray(e.scanTags) ? e.scanTags : [])))];

    const merged = {
        id: first.id,
        scanId: first.scanId,
        orderKey: first.orderKey,
        iterationIndex: first.iterationIndex,
        scanIndex: first.scanIndex,
        label,
        scanTags: scanTags.length ? scanTags : null,
        mergedScan: true,
        // Which step's scans it was made from: how the merge is reported to the
        // live counts, scans having no id until the run's end. Not kept in the
        // payload, which picks its fields.
        mergedScanKey: group.key || null,
        contexts,
        results: null,
        nativeForReport: null,
        coreResult: null,
        screenshot: null,
        extraScreenshots: [],
    };

    if (!active.length) {
        const skipInfo = (entries.find((e) => e.skipInfo) || {}).skipInfo || null;
        return {
            ...pickSettings(first),
            ...merged,
            skipped: true,
            skipInfo,
            canonical: null,
            domMetrics: null,
            a11ySummary: null,
            coverageSummary: null,
            byEngineMetrics: null,
            screenshots: [],
            viewportRatio: first.viewportRatio || null,
        };
    }

    const lead = active[0].e;
    const contextsTotal = active.length;
    const canonical = mergeCanonicals(active.map(({ e, name }) => ({ canonical: e.canonical, context: name })), contextsTotal);
    canonical.notices = [...differenceNotices(active.map(({ e }) => e), active.map(({ name }) => name)), ...canonical.notices];

    // The page-size figures the scores divide by: the context with the most
    // elements, so one that hides part of the page does not shrink them.
    const domMetrics = active
        .map(({ e }) => e.domMetrics)
        .filter((d) => d && typeof d.totalElements === 'number')
        .sort((a, b) => b.totalElements - a.totalElements)[0] || null;

    // Coverage is measured against the widest context's scope, so a context
    // that ran only some rules does not narrow what the scan is judged on.
    // Contexts run by different engines are measured against what those
    // engines reach between them, as their findings are counted together.
    const inputs = widestContext(active.map(({ e }) => e))._metricInputs || {};
    const engineIds = [...new Set(active.flatMap(({ e }) => ((e._metricInputs && e._metricInputs.perEngine) || []).map((p) => p.engineId)))];
    let automationCoverage = inputs.automationCoverage || null;
    if (engineIds.length > 1 && typeof automationCoverageForEngines === 'function') {
        try {
            const { version, level } = scanWcag(lead);
            automationCoverage = automationCoverageForEngines(level, engineIds, version || undefined) || automationCoverage;
        } catch {
            // Keep the widest context's.
        }
    }
    let coverageSummary = null;
    let a11ySummary = null;
    try {
        if (typeof buildCoverageAwareSummary === 'function') {
            coverageSummary = buildCoverageAwareSummary({ canonical, automationCoverage });
        }
        if (typeof buildA11ySummary === 'function' && domMetrics) {
            a11ySummary = buildA11ySummary({ canonical: scoringView(canonical), domMetrics, coverageSummary });
        }
    } catch {
        coverageSummary = coverageSummary || null;
        a11ySummary = null;
    }

    // One set of metrics per engine when the contexts ran different engines,
    // for the report's engine filter: each engine's findings merged across
    // its contexts on their own, against its own coverage.
    let byEngineMetrics = null;
    try {
        if (engineIds.length > 1 && domMetrics && typeof buildCoverageAwareSummary === 'function' && typeof buildA11ySummary === 'function') {
            const out = {};
            for (const engineId of engineIds) {
                const parts = active
                    .map(({ e, name }) => {
                        const p = ((e._metricInputs && e._metricInputs.perEngine) || []).find((x) => x.engineId === engineId);
                        return p ? { canonical: p.canonical, context: name, p } : null;
                    })
                    .filter(Boolean);
                if (!parts.length) continue;
                const engineCanonical = mergeCanonicals(parts, contextsTotal);
                const engineCoverage = buildCoverageAwareSummary({ canonical: engineCanonical, automationCoverage: parts[0].p.automationCoverage || null });
                out[engineId] = {
                    engine: parts[0].p.engine,
                    a11ySummary: buildA11ySummary({ canonical: scoringView(engineCanonical), domMetrics, coverageSummary: engineCoverage }),
                    coverageSummary: engineCoverage,
                };
            }
            if (Object.keys(out).length > 1) byEngineMetrics = out;
        }
    } catch {
        byEngineMetrics = null;
    }

    // Every context's screenshots, each named by its context and keeping its
    // own aspect ratio: a mobile and a desktop screenshot are not alike.
    const screenshots = [];
    for (const { e, name } of active) {
        for (const shot of Array.isArray(e.extraScreenshots) ? e.extraScreenshots : []) {
            const entry = contextShot(shot, name, e.viewportRatio);
            if (entry) screenshots.push(entry);
        }
        const main = contextShot(e.screenshot, name, e.viewportRatio);
        if (main) screenshots.push(main);
    }

    const coreResult = mergeCoreResults(active.map(({ e, name }) => ({ result: e.coreResult, context: name })));

    return {
        ...pickSettings(lead),
        runOnly: combinedRunOnly(active.map(({ e }) => e)),
        ...merged,
        coreResult,
        skipped: false,
        skipInfo: null,
        canonical,
        domMetrics,
        a11ySummary,
        coverageSummary,
        byEngineMetrics,
        screenshots,
        viewportRatio: lead.viewportRatio || null,
    };
}

const includes = (runOnly) => {
    const r = runOnly && typeof runOnly === 'object' ? runOnly : {};
    return [...(Array.isArray(r.includeRuleIds) ? r.includeRuleIds : []), ...(Array.isArray(r.includeTags) ? r.includeTags : [])];
};

/** The context that ran the most: one that ran every rule of its level, else the first. */
function widestContext(entries) {
    return entries.find((e) => !includes(e.runOnly).length) || entries[0];
}

/**
 * The rules the merged scan ran: every rule of its level when a context ran
 * them all, else the rules and tags the contexts included, together. Excludes
 * are kept only where every context excluded them.
 */
function combinedRunOnly(entries) {
    const widest = widestContext(entries);
    if (!includes(widest.runOnly).length) return widest.runOnly || null;
    const union = (key) => [...new Set(entries.flatMap((e) => (e.runOnly && Array.isArray(e.runOnly[key]) ? e.runOnly[key] : [])))];
    const common = (key) => {
        const lists = entries.map((e) => (e.runOnly && Array.isArray(e.runOnly[key]) ? e.runOnly[key] : []));
        return lists.length ? lists[0].filter((x) => lists.every((l) => l.includes(x))) : [];
    };
    const out = { ...(widest.runOnly || {}), includeRuleIds: union('includeRuleIds'), excludeRuleIds: common('excludeRuleIds') };
    if (entries.some((e) => e.runOnly && Array.isArray(e.runOnly.includeTags))) out.includeTags = union('includeTags');
    if (entries.some((e) => e.runOnly && Array.isArray(e.runOnly.excludeTags))) out.excludeTags = common('excludeTags');
    return out;
}

function pickSettings(e) {
    return {
        context: e.context || null,
        exclude: e.exclude || null,
        tags: e.tags || null,
        profile: e.profile || null,
        wcag: e.wcag || null,
        runOnly: e.runOnly || null,
        url: e.url || null,
    };
}

/**
 * The collected scans of a run, with each Merged scan's scans folded into one,
 * at the place of its first. Scans outside a Merged scan pass through as they
 * are. A collected scan belongs to a Merged scan when it carries
 * `mergedScan: { key, label }`.
 */
function foldMergedScans(entries, deps, { onlyKey = null } = {}) {
    const list = Array.isArray(entries) ? entries : [];
    const groupKey = (e) => {
        const key = e && e.mergedScan && e.mergedScan.key;
        return key && (!onlyKey || key === onlyKey) ? key : null;
    };
    const groups = new Map();
    for (const e of list) {
        const key = groupKey(e);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
    }
    if (!groups.size) return list;

    const out = [];
    const done = new Set();
    for (const e of list) {
        const key = groupKey(e);
        if (!key) {
            out.push(e);
            continue;
        }
        if (done.has(key)) continue;
        done.add(key);
        out.push(mergeGroup(groups.get(key), deps));
    }
    return out;
}

function scanSummary(canonical) {
    const c = outcomeCounts(canonical && Array.isArray(canonical.findings) ? canonical.findings : []);
    return { failCount: c.fail, reviewCount: c.cantTell, passesCount: c.pass };
}

/**
 * For the live totals: each merged scan of a run, with its counts and tags,
 * and those of the contexts it was made from that finished (and so were
 * counted as they did), so the totals can swap the one for the other.
 * Counted as the "a11yScan ready" progress entries count a scan.
 */
function describeMerges(collected, folded) {
    const groups = new Map();
    for (const e of Array.isArray(collected) ? collected : []) {
        const key = e && e.mergedScan && e.mergedScan.key;
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(e);
    }
    // Matched by the step's key: scans have no id until the run's end, and
    // groups folded earlier are already merged scans in `collected`, so
    // neither an id nor a position would find the right one.
    const merged = (Array.isArray(folded) ? folded : []).filter((e) => e && e.mergedScan === true);
    return [...groups.entries()].map(([key, entries]) => {
        const m = merged.find((x) => x.mergedScanKey === key) || {};
        return {
            key,
            label: m.label || null,
            scanId: m.scanId || null,
            scanTags: m.scanTags || null,
            summary: scanSummary(m.canonical),
            contexts: entries
                .filter((e) => !e.skipped && e.canonical)
                .map((e) => ({ label: e.label || null, scanTags: e.scanTags || null, summary: scanSummary(e.canonical) })),
        };
    });
}

module.exports = {
    describeMerges,
    foldMergedScans,
    mergeGroup,
    mergeCanonicals,
    mergeCoreResults,
    occurrenceIdentity,
};
