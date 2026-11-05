'use strict';

/**
 * The run written out as prose.
 *
 * A pipeline reads the exit code and diff.json. A person reads this: what ran,
 * whether it ran whole, and what changed since the run it was compared with.
 */

const { describeRunHealth } = require('../shared/run-health.js');
const { stepsSection } = require('./step-progress');
const { countReviewGroups, reviewGroupsText } = require('../shared/review-groups.js');
const { findingsByOutcome } = require('../server-side/a11y-canonical');

const OUTCOME = {
    error: 'Run failed',
    cancelled: 'Run cancelled',
    degraded: 'Ran, but covered less than the spec asked for',
    regressed: 'New failing instances since the baseline',
    failing: 'Failing instances, and no baseline to compare with',
    notCompared: 'Failing instances the baseline could not be compared with',
    likely: 'New likely failures to confirm',
    clean: 'Nothing new since the baseline',
    done: 'Run finished',
};

function countOccurrences(findings) {
    if (!Array.isArray(findings)) return 0;
    return findings.reduce((total, finding) => (
        total + (Array.isArray(finding?.occurrences) ? finding.occurrences.length : 0)
    ), 0);
}

/** The one line that answers "do I need to look at this?". */
function outcomeOf({ status, health, summary, likely = null, failing = null, baseline = false }) {
    if (status === 'error') return { key: 'error', headline: OUTCOME.error };
    if (status === 'cancelled') return { key: 'cancelled', headline: OUTCOME.cancelled };
    if (health && health.degraded) return { key: 'degraded', headline: OUTCOME.degraded };
    if (summary && summary.occurrences && summary.occurrences.new > 0) {
        return { key: 'regressed', headline: OUTCOME.regressed };
    }
    // --fail-on-failures, as the exit code decides it.
    // With a baseline, they come from scans it shares no profile with.
    if (failing > 0) return baseline ? { key: 'notCompared', headline: OUTCOME.notCompared } : { key: 'failing', headline: OUTCOME.failing };
    // --fail-on-lean, as the exit code decides it.
    if (likely && likely.new > 0) return { key: 'likely', headline: OUTCOME.likely };
    if (summary) return { key: 'clean', headline: OUTCOME.clean };
    return { key: 'done', headline: OUTCOME.done };
}

function pluralInstances(n) {
    return `${n} instance${n === 1 ? '' : 's'}`;
}

function optInWords(tags) {
    return tags.map((t) => String(t).toUpperCase()).join(', ') + '-only rules';
}

function findingsSection(payload, likely = null) {
    // By outcome, one rule merged across scans: a report keeps them in its
    // scans only.
    const findings = findingsByOutcome(payload?.scans);
    const fail = findings.fail || [];
    const cantTell = findings.cantTell || [];
    const scans = payload?.scans || [];

    const lines = [
        '## This run',
        '',
        `- Scans: ${scans.length}`,
        `- Failing: ${fail.length} rules, ${pluralInstances(countOccurrences(fail))}`,
        `- Can't tell: ${cantTell.length} rules, ${pluralInstances(countOccurrences(cantTell))}`,
    ];
    // Which way the questions lean, as core's report groups them: the
    // likely failures are the ones to confirm first.
    const groups = reviewGroupsText(countReviewGroups(cantTell, { outcome: 'cantTell' }));
    if (groups) lines.push(`  - ${groups}`);
    if (likely) {
        lines.push(`- Likely failures (--fail-on-lean): ${likely.total}`
            + (likely.known || likely.new !== likely.total ? `, ${likely.new} new since the baseline` : ''));
    }

    // Rules one standard requires and WCAG does not: their failures are not
    // failures of the scans' conformance target.
    const withOptIn = scans.filter((s) => Array.isArray(s?.optInRules) && s.optInRules.length);
    if (withOptIn.length) {
        const tags = [...new Set(withOptIn.flatMap((s) => s.optInRules.map(String)))].sort();
        lines.push(`- Also ran ${optInWords(tags)} in ${withOptIn.length} of ${scans.length} scans`);
    }
    return lines;
}

function healthSection(health) {
    const lines = describeRunHealth(health);
    const optional = (health?.optionalFailures || []).length;
    if (!lines.length && !optional) return [];

    const out = ['', '## Coverage', ''];
    for (const line of lines) out.push(`- ${line}`);
    if (optional) {
        out.push(`- ${optional} optional action${optional === 1 ? '' : 's'} failed, which the spec allows`);
    }
    out.push('');
    out.push('Fewer failures than the baseline is not good news while this is true.');
    return out;
}

/**
 * "the baseline and this run were made with different releases of surea11y
 * (1.13.1, 1.14.0), ...", or '' when they used the same ones.
 */
function engineChangesText(changes) {
    const list = Array.isArray(changes) ? changes.filter((c) => c && c.name && Array.isArray(c.versions)) : [];
    if (!list.length) return '';
    return 'the baseline and this run were made with different releases of '
        + list.map((c) => `${c.name} (${c.versions.join(', ')})`).join(' and ')
        + ', so some differences may come from the engine rather than the pages';
}

/**
 * What the baseline and this run were checked against, when that differs:
 * { text, warning } or null. Compared on the profiles they share, it says
 * which and what it left out; sharing none, that their rows don't line up
 * and the new instances were not counted.
 */
function profilesText(profiles) {
    if (!profiles) return null;
    const basis = profiles.basis;
    const comparedOn = basis && Array.isArray(basis.comparedOn) ? basis.comparedOn : [];
    const notCompared = basis && Array.isArray(basis.notCompared) ? basis.notCompared : [];
    if (!profiles.mismatch && (comparedOn.length || notCompared.length)) {
        const left = basis && Array.isArray(basis.leftOut) ? basis.leftOut.map((p) => p.label) : [];
        const parts = [];
        if (comparedOn.length) {
            parts.push(`compared on ${comparedOn.map((p) => p.label).join(' + ')}, which both checked`
                + (left.length ? `; left out, as only one checked it: ${left.join(', ')}` : ''));
        }
        if (basis && basis.byReport) parts.push('no page is in both, so each is read on the profiles both checked on some page');
        if (notCompared.length) {
            parts.push(`not compared, as the baseline and this run checked ${notCompared.length === 1 ? 'it' : 'them'} against different things that share none: ${[...new Set(notCompared.map((s) => s.label))].join(', ')}`);
        }
        return { warning: false, text: parts.join('; ') };
    }
    if (profiles.mismatch) {
        const named = Array.isArray(profiles.compared) && profiles.compared.length > 1 ? ` (${profiles.compared.join(', ')})` : '';
        return {
            warning: true,
            text: `the baseline and this run were checked against different standards or WCAG levels${named}, `
                + 'which share none: their rows don\'t line up, so new instances are not counted against the baseline',
        };
    }
    return null;
}

function comparisonSection(comparison, baselineLabel) {
    if (!comparison) {
        return ['', '## Compared to', '', 'No baseline was given, so nothing is being compared.'];
    }

    // Reporting must not throw away a run that already finished.
    const summary = comparison.summary || {};
    const rules = summary.rules || { new: 0, resolved: 0, persistent: 0 };
    const occurrences = summary.occurrences || { new: 0, fixed: 0, still: 0 };
    const newRules = Array.isArray(summary.newRules) ? summary.newRules : [];
    const swapped = comparison.swapped;

    const out = [
        '',
        `## Compared to ${baselineLabel || 'the baseline'}`,
        '',
        `- Rules: ${rules.new} new, ${rules.resolved} resolved, ${rules.persistent} persistent`,
        `- Instances: ${occurrences.new} new, ${occurrences.fixed} fixed, ${occurrences.still} still failing`,
    ];

    if (swapped) {
        out.push('- The baseline is newer than this run; it is still read as the baseline');
    }

    const engines = engineChangesText(comparison.engineChanges);
    if (engines) out.push(`- ${engines.charAt(0).toUpperCase()}${engines.slice(1)}`);
    if (comparison.pagesUnmatched) {
        out.push('- No page of this run is a page of the baseline (pages are matched by path and query), so every failing instance reads as new or fixed');
    }
    const profiles = profilesText(comparison.profiles);
    if (profiles) out.push(`- ${profiles.text.charAt(0).toUpperCase()}${profiles.text.slice(1)}`);

    const optIn = comparison.optInRules;
    if (optIn && optIn.baseline.join(',') !== optIn.current.join(',')) {
        const side = (tags) => (tags.length ? optInWords(tags) : 'no opt-in rules');
        out.push(`- The baseline ran ${side(optIn.baseline)} and this run ${side(optIn.current)}, `
            + 'so those rules\' findings differ because of what was checked, not because of the pages');
    }

    if (newRules.length) {
        out.push('', '### New', '');
        for (const rule of newRules) {
            out.push(`- **${rule.ruleId}** (${rule.severity}) — ${pluralInstances(rule.occurrences)}`);
        }
    }

    return out;
}

/**
 * Markdown for one run. Everything comes from the payload and the diff, so the
 * same inputs always produce the same text.
 */
function buildSummaryMarkdown({ payload, status, health, comparison, baselineLabel, outDir, steps, likely = null, failing = null }) {
    // A comparison whose two share no profile is judged as no comparison.
    const comparable = comparison && !(comparison.profiles && comparison.profiles.mismatch) ? comparison.summary : null;
    const outcome = outcomeOf({ status, health, summary: comparable, likely, failing, baseline: !!comparison });
    const title = payload?.scenarioName || payload?.url || 'Workflow run';

    const lines = [
        `# ${title}`,
        '',
        `**${outcome.headline}**`,
        '',
        `- Url: ${payload?.url || '(none)'}`,
        `- Run: ${payload?.runId || '(none)'} at ${payload?.timestamp || '(no timestamp)'}`,
    ];

    if (outDir) lines.push(`- Output: ${outDir}`);
    if (payload?.errorDetails?.message) lines.push(`- Error: ${payload.errorDetails.message}`);

    lines.push('');
    lines.push(...findingsSection(payload, likely));
    // How much of the workflow ran, before what it found: a partial run's
    // findings mean something different from a whole one's.
    lines.push(...stepsSection(steps));
    lines.push(...healthSection(health));
    lines.push(...comparisonSection(comparison, baselineLabel));
    lines.push('');

    return lines.join('\n');
}

module.exports = { buildSummaryMarkdown, outcomeOf, engineChangesText, profilesText };
