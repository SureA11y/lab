'use strict';

/**
 * Per-criterion verdicts paired with how much of each criterion was machine-evaluated.
 * Composite rollups drive the verdict; atomic findings are read only as evidence
 * about it, so the two layers are never summed.
 */

const CONFORMANCE_LEVELS = ['A', 'AA', 'AAA'];

/** VPAT-style statuses, plus the two states a VPAT has no word for. */
const STATUS = {
    SUPPORTS: 'supports',
    PARTIALLY_SUPPORTS: 'partiallySupports',
    DOES_NOT_SUPPORT: 'doesNotSupport',
    NOT_APPLICABLE: 'notApplicable',
    NEEDS_REVIEW: 'needsReview',
    NOT_EVALUATED: 'notEvaluated'
};

/** How much of the criterion the automation actually reached a conclusion on. */
const VERIFICATION = {
    VERIFIED: 'verified',
    PARTIALLY_VERIFIED: 'partiallyVerified',
    NOT_VERIFIED: 'notVerified'
};

function asArray(x) {
    return Array.isArray(x) ? x : [];
}

function isComposite(finding) {
    if (!finding) return false;
    if (finding.meta && finding.meta.atomic === false) return true;
    return !!(finding.evidence && finding.evidence.rollup);
}

/**
 * `scNormative` is the criterion set the rule enforces; `sc` also carries
 * informative references, which would over-attribute criteria to a verdict.
 */
function scRefsOf(finding) {
    const wcag = finding && finding.wcag ? finding.wcag : null;
    if (!wcag) return [];
    const list = Array.isArray(wcag.scNormative) ? wcag.scNormative : asArray(wcag.sc);
    return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

/**
 * SC-specific: one check can map to several criteria at different levels
 * (contrast maps to 1.4.3 at AA and 1.4.6 at AAA), so the mapping has to match.
 */
function levelOf(finding, sc) {
    const mappings = asArray(finding && finding.standards && finding.standards.normativeMappings);
    for (const m of mappings) {
        if (!m || typeof m !== 'object') continue;
        if (String(m.requirement || '').trim() !== sc) continue;
        const lvl = String(m.conformanceLevel || '').toUpperCase();
        if (CONFORMANCE_LEVELS.includes(lvl)) return lvl;
    }
    return null;
}

function emptyTally() {
    return { total: 0, pass: 0, fail: 0, cantTell: 0, notApplicable: 0, notRun: 0, evaluated: 0 };
}

function tallyOutcome(tally, outcome) {
    tally.total += 1;
    if (outcome === 'pass') { tally.pass += 1; tally.evaluated += 1; return; }
    if (outcome === 'fail') { tally.fail += 1; tally.evaluated += 1; return; }
    if (outcome === 'cantTell') { tally.cantTell += 1; return; }
    if (outcome === 'notApplicable') { tally.notApplicable += 1; return; }
    // A check of the criterion that did not run (core's 'missing': a scan
    // that named only some of its checks). It judged nothing.
    if (outcome === 'missing') tally.notRun += 1;
}

/**
 * Nothing evaluated means nothing was verified, whatever the rollup concluded -
 * this is what stops a criterion reading green off inapplicable checks alone.
 * A criterion some of whose checks did not run cannot be supported either:
 * only a failure decides it, as core's rollup reads it.
 */
function deriveStatus(tally) {
    if (!tally.total) return STATUS.NOT_EVALUATED;
    if (!tally.evaluated) return (tally.cantTell || tally.notRun) ? STATUS.NEEDS_REVIEW : STATUS.NOT_APPLICABLE;
    if (tally.fail && tally.pass) return STATUS.PARTIALLY_SUPPORTS;
    if (tally.fail) return STATUS.DOES_NOT_SUPPORT;
    if (tally.notRun) return STATUS.NEEDS_REVIEW;
    return STATUS.SUPPORTS;
}

function deriveVerification(tally) {
    if (!tally.evaluated) return VERIFICATION.NOT_VERIFIED;
    if (tally.cantTell || tally.notRun) return VERIFICATION.PARTIALLY_VERIFIED;
    return VERIFICATION.VERIFIED;
}

function mean(values) {
    const nums = values.filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(n, places = 3) {
    if (!Number.isFinite(n)) return null;
    const f = 10 ** places;
    return Math.round(n * f) / f;
}

/**
 * Contributors carry only a testId and an outcome, so the atomic layer is where
 * the check's confidence, automatability and occurrence count actually live.
 */
/**
 * The engine that produced a finding, as a lowercased key. Two provenance shapes
 * are in circulation and a server-produced finding carries both: the adapters
 * write a flat `{engineId}`, and the facade merges a nested `engine: {id}` on top
 * when it stamps provenance.
 *
 * Returns '' for a finding with no engine recorded, which is what a single-engine
 * canonical written before provenance existed looks like.
 */
function engineKeyOf(finding) {
    const provenance = (finding && finding.provenance && typeof finding.provenance === 'object')
        ? finding.provenance
        : null;
    const nested = (provenance && provenance.engine && typeof provenance.engine === 'object')
        ? provenance.engine
        : null;

    const id = (nested && typeof nested.id === 'string' && nested.id.trim())
        || (provenance && typeof provenance.engineId === 'string' && provenance.engineId.trim())
        || (finding && typeof finding.engineId === 'string' && finding.engineId.trim())
        || '';

    return id.toLowerCase();
}

/**
 * Findings split by the engine that produced them, in first-seen order.
 *
 * A multi-engine run concatenates its engines' findings, and the composite and
 * atomic layers are engine-specific: only some engines model their rules as
 * composites over contributing checks. Resolving one layer for the whole merged
 * set therefore reads every engine through the layer of whichever one happens to
 * emit composites, and silently drops the rest - so the layer is resolved inside
 * each engine's own findings instead.
 */
function groupFindingsByEngine(findings) {
    const groups = new Map();

    for (const f of findings) {
        if (!f) continue;
        const key = engineKeyOf(f);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(f);
    }

    return [...groups.values()];
}

function indexAtomicsByRuleId(atomics) {
    const byId = new Map();
    for (const f of atomics) {
        const id = String((f && (f.ruleId || f.id)) || '').trim();
        if (id) byId.set(id, f);
    }
    return byId;
}

function buildCriterionEntry(sc) {
    return {
        sc,
        level: null,
        status: STATUS.NOT_EVALUATED,
        verification: VERIFICATION.NOT_VERIFIED,
        checks: emptyTally(),
        manualChecks: 0,
        confidence: null,
        failCount: 0,
        occurrenceCount: 0,
        ruleIds: [],
        needsReviewChecks: []
    };
}

function collectFromComposites(composites, atomicsById, criteria) {
    for (const comp of composites) {
        const rollup = (comp.evidence && comp.evidence.rollup) ? comp.evidence.rollup : {};
        const contributors = asArray(rollup.contributors);
        const refs = scRefsOf(comp);
        const occurrences = asArray(comp.occurrences).length;

        for (const sc of refs) {
            if (!criteria.has(sc)) criteria.set(sc, buildCriterionEntry(sc));
            const entry = criteria.get(sc);

            if (!entry.level) entry.level = levelOf(comp, sc);
            entry.ruleIds.push(String(comp.ruleId || comp.id || ''));
            entry.occurrenceCount += occurrences;
            if (comp.outcome === 'fail') entry.failCount += 1;

            const confidences = [];

            for (const c of contributors) {
                if (!c || typeof c !== 'object') continue;
                const outcome = String(c.outcome || '').trim();
                tallyOutcome(entry.checks, outcome);

                const atomic = atomicsById.get(String(c.testId || '').trim());
                if (atomic) {
                    if (!entry.level) entry.level = levelOf(atomic, sc);
                    if (atomic.type === 'manual') entry.manualChecks += 1;
                    if (outcome === 'pass' || outcome === 'fail') {
                        const conf = Number(atomic.confidence);
                        if (Number.isFinite(conf)) confidences.push(conf);
                    }
                    entry.occurrenceCount += asArray(atomic.occurrences).length;
                }

                if (outcome === 'cantTell') {
                    entry.needsReviewChecks.push(String(c.testId || '').trim());
                }
            }

            // A composite with no contributor breakdown still carries its own verdict.
            if (!contributors.length) {
                tallyOutcome(entry.checks, String(comp.outcome || '').trim());
                const conf = Number(comp.confidence);
                if (Number.isFinite(conf) && (comp.outcome === 'pass' || comp.outcome === 'fail')) {
                    confidences.push(conf);
                }
                if (comp.outcome === 'cantTell') entry.needsReviewChecks.push(String(comp.ruleId || ''));
            }

            const m = mean([...(entry.confidence === null ? [] : [entry.confidence]), ...confidences]);
            entry.confidence = m === null ? entry.confidence : m;
        }
    }
}

function collectFromAtomics(atomics, criteria) {
    for (const f of atomics) {
        const refs = scRefsOf(f);
        const outcome = String(f.outcome || '').trim();
        const occurrences = asArray(f.occurrences).length;

        for (const sc of refs) {
            if (!criteria.has(sc)) criteria.set(sc, buildCriterionEntry(sc));
            const entry = criteria.get(sc);

            if (!entry.level) entry.level = levelOf(f, sc);
            entry.ruleIds.push(String(f.ruleId || f.id || ''));
            entry.occurrenceCount += occurrences;
            if (outcome === 'fail') entry.failCount += 1;
            if (f.type === 'manual') entry.manualChecks += 1;
            if (outcome === 'cantTell') entry.needsReviewChecks.push(String(f.ruleId || f.id || ''));

            tallyOutcome(entry.checks, outcome);

            if (outcome === 'pass' || outcome === 'fail') {
                const conf = Number(f.confidence);
                if (Number.isFinite(conf)) {
                    const prev = entry.confidence === null ? [] : [entry.confidence];
                    entry.confidence = mean([...prev, conf]);
                }
            }
        }
    }
}

/**
 * Criteria in scope that no finding touched are the ones most likely to be read as
 * clean, so they are folded in explicitly and labelled with why nothing ran.
 */
function addUntouchedCriteria(criteria, automationCoverage) {
    for (const c of asArray(automationCoverage && automationCoverage.criteria)) {
        if (!c || criteria.has(c.sc)) continue;
        const entry = buildCriterionEntry(c.sc);
        entry.level = c.level || null;
        criteria.set(c.sc, entry);
    }
}

/**
 * @param {object} input
 * @param {object} input.canonical - canonical engine output for one page or a portfolio
 * @param {'composite'|'atomic'|'auto'} [input.layer='auto'] - which layer drives the verdicts
 * @param {object} [input.automationCoverage] - buildAutomationCoverage() output; supplies
 *   the in-scope denominator and each criterion's automation reach
 */
function buildCoverageAwareSummary({ canonical, layer = 'auto', automationCoverage = null } = {}) {
    const findings = asArray(canonical && canonical.findings);

    // findingsByKind holds back-references, which serialize to "[Circular]" in a
    // dumped scan, so only trust it when its entries survived as finding objects.
    const byKind = (canonical && canonical.findingsByKind && typeof canonical.findingsByKind === 'object')
        ? canonical.findingsByKind
        : null;
    const usableKind = (key) => {
        const list = byKind ? byKind[key] : null;
        return Array.isArray(list) && list.every((f) => f && typeof f === 'object') ? list : null;
    };

    // One group per engine that produced findings. A single-engine canonical - the
    // common case, and every canonical written before multi-engine runs existed -
    // yields exactly one group, so it is read exactly as it was before.
    const groups = groupFindingsByEngine(findings);
    const isMultiEngine = groups.length > 1;

    // `findingsByKind` describes the canonical it was written for. A merged
    // canonical inherits the first engine's copy, which lists only that engine's
    // findings, so it is only trustworthy while one engine is in play.
    const kindOf = (key, fallback) => (isMultiEngine ? null : usableKind(key)) || fallback;

    const composites = kindOf('composite', findings.filter(isComposite));
    const atomics = kindOf('atomic', findings.filter((f) => f && !isComposite(f)));

    const criteria = new Map();
    const layersUsed = new Set();

    const collectGroup = (groupComposites, groupAtomics) => {
        const groupLayer = layer === 'auto'
            ? (groupComposites.length ? 'composite' : 'atomic')
            : layer;

        layersUsed.add(groupLayer);

        if (groupLayer === 'composite') {
            // Contributors are looked up among this engine's own atomics: a testId
            // is only unique within the engine that issued it, so indexing across
            // engines would let one engine's check stand in for another's.
            collectFromComposites(groupComposites, indexAtomicsByRuleId(groupAtomics), criteria);
        } else {
            collectFromAtomics(groupAtomics, criteria);
        }
    };

    if (isMultiEngine) {
        for (const group of groups) {
            collectGroup(group.filter(isComposite), group.filter((f) => f && !isComposite(f)));
        }
    } else {
        collectGroup(composites, atomics);
    }

    // 'mixed' when the engines that ran did not agree on a layer - the merged run
    // read each through its own, so neither name alone describes the result.
    const resolvedLayer = layersUsed.size === 1 ? [...layersUsed][0] : 'mixed';

    const touched = new Set(criteria.keys());
    addUntouchedCriteria(criteria, automationCoverage);

    const automationBySc = new Map(
        asArray(automationCoverage && automationCoverage.criteria).map((c) => [c.sc, c.automation])
    );

    const entries = [...criteria.values()].map((entry) => {
        entry.status = deriveStatus(entry.checks);
        entry.verification = deriveVerification(entry.checks);
        entry.confidence = round(entry.confidence);
        entry.ruleIds = [...new Set(entry.ruleIds.filter(Boolean))];
        entry.needsReviewChecks = [...new Set(entry.needsReviewChecks.filter(Boolean))];
        entry.automation = automationBySc.get(entry.sc) || null;
        entry.inScope = automationCoverage ? automationBySc.has(entry.sc) : null;
        return entry;
    });

    entries.sort((a, b) => a.sc.localeCompare(b.sc, undefined, { numeric: true }));

    const countBy = (pred) => entries.filter(pred).length;

    const evaluated = countBy((e) => e.checks.evaluated > 0);
    const failing = countBy((e) => e.status === STATUS.DOES_NOT_SUPPORT || e.status === STATUS.PARTIALLY_SUPPORTS);
    const supporting = countBy((e) => e.status === STATUS.SUPPORTS);

    const confidences = entries.map((e) => e.confidence).filter((n) => Number.isFinite(n));

    return {
        layer: resolvedLayer,
        criteria: entries,

        // Which engines' rule catalogs the in-scope denominator was actually built
        // from. `complete: false` means an engine that ran contributed criteria to
        // the numerator but nothing to the scope it is being measured against, so
        // the ratios below understate what the run could reach.
        automationScope: (automationCoverage && automationCoverage.engines)
            ? {
                complete: !asArray(automationCoverage.engines.withoutCatalog).length,
                withCatalog: asArray(automationCoverage.engines.withCatalog).slice(),
                withoutCatalog: asArray(automationCoverage.engines.withoutCatalog).slice()
            }
            : null,

        coverage: {
            criteriaInScope: automationCoverage ? automationBySc.size : null,
            criteriaTouched: touched.size,
            criteriaEvaluated: evaluated,
            criteriaNotEvaluated: countBy((e) => e.status === STATUS.NOT_EVALUATED),
            // criteria in scope that no rule could ever reach, so an absent finding
            // there says nothing about the page
            criteriaNotAutomatable: countBy((e) => e.automation === 'notAutomatable'),
            criteriaManualOnly: countBy((e) => e.automation === 'manualOnly'),
            // The ceiling: how many criteria any run could have concluded on. A score
            // read against criteriaInScope alone looks damning; read against this, it
            // says how much of the reachable ground was actually covered.
            criteriaAutomatable: countBy((e) => e.automation === 'automatic'),
            criteriaNeedsReview: countBy((e) => e.status === STATUS.NEEDS_REVIEW),
            criteriaNotApplicable: countBy((e) => e.status === STATUS.NOT_APPLICABLE),
            // of the criteria this run touched, the share it could conclude on
            evaluatedRatio: touched.size ? round(evaluated / touched.size) : 0,
            // the same count against the full conformance target - the number that
            // stops a report reading as if it had covered WCAG
            evaluatedRatioOfScope: automationBySc.size ? round(evaluated / automationBySc.size) : null,
            verified: countBy((e) => e.verification === VERIFICATION.VERIFIED),
            partiallyVerified: countBy((e) => e.verification === VERIFICATION.PARTIALLY_VERIFIED),
            notVerified: countBy((e) => e.verification === VERIFICATION.NOT_VERIFIED)
        },

        outcome: {
            supports: supporting,
            partiallySupports: countBy((e) => e.status === STATUS.PARTIALLY_SUPPORTS),
            doesNotSupport: countBy((e) => e.status === STATUS.DOES_NOT_SUPPORT),
            failing,
            // pass share of what was actually testable - the honest headline number
            passShareOfEvaluated: evaluated ? round(supporting / evaluated) : null
        },

        reliability: {
            mean: round(mean(confidences)),
            min: confidences.length ? round(Math.min(...confidences)) : null,
            criteriaWithConfidence: confidences.length
        },

        needsReview: entries
            .filter((e) => e.checks.cantTell > 0)
            .map((e) => ({
                sc: e.sc,
                level: e.level,
                status: e.status,
                cantTell: e.checks.cantTell,
                checks: e.needsReviewChecks
            }))
    };
}

module.exports = {
    buildCoverageAwareSummary,
    STATUS,
    VERIFICATION
};
