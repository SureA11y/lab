'use strict';

/**
 * renderA11yNarrative
 *
 * Purpose:
 * - Converts numeric accessibility metrics (a11ySummary + domMetrics) into a
 *   human-readable interpretation intended for triage and decision support.
 * - Produces explanatory text, not conformance claims.
 * - Uses controlled variation so repeated scans do not always read the same.
 *
 * Core behavior:
 * - The interpretation is derived from computed metrics (scores, ratios, flags),
 *   not from raw DOM or rule-level data.
 * - Text selection is deterministic for a given input and seed.
 * - The same inputs + same seed always produce the same output.
 *
 * Parameters:
 * - a11ySummary:
 *     Aggregated accessibility metrics (scores, counts, flags).
 *
 * - domMetrics:
 *     Structural and density metrics extracted from the DOM
 *     (coverage, hidden content, control density, complexity signals).
 *
 * - metricDefs:
 *     Definitions used to classify numeric values into bands (good / ok / warn / bad).
 *     These definitions drive the semantic meaning of the output.
 *
 * - seed (optional):
 *     Controls narrative variation.
 *
 *     If omitted:
 *       - A deterministic seed is derived from the metric values.
 *       - Identical inputs always produce identical wording.
 *
 *     If provided:
 *       - Different seed values produce different phrasing,
 *         while preserving the same meaning.
 *
 *     Common patterns:
 *
 *       // Stable per page (same text every time for the same page)
 *       seed: pageId
 *
 *       // Stable per session, but varies between sessions
 *       seed: sessionId
 *
 *       // Controlled variation (e.g. cycle between 5 variants)
 *       seed: `variant:${index}`
 *
 *       // Fully variable (not recommended for comparisons)
 *       seed: `${Date.now()}`
 *
 * - mode (optional, default: "standard"):
 *     Controls verbosity.
 *     - "standard": full interpretation with context and guidance.
 *     - "concise": shorter output with fewer explanations.
 *
 * Output:
 * - Returns an HTML string ready to be injected into the UI.
 * - The output typically includes:
 *     - A short interpretive title
 *     - A summary paragraph
 *     - Key reasons ("Why this looks this way")
 *     - Suggested validation actions
 *     - Optional follow-up guidance
 *
 * Notes:
 * - This module does NOT assert WCAG conformance.
 * - It is intended for prioritization and sense-making, not certification.
 * - Wording may vary, meaning does not.
 */
export function renderA11yNarrative({ a11ySummary, domMetrics, metricDefs, seed, mode = 'standard' } = {}) {
  if (!a11ySummary || !domMetrics) return '';

  const defs = (metricDefs && typeof metricDefs === 'object') ? metricDefs : {};
  const s = a11ySummary;
  const d = domMetrics;

  const scores = s?.scores || {};
  const pageStats = s?.stats?.pageAccessibility || null;

  const inputs = s?.inputs || {};
  const flags = s?.flags || {};

  // The findings' counts.
  const counts = inputs.engine || {};
  const controls = inputs.controls || {};

  const tm = d?.textMetrics || null;
  const tmLinks = tm?.links || {};
  const tmButtons = tm?.buttons || {};

  // Prefer cleaned summary inputs, fallback to textMetrics.
  const linksPer1k = num(controls.linksPer1k, num(tmLinks.linksPer1k, null));
  const linkTextShare = num(controls.linkTextShare, num(tmLinks.linkTextShare, null));
  const linksNoTextRate = num(controls.linksNoTextRate, num(tmLinks.linksNoVisibleTextRate, null));
  const linksNoTextNoNameRate = num(controls.linksNoTextNoNameRate, num(tmLinks.linksNoTextNoNameSignalRate, null));

  const buttonsPer1k = num(controls.buttonsPer1k, num(tmButtons.buttonsPer1k, null));
  const buttonTextShare = num(controls.buttonTextShare, num(tmButtons.buttonTextShare, null));
  const buttonsNoTextRate = num(controls.buttonsNoTextRate, num(tmButtons.buttonsNoVisibleTextRate, null));
  const buttonsNoTextNoNameRate = num(controls.buttonsNoTextNoNameRate, num(tmButtons.buttonsNoTextNoNameSignalRate, null));

  const model = {
    // Headline scores
    adjusted: num(scores.adjusted, null),
    evidence: num(scores.evidence, null),
    confidence: num(scores.confidence, null),
    avgPageAccessibility: num(scores.avgPageAccessibility, num(scores.adjusted, null)),
    scores,
    pageStats,


    // Findings outcomes
    violations: num(counts.violations, 0),
    incomplete: num(counts.incomplete, 0),
    incompleteLikelyFail: num(counts.incompleteLikelyFail, 0),
    passes: num(counts.passes, 0),

    // Flags and scope signals
    manualReviewNeeded: !!flags.manualReviewNeeded,
    capped: !!d.capped,

    // DOM metrics
    semanticRatio: num(d.semanticRatio, null),
    coverageRatio: num(d.coverageRatio, null),
    hiddenRatio: num(d.hiddenRatio, null),
    customControlsRatio: num(d.customControlsRatio, null),
    statefulComponentsCount: num(d.statefulComponentsCount, null),
    depthMax: num(d.depthMax, null),
    focusableDensityPer1k: num(d.focusableDensityPer1k, null),
    iframeCount: num(d.iframeCount, 0),
    shadowHostCount: num(d.shadowHostCount, 0),
    positiveTabindexCount: num(d.positiveTabindexCount, null),

    // Control heuristics
    linksPer1k,
    linkTextShare,
    linksNoTextRate,
    linksNoTextNoNameRate,
    buttonsPer1k,
    buttonTextShare,
    buttonsNoTextRate,
    buttonsNoTextNoNameRate
  };

  const rng = mulberry32(hash32(String(seed ?? deriveSeed(model))));

  // Banding info, keyed by metricDefs.
  const band = {
    adjusted: bandMeta(defs, 'scores.adjusted', model.adjusted),
    evidence: bandMeta(defs, 'scores.evidence', model.evidence),
    confidence: bandMeta(defs, 'scores.confidence', model.confidence),

    coverageRatio: bandMeta(defs, 'dom.coverageRatio', model.coverageRatio),
    hiddenRatio: bandMeta(defs, 'dom.hiddenRatio', model.hiddenRatio),
    customControlsRatio: bandMeta(defs, 'dom.customControlsRatio', model.customControlsRatio),
    statefulComponentsCount: bandMeta(defs, 'dom.statefulComponentsCount', model.statefulComponentsCount),
    linksNoTextNoNameRate: bandMeta(defs, 'controls.linksNoTextNoNameRate', model.linksNoTextNoNameRate),
    buttonsNoTextNoNameRate: bandMeta(defs, 'controls.buttonsNoTextNoNameRate', model.buttonsNoTextNoNameRate)
  };

  const derived = deriveSignals({ model, band, defs });
  const narrative = composeNarrative({ model, band, derived, defs, rng, mode });

  if (!narrative) return '';

  return renderHtml({ narrative });
}

/* -------------------------------- seed helper -------------------------------- */
export function createNarrativeSeed({ pageId, mode = 'stable', variants = 8 }) {
  if (mode === 'stable') return pageId;

  if (mode === 'session') {
    let id = sessionStorage.getItem('a11yNarrativeSessionId');
    if (!id) {
      id = String(Date.now());
      sessionStorage.setItem('a11yNarrativeSessionId', id);
    }
    return `${pageId}:${id}`;
  }

  if (mode === 'rotate') {
    const key = `a11yNarrativeVariant:${pageId}`;
    let idx = Number(localStorage.getItem(key));

    if (!Number.isFinite(idx)) idx = 0;
    else idx = (idx + 1) % variants;

    localStorage.setItem(key, String(idx));
    return `${pageId}:variant:${idx}`;
  }

  if (mode === 'random') {
    return `${pageId}:${Date.now()}`;
  }

  return pageId;
}

/* -------------------------------- composition -------------------------------- */

function deriveSignals({ model, band, defs }) {
  const signals = {};

  // Overall stance
  signals.adjustedBand = band?.adjusted?.key || null;
  signals.evidenceBand = band?.evidence?.key || null;
  signals.confidenceBand = band?.confidence?.key || null;

  // Top-level uncertainties
  signals.hasIncomplete = model.incomplete > 0;
  signals.hasViolations = model.violations > 0;
  signals.isCapped = !!model.capped;
  signals.hasShadow = model.shadowHostCount > 0;
  signals.hasIframes = model.iframeCount > 0;

  // Complexity signals (defs-driven when possible)
  signals.lowCoverage = isConcern(defs, 'dom.coverageRatio', model.coverageRatio);
  signals.hiddenHigh = isConcern(defs, 'dom.hiddenRatio', model.hiddenRatio);
  signals.customControlsHigh =
      isConcern(defs, 'dom.customControlsRatio', model.customControlsRatio) ||
      (num(model.customControlsRatio, 0) > 0.40);

  signals.statefulHigh = isConcern(defs, 'dom.statefulComponentsCount', model.statefulComponentsCount);

  // Dense control layer signals
  signals.linkNoNameHigh =
      isConcern(defs, 'controls.linksNoTextNoNameRate', model.linksNoTextNoNameRate) ||
      (num(model.linksNoTextNoNameRate, 0) > 0);

  signals.buttonNoNameHigh =
      isConcern(defs, 'controls.buttonsNoTextNoNameRate', model.buttonsNoTextNoNameRate) ||
      (num(model.buttonsNoTextNoNameRate, 0) > 0);

  signals.linksNoTextSome = num(model.linksNoTextRate, 0) > 0;
  signals.buttonsNoTextSome = num(model.buttonsNoTextRate, 0) > 0;

  // Confidence stance
  const confKey = signals.confidenceBand;
  signals.confidenceLow = (confKey === 'bad');
  signals.confidenceMedium = (confKey === 'warn');
  signals.confidenceGood = (confKey === 'good' || confKey === 'ok');

  // A confidence measured over only part of the evidence cannot support a claim about
  // how representative the run was: at 5% coverage it is one engine's certainty being
  // read as the whole page's.
  const confCoverage = num(model.scores?.confidenceCoverage, null);
  signals.confidencePartial = confCoverage !== null && confCoverage < 100;

  // Nothing about the page can be claimed from a score that was never measurable.
  signals.notMeasurable = model.scores?.evaluationState === 'notMeasurable';

  // Read from the structural signals directly rather than a weighted composite.
  signals.structuralComplexity =
      !!(signals.customControlsHigh || signals.statefulHigh || signals.hiddenHigh);

  // Special mismatch: high evidence but low confidence
  signals.mismatchEvidenceConfidence =
      (signals.evidenceBand === 'good' || signals.evidenceBand === 'ok') &&
      (signals.confidenceBand === 'warn' || signals.confidenceBand === 'bad');

  signals.mismatchStructureEvidence =
      signals.structuralComplexity &&
      (signals.evidenceBand === 'good' || signals.evidenceBand === 'ok');

  signals.mismatchEvidenceViolations =
      (signals.evidenceBand === 'good' || signals.evidenceBand === 'ok') && signals.hasViolations;

  // Near-boundary flags for softer language
  signals.adjustedNear = band?.adjusted?.near || null;
  signals.confidenceNear = band?.confidence?.near || null;

  // Manual review flag, treat as "policy" output
  signals.manualReviewNeeded = !!model.manualReviewNeeded;

  // Driver scoring to prioritize messages
  signals.driverScores = scoreDrivers({ signals });

  return signals;
}

function scoreDrivers({ signals }) {
  // Higher score means more important driver for explanation and actions.
  const scores = [];

  pushScore(scores, 'capped', signals.isCapped, 100);
  pushScore(scores, 'incomplete', signals.hasIncomplete, 95);
  pushScore(scores, 'violations', signals.hasViolations, 90);

  pushScore(scores, 'confidenceLow', signals.confidenceLow, 88);
  pushScore(scores, 'confidenceMedium', signals.confidenceMedium, 72);

  pushScore(scores, 'linkNoName', signals.linkNoNameHigh, 85);
  pushScore(scores, 'buttonNoName', signals.buttonNoNameHigh, 85);

  pushScore(scores, 'customControls', signals.customControlsHigh, 70);
  pushScore(scores, 'hidden', signals.hiddenHigh, 62);
  pushScore(scores, 'stateful', signals.statefulHigh, 58);
  pushScore(scores, 'lowCoverage', signals.lowCoverage, 52);

  pushScore(scores, 'shadow', signals.hasShadow, 45);
  pushScore(scores, 'iframes', signals.hasIframes, 40);

  // Soft cues
  pushScore(scores, 'linksNoText', signals.linksNoTextSome, 25);
  pushScore(scores, 'buttonsNoText', signals.buttonsNoTextSome, 25);

  // Sort by score desc
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function pushScore(arr, key, cond, score) {
  if (cond) arr.push({ key, score });
}

function composeNarrative({ model, band, derived, rng, mode }) {
  const drivers = derived.driverScores || [];
  const topDrivers = drivers.slice(0, mode === 'concise' ? 2 : 4).map(d => d.key);

  const title = pick(rng, titleVariants({ band, derived }));
  const summary = pick(rng, summaryVariants({ derived, topDrivers }));

  const why = [];
  const validateFirst = [];
  const validate = [];
  const next = [];
  const notes = [];

  // WHY bullets, prioritize by drivers
  for (const k of topDrivers) {
    const pool = WHY_CHIPS[k]?.({ model, band, derived }) || [];
    const line = pick(rng, pool);
    if (line) pushDedup(why, line);
  }

  // Fill with secondary positives if space allows
  if (mode !== 'concise') {
    const posKeys = positiveKeys({ derived });
    for (const k of posKeys) {
      if (why.length >= 4) break;
      const pool = POSITIVE_CHIPS[k]?.({ model, band, derived }) || [];
      const line = pick(rng, pool);
      if (line) pushDedup(why, line);
    }
  }

  // VALIDATE FIRST, smallest high-value checklist
  const validateFirstKeys = buildValidateFirstKeys({ derived, topDrivers });
  for (const k of validateFirstKeys) {
    const pool = VALIDATE_FIRST_CHIPS[k]?.({ model, band, derived }) || [];
    const line = pick(rng, pool);
    if (line) pushDedup(validateFirst, line);
    if (validateFirst.length >= (mode === 'concise' ? 1 : 2)) break;
  }

  // WHAT TO VALIDATE, deeper checklist mapped from drivers
  const validateKeys = buildValidateKeys({ derived, topDrivers });
  for (const k of validateKeys) {
    const pool = VALIDATE_CHIPS[k]?.({ model, band, derived }) || [];
    const line = pick(rng, pool);
    if (line) pushDedup(validate, line);
    if (validate.length >= (mode === 'concise' ? 2 : 6)) break;
  }

  // NEXT actions, mapped from drivers, de-dup
  const actionKeys = buildActionKeys({ derived, topDrivers });
  for (const k of actionKeys) {
    const pool = NEXT_CHIPS[k]?.({ model, band, derived }) || [];
    const line = pick(rng, pool);
    if (line) pushDedup(next, line);
    if (next.length >= (mode === 'concise' ? 2 : 5)) break;
  }

  // Notes, only when relevant
  if (derived.mismatchEvidenceConfidence) {
    notes.push(pick(rng, NOTE_CHIPS.mismatchEvidenceConfidence({})));
  }
  if (derived.isCapped) {
    notes.push(pick(rng, NOTE_CHIPS.capped({})));
  }
  if (!notes.length) {
    notes.push(pick(rng, NOTE_CHIPS.default({})));
  }

  // Trim to mode
  const whyMax = mode === 'concise' ? 2 : 4;
  const nextMax = mode === 'concise' ? 2 : 5;

  // --- Page accessibility distribution interpretation (global only)
  if (model.pageStats && Number.isFinite(model.pageStats.n) && model.pageStats.n >= 2) {
    const s = model.pageStats;
    const nPages = s.n;

    const mean = s.mean;
    const median = s.median;
    const min = s.min;
    const max = s.max;
    const p10 = s.p10;
    const p90 = s.p90;
    const iqr = s.iqr;

    const fmt = v => Number.isFinite(v) ? Math.round(v) : 'n/a';

    // For very small sample sizes, percentiles can collapse to the same value.
    // Use min/max as the displayed "most pages fall between" range for n <= 4.
    const rangeLo = (nPages <= 4) ? min : p10;
    const rangeHi = (nPages <= 4) ? max : p90;

    const spread = (Number.isFinite(rangeLo) && Number.isFinite(rangeHi))
        ? rangeHi - rangeLo
        : null;

    if (Number.isFinite(iqr) && iqr <= 8 && spread !== null && spread <= 15) {
      if(nPages === 2) {
        notes.push(
            `Accessibility scores are consistent across the ${nPages} scanned pages, with the values ${fmt(rangeLo)} and ${fmt(rangeHi)}.`
        );
      } else {
        notes.push(
            `Accessibility scores are consistent across the ${nPages} scanned pages, with most pages falling between ${fmt(rangeLo)} and ${fmt(rangeHi)}.`
        );
      }
    } else if (Number.isFinite(iqr) && iqr <= 15) {
      if(nPages === 2) {
        notes.push(
            `Accessibility varies across the ${nPages} scanned pages. The typical page scores around ${fmt(mean)}, with values ${fmt(rangeLo)} and ${fmt(rangeHi)}.`
        );
      } else {
        notes.push(
            `Accessibility varies across the ${nPages} scanned pages. The typical page scores around ${fmt(mean)}, with most pages between ${fmt(rangeLo)} and ${fmt(rangeHi)}.`
        );
      }
    } else {
      notes.push(
          `Accessibility varies significantly across the ${nPages} scanned pages. Scores range from ${fmt(min)} to ${fmt(max)}, indicating uneven accessibility quality.`
      );
      notes.push(
          `Improving the lowest scoring pages would likely have the biggest impact.`
      );
    }

    if (
        Number.isFinite(mean) &&
        Number.isFinite(median) &&
        Math.abs(mean - median) >= 8
    ) {
      notes.push(
          `The difference between the average and median suggests that a few pages are disproportionately affecting the overall result.`
      );
    }
  }

  return {
    title,
    summary,
    why: why.slice(0, whyMax),
    validateFirst: validateFirst.slice(0, mode === 'concise' ? 1 : 2),
    validate: validate.slice(0, mode === 'concise' ? 2 : 6),
    next: next.slice(0, nextMax),
    notes: notes.slice(0, mode === 'concise' ? 1 : 2),
    tags: topDrivers
  };
}

function buildActionKeys({ derived, topDrivers }) {
  const keys = [];

  // Always prioritize: incomplete, violations, capped
  if (derived.hasIncomplete) keys.push('reviewIncomplete');
  if (derived.hasViolations) keys.push('triageViolations');
  if (derived.isCapped) keys.push('handleCapped');

  // Then map other drivers
  for (const d of topDrivers) {
    switch (d) {
      case 'confidenceLow':
      case 'confidenceMedium':
        keys.push('validateJourneys');
        break;
      case 'customControls':
        keys.push('checkCustomControls');
        break;
      case 'hidden':
      case 'stateful':
        keys.push('checkStates');
        break;
      case 'lowCoverage':
        keys.push('checkStructure');
        break;
      case 'linkNoName':
        keys.push('checkLinkNames');
        break;
      case 'buttonNoName':
        keys.push('checkButtonNames');
        break;
      case 'shadow':
        keys.push('checkShadowDom');
        break;
      case 'iframes':
        keys.push('checkIframes');
        break;
      default:
        break;
    }
  }

  if (!keys.length) keys.push('genericFollowUp');
  return uniq(keys);
}

function buildValidateFirstKeys({ derived, topDrivers }) {
  const keys = [];

  // Highest priority uncertainty signals
  if (derived.isCapped) keys.push('vfCapped');
  if (derived.hasIncomplete) keys.push('vfIncomplete');

  // Reliability stance
  if (derived.confidenceLow || derived.confidenceMedium) keys.push('vfLowConfidence');

  // Driver-based focus
  if (derived.customControlsHigh || topDrivers.includes('customControls')) keys.push('vfCustomControls');
  if (derived.linkNoNameHigh || derived.buttonNoNameHigh || topDrivers.includes('linkNoName') || topDrivers.includes('buttonNoName')) keys.push('vfNames');
  if (derived.hasShadow || derived.hasIframes || topDrivers.includes('shadow') || topDrivers.includes('iframes')) keys.push('vfEmbedded');

  // Always keep a minimal starting point
  if (!keys.length) keys.push('vfSpotChecks');
  if (keys.length === 1) keys.push('vfKeyJourneys');

  return uniq(keys);
}

function buildValidateKeys({ derived, topDrivers }) {
  const keys = [];

  // Always include basics when uncertainty is present
  if (derived.hasIncomplete) keys.push('validateIncomplete');
  if (derived.hasViolations) keys.push('validateViolations');
  if (derived.isCapped) keys.push('validateCapped');

  // Confidence bands influence breadth of validation
  if (derived.confidenceLow) keys.push('validateConfidenceLow');
  else if (derived.confidenceMedium) keys.push('validateConfidenceMedium');

  // Driver-based validation themes
  for (const d of topDrivers) {
    switch (d) {
      case 'customControls':
        keys.push('validateKeyboard');
        keys.push('validateNamesRolesStates');
        break;
      case 'hidden':
      case 'stateful':
        keys.push('validateFocusManagement');
        keys.push('validateAnnouncements');
        break;
      case 'lowCoverage':
        keys.push('validateReadingOrder');
        break;
      case 'linkNoName':
      case 'buttonNoName':
        keys.push('validateIconControls');
        break;
      case 'shadow':
        keys.push('validateShadowComponents');
        break;
      case 'iframes':
        keys.push('validateEmbeddedFlows');
        break;
      default:
        break;
    }
  }

  if (!keys.length) keys.push('validateKeyJourneys');
  return uniq(keys);
}

function positiveKeys({ derived }) {
  const keys = [];
  const ab = derived.adjustedBand;
  // A scan too thin to measure has no positives to report: every one of these reads as
  // a statement about the page, and the page is exactly what was not measured.
  if (derived.notMeasurable) return [];

  if (ab === 'good') keys.push('adjustedHigh');
  if ((derived.evidenceBand === 'good' || derived.evidenceBand === 'ok') && !derived.hasViolations) keys.push('evidenceClean');
  if (derived.confidenceGood && !derived.isCapped && !derived.confidencePartial) keys.push('confidenceGood');
  if (!derived.hasIncomplete) keys.push('noIncomplete');
  return keys.slice(0, 3);
}

/* -------------------------------- text libraries -------------------------------- */

function titleVariants({ derived }) {
  const adj = derived.adjustedBand;
  const near = derived.adjustedNear;

  const strengthWord = (() => {
    if (adj === 'good') return pickDet(derived, 't_good', [
      'Interpretation',
      'Triage summary',
      'Automated snapshot',
      'What the metrics suggest'
    ]);

    if (adj === 'ok') return pickDet(derived, 't_ok', [
      'Interpretation',
      'Triage summary',
      'Mixed snapshot',
      'What to validate next'
    ]);

    if (adj === 'warn') return pickDet(derived, 't_warn', [
      'Interpretation',
      'Triage summary',
      'More validation needed',
      'Why this needs review'
    ]);

    if (adj === 'bad') return pickDet(derived, 't_bad', [
      'Interpretation',
      'Triage summary',
      'Higher risk snapshot',
      'Where to focus first'
    ]);
    return 'Interpretation';
  })();

  const boundary = (near ? pickDet(derived, 't_near', [
    'near a threshold',
    'close to a band boundary',
    'around a boundary',
    'borderline for its band'
  ]) : null);

  const manual = derived.manualReviewNeeded ? pickDet(derived, 't_manual', [
    'manual validation is needed',
    'plan manual verification',
    'include manual checks',
    'confirm with manual validation'
  ]) : pickDet(derived, 't_manual2', [
    'confirm key flows manually',
    'include a brief spot check',
    'validate key journeys',
    'add quick manual checks'
  ]);

  const parts = [strengthWord];
  if (boundary && (adj === 'ok' || adj === 'warn')) parts.push(boundary);
  parts.push(manual);

  return [parts.join(', ')];
}

function summaryVariants({ derived, topDrivers }) {
  const adj = derived.adjustedBand;
  const caution = derived.isCapped || derived.hasIncomplete || derived.confidenceLow || derived.confidenceMedium;

  const base = [
    'This interpretation turns the displayed metrics into a short, practical reading.',
    'This explanation summarizes what the current metrics suggest, in plain language.',
    'This section translates the numbers into a triage oriented summary.'
  ];

  const overall = (() => {
    if (adj === 'good' && !caution) return [
      'Overall, the dashboard signal is positive, with fewer risk indicators and good automation reliability.',
      'Overall, the results look encouraging, and the scan indicates a relatively straightforward page.'
    ];
    if (adj === 'good' && caution) return [
      'Overall, the indicator is strong, but some uncertainty signals suggest you should still validate key journeys.',
      'Overall, the automated picture looks good, but reliability signals suggest caution for interactive behavior.'
    ];
    if (adj === 'ok') return [
      'Overall, the signal is mixed, some areas look fine, and some deserve follow up checks.',
      'Overall, this is a moderate snapshot, there are some risk indicators worth investigating.'
    ];
    if (adj === 'warn') return [
      'Overall, the signal leans risky, several indicators suggest manual verification should be planned.',
      'Overall, multiple risk signals appear, prioritize this page for deeper checks.'
    ];
    if (adj === 'bad') return [
      'Overall, the signal is high risk, plan manual validation and remediation follow up.',
      'Overall, the metrics suggest significant risk, this page likely needs attention and retesting.'
    ];
    return [
      'Overall, the metrics provide a triage snapshot, focus on the main drivers below.'
    ];
  })();

  const relationship = [];
  if (derived.mismatchEvidenceConfidence) {
    relationship.push(pickDet(derived, 's_rel1', [
      'Automated evidence looks relatively clean, but confidence is lower, so manual validation matters more here.',
      'The tool signal is decent, but confidence is reduced, so treat automation as a hint, not a conclusion.'
    ]));
  } else if (derived.mismatchStructureEvidence) {
    relationship.push(pickDet(derived, 's_rel2', [
      'The tool evidence is fairly positive, but structure signals suggest a complex UI, which can hide interaction issues.',
      'Even with decent automated evidence, the page structure looks less audit friendly, plan manual checks.'
    ]));
  } else {
    relationship.push(pickDet(derived, 's_rel3', [
      'Think of evidence as what automation detected, and confidence as how sure the engine was about the findings it reported - not as how much of the page was checked.',
      'Evidence reflects tool outcomes, and confidence reflects how certain the engine was about what it found. How much was checked is the coverage figures, not confidence.'
    ]));
  }

  const addDrivers = (() => {
    const d = topDrivers.slice(0, 2);
    if (!d.length) return null;
    const map = {
      capped: 'partial metrics due to scan limits',
      incomplete: 'inconclusive checks',
      violations: 'detected failures',
      confidenceLow: 'low automation confidence',
      confidenceMedium: 'moderate automation confidence',
      customControls: 'custom interaction patterns',
      hidden: 'hidden or conditional content',
      stateful: 'stateful components',
      lowCoverage: 'a low share of meaningful content',
      linkNoName: 'links without name signals',
      buttonNoName: 'buttons without name signals',
      shadow: 'Shadow DOM components',
      iframes: 'embedded iframe content'
    };
    const labels = d.map(x => map[x]).filter(Boolean);
    if (!labels.length) return null;
    return pickDet(derived, 's_rel4', [
      `Top signals here are ${labels.join(' and ')}.`,
      `The main drivers are ${labels.join(' and ')}.`,
      `Most of the explanation comes from ${labels.join(' and ')}.`
    ]);
  })();

  const items = [];
  items.push(pickDet(derived, 's_base', base));
  items.push(pickDet(derived, 's_overall', overall));
  items.push(relationship[0]);
  if (addDrivers) items.push(addDrivers);

  return [items.filter(Boolean).join(' ')];
}

/* WHY chips (drivers) */
const WHY_CHIPS = {
  capped: () => [
    'The DOM traversal hit a cap, so some metrics represent only a partial view of the page.',
    'The scan stopped early due to size limits, interpret the numbers as a sample rather than the full DOM.',
    'A scan cap was reached, metrics may underrepresent complexity and hidden states.'
  ],
  incomplete: ({ model }) => (model.incompleteLikelyFail > 0
    // Where the engine says which way its questions lean, the likely
    // failures are where a reviewer starts.
    ? [
      `There are ${model.incomplete} incomplete automated checks; ${model.incompleteLikelyFail} of their questions lean toward a failure, confirm those first, each one says how to check it.`,
      `Some automated checks were inconclusive, and ${model.incompleteLikelyFail} of their questions likely fail: start manual verification there, following each one's steps.`,
      `The scan includes incomplete results, ${model.incompleteLikelyFail} of them likely failures to confirm, a starting point for manual review.`
    ]
    : [
      `There are ${model.incomplete} incomplete automated checks, these require manual validation.`,
      'Some automated checks were inconclusive, plan manual verification for those areas.',
      'The scan includes incomplete results, which is a common reason to treat automation as a starting point.'
    ]),
  violations: ({ model }) => [
    `The scan detected ${model.violations} violations, these are likely failures that need investigation.`,
    'Automated checks found confirmed issues, treat these as remediation candidates and retest.',
    'At least one likely failure was detected by automation, review impact and affected scope.'
  ],
  confidenceLow: () => [
    'Confidence is low, complex patterns may reduce how much automation can reliably see.',
    'Automation reliability looks reduced for this page, manual checks should drive decisions.',
    'Confidence is in a low band, treat the automated score as a hint only.',
    'Low confidence suggests the page uses patterns that tools struggle to evaluate reliably.',
    'Automation is less trustworthy here, complexity signals indicate manual validation is essential.',
    'The page shows uncertainty signals, so automated evidence should be treated cautiously.'
  ],
  confidenceMedium: () => [
    'Confidence is moderate, automation is useful, but manual checks are still important for interactive behavior.',
    'Reliability signals are mixed, use automation for triage, then confirm manually.',
    'Confidence sits in a caution band, automation may miss state and focus issues.'
  ],
  customControls: () => [
    'Custom control signals are high, non native widgets often need careful keyboard and name validation.',
    'Many interactive patterns appear custom rather than native controls, test focus, roles, names, and states.',
    'A higher custom controls ratio suggests more manual validation effort and higher risk of interaction issues.'
  ],
  hidden: () => [
    'Hidden or conditional content signals are higher, verify visibility changes, announcements, and focus handling.',
    'A higher hidden content ratio often correlates with accordions, tabs, and dynamic panels, test state behavior.',
    'More hidden content is present, check that show and hide behavior is accessible and predictable.'
  ],
  stateful: () => [
    'Stateful component signals are higher, this usually means more dynamic behavior to validate manually.',
    'The UI appears state heavy, validate dialogs, expanded states, and interaction flows.',
    'Stateful patterns are present, manual validation should include state changes and announcements.'
  ],
  lowCoverage: () => [
    'The share of meaningful content looks low, which can indicate heavy layout scaffolding or repeated containers, making auditing harder.',
    'A low share of meaningful content suggests a lot of DOM that carries none, so automation may be less representative.',
    'A low share of meaningful content can be a sign of complex rendering patterns, consider deeper manual sampling.'
  ],
  linkNoName: () => [
    'Some links appear to lack visible text and basic name signals, this is often a usability blocker for assistive tech users.',
    'A non zero "links no text and no name" rate suggests unlabeled icon links, confirm accessible names.',
    'There are link elements that look unnamed, prioritize checking link labels and accessible names.'
  ],
  buttonNoName: () => [
    'Some buttons appear to lack visible text and basic name signals, confirm accessible names and states.',
    'A non zero "buttons no text and no name" rate suggests unlabeled icon buttons, verify naming.',
    'There are button elements that look unnamed, prioritize checking button labels and accessible names.'
  ],
  shadow: () => [
    'Shadow DOM is present, depending on tooling and configuration, automation coverage can be reduced.',
    'Web components with Shadow DOM appear in the page, prioritize manual validation for those components.',
    'Shadow hosts were detected, treat automation coverage as less predictable for custom components.'
  ],
  iframes: () => [
    'The page includes iframes, embedded content may not be fully covered by the same scan context.',
    'Iframes were detected, confirm whether embedded content is in scope and scanned.',
    'Embedded iframe content adds scope and tooling complexity, consider manual checks inside those frames.'
  ],
  linksNoText: () => [
    'Some links have no visible text, these are often icon links, ensure they are named correctly.',
    'A portion of links appear textless, verify accessible names and hit targets.',
    'Textless links were detected, confirm they have meaningful labels for non visual users.'
  ],
  buttonsNoText: () => [
    'Some buttons have no visible text, these are often icon buttons, ensure they are named correctly.',
    'A portion of buttons appear textless, verify accessible names, states, and focus visibility.',
    'Textless buttons were detected, confirm they have meaningful labels for assistive technologies.'
  ]
};

const POSITIVE_CHIPS = {
  adjustedHigh: () => [
    'The overall indicator is high, which usually means fewer strong risk signals in this scan.',
    'The combined indicator looks strong, relative to the current thresholds.',
    'The overall score sits in a positive band for this snapshot.'
  ],
  evidenceClean: () => [
    'Automated evidence looks clean, fewer issues were detected by the tool in the scanned context.',
    'The automated score is in a positive band, at least for what automation could evaluate.',
    'Tool evidence is fairly positive, which often means fewer detected failures.'
  ],
  confidenceGood: () => [
    'Confidence is high, which suggests automation coverage is more representative here.',
    'Automation reliability looks good for this page, within the limits of automated testing.',
    'Confidence is in a positive band, automated evidence is more usable as a triage hint.'
  ],
  noIncomplete: () => [
    'No incomplete checks were reported, so there are fewer explicit uncertainty flags from the tool.',
    'The scan has no incomplete results, that usually reduces uncertainty in the automated evidence.',
    'There are no incomplete outcomes, so the tool produced more decisive results.'
  ]
};

const VALIDATE_FIRST_CHIPS = {
  vfCapped: () => [
    'Validate the most important flow manually, the scan was capped so metrics are partial.',
    'Prioritize manual checks for key tasks, the scan stopped early due to size or complexity.',
    'Treat this as a partial snapshot, validate the main journey manually first.'
  ],
  vfIncomplete: () => [
    'Validate the areas linked to incomplete checks, confirm what users perceive and what assistive tech announces.',
    'Manually confirm incomplete outcomes, especially dynamic UI, media, and non-text alternatives.',
    'Review incomplete checks by hand, these are explicit uncertainty signals.'
  ],
  vfLowConfidence: () => [
    'Validate keyboard operation and focus management on the main journey, confidence is reduced here.',
    'Run a quick manual pass on interaction behavior, automation reliability is lower on this page.',
    'Manually verify focus order, names, and state announcements, confidence is not high.'
  ],
  vfKeyJourneys: () => [
    'Validate the main journey end to end with keyboard only, focus order, visible focus, and escape paths.',
    'Validate the primary tasks manually, navigation, focus, and state changes.',
    'Start with the key user journeys, keyboard, focus, and predictable interaction patterns.'
  ],
  vfNames: () => [
    'Validate accessible names for icon controls and key actions, confirm name, role, and state.',
    'Validate that controls have usable names, especially icon buttons and icon links.',
    'Validate name and purpose for primary controls, and confirm the announced state for toggles.'
  ],
  vfCustomControls: () => [
    'Validate any custom widgets with keyboard and a screen reader, roles, names, states, and focus behavior.',
    'Validate custom controls manually, including arrow key support when relevant and correct announcements.',
    'Focus on custom widgets first, these often hide keyboard and state issues.'
  ],
  vfEmbedded: () => [
    'Validate embedded and componentized content manually, iframes or Shadow DOM can reduce tool coverage.',
    'Validate interactions inside embedded content, confirm the scan covered it, then test manually.',
    'Validate custom components and embedded areas, tooling coverage can be inconsistent there.'
  ],
  vfSpotChecks: () => [
    'Validate headings, landmarks, and one key form, plus a keyboard pass of the main journey.',
    'Do a short manual spot check, headings, landmarks, form labels, and focus order on key actions.',
    'Run a quick manual verification, key structure, a couple of controls, and one main task.'
  ]
};

const VALIDATE_CHIPS = {
  validateKeyJourneys: () => [
    'Validate the main user journeys with keyboard only, then repeat with a screen reader for key screens.',
    'Manually test the critical flows end to end, check focus, labels, and state changes.',
    'Do a quick manual pass on the main tasks, confirm keyboard access and clear announcements.'
  ],
  validateViolations: () => [
    'For the violations reported by automation, confirm user impact in the UI, then fix and retest.',
    'Verify each violation in context, validate the behavior with keyboard and screen reader before and after remediation.',
    'Spot-check the reported failures directly in the interface to confirm severity and scope.'
  ],
  validateIncomplete: () => [
    'For incomplete checks, manually confirm what the user perceives and what assistive tech announces.',
    'Review incomplete outcomes by hand, these often depend on visual meaning or dynamic behavior.',
    'Manually confirm the inconclusive checks, especially where context or UI state affects the result.'
  ],
  validateCapped: () => [
    'Because the scan was capped, validate using representative sampling, focus on core screens and interactions.',
    'Treat this as partial coverage, validate the most important regions manually, especially complex widgets.',
    'When metrics are capped, prioritize manual validation on high impact flows and repeat scans on smaller regions.'
  ],
  validateConfidenceLow: () => [
    'Automation confidence is low, validate keyboard operation, focus management, and announcements for dynamic UI.',
    'With low confidence, run a more thorough manual check, especially for custom widgets and conditional panels.',
    'Low confidence suggests automation may miss interaction issues, validate key components manually.'
  ],
  validateConfidenceMedium: () => [
    'Confidence is moderate, validate a representative set of interactions, especially state changes and custom controls.',
    'With medium confidence, confirm the main interactions manually, focus order and announcements are common gaps.',
    'Treat automation as a hint, validate key journeys with keyboard and a screen reader.'
  ],
  validateKeyboard: () => [
    'Validate keyboard operation for all primary controls, including arrow key patterns where applicable.',
    'Confirm every important control is reachable by keyboard, and that interaction does not require a mouse.',
    'Check that custom widgets support expected keyboard patterns and do not trap focus.'
  ],
  validateFocusManagement: () => [
    'Validate focus management for open and close patterns, dialogs should trap focus, and closing should return focus sensibly.',
    'Check focus behavior when panels expand or collapse, focus should not land in hidden content.',
    'Confirm focus is moved appropriately when state changes occur, especially after actions that reveal new content.'
  ],
  validateAnnouncements: () => [
    'Validate that state changes are announced, expanded, collapsed, selected, and error states should be perceivable to assistive tech.',
    'Check live updates and dynamic feedback, confirm the user is informed without needing to see the screen.',
    'Confirm changes in UI state are communicated via accessible names, states, and possibly live regions where needed.'
  ],
  validateNamesRolesStates: () => [
    'Validate names, roles, and states for custom controls, confirm labels, pressed, expanded, checked, and selected states.',
    'Check accessible names for icon buttons and toggles, confirm role and state reflect the UI accurately.',
    'Verify that controls expose the right role and state, and that labels match what sighted users see.'
  ],
  validateIconControls: () => [
    'Validate icon only controls have meaningful accessible names, and that the name matches the visible intent.',
    'Check buttons and links with no visible text, confirm they have an accessible name and are discoverable.',
    'Verify icon actions, confirm an assistive tech user can understand purpose without visual context.'
  ],
  validateReadingOrder: () => [
    'Validate reading order, headings, and landmark structure, confirm it matches the visual layout.',
    'Check headings and structure, confirm users can scan and navigate by sections predictably.',
    'Verify that the DOM order supports a sensible reading order, especially when layout is complex.'
  ],
  validateShadowComponents: () => [
    'Validate Web Components manually, confirm shadow rooted controls expose names, roles, and states correctly.',
    'Check custom components in Shadow DOM with assistive tech, automation may not cover all internal behavior.',
    'Manually validate Shadow DOM widgets, focus management and labeling are common risk areas.'
  ],
  validateEmbeddedFlows: () => [
    'Validate embedded content in iframes, confirm it is in scope, reachable, and behaves accessibly.',
    'Check iframe based flows, confirm keyboard focus moves into and out of embedded areas predictably.',
    'Manually validate embedded widgets, confirm they are scanned and that navigation is not broken.'
  ]
};

const NEXT_CHIPS = {
  reviewIncomplete: () => [
    'Review the incomplete checks manually, confirm intent and impact using keyboard and assistive tech testing.',
    'Follow up on incomplete checks with human verification, these often depend on context or visual meaning.',
    'Validate incomplete outcomes manually, especially for dynamic content and interaction intent.'
  ],
  triageViolations: () => [
    'Triage violations by severity and impact, fix confirmed issues, then rerun the scan to confirm improvements.',
    'Review each violation, confirm user impact, remediate, and retest the affected flow.',
    'Prioritize the most severe violations first, then re-scan to measure changes.'
  ],
  handleCapped: () => [
    'Because metrics were capped, consider re-scanning with a higher cap or narrower scope, and rely more on manual sampling.',
    'Treat this as a partial snapshot, consider splitting the page into regions and rescanning, plus manual validation.',
    'Re-run the scan with adjusted limits if possible, and plan manual checks because metrics are incomplete.'
  ],
  validateJourneys: () => [
    'Validate key user journeys with keyboard and a screen reader, focus order and state announcements are common gaps.',
    'Plan a short manual test of the main flows, verify focus, names, roles, and state changes.',
    'Run a targeted manual check for interaction behavior, especially for widgets and dynamic panels.'
  ],
  checkCustomControls: () => [
    'For custom controls, verify keyboard operation, focus visibility, correct roles, names, and states.',
    'Manually test non native widgets, check tab order, arrow key behavior where relevant, and announcements.',
    'Validate custom interactive elements, confirm they behave like their native equivalents.'
  ],
  checkStates: () => [
    'Test stateful UI patterns such as dialogs, accordions, tabs, and expandable controls, confirm focus management and announcements.',
    'Verify show and hide behavior, ensure hidden content is not focusable and state changes are communicated.',
    'Check dynamic panels and state changes, confirm correct aria attributes and focus behavior.'
  ],
  checkStructure: () => [
    'Review landmark and heading structure, semantic HTML often improves predictability and navigation.',
    'Spot check structure and reading order, heavy layout scaffolding can hide navigation issues.',
    'Confirm the main content structure, headings, landmarks, and form groupings are meaningful.'
  ],
  checkLinkNames: () => [
    'Audit icon links, ensure each has a meaningful accessible name, and avoid ambiguous labels.',
    'Check links without visible text, confirm aria-label or other naming mechanisms are present and accurate.',
    'Validate link names, especially in navigation and icon only areas.'
  ],
  checkButtonNames: () => [
    'Audit icon buttons, ensure each has a meaningful accessible name and correct pressed or expanded states.',
    'Check buttons without visible text, confirm they expose accurate accessible names and states.',
    'Validate button labels, especially for controls that open menus, dialogs, or panels.'
  ],
  checkShadowDom: () => [
    'Manually test custom components implemented with Shadow DOM, confirm accessibility tree output matches expectations.',
    'Validate web components with a screen reader, ensure names, roles, states, and focus are correct.',
    'Prioritize manual checks on Shadow DOM widgets, automation coverage can be inconsistent.'
  ],
  checkIframes: () => [
    'Confirm iframe content is included in scope, and test key flows inside embedded frames.',
    'If iframes are in scope, run scans within those frames where possible, plus manual checks.',
    'Validate embedded content separately if needed, iframe boundaries can affect scanning coverage.'
  ],
  genericFollowUp: () => [
    'Use these results to prioritize manual checks, then confirm improvements with a rerun after changes.',
    'Plan a short manual validation on key tasks, and rerun the scan after remediation.',
    'Treat the indicator as a triage hint, confirm with targeted manual validation.'
  ]
};

const NOTE_CHIPS = {
  mismatchEvidenceConfidence: () => [
    'Even with decent automated evidence, reduced confidence means automation may miss interaction or state issues.',
    'A clean tool signal combined with lower confidence usually indicates complex UI behavior that automation can miss.',
    'When evidence is high but confidence is lower, prioritize manual validation on interactive components.'
  ],
  capped: () => [
    'Because the scan reached a cap, comparisons across runs can be noisy, re-scan with consistent limits when tracking trends.',
    'Capped runs can undercount hidden states and deep structure, treat trend tracking cautiously.',
    'With capped metrics, use the result for triage, and rely on manual validation for decisions.'
  ],
  default: () => [
    'This is a triage explanation, it does not prove WCAG compliance, manual validation remains essential.',
    'These interpretations are designed for prioritization, not for conformance claims.',
    'Use this as a quick reading, then validate with manual checks and user journey testing.'
  ]
};

/* -------------------------------- HTML render -------------------------------- */

function renderHtml({ narrative }) {
  const title = escapeHtml(narrative.title);
  const summary = escapeHtml(narrative.summary);

  const whyList = narrative.why?.length
      ? `<ul class="a11yNarrative__list">${narrative.why.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';

  const validateFirstList = narrative.validateFirst?.length
      ? `<ul class="a11yNarrative__list">${narrative.validateFirst.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';

  const validateList = narrative.validate?.length
      ? `<ul class="a11yNarrative__list">${narrative.validate.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';

  const nextList = narrative.next?.length
      ? `<ul class="a11yNarrative__list">${narrative.next.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';

  const notes = narrative.notes?.length
      ? `<div class="a11yNarrative__notes">${narrative.notes.map(x => `<p class="a11yNarrative__note">${escapeHtml(x)}</p>`).join('')}</div>`
      : '';

  return `
  <div class="a11yNarrative">
    <h4 class="a11yNarrative__title">${title}</h4>
    <p class="a11yNarrative__lead">${summary}</p>
    ${whyList ? `<h5 class="a11yNarrative__h">Why this looks that way</h5>${whyList}` : ''}
    ${validateFirstList ? `<h5 class="a11yNarrative__h">Validate first</h5>${validateFirstList}` : ''}
    ${validateList ? `<h5 class="a11yNarrative__h">What to validate</h5>${validateList}` : ''}
    ${nextList ? `<h5 class="a11yNarrative__h">What to do next</h5>${nextList}` : ''}
    ${notes}
  </div>
`.trim();
}

/* -------------------------------- utilities -------------------------------- */

function num(a, b = 0) {
  const n = Number(a);
  return Number.isFinite(n) ? n : b;
}

function uniq(arr) {
  return [...new Set(arr)];
}

function pushDedup(arr, line) {
  const k = String(line).slice(0, 28).toLowerCase();
  if (!arr.some(x => String(x).slice(0, 28).toLowerCase() === k)) arr.push(line);
}

function isConcern(defs, defKey, value) {
  const def = defs?.[defKey];
  if (!def) return false;
  const it = classifyInterval(def, value);
  if (!it?.key) return false;
  return (String(it.key) === 'warn' || String(it.key) === 'bad');
}

function bandMeta(defs, defKey, value) {
  const def = defs?.[defKey];
  const it = classifyInterval(def, value);
  if (!it) return { key: null, near: null, label: null };

  const near = intervalProximity(def, value, it);
  return { key: it.key || null, near, label: it.label || null };
}

function classifyInterval(def, rawValue) {
  if (!def || !Array.isArray(def.intervals) || !def.intervals.length) return null;
  const v = Number(rawValue);
  if (!Number.isFinite(v)) return null;

  for (const it of def.intervals) {
    const from = Number(it.from);
    const toRaw = it.to;
    const to = (toRaw === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : Number(toRaw);
    if (!Number.isFinite(from) || (!Number.isFinite(to) && to !== Number.POSITIVE_INFINITY)) continue;

    if (to === Number.POSITIVE_INFINITY) {
      if (v >= from) return it;
    } else {
      if (v >= from && v <= to) return it;
    }
  }
  return null;
}

function intervalProximity(def, vRaw, interval) {
  const v = Number(vRaw);
  if (!Number.isFinite(v)) return null;

  const from = Number(interval.from);
  const toRaw = interval.to;
  const to = (toRaw === Number.POSITIVE_INFINITY) ? Number.POSITIVE_INFINITY : Number(toRaw);

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const width = Math.max(1e-9, Math.abs(to - from));

  const eps = proximityEps(v, width);
  const dFrom = Math.abs(v - from);
  const dTo = Math.abs(v - to);

  if (dFrom <= eps) return 'lower';
  if (dTo <= eps) return 'upper';
  return null;
}

function proximityEps(v, width) {
  if (Math.abs(v) <= 1.2) return Math.max(0.02, width * 0.12);
  if (Math.abs(v) <= 110) return Math.max(3, width * 0.12);
  return Math.max(10, width * 0.12);
}

/* ---------------- deterministic randomness ---------------- */

function deriveSeed(m) {
  const parts = [
    m.adjusted, m.evidence, m.confidence,
    m.violations, m.incomplete, m.passes,
    m.capped ? 1 : 0, m.shadowHostCount, m.iframeCount,
    m.linksNoTextNoNameRate, m.buttonsNoTextNoNameRate,
    m.customControlsRatio, m.hiddenRatio, m.statefulComponentsCount
  ];
  return parts.map(x => String(x ?? '')).join('|');
}

function pick(rng, arr) {
  if (!arr || !arr.length) return '';
  const i = Math.floor(rng() * arr.length);
  return arr[i];
}

function pickDet(obj, salt, arr) {
  const key = `${salt}|${stableString(obj)}`;
  const r = mulberry32(hash32(key));
  return pick(r, arr);
}

function stableString(o) {
  try {
    return JSON.stringify(o, Object.keys(o).sort());
  } catch {
    return String(o);
  }
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- escaping ---------------- */

function escapeHtml(s) {
  return String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
}
