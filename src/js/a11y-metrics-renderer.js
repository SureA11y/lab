'use strict';

/**
 * Renders the a11ySummary + domMetrics panel.
 * Metric definitions (metricDefs) are the source of truth for:
 * - labels
 * - value formatting (percent mapping)
 * - ranges
 * - bands (intervals and keys)
 * - direction (polarity)
 *
 * Remaining UI text is limited to:
 * - KPI (findings counts) explanations
 * - Banner narrative and reason wording
 *
 * - For metrics with an explicit range (defs.min and defs.max are finite numbers),
 *   values are rendered using the provided gauge function.
 *
 * Usage:
 *   import { createA11yMetricsPanel } from './a11y-metrics-renderer.js';
 *   container.innerHTML = createA11yMetricsPanel({ a11ySummary, domMetrics, metricDefs, renderGauge });
 *
 * Where renderGauge is the gauge builder that accepts:
 *   ({ name, value, min, max, intervals, units, isPercent, idPrefix, polarity, asText })
 * and returns a string when asText === true.
 */

import {buildRatingGauge} from './ui-gauge.js';
import {renderA11yNarrative, createNarrativeSeed} from './a11y-narrative.js';

const UI_TEXT = {
    kpis: {
        violations: {
            label: 'Violations',
            help:
                'Confirmed issues detected by automated rules.\n' +
                'Interpretation:\n' +
                '• 0: none detected by automation\n' +
                '• >0: action required, review severity and scope\n\n' +
                'Note: automated rules only detect a subset of potential issues.'
        },
        incomplete: {
            label: 'Incomplete',
            help:
                'Checks that could not be fully evaluated automatically.\n' +
                'Interpretation:\n' +
                '• 0: fewer uncertain areas detected\n' +
                '• >0: manual verification is needed\n\n' +
                'Examples include visual meaning, interaction intent, and context-sensitive patterns.'
        },
        passes: {
            label: 'Passes',
            help:
                'Checks that passed automated evaluation for the scanned context.\n' +
                'Interpretation:\n' +
                'A higher number is generally positive, but it does not guarantee overall accessibility.'
        }
    },

    banner: {
        titles: {
            // Keep these short, label-like, and non-judgmental
            bad: 'Issues detected',
            warn: 'Review recommended',
            ok: 'Quick review advised',
            // "No automated findings" is a statement about the checks, not the page;
            // anything warmer reads as a clean bill of health automation cannot give.
            good: 'No automated findings',
            unknown: 'More review needed'
        },
        subtitles: {
            // One line, reason-focused, avoids sounding like a section heading
            capped: 'Results are partial because the scan was capped',
            incomplete: 'Some checks could not be completed automatically',
            lowConfidence: 'Automation confidence is lower for this page',
            manual: 'Add a brief manual check for key journeys'
        },
        reasons: {
            // Short, evidence-style bullets, no conformance language
            incomplete: 'Incomplete automated checks reported',
            lowConfidence: 'Lower automation confidence for this page',
            capped: 'Scan capped, some content may be missing from metrics',
            shadow: 'Shadow DOM present, automated coverage can be reduced',
            iframes: 'Iframes present, some content may not be analyzable automatically',
            hiddenHigh: 'High hidden or conditional content, validate state changes and focus',
            statefulHigh: 'Many stateful components, validate interaction flows',
            linkNoName: 'Some links may lack a usable accessible name',
            buttonNoName: 'Some buttons may lack a usable accessible name',
            linkIconHeavy: 'Many links appear icon-based, validate naming',
            buttonIconHeavy: 'Many buttons appear icon-based, validate naming'
        }
    }
};

export function generateA11yMetricsContents({a11ySummary, domMetrics, coverageSummary, metricDefs} = {}) {
    // Callers destructure narrativeEls/metricsEls, so this path must not return a
    // bare string: a scan whose DOM metrics failed to collect would crash the render.
    if (!a11ySummary || !domMetrics) {
        const holder = document.createElement('div');
        holder.innerHTML = '<section class="a11y-metrics" aria-label="Accessibility Risk Indicators"><p>No data available.</p></section>';
        return {narrativeEls: [], metricsEls: Array.from(holder.childNodes)};
    }

    const defs = (metricDefs && typeof metricDefs === 'object') ? metricDefs : {};

    const s = a11ySummary;
    const d = domMetrics;

    const isGlobal = !!s?.stats?.pageAccessibility;

    const scores = s && s.scores ? s.scores : {};
    const inputs = s && s.inputs ? s.inputs : {};
    const flags = s && s.flags ? s.flags : {};

    // The findings' counts; `axe` is the name saved reports keep them under.
    const counts = inputs.axe || {};
    const controls = inputs.controls || {};

    const tm = d && d.textMetrics ? d.textMetrics : null;
    const tmLinks = tm && tm.links ? tm.links : {};
    const tmButtons = tm && tm.buttons ? tm.buttons : {};

    // Prefer cleaned summary inputs, fallback to textMetrics
    const linksPer1k = num(controls.linksPer1k, num(tmLinks.linksPer1k, null));
    const linkTextShare = num(controls.linkTextShare, num(tmLinks.linkTextShare, null));
    const linksNoTextRate = num(controls.linksNoTextRate, num(tmLinks.linksNoVisibleTextRate, null));
    const linksNoTextNoNameRate = num(controls.linksNoTextNoNameRate, num(tmLinks.linksNoTextNoNameSignalRate, null));

    const buttonsPer1k = num(controls.buttonsPer1k, num(tmButtons.buttonsPer1k, null));
    const buttonTextShare = num(controls.buttonTextShare, num(tmButtons.buttonTextShare, null));
    const buttonsNoTextRate = num(controls.buttonsNoTextRate, num(tmButtons.buttonsNoVisibleTextRate, null));
    const buttonsNoTextNoNameRate = num(controls.buttonsNoTextNoNameRate, num(tmButtons.buttonsNoTextNoNameSignalRate, null));

    const a11yViolations = num(counts.violations, 0);
    const a11yIncomplete = num(counts.incomplete, 0);
    const a11yPasses = num(counts.passes, 0);
    const a11yTotalChecks = a11yViolations + a11yIncomplete + a11yPasses;
    // Share of the same denominator that is unresolved — a pass-rate gauge must
    // state this alongside the number, never show a bare percentage on its own.
    const unresolvedPct = a11yTotalChecks > 0 ? (a11yIncomplete / a11yTotalChecks) * 100 : 0;

    const bannerModel = buildBannerModel({
        defs,
        manualReviewNeeded: !!flags.manualReviewNeeded,

        a11yViolations,
        a11yIncomplete,

        adjustedPct: num(scores.adjusted, null),
        confidencePct: num(scores.confidence, null),

        domCapped: !!d.capped,
        shadowHostCount: num(d.shadowHostCount, 0),
        iframeCount: num(d.iframeCount, 0),

        hiddenRatio: num(d.hiddenRatio, null),
        statefulComponentsCount: num(d.statefulComponentsCount, null),

        linksPer1k,
        linkTextShare,
        linksNoTextNoNameRate,

        buttonsPer1k,
        buttonTextShare,
        buttonsNoTextNoNameRate
    });

    const coverage = coverageSummary || (a11ySummary && a11ySummary.coverageSummary) || null;
    const chip = (defKey, value, extra) => renderChip(defs, defKey, value, extra);

    // Stable seed: the same scan must read the same way every time it is opened.
    // Rotating the wording made a re-read look like a re-assessment.
    const seed = createNarrativeSeed({
        pageId: location.origin + location.pathname,
        mode: 'stable'
    });
    const narrativeHTML = renderA11yNarrative({a11ySummary, domMetrics, metricDefs, seed});

    const row = (defKey, rawValue) => renderMetricRow(defs, defKey, rawValue);

    const evaluationState = scores.evaluationState || null;

    // A scan that could not be measured gets the statement, not a row of cards: two of
    // them would repeat the same sentence and the third would show a confident dial
    // beside them. The statement is louder than the cards were, so nothing goes
    // unsaid - which is the only thing that made showing them worth it.
    const scoreBlockHTML = evaluationState === 'notMeasurable'
        ? renderScoreState(a11ySummary)
        : `
    <div class="a11y-scoregrid" role="group" aria-label="Scores">
        ${chip('scores.avgPageAccessibility', scores.avgPageAccessibility ?? scores.adjusted, {unresolvedPct, evaluationState})}
        ${isGlobal ? chip('scores.adjusted', scores.adjusted, {evaluationState}) : ''}
        ${chip('scores.confidence', scores.confidence, {evaluationState, coveragePct: scores.confidenceCoverage})}
        ${chip('scores.evidence', scores.evidence, {evaluationState})}
    </div>`;

    const metricsHTML = `
<section class="a11y-metrics" aria-label="Accessibility Risk Indicators">
    ${scoreBlockHTML}
    ${renderScoreCaveat(defs, ['scores.avgPageAccessibility', 'scores.adjusted'], a11ySummary)}

    ${renderReviewSignals(a11ySummary)}

    ${renderCoverageSection(coverage)}

    ${renderOccurrenceSection(a11ySummary)}

    <details class="a11y-details">
    <summary>Page structure signals</summary>
    <ul class="a11y-grid3">
        ${row('dom.semanticRatio', d.semanticRatio)}
        ${row('dom.coverageRatio', d.coverageRatio)}
        ${row('dom.hiddenRatio', d.hiddenRatio)}
        ${row('dom.statefulComponentsCount', d.statefulComponentsCount)}
        ${row('dom.focusableDensityPer1k', d.focusableDensityPer1k)}
        ${row('dom.depthMax', d.depthMax)}
        ${row('dom.iframeCount', d.iframeCount)}
        ${row('dom.shadowHostCount', d.shadowHostCount)}
        ${row('dom.capped', d.capped ? 1 : 0)}
    </ul>
    </details>

    <details class="a11y-details">
    <summary>Interactive controls</summary>
    <ul class="a11y-grid3">
        ${row('controls.linksPer1k', linksPer1k)}
        ${row('controls.linkTextShare', linkTextShare)}
        ${row('controls.linksNoTextRate', linksNoTextRate)}
        ${row('controls.linksNoTextNoNameRate', linksNoTextNoNameRate)}

        ${row('controls.buttonsPer1k', buttonsPer1k)}
        ${row('controls.buttonTextShare', buttonTextShare)}
        ${row('controls.buttonsNoTextRate', buttonsNoTextRate)}
        ${row('controls.buttonsNoTextNoNameRate', buttonsNoTextNoNameRate)}
    </ul>
    </details>
</section>
`.trim();

    const narrativeEl = document.createElement('div');
    narrativeEl.innerHTML = (bannerModel ? renderBanner(bannerModel) : '') + narrativeHTML;

    const metricsEl = document.createElement('div');
    metricsEl.innerHTML = metricsHTML;
    return {
        narrativeEls: Array.from(narrativeEl.childNodes),
        metricsEls: Array.from(metricsEl.childNodes),
    }
}

/* ---------------- metric rendering (defs are truth) ---------------- */

// Canonical, app-bundled metric definitions (with `help` text), exposed by
// shared/workflow-payload-deps.js as globalThis.A11Y_WORKFLOW_DEPS.METRIC_DEFS.
// Embedded metricDefs can be partial (e.g. older exports carry a def's `name`
// but omit `help`/`polarity`, blanking the `?` tooltip); those fields get
// backfilled from this canonical set. Returns null when it isn't loaded.
function canonicalMetricDefs() {
    try {
        const d = globalThis && globalThis.A11Y_WORKFLOW_DEPS && globalThis.A11Y_WORKFLOW_DEPS.METRIC_DEFS;
        return (d && typeof d === 'object') ? d : null;
    } catch {
        return null;
    }
}

function resolveDef(defs, defKey) {
    const provided = (defs && defs[defKey] && typeof defs[defKey] === 'object') ? defs[defKey] : null;

    const canonAll = canonicalMetricDefs();
    const canon = (canonAll && canonAll[defKey] && typeof canonAll[defKey] === 'object') ? canonAll[defKey] : null;

    if (!provided) return canon || null;
    if (!canon) return provided;

    // Keep the payload's own fields (values, ranges, intervals), but backfill the
    // documentation fields the payload omits so the tooltip always has content.
    return {
        ...provided,
        name: provided.name || canon.name,
        help: provided.help || canon.help,
        polarity: provided.polarity || canon.polarity
    };
}

// An absent value has a different cause per metric: a score is withheld because
// nothing was evaluated, confidence because nothing found carried one - which also
// happens on a fully evaluated page where everything passed.
const CHIP_EMPTY_STATES = {
    'scores.confidence': {
        value: 'Not measured',
        why: 'Nothing found carried a confidence, so there was no reliability to measure.'
    }
};

const CHIP_EMPTY_DEFAULT = {
    value: 'Not evaluated',
    why: 'No criteria were evaluated, so this has no value.'
};

/**
 * A withheld score is shown, never hidden. An absent tile and a clean tile look the
 * same to a reader who does not know the tile is sometimes dropped - and in an
 * exported report nobody knows that. So the chip stays and says what it is missing.
 */
const CHIP_EMPTY_BY_STATE = {
    notMeasurable: {
        value: 'Not measurable',
        why: 'Too little of the page was testable to measure how dense the findings are.'
    },
    notEvaluated: {
        value: 'Not evaluated',
        why: 'No criteria were evaluated, so this has no value.'
    }
};

/**
 * The score block's own state, rendered once above the chips.
 *
 * When a scan is unmeasurable it is not three metrics that each happen to be missing,
 * it is one scan that could not be measured - so the reason is stated once, with what
 * the run did find, rather than repeated in every chip.
 */
function renderScoreState(a11ySummary) {
    const scores = (a11ySummary && a11ySummary.scores) ? a11ySummary.scores : {};
    if (scores.evaluationState !== 'notMeasurable') return '';

    const inputs = (a11ySummary && a11ySummary.inputs) ? a11ySummary.inputs : {};
    const units = inputs.contentUnits || {};
    // The findings' counts; `axe` is the name saved reports keep them under.
    const counts = inputs.axe || {};

    const size = Number(units.primarySize);
    const sizeText = Number.isFinite(size)
        ? `only ${fmtCount(size)} ${units.primary === 'evaluable' ? 'testable elements' : 'units of content'} were found`
        : 'too little testable content was found';

    const found = [
        Number(counts.violations) > 0 ? `${fmtCount(counts.violations)} failing ${Number(counts.violations) === 1 ? 'check' : 'checks'}` : null,
        Number(counts.incomplete) > 0 ? `${fmtCount(counts.incomplete)} needing review` : null
    ].filter(Boolean).join(' and ');

    // The engines' confidence belongs here rather than on a dial of its own. Beside
    // two withheld scores a green "High" gauge reads as a verdict on the page, which
    // is the one thing this scan cannot support - the same reason the structural
    // proxy is already refused when nothing was found: it returns near-maximum
    // confidence for a scan that produced no information at all.
    const confidence = Number(scores.confidence);
    const coverage = Number(scores.confidenceCoverage);
    const confidenceText = Number.isFinite(confidence)
        ? ` The engines reported ${Math.round(confidence)}% confidence in the checks that did run${
            Number.isFinite(coverage) && coverage < 100 ? `, measured on ${Math.round(coverage)}% of the findings` : ''
        }, which says how sure they were of those checks - not that the page was covered.`
        : '';

    return `
    <div class="a11y-score-state a11y-score-state-notmeasurable">
        <p class="a11y-score-state-head">No score for this scan: ${escapeHtml(sizeText)}.</p>
        <p class="a11y-score-state-why">${escapeHtml(
            (found
                ? `The ${found} below are real and worth acting on. What cannot be said is how dense they are, which is what the score measures - on a page this thin a single finding reads as a page-wide failure. Check that the scan captured the page after its content had rendered.`
                : 'Nothing was found, but on a page this thin that says little. Check that the scan captured the page after its content had rendered.'
            ) + confidenceText
        )}</p>
    </div>
    `.trim();
}

function fmtCount(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return String(n);
    return String(Math.round(v * 10) / 10);
}

function renderChip(defs, defKey, value, extra) {
    const def = resolveDef(defs, defKey);

    // A withheld value must not render as a dial. Showing 0, or falling back to a
    // gauge, would turn an absent measurement into a reading.
    if (value == null) {
        const label = (def && def.name) ? def.name : defKey;
        // The scan-level state wins: "not measurable" explains every withheld score
        // in the block, where the per-metric copy would only explain one of them.
        const state = extra && extra.evaluationState;
        const empty = (state && CHIP_EMPTY_BY_STATE[state])
            || CHIP_EMPTY_STATES[defKey]
            || CHIP_EMPTY_DEFAULT;
        return `
    <div class="a11y-chip a11y-chip-unevaluated">
        <h4 class="a11y-chip-name">${escapeHtml(label)}</h4>
        <p class="a11y-chip-unevaluated-value">${escapeHtml(empty.value)}</p>
        <p class="a11y-cov-caption">${escapeHtml(empty.why)}</p>
    </div>
    `.trim();
    }

    const cls = scoreBandClassByDef(defs, defKey, value);

    // A def without a bounded range, or one missing from the payload entirely,
    // yields no gauge — fall back to the plain reading rather than interpolating
    // an absent gauge into the chip.
    // A confidence measured over part of the evidence must not read as though it
    // covered all of it: at 5% it is one engine's certainty standing in for a run
    // where most findings carried no reliability signal at all.
    const coveragePct = extra && Number(extra.coveragePct);
    const qualifier = (Number.isFinite(coveragePct) && coveragePct < 100)
        ? `measured on ${Math.round(coveragePct)}% of findings`
        : undefined;

    const content = renderGauge(defs, defKey, def, value, {
        kind: 'chip',
        unresolvedPct: extra && extra.unresolvedPct,
        qualifier
    })
        || `<h4 class="a11y-chip-name">${escapeHtml((def && def.name) ? def.name : defKey)}</h4>` +
        `<p class="a11y-chip-value">${escapeHtml(formatByDef(def, value))}</p>`;

    return `
    <div class="a11y-chip ${escapeHtml(cls)}">
        ${content}
    </div>
    `.trim();
}

/**
 * A score is never shown on its own: the caveat states what automation covered,
 * and the scan coverage figures say how much of the run actually produced data.
 */
function renderScoreCaveat(defs, defKeys, a11ySummary) {
    const caveats = defKeys
        .map((key) => resolveDef(defs, key))
        .map((def) => (def && def.caveat) ? String(def.caveat).trim() : '')
        .filter(Boolean);

    const parts = [...new Set(caveats)];

    const cov = a11ySummary && a11ySummary.scanCoverage ? a11ySummary.scanCoverage : null;
    if (cov && cov.scansSkipped > 0) {
        parts.push(`${cov.scansAnalyzed} of ${cov.scansTotal} scans analyzed - ${cov.scansSkipped} skipped and not represented above.`);
    }

    if (!parts.length) return '';

    return `<p class="a11y-score-caveat">${parts.map(escapeHtml).join(' ')}</p>`;
}

// "Supports" would claim the criterion is met. The checks only test part of what a
// criterion requires, so the passing case is labelled for what was actually observed.
/**
 * The structural signals, listed rather than summed into a score. Weighting six
 * quantities with no common unit produced a number nothing validated, on the same
 * scale and band words as the evidence score, inviting a comparison that never held.
 */
function renderReviewSignals(a11ySummary) {
    const flags = (a11ySummary && a11ySummary.flags) ? a11ySummary.flags : {};
    const reasons = Array.isArray(flags.manualReviewReasons) ? flags.manualReviewReasons.filter(Boolean) : [];

    if (!reasons.length) {
        return '<p class="a11y-review-signals a11y-review-signals-none">'
            + 'No signals suggesting automation missed part of this page.</p>';
    }

    const items = reasons.map((r) => `<li>${escapeHtml(String(r))}</li>`).join('');
    const heading = reasons.length === 1
        ? '1 signal that automation may not have seen everything:'
        : `${reasons.length} signals that automation may not have seen everything:`;

    return `
    <div class="a11y-review-signals">
        <p class="a11y-review-signals-head">${escapeHtml(heading)}</p>
        <ul class="a11y-review-signals-list">${items}</ul>
    </div>
    `.trim();
}

const SCOPE_LABELS = {
    systemic: 'On every page scanned',
    partial: 'On some pages',
    local: 'On one page only',
    unknown: 'Scope needs more than one page'
};

/**
 * Where the debt actually sits: which patterns carry it, and whether a defect is
 * systemic or local. Scope only means something once more than one page was scanned.
 */
function renderOccurrenceSection(a11ySummary) {
    const mined = (a11ySummary && a11ySummary.occurrences) ? a11ySummary.occurrences : null;
    if (!mined || !Number(mined.totals && mined.totals.clusteredOccurrences)) return '';

    const t = mined.totals;

    const patterns = (mined.topPatterns || []).slice(0, 8).map((p) => `
        <tr>
            <th scope="row"><code>${escapeHtml(p.pattern)}</code></th>
            <td>${escapeHtml(String(p.occurrences))}</td>
            <td>${escapeHtml(String(p.pages))}</td>
            <td>${escapeHtml(p.ruleIds.join(', '))}</td>
        </tr>`.trim()).join('');

    const scoped = (mined.reach || []).filter((r) => r.scope !== 'unknown');
    const reachRows = (scoped.length ? scoped : (mined.reach || [])).slice(0, 8).map((r) => `
        <tr>
            <th scope="row">${escapeHtml(r.ruleId)}</th>
            <td>${escapeHtml(SCOPE_LABELS[r.scope] || r.scope)}</td>
            <td>${escapeHtml(`${r.pagesAffected} of ${r.pagesScanned}`)}</td>
            <td>${escapeHtml(String(r.occurrences))}</td>
        </tr>`.trim()).join('');

    const headline = mined.pagesScanned > 1
        ? `${t.clusteredOccurrences} occurrences across ${t.distinctPatterns} distinct patterns - ${t.systemic} defect(s) on every page, ${t.local} on one page only.`
        : `${t.clusteredOccurrences} occurrences across ${t.distinctPatterns} distinct patterns. Scan more than one page to tell systemic defects from local ones.`;

    return `
    <details class="a11y-details a11y-occurrences">
    <summary>Where the issues cluster</summary>
    <p class="a11y-cov-headline">${escapeHtml(headline)}</p>
    <div class="a11y-cov-tablewrap">
    <table class="a11y-cov-table">
        <caption class="a11y-cov-caption">Patterns carrying the most occurrences. Fixing a shared pattern usually clears every instance at once.</caption>
        <thead><tr><th scope="col">Pattern</th><th scope="col">Occurrences</th><th scope="col">Pages</th><th scope="col">Rules</th></tr></thead>
        <tbody>${patterns}</tbody>
    </table>
    </div>
    <div class="a11y-cov-tablewrap">
    <table class="a11y-cov-table">
        <caption class="a11y-cov-caption">A defect on every page usually points at a template or design-system fix rather than a page one.</caption>
        <thead><tr><th scope="col">Rule</th><th scope="col">Scope</th><th scope="col">Pages</th><th scope="col">Occurrences</th></tr></thead>
        <tbody>${reachRows}</tbody>
    </table>
    </div>
    </details>
    `.trim();
}

/**
 * One dial only: reach is a ratio of counted criteria, bounded, with an
 * unambiguous direction. Everything else reads better as text, and a dial implies
 * a precision the other figures do not have.
 */
function renderValorationGauges(coverage) {
    const cov = coverage.coverage || {};
    const outcome = coverage.outcome || {};
    const evaluated = Number(cov.criteriaEvaluated) || 0;
    const reachable = Number(cov.criteriaAutomatable) || 0;
    const inScope = Number(cov.criteriaInScope) || 0;

    const gauges = [];

    // 1. Did the scan cover the ground automation can actually reach?
    if (reachable > 0) {
        gauges.push({
            name: 'Criteria reached',
            value: Math.round((Math.min(evaluated, reachable) / reachable) * 100),
            help: `${evaluated} of the ${reachable} criteria an automated check exists for were evaluated on this page`
                + (inScope ? `. ${inScope} criteria are in scope at this conformance level; automation can never reach ${inScope - reachable} of them.` : ''),
        });
    }

    if (!gauges.length) return '';

    const rendered = gauges.map((g) => {
        let dial = '';
        try {
            dial = buildRatingGauge({
                name: g.name,
                value: g.value,
                min: 0,
                max: 100,
                isPercent: true,
                help: g.help,
                asText: true,
                size: 140,
                thickness: 10,
                unresolvedPct: g.unresolvedPct
            }) || '';
        } catch {
            dial = `<p>${escapeHtml(g.name)}: ${escapeHtml(String(g.value))}%</p>`;
        }
        return `<div class="a11y-chip">${dial}</div>`;
    }).join('');

    return `<div class="a11y-cov-gauges" role="group" aria-label="Coverage valorations">${rendered}</div>`;
}

/**
 * Per-criterion verdicts with their coverage. The headline number says how the
 * checks that ran turned out; this says how many criteria they reached at all,
 * which is the difference between "nothing was found" and "nothing was tested".
 */
function renderCoverageSection(coverage) {
    if (!coverage || !Array.isArray(coverage.criteria) || !coverage.criteria.length) return '';

    const cov = coverage.coverage || {};
    const outcome = coverage.outcome || {};
    const evaluated = Number(cov.criteriaEvaluated) || 0;
    // criteriaInScope is null when no rule catalog was available; Number(null) is 0,
    // which would claim a scope of zero criteria rather than an unknown one.
    const inScope = (cov.criteriaInScope != null && Number.isFinite(Number(cov.criteriaInScope)))
        ? Number(cov.criteriaInScope)
        : null;

    const reachable = Number(cov.criteriaAutomatable) || 0;

    let headline;
    if (inScope !== null && reachable > 0) {
        headline = `${evaluated} of the ${reachable} criteria automation can reach were evaluated, out of ${inScope} in scope`;
    } else if (inScope !== null) {
        headline = `${evaluated} of ${inScope} criteria were evaluated by automation`;
    } else {
        headline = `${evaluated} of ${Number(cov.criteriaTouched) || 0} criteria reached by this scan were evaluated`;
    }

    const reach = [];
    if (Number(cov.criteriaNotAutomatable) > 0) reach.push(`${cov.criteriaNotAutomatable} have no automated check`);
    if (Number(cov.criteriaManualOnly) > 0) reach.push(`${cov.criteriaManualOnly} are manual review only`);
    if (Number(cov.criteriaNeedsReview) > 0) reach.push(`${cov.criteriaNeedsReview} need review`);

    // Counted against what was evaluated, which is what the removed second dial
    // showed. "No automated failure" rather than "supports": passing the checks is
    // not the criterion being met, only nothing having objected.
    const tallies = [
        ['No automated failure', outcome.supports],
        ['Partially supports', outcome.partiallySupports],
        ['Does not support', outcome.doesNotSupport]
    ].filter(([, n]) => Number.isFinite(Number(n)))
        .map(([label, n]) => [label, evaluated > 0 ? `${n} of ${evaluated}` : String(n)]);

    // Which criteria need a human, named rather than only counted. The full
    // per-criterion breakdown stays in the payload for anyone who wants it.
    const review = (Array.isArray(coverage.needsReview) ? coverage.needsReview : [])
        .map((r) => `${r.sc}${r.level ? ` (${r.level})` : ''}`)
        .join(', ');

    return `
    <details class="a11y-details a11y-coverage">
    <summary>Automated coverage</summary>
    <div class="a11y-cov-layout">
        ${renderValorationGauges(coverage)}
        <div class="a11y-cov-explain">
            <p class="a11y-cov-headline">${escapeHtml(headline)}${reach.length ? ` - ${escapeHtml(reach.join(', '))}.` : '.'}</p>
            <ul class="a11y-cov-tallies">
                ${tallies.map(([label, n]) => `<li><span>${escapeHtml(label)}</span><span>${escapeHtml(n)}</span></li>`).join('')}
            </ul>
            ${review ? `<p class="a11y-cov-review">Needs a human: ${escapeHtml(review)}</p>` : ''}
        </div>
    </div>
    </details>
    `.trim();
}

function renderMetricRow(defs, defKey, rawValue) {
    const def = resolveDef(defs, defKey);
    const label = def && def.name ? def.name : defKey;
    const help = buildDefHelp(def);

    const fallbackText = escapeHtml(formatByDef(def, rawValue));

    return `
    <li class="a11y-row">
        <div class="a11y-row-label">
            <span>${escapeHtml(label)}</span>
            ${helpDisclosure(label, help)}
        </div>
        <span class="a11y-row-value">${fallbackText}</span>
     </li>
    `.trim();
}

function renderGauge(defs, defKey, def, rawValue, {kind, unresolvedPct, qualifier} = {}) {
    if (!isGauge(def, rawValue)) {
        return undefined;
    }
    try {
        const gaugeCfg = defToRatingGaugeConfig(defs, defKey, def, Number(rawValue), kind, unresolvedPct, qualifier);
        const out = buildRatingGauge({...gaugeCfg, asText: true});
        // If gauge returns an element even with asText, be defensive
        if (typeof out === 'string' && out.trim()) return out;

        return undefined;
    } catch {
    }
    return undefined;
}

function isGauge(def, rawValue) {
    if (!def || typeof def !== 'object') return false;
    if (!isBoundedRangeDef(def)) return false;
    return Number.isFinite(typeof rawValue === 'number' ? rawValue : Number(rawValue));
}

function isBoundedRangeDef(def) {
    const min = Number(def.min);
    const max = Number(def.max);
    return Number.isFinite(min) && Number.isFinite(max);
}

function normalizedIntervals(def) {
    return Array.isArray(def.intervals) ? def.intervals.map((it) => ({
        from: it.from,
        to: it.to,
        label: it.label,
        key: it.key
    })) : [];
}

function defToRatingGaugeConfig(defs, defKey, def, value, kind, unresolvedPct, qualifier) {
    const min = Number(def.min);
    const max = Number(def.max);
    const name = (def && def.name) ? String(def.name) : String(defKey);
    const isPercent = !!def.isPercent;
    const suffix = kind ? `_${kind}` : '';
    const idPrefix = `g_${slugify(defKey)}${suffix}`;
    const help = buildDefHelp(def);
    const intervals = normalizedIntervals(def);

    return {
        name,
        value,
        min,
        max,
        intervals,
        isPercent,
        idPrefix,
        help,
        unresolvedPct: (typeof unresolvedPct === 'number' && unresolvedPct > 0) ? unresolvedPct : undefined,
        qualifier: (typeof qualifier === 'string' && qualifier.trim()) ? qualifier.trim() : undefined
    };
}

function slugify(s) {
    return String(s || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function buildDefHelp(def) {
    if (!def || typeof def !== 'object') return 'No definition available.';

    const lines = [];

    if (def.help) lines.push(String(def.help).trim());
    if (def.caveat) lines.push(String(def.caveat).trim());

    const pol = String(def.polarity || '');
    if (pol === 'higher-is-better') lines.push('Higher is better.');
    else if (pol === 'lower-is-better') lines.push('Lower is better.');

    return lines.filter(Boolean).join('\n');
}

function formatByDef(def, value) {
    if (value == null) return 'N/A';

    const n = Number(value);
    if (!Number.isFinite(n)) return 'N/A';

    return fmtNum(n, 1);
}

/* ---------------- banner logic (defs-first) ---------------- */

/**
 * Decide whether a metric value should be treated as a concern, using defs as source of truth.
 * Rule:
 * - If defs have intervals and the matched interval key is 'warn' or 'bad', it is a concern.
 * - If defs exist but have no intervals, it is not treated as a concern here (keeps logic conservative).
 * - If no def exists, return null so caller can apply a small heuristic fallback when needed.
 */
function isConcernByDef(defs, defKey, value) {
    const def = defs && defs[defKey] ? defs[defKey] : null;
    if (!def) return null;

    const interval = classifyInterval(def, value);
    if (!interval || !interval.key) return false;

    const k = String(interval.key);
    return (k === 'warn' || k === 'bad');
}

const HEURISTICS = {
    // Used only when defs do not exist for these metrics.
    confidenceLowBelow: 85,
    linkIconHeavy: {linksPer1kAbove: 60, linkTextShareBelow: 0.45},
    buttonIconHeavy: {buttonsPer1kAbove: 20, buttonTextShareBelow: 0.45}
};

function buildBannerModel({
                              defs,
                              manualReviewNeeded,

                              a11yViolations,
                              a11yIncomplete,

                              adjustedPct,
                              confidencePct,

                              domCapped,
                              shadowHostCount,
                              iframeCount,
                              hiddenRatio,
                              statefulComponentsCount,
                              linksPer1k,
                              linkTextShare,
                              linksNoTextNoNameRate,
                              buttonsPer1k,
                              buttonTextShare,
                              buttonsNoTextNoNameRate
                          }) {
    const reasons = [];

    // Always treat these as uncertainty / scope signals
    if (a11yIncomplete > 0) reasons.push(UI_TEXT.banner?.reasons?.incomplete);
    if (domCapped) reasons.push(UI_TEXT.banner?.reasons?.capped);
    if (shadowHostCount > 0) reasons.push(UI_TEXT.banner?.reasons?.shadow);
    if (iframeCount > 0) reasons.push(UI_TEXT.banner?.reasons?.iframes);

    // Confidence, defs-first
    const confConcern = isConcernByDef(defs, 'scores.confidence', confidencePct);
    if (confConcern === true) {
        reasons.push(UI_TEXT.banner?.reasons?.lowConfidence);
    } else if (confConcern === null && confidencePct != null && confidencePct < HEURISTICS.confidenceLowBelow) {
        reasons.push(UI_TEXT.banner?.reasons?.lowConfidence);
    }

    // Hidden ratio, defs-first
    const hiddenConcern = isConcernByDef(defs, 'dom.hiddenRatio', hiddenRatio);
    if (hiddenConcern === true) reasons.push(UI_TEXT.banner?.reasons?.hiddenHigh);

    // Stateful components, defs-first
    const statefulConcern = isConcernByDef(defs, 'dom.statefulComponentsCount', statefulComponentsCount);
    if (statefulConcern === true) reasons.push(UI_TEXT.banner?.reasons?.statefulHigh);

    // Links no-name, defs-first
    const linkNoNameConcern = isConcernByDef(defs, 'controls.linksNoTextNoNameRate', linksNoTextNoNameRate);
    if (linkNoNameConcern === true) reasons.push(UI_TEXT.banner?.reasons?.linkNoName);

    // Buttons no-name, defs-first
    const buttonNoNameConcern = isConcernByDef(defs, 'controls.buttonsNoTextNoNameRate', buttonsNoTextNoNameRate);
    if (buttonNoNameConcern === true) reasons.push(UI_TEXT.banner?.reasons?.buttonNoName);

    // Icon-heavy heuristics, only if defs are not available for these metrics
    const hasLinkShareDef = !!(defs && defs['controls.linkTextShare']);
    if (!hasLinkShareDef) {
        if (linksPer1k != null && linkTextShare != null &&
            linksPer1k > HEURISTICS.linkIconHeavy.linksPer1kAbove &&
            linkTextShare < HEURISTICS.linkIconHeavy.linkTextShareBelow) {
            reasons.push(UI_TEXT.banner?.reasons?.linkIconHeavy);
        }
    }

    const hasButtonShareDef = !!(defs && defs['controls.buttonTextShare']);
    if (!hasButtonShareDef) {
        if (buttonsPer1k != null && buttonTextShare != null &&
            buttonsPer1k > HEURISTICS.buttonIconHeavy.buttonsPer1kAbove &&
            buttonTextShare < HEURISTICS.buttonIconHeavy.buttonTextShareBelow) {
            reasons.push(UI_TEXT.banner?.reasons?.buttonIconHeavy);
        }
    }

    // Decide whether to show banner (banner is now a short signal, not an explanation)
    const strongUncertainty =
        (a11yIncomplete > 0) ||
        domCapped ||
        shadowHostCount > 0 ||
        iframeCount > 0 ||
        reasons.includes(UI_TEXT.banner?.reasons?.lowConfidence) ||
        reasons.includes(UI_TEXT.banner?.reasons?.hiddenHigh) ||
        reasons.includes(UI_TEXT.banner?.reasons?.statefulHigh) ||
        reasons.includes(UI_TEXT.banner?.reasons?.linkNoName) ||
        reasons.includes(UI_TEXT.banner?.reasons?.buttonNoName) ||
        reasons.includes(UI_TEXT.banner?.reasons?.linkIconHeavy) ||
        reasons.includes(UI_TEXT.banner?.reasons?.buttonIconHeavy);

    // If you only want the banner when there is a meaningful attention cue:
    if (!manualReviewNeeded && !strongUncertainty && !(a11yViolations > 0)) return null;

    const uniqueReasons = uniqStrings(reasons).filter(Boolean);

    // Severity rules:
    // - violations => bad (highest attention)
    // - capped/incomplete/low confidence/manual => warn (review recommended)
    // - else fall back to adjusted band, but do not show "warn" unless a real attention cue exists
    const adjustedBand = bandKey(defs, 'scores.adjusted', adjustedPct); // good/ok/warn/bad/null
    const hasLowConfidence = uniqueReasons.includes(UI_TEXT.banner?.reasons?.lowConfidence);

    let severity = adjustedBand || 'ok';

    if (a11yViolations > 0) {
        severity = 'bad';
    } else if (domCapped || a11yIncomplete > 0 || hasLowConfidence || manualReviewNeeded) {
        severity = 'warn';
    } else if (severity === 'warn') {
        severity = 'ok';
    }

    // Pick a single subtitle (one line) by priority
    const subtitle = pickBannerSubtitle({
        domCapped,
        a11yIncomplete,
        hasLowConfidence,
        manualReviewNeeded
    });

    const titles = UI_TEXT.banner?.titles || {};
    const title = titles[severity] || titles.warn || 'Review recommended';

    return {
        severity,   // good/ok/warn/bad
        title,      // short status label
        subtitle,   // one line, optional
        reasons: uniqueReasons.slice(0, 2) // keep banner short, narrative covers the rest
    };
}

function bandKey(metricDefs, defKey, value) {
    const defs = (metricDefs && typeof metricDefs === 'object') ? metricDefs : null;
    const def = defs ? defs[defKey] : null;
    if (!def) return null;

    const interval = classifyInterval(def, value);
    if (interval && interval.key) return String(interval.key);

    // Fallback for percent-like scores when defs lack intervals
    const v = Number(value);
    if (!Number.isFinite(v)) return null;
    if (v >= 85) return 'good';
    if (v >= 60) return 'ok';
    if (v >= 40) return 'warn';
    return 'bad';
}

function pickBannerSubtitle({ domCapped, a11yIncomplete, hasLowConfidence, manualReviewNeeded }) {
    const sub = UI_TEXT.banner?.subtitles || {};

    if (domCapped && sub.capped) return sub.capped;
    if (a11yIncomplete > 0 && sub.incomplete) return sub.incomplete;
    if (hasLowConfidence && sub.lowConfidence) return sub.lowConfidence;
    if (manualReviewNeeded && sub.manual) return sub.manual;

    return '';
}

function uniqStrings(arr) {
    const seen = new Set();
    const out = [];
    for (const v of (arr || [])) {
        const s = (v == null) ? '' : String(v).trim();
        if (!s) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

function renderBanner(model) {
    const severity = model?.severity || 'warn';
    const title = model?.title || 'Assessment summary';
    const subtitle = model?.subtitle || '';

    const reasonsHtml = (model.reasons && model.reasons.length)
        ? `<ul class="a11y-bullets">${model.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
        : '';

    return `
  <div class="a11y-banner a11y-banner-${escapeHtml(severity)}" role="note" aria-label="Assessment summary">
    <div class="a11y-banner-title">${escapeHtml(title)}</div>

    ${subtitle ? `<p class="a11y-banner-subtitle">${escapeHtml(subtitle)}</p>` : ''}

    ${reasonsHtml ? `<div class="a11y-banner-signals">${reasonsHtml}</div>` : ''}
  </div>
  `.trim();
}

/**
 * The "?" beside a metric, as a native disclosure. <details> is used rather than
 * a scripted button so the help still opens in the exported report, and so the
 * expanded state and focus behaviour come from the platform. The glyph is
 * decorative; the summary names itself after the metric it explains.
 */
function helpDisclosure(label, help) {
    const text = String(help ?? '').trim();
    if (!text) return '';

    return `<details class="a11y-help-disclosure">` +
        `<summary class="a11y-help">` +
        `<span aria-hidden="true">?</span>` +
        `<span class="visually-hidden">About ${escapeHtml(label)}</span>` +
        `</summary>` +
        `<p class="a11y-help-body">${escapeHtml(text)}</p>` +
        `</details>`;
}

/* ---------------- existing helpers ---------------- */

function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function fmtNum(v, decimals = 1) {
    if (v == null) return 'N/A';
    const n = Number(v);
    if (!Number.isFinite(n)) return 'N/A';
    const d = Math.max(0, Math.min(6, Number(decimals) || 0));
    return n.toFixed(d).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function kpi(cfg, value) {
    return `
    <div class="a11y-kpi">
        <div class="a11y-kpi-label">
            <span>${escapeHtml(cfg.label)}</span>
            ${helpDisclosure(cfg.label, cfg.help)}
        </div>
        <div class="a11y-kpi-value">${escapeHtml(String(value ?? 'N/A'))}</div>
    </div>
    `.trim();
}

function classifyInterval(def, rawValue) {
    if (!def || !def.intervals || !def.intervals.length) return null;
    const v = Number(rawValue);
    if (!Number.isFinite(v)) return null;

    for (const it of def.intervals) {
        const from = Number(it.from);
        const toRaw = it.to;

        const to =
            toRaw === Number.POSITIVE_INFINITY
                ? Number.POSITIVE_INFINITY
                : Number(toRaw);

        if (!Number.isFinite(from) || (!Number.isFinite(to) && to !== Number.POSITIVE_INFINITY)) continue;

        if (to === Number.POSITIVE_INFINITY) {
            if (v >= from) return it;
        } else {
            if (v >= from && (v < to || (def.max != null && to === def.max && v <= to))) return it;
        }
    }
    return null;
}

function bandKeyToClass(key) {
    if (key === 'good') return 'a11y-band-good';
    if (key === 'ok') return 'a11y-band-ok';
    if (key === 'warn') return 'a11y-band-warn';
    if (key === 'bad') return 'a11y-band-bad';
    return 'a11y-band-unknown';
}

function scoreBandClassByDef(metricDefs, defKey, value) {
    const defs = (metricDefs && typeof metricDefs === 'object') ? metricDefs : null;
    const def = defs ? defs[defKey] : null;
    if (!def) return 'a11y-band-unknown';

    const interval = classifyInterval(def, value);
    if (interval && interval.key) return bandKeyToClass(interval.key);

    const s = Number(value);
    if (!Number.isFinite(s)) return 'a11y-band-unknown';
    if (s >= 85) return 'a11y-band-good';
    if (s >= 60) return 'a11y-band-ok';
    if (s >= 40) return 'a11y-band-warn';
    return 'a11y-band-bad';
}