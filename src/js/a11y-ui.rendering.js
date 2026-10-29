'use strict';

/**
 * Rendering helpers for a11y-ui.
 */
import {generateA11yMetricsContents} from './a11y-metrics-renderer.js';
import {iconButton, scanTagChipsHtml} from './a11y-ui.utils.js';
import {buildTagsInputControl} from './tags-input.js';
import {resultGlyphHtml} from './result-glyph.js';
import {summarizeTopic, topicBadgeText} from './coverage-topics.js';
import {isFailureFreeScan} from './scan-failures.js';
import {optInRulesLabel} from './report-fields.js';
import {registerLazyBody} from './lazy-dialogs.js';
import {
    normalizeGroupingSpec, isValidGroupingSpecShape, groupIssuesBySpec, NOT_IN_WCAG_GROUP, OTHERS_GROUP
} from './grouping-spec.js';
import {formatMarginLimit, formatMarginRoom, formatMarginValue, isNearMiss, scanMargins} from './margins.js';
import {collectEngineOptions} from './engine-filter.js';

// The standard a scan checked against, or null for plain WCAG, read the same
// way from every report, old or new (shared/report-scan.js).
const standardIdOf = (scan) => globalThis.A11Y_REPORT_SCAN?.scanStandardId(scan) ?? null;

// Active grouping spec, can be replaced by uploaded JSON via setIssueGroupingSpec.
// If null, grouping is disabled.
let ACTIVE_ISSUE_GROUPS = null;

export function createRenderer({
                                   resultsEl,
                                   screenshotsEl,
                                   escapeAttr,
                                   escapeHtml,
                                   jsonToBrowserLink,
                                   buildScreenshotElements,
                                   imgToBtn,
                                   dialogs,
                                   onToggleScanIncludedInReport,
                                   onMoveScan,
                                   onRenameScan,
                                   onEditScanTags,
                                   getScanTagSuggestions
                               }) {
    if (!resultsEl) throw new Error('createRenderer requires resultsEl');
    if (!screenshotsEl) throw new Error('createRenderer requires screenshots');

    /* ==================== Rendering ==================== */

    function getScanFindings(scan) {
        return Array.isArray(scan?.canonical?.findings)
            ? scan.canonical.findings
            : [];
    }

    function getScanFindingsByOutcome(scan, outcome) {
        const out = [];
        for (const finding of getScanFindings(scan)) {
            const expanded = splitFindingByOccurrenceOutcome(finding);
            for (const f of expanded) {
                if (f && f.outcome === outcome) out.push(f);
            }
        }
        return out;
    }

    function getCanonicalFindings(scan) {
        const canon = scan && scan.canonical && typeof scan.canonical === 'object' ? scan.canonical : null;
        return canon && Array.isArray(canon.findings) ? canon.findings : [];
    }

    function getScanViolationsList(scan) {
        const url = scan?.url || '';
        const rows = getScanFindingsByOutcome(scan, 'fail').map(f => findingToIssueRow(f, url, standardIdOf(scan)));
        return mergeCompositeIssueRows(rows);
    }

    function getScanIncompleteList(scan) {
        const url = scan?.url || '';
        const rows = getScanFindingsByOutcome(scan, 'cantTell').map(f => findingToIssueRow(f, url, standardIdOf(scan)));
        return mergeCompositeIssueRows(rows);
    }

    function getScanPassList(scan) {
        const url = scan?.url || '';
        const rows = getScanFindingsByOutcome(scan, 'pass').map(f => findingToIssueRow(f, url, standardIdOf(scan)));
        return mergeCompositeIssueRows(rows);
    }

    function normalizeStringListUnique(list) {
        if (!Array.isArray(list)) return [];
        const out = [];
        const seen = new Set();
        for (const v of list) {
            const s = String(v || '').trim();
            if (!s) continue;
            const k = s.toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(s);
        }
        return out;
    }

    function normalizeContributorsList(list) {
        if (!Array.isArray(list)) return [];
        const out = [];
        const seen = new Set();
        for (const item of list) {
            const testId = String(item?.testId || '').trim();
            if (!testId) continue;
            const outcome = String(item?.outcome || '').trim();
            const key = `${testId.toLowerCase()}|${outcome.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({testId, outcome, ...(item?.notSelected === true ? {notSelected: true} : {})});
        }
        return out;
    }

    function getCompositeMergeKey(issue) {
        const engine = issue?.engine && typeof issue.engine === 'object' ? issue.engine : {};
        return JSON.stringify({
            id: String(issue?.id || '').trim(),
            impact: String(issue?.impact || '').trim(),
            engineName: String(engine?.name || '').trim(),
            engineId: String(engine?.id || '').trim(),
            engineVersion: String(engine?.version || '').trim()
        });
    }

    function mergeCompositeIssueRows(rows) {
        const map = new Map();
        const out = [];
        for (const issue of Array.isArray(rows) ? rows : []) {
            const hints = issue?.reviewHints && typeof issue.reviewHints === 'object' ? issue.reviewHints : null;
            const key = getCompositeMergeKey(issue);
            const existing = map.get(key);
            if (!existing) {
                const clone = {
                    ...issue,
                    SC: Array.isArray(issue?.SC) ? issue.SC.slice() : [],
                    nodes: Array.isArray(issue?.nodes) ? issue.nodes.slice() : [],
                    reviewHints: {
                        ...(hints || {}),
                        isComposite: !!(hints?.isComposite),
                        checksIds: normalizeStringListUnique(hints?.checksIds),
                        contributors: normalizeContributorsList(hints?.contributors)
                    }
                };
                map.set(key, clone);
                out.push(clone);
                continue;
            }

            existing.nodes = existing.nodes.concat(Array.isArray(issue?.nodes) ? issue.nodes : []);
            const existingHints = existing.reviewHints && typeof existing.reviewHints === 'object'
                ? existing.reviewHints
                : {};
            existingHints.isComposite = !!(existingHints.isComposite || hints?.isComposite);
            existingHints.checksIds = normalizeStringListUnique([
                ...(existingHints.checksIds || []),
                ...(Array.isArray(hints?.checksIds) ? hints.checksIds : [])
            ]);
            existingHints.contributors = normalizeContributorsList([
                ...(existingHints.contributors || []),
                ...(Array.isArray(hints?.contributors) ? hints.contributors : [])
            ]);
            if (!existingHints.reasonCode && hints?.reasonCode) {
                existingHints.reasonCode = String(hints.reasonCode);
            }
            // Partly checked only while every row joined is: a criterion left
            // undecided by a check that ran needs review as such.
            if (!hints?.partlyChecked) delete existingHints.partlyChecked;
            existing.reviewHints = existingHints;
        }
        return out;
    }

    function inferAtomicRulesForOccurrence({compositeRuleId, summaryText, htmlSnippet}) {
        const ruleId = String(compositeRuleId || '').trim().toLowerCase();
        if (!ruleId) return [];

        const text = `${String(summaryText || '')} ${String(htmlSnippet || '')}`.toLowerCase();
        const out = [];

        if (ruleId === 'wcag-2.4.7-focus-visible') {
            if (text.includes('aria-hidden')) out.push('aria-hidden-focus');

            if (
                text.includes('visually hidden') ||
                text.includes('opacityzero') ||
                text.includes('clipped') ||
                text.includes('css-hidden') ||
                text.includes('focus-trap')
            ) {
                out.push('css-hidden-focus');
            }
        }

        return normalizeStringListUnique(out);
    }

    function getOccurrenceOutcome(occ, fallbackOutcome) {
        const occOutcome = String(occ?.occurrenceOutcome || occ?.outcome || '').trim();
        if (occOutcome === 'fail' || occOutcome === 'cantTell') return occOutcome;
        if (fallbackOutcome === 'fail' || fallbackOutcome === 'cantTell') return fallbackOutcome;
        return null;
    }

    function splitFindingByOccurrenceOutcome(finding) {
        const occs = Array.isArray(finding?.occurrences) ? finding.occurrences : [];
        if (!occs.length) return [finding];

        const failOccs = [];
        const cantTellOccs = [];
        for (const occ of occs) {
            const tier = getOccurrenceOutcome(occ, finding?.outcome);
            if (tier === 'fail') failOccs.push(occ);
            else if (tier === 'cantTell') cantTellOccs.push(occ);
        }

        const out = [];
        if (failOccs.length) out.push({ ...finding, outcome: 'fail', occurrences: failOccs });
        if (cantTellOccs.length) out.push({ ...finding, outcome: 'cantTell', occurrences: cantTellOccs });
        if (!out.length) out.push(finding);
        return out;
    }

    // EN 301 549 clauses for a finding: added by the lab server for every
    // engine, or read from surea11y's own normativeMappings when the finding
    // comes straight from the engine (the extension). Grouped by clause, with
    // the versions of the standard that have it.
    function en301549ClausesOf(f) {
        if (Array.isArray(f?.en301549)) return f.en301549;
        const byClause = new Map();
        const mappings = Array.isArray(f?.standards?.normativeMappings) ? f.standards.normativeMappings : [];
        for (const m of mappings) {
            if (!m || m.standard !== 'EN 301 549' || !m.requirement) continue;
            const clause = String(m.requirement);
            const entry = byClause.get(clause) || {clause, title: m.title || '', versions: [], wcagSc: []};
            if (m.version && !entry.versions.includes(m.version)) entry.versions.push(m.version);
            for (const sc of Array.isArray(m.wcagSc) ? m.wcagSc : []) {
                if (!entry.wcagSc.includes(String(sc))) entry.wcagSc.push(String(sc));
            }
            byClause.set(clause, entry);
        }
        return [...byClause.values()];
    }

    // "RGAA 1.1": one pill per RGAA criterion. Findings carry them only when
    // the scan targeted RGAA, the one time core names them.
    function rgaaPillsHtml(entries) {
        return (Array.isArray(entries) ? entries : [])
            .filter((e) => e && e.criterion)
            .map((e) => '<span class="tag-pill">RGAA ' + escapeHtml(e.criterion) + '</span>')
            .join(' ');
    }

    // Which EN 301 549 clauses a scan's results should name, given the
    // standard the scan checked against:
    //  - an EN 301 549 version: only the clauses that version has, without
    //    repeating the version on each one;
    //  - Section 508 or WCAG 2.2 AA: none, since neither is written in EN
    //    301 549's terms (Section 508 cites WCAG 2.0 directly);
    //  - no standard, just a WCAG level: all of them, as a cross-reference.
    const EN301549_TARGET_VERSIONS = {'en301549-v4.1.1': 'V4.1.1', 'en301549-v3.2.1': 'V3.2.1'};

    function en301549ForTarget(clauses, targetId) {
        const list = Array.isArray(clauses) ? clauses : [];
        if (!targetId) return list;
        const version = EN301549_TARGET_VERSIONS[targetId];
        if (!version) return [];
        return list
            .filter((c) => Array.isArray(c?.versions) && c.versions.includes(version))
            .map((c) => ({...c, versions: [version], versionImplied: true}));
    }

    // Every pill names its standard, so criteria from different standards can
    // sit side by side: "WCAG 1.1.1", "RGAA 1.1", and "EN 301 549 9.1.1.1",
    // spelled out because "EN" alone reads as English.
    // "EN 301 549 9.1.1.1" when both versions of the standard have the clause,
    // and "EN 301 549 9.2.5.8 (V4.1.1)" when only one does, since the two restate
    // different WCAG versions. Under an EN 301 549 target the version is
    // already known, so it is left out.
    function en301549PillsHtml(clauses) {
        return (Array.isArray(clauses) ? clauses : [])
            .map((c) => {
                const versions = Array.isArray(c?.versions) ? c.versions : [];
                const text = 'EN 301 549 ' + c.clause + (versions.length === 1 && !c.versionImplied ? ' (' + versions[0] + ')' : '');
                return '<span class="tag-pill">' + escapeHtml(text) + '</span>';
            })
            .join(' ');
    }

    function buildGroupedTagsHtml(v) {
        const groupedTags = Array.isArray(v?.SC) ? v.SC : [];
        return [
            groupedTags.map((t) => '<span class="tag-pill">WCAG ' + escapeHtml(t) + '</span>').join(' '),
            en301549PillsHtml(v?.EN),
            rgaaPillsHtml(v?.RGAA)
        ].filter(Boolean).join(' ');
    }

    function escapeAngleBrackets(str) {
        return str.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function convertIndentedBlockToHtml(inputText) {
        const lines = inputText.replace(/\r\n/g, '\n').split('\n');
        const titleLine = lines[0].trim();
        const items = lines
            .slice(1)
            .filter((line) => /^\s+/.test(line))
            .map((line) => line.trim());

        if (items.length === 0) {
            return titleLine;
        }

        let html = `<details><summary>${escapeHtml(titleLine)}</summary>\n<ul>\n`;
        for (const item of items) {
            html += `  <li>${escapeHtml(item)}</li>\n`;
        }
        html += `</ul></details>`;
        return html;
    }

    function findingToIssueRow(f, fallbackUrl = '', targetId = null) {
        const occurrences = Array.isArray(f?.occurrences) ? f.occurrences : [];
        const rollup = (f?.evidence && typeof f.evidence === 'object' && f.evidence.rollup && typeof f.evidence.rollup === 'object')
            ? f.evidence.rollup
            : null;
        const checksIds = Array.isArray(rollup?.checksIds)
            ? [...new Set(rollup.checksIds.map((x) => String(x || '').trim()).filter(Boolean))]
            : [];
        const contributors = Array.isArray(rollup?.contributors)
            ? rollup.contributors
                .map((c) => ({
                    testId: String(c?.testId || '').trim(),
                    outcome: String(c?.outcome || '').trim(),
                    ...(c?.notSelected === true ? {notSelected: true} : {})
                }))
                .filter((c) => c.testId)
            : [];
        const contributorTestIds = normalizeStringListUnique(contributors.map((c) => c.testId));
        const partlyChecked = f?.partlyChecked && typeof f.partlyChecked === 'object'
            && Number.isFinite(f.partlyChecked.notSelected) && Number.isFinite(f.partlyChecked.checks)
            ? {notSelected: f.partlyChecked.notSelected, checks: f.partlyChecked.checks}
            : null;

        const nodes = occurrences.map((occ) => {
            const pageUrl = occ?.pageUrl ? String(occ.pageUrl) : (fallbackUrl || '');
            const failureSummary = occ?.failureSummary
                ? String(occ.failureSummary)
                : (occ?.summary ? String(occ.summary) : '');
            const htmlSnippet = occ?.html ? String(occ.html) : '';
            const occChecksIds = normalizeStringListUnique(
                occ && typeof occ === 'object' ? occ.checksIds : null
            );
            const occAtomicRules = normalizeStringListUnique(
                occ && typeof occ === 'object'
                    ? [
                        ...(Array.isArray(occ.sourceAtomicRules) ? occ.sourceAtomicRules : []),
                        ...(occ.atomicCheckId ? [occ.atomicCheckId] : [])
                    ]
                    : null
            );
            const inferredAtomicRules = inferAtomicRulesForOccurrence({
                compositeRuleId: f?.ruleId || f?.id || '',
                summaryText: failureSummary,
                htmlSnippet
            });
            const sourceAtomicRules = normalizeStringListUnique(
                occAtomicRules.length
                    ? occAtomicRules
                    : (occChecksIds.length ? occChecksIds : (checksIds.length ? checksIds : (contributorTestIds.length ? contributorTestIds : inferredAtomicRules)))
            );
            return {
                target: Array.isArray(occ?.target) ? occ.target : [],
                html: htmlSnippet,
                failureSummary,
                urls: pageUrl ? [pageUrl] : [],
                sourceAtomicRules,
                sourceContributors: contributors,
                lang: typeof f?.lang === 'string' ? f.lang : '',
                hint: typeof occ?.hint === 'string' ? occ.hint : '',
                uncertainty: occ?.uncertainty && typeof occ.uncertainty === 'object' ? occ.uncertainty : null,
                // A question's lean (which way its evidence points) and the
                // steps that answer it, from core 1.14.
                lean: occ?.lean && (occ.lean.toward === 'fail' || occ.lean.toward === 'pass') ? occ.lean : null,
                howToCheck: occ?.howToCheck && Array.isArray(occ.howToCheck.steps) ? occ.howToCheck : null,
                details: occ?.details && typeof occ.details === 'object' ? occ.details : null,
                shadowHostSelectors: Array.isArray(occ?.shadowHostSelectors) ? occ.shadowHostSelectors : null,
                elementScreenshot: elementScreenshotOf(occ),
                // A merged scan's occurrence: the contexts it occurs in, of how many.
                ...(Array.isArray(occ?.contexts) && occ.contexts.length
                    ? {contexts: occ.contexts.map(String), contextsTotal: Number(occ.contextsTotal) || occ.contexts.length}
                    : {})
            };
        });

        return {
            id: f?.ruleId || f?.id || '',
            impact: f?.severity || 'unknown',
            help: f?.title || f?.help || f?.description || '',
            lang: typeof f?.lang === 'string' ? f.lang : '',
            // An RGAA rollup's title is RGAA's French, whatever `lang` says.
            titleLang: typeof f?.titleLang === 'string' && f?.title ? f.titleLang : '',
            description: f?.description || '',
            helpUrl: f?.helpUrl || '',
            SC: Array.isArray(f?.wcag?.sc) ? [...new Set(f.wcag.sc.map(String).filter(Boolean))] : [],
            EN: en301549ForTarget(en301549ClausesOf(f), targetId),
            RGAA: Array.isArray(f?.rgaa) ? f.rgaa : [],
            engine: f?.provenance?.engine || {},
            reviewHints: {
                isComposite: (f?.meta?.atomic === false) || checksIds.length > 0 || contributors.length > 0,
                reasonCode: rollup?.reasonCode ? String(rollup.reasonCode) : '',
                checksIds,
                contributors,
                ...(partlyChecked ? {partlyChecked} : {})
            },
            nodes
        };
    }

    function buildHelpLinkHtml(v) {
        return v?.helpUrl
            ? '<a href="' + escapeAttr(v.helpUrl) + '" target="_blank" rel="noreferrer">details</a>'
            : '';
    }

    // Identical occurrences become one, listing every page (and, for a merged
    // scan, every context) they were found in.
    const dedupeWithUrlMerge = (arr) => {
        const map = new Map();

        for (const item of arr) {
            const {urls, contexts, contextsTotal, ...rest} = item;
            const key = JSON.stringify(rest);

            if (!map.has(key)) {
                map.set(key, {
                    ...rest,
                    urls: Array.from(new Set(urls)),
                    ...(Array.isArray(contexts) ? {contexts: [...contexts], contextsTotal} : {})
                });
            } else {
                const current = map.get(key);
                current.urls = Array.from(new Set([...current.urls, ...urls]));
                if (Array.isArray(contexts)) {
                    current.contexts = Array.from(new Set([...(current.contexts || []), ...contexts]));
                    current.contextsTotal = Math.max(current.contextsTotal || 0, contextsTotal || 0);
                }
            }
        }

        return Array.from(map.values());
    };

    /** Where a merged scan's occurrence was found: "In: Dark · desktop, Dark · mobile". */
    function contextsLabel(n) {
        const list = Array.isArray(n?.contexts) ? n.contexts : [];
        if (!list.length) return '';
        const total = Number(n.contextsTotal) || 0;
        return total > 1 && list.length >= total ? `In all ${total} contexts` : `In: ${list.join(', ')}`;
    }

    // Engine text written in another language than the page around it gets
    // its own lang, so a screen reader pronounces it correctly. English, the
    // page's language, needs none.
    function langAttr(lang) {
        const l = typeof lang === 'string' ? lang.trim() : '';
        return l && l.toLowerCase() !== 'en' && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(l) ? ' lang="' + l + '"' : '';
    }

    function withLang(html, lang) {
        const attr = langAttr(lang);
        return attr ? '<span' + attr + '>' + html + '</span>' : html;
    }

    // Plain wording for the engine's reasons a can't-tell occurrence was left
    // open. An unknown code still shows, just without the explanation.
    const UNCERTAINTY_LABELS = {
        'not-computable': 'The engine could not read what it needed to measure this here.',
        'runtime-dependent': 'Script decides this at runtime, so the markup alone cannot settle it.',
        'spec-only': 'The markup breaks the specification, but the name, role and value still come through.',
        'equivalence-unknown': 'These may or may not do the same job; the page does not make it clear.',
        'judgement-required': 'This needs a person to decide.',
        'out-of-scope': 'Real, but outside the WCAG version this scan targets.'
    };

    // The review group of a question, as core's own report groups them:
    // its lean points to a failure, to a pass, or nowhere.
    function reviewGroupOfNode(n) {
        const toward = n?.lean?.toward;
        return toward === 'fail' ? 'leanFail' : toward === 'pass' ? 'leanPass' : 'open';
    }

    const REVIEW_GROUP_WORDS = {leanFail: 'Likely fails', leanPass: 'Likely passes', open: 'Needs a person'};
    // Likely failures first, then likely passes, then the open questions.
    const REVIEW_GROUP_RANK = {leanFail: 0, leanPass: 1, open: 2};

    // "right in 9 of 10 known cases": how often a lean of its kind agreed
    // with the W3C ACT test cases, once core counted it on enough of them.
    function leanMeasuredText(lean) {
        const m = lean?.measured;
        return m && Number.isInteger(m.agreed) && Number.isInteger(m.cases) && m.cases > 0
            ? `right in ${m.agreed} of ${m.cases} known cases`
            : '';
    }

    // Which way a question leans and why, with what could make that wrong.
    function buildLeanHtml(n) {
        const lean = n?.lean;
        if (!lean) return '';
        const group = reviewGroupOfNode(n);
        const why = typeof lean.why === 'string' ? lean.why.trim() : '';
        const caution = typeof lean.caution === 'string' ? lean.caution.trim() : '';
        const measured = leanMeasuredText(lean);
        return '<div class="node-detail node-lean node-lean-' + (group === 'leanFail' ? 'fail' : 'pass') + '">' +
            '<strong>' + escapeHtml(REVIEW_GROUP_WORDS[group]) + ':</strong> ' +
            (why ? withLang(escapeHtml(why), n.lang) : '') +
            (measured ? ' <span class="node-lean-measured">(' + escapeHtml(measured) + ')</span>' : '') +
            (caution ? '<br><strong>Caution:</strong> ' + withLang(escapeHtml(caution), n.lang) : '') +
            '</div>';
    }

    // The steps that answer a question, and what a person sees if it passes
    // and if it fails, collapsed behind "How to check (3 steps)": they are
    // the same for every question of a rule and reason, and long. `forAll`
    // says, in the summary, that they stand for every instance listed.
    function buildHowToCheckHtml(h, {lang = '', forAll = false} = {}) {
        if (!h) return '';
        const steps = (Array.isArray(h.steps) ? h.steps : []).filter((x) => typeof x === 'string' && x.trim());
        const passWhen = typeof h.passWhen === 'string' ? h.passWhen.trim() : '';
        const failWhen = typeof h.failWhen === 'string' ? h.failWhen.trim() : '';
        if (!steps.length && !passWhen && !failWhen) return '';
        const count = steps.length ? ' (' + steps.length + ' ' + (steps.length === 1 ? 'step' : 'steps') + ')' : '';
        return '<div class="node-detail node-how-to-check"><details>' +
            '<summary>How to check' + count + (forAll ? ', for every instance' : '') + '</summary>' +
            '<div' + langAttr(lang) + '>' +
            (steps.length ? '<ol>' + steps.map((x) => '<li>' + escapeHtml(x.trim()) + '</li>').join('') + '</ol>' : '') +
            (passWhen ? '<p><strong>Passes when:</strong> ' + escapeHtml(passWhen) + '</p>' : '') +
            (failWhen ? '<p><strong>Fails when:</strong> ' + escapeHtml(failWhen) + '</p>' : '') +
            '</div></details></div>';
    }

    // The steps every listed question shares, when they all have the same:
    // shown once, above the instances, instead of under each. Null otherwise.
    function sharedHowToCheck(nodes) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (list.length < 2 || !list.every((n) => n?.howToCheck)) return null;
        const key = JSON.stringify(list[0].howToCheck);
        return list.every((n) => JSON.stringify(n.howToCheck) === key) ? list[0].howToCheck : null;
    }

    function buildOccurrenceGuidanceHtml(n, {stepsShown = false} = {}) {
        const hint = typeof n?.hint === 'string' ? n.hint.trim() : '';
        const u = n?.uncertainty && typeof n.uncertainty === 'object' ? n.uncertainty : null;
        const code = u && typeof u.code === 'string' ? u.code.trim() : '';
        const needed = u && typeof u.needed === 'string' ? u.needed.trim() : '';

        let out = buildLeanHtml(n);
        if (code) {
            const why = UNCERTAINTY_LABELS[code] || '';
            out += '<div class="node-detail node-uncertainty"><strong>Why it is undecided:</strong> ' +
                (why ? escapeHtml(why) + ' ' : '') + '<code>' + escapeHtml(code) + '</code>' +
                (needed ? '<br><strong>To settle it:</strong> ' + withLang(escapeHtml(needed), n.lang) : '') +
                '</div>';
        }
        if (!stepsShown) out += buildHowToCheckHtml(n.howToCheck, {lang: n.lang});
        if (hint) {
            out += '<div class="node-detail node-hint"><strong>How to fix:</strong> ' + withLang(escapeHtml(hint), n.lang) + '</div>';
        }
        return out;
    }

    // "contrastRatio" -> "Contrast ratio": the engine's field names, read as words.
    function detailLabel(key) {
        const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
        return words.charAt(0).toUpperCase() + words.slice(1);
    }

    function detailValue(v) {
        if (Array.isArray(v)) return v.map(detailValue).join(', ');
        if (typeof v === 'boolean') return v ? 'yes' : 'no';
        if (typeof v === 'number') return String(Math.round(v * 100) / 100);
        return String(v);
    }

    // What the rule measured or resolved for this element (data.details),
    // and, for an element in a shadow tree, the hosts that lead to it, since
    // its selector only holds inside its own shadow root.
    function buildOccurrenceDetailsHtml(n) {
        let out = '';
        const hosts = Array.isArray(n?.shadowHostSelectors) ? n.shadowHostSelectors.filter(Boolean) : [];
        if (hosts.length) {
            out += '<div class="node-detail node-shadow"><strong>Inside the shadow DOM of:</strong> ' +
                hosts.map((h) => '<code>' + escapeHtml(String(h)) + '</code>').join(' › ') + '</div>';
        }
        const entries = n?.details && typeof n.details === 'object' ? Object.entries(n.details) : [];
        if (entries.length) {
            out += '<div class="node-detail node-measured"><strong>What the engine found:</strong><dl class="node-details-list">' +
                entries.map(([k, v]) => '<div><dt>' + escapeHtml(detailLabel(k)) + '</dt><dd>' + escapeHtml(detailValue(v)) + '</dd></div>').join('') +
                '</dl></div>';
        }
        return out;
    }

    // Why an occurrence has no picture of its element (the binding's reasons).
    const SCREENSHOT_SKIP_LABELS = {
        'no-element': 'the finding names no element, or it is no longer in the page.',
        'page-level': 'the finding is about the whole page.',
        'not-rendered': 'the element is not rendered (hidden by CSS, for instance).',
        'zero-size': 'the element has no width or height.',
        'off-screen': 'the element is outside the page.',
        'max-reached': 'the scan reached its limit of pictures.',
        'rule-limit': 'this rule reached its limit of pictures.',
        'capture-failed': 'the picture could not be taken.',
        'store-failed': 'the picture was taken but could not be saved.',
        'time-limit': 'the scan ran out of time for pictures.',
        // A report's JSON taken out of the zip that holds its pictures
        // (report-package.js).
        'not-included': 'it is not included with this copy of the report.'
    };

    // The picture of the flagged element, from a stored file, a data URL or a
    // loaded report package's picture (blob:), or why there is none.
    function elementScreenshotOf(occ) {
        const shot = occ && typeof occ === 'object' ? occ.elementScreenshot : null;
        if (!shot || typeof shot !== 'object') return null;
        // A path into a package the report was not loaded from.
        if (typeof shot.url === 'string' && /^images\//.test(shot.url)) return {skipped: 'not-included'};
        if (typeof shot.url === 'string' && /^(\/reports\/|data:image\/png;base64,|blob:)/.test(shot.url)) {
            return {
                url: shot.url,
                cropped: shot.cropped === true,
                // A merged scan's occurrence: the context the picture shows.
                ...(typeof shot.context === 'string' && shot.context ? {context: shot.context} : {})
            };
        }
        if (typeof shot.skipped === 'string') {
            return {
                skipped: shot.skipped,
                ...(Number.isInteger(shot.max) && shot.max > 0 ? {max: shot.max} : {}),
                // What went wrong, as the browser or the disk said it.
                ...(typeof shot.error === 'string' && shot.error.trim() ? {error: shot.error.trim().slice(0, 300)} : {})
            };
        }
        return null;
    }

    // The element's tag, from its markup, for the picture's text alternative.
    function elementTagOf(html) {
        const m = /^\s*<([a-zA-Z][a-zA-Z0-9-]*)/.exec(String(html || ''));
        return m ? m[1].toLowerCase() : '';
    }

    // `name` is the occurrence's heading ("Occurrence 2"), so each picture's
    // text alternative says which occurrence it belongs to.
    function buildElementScreenshotHtml(n, name = '') {
        const shot = n?.elementScreenshot;
        if (!shot) return '';
        if (shot.url) {
            // Which context the picture shows, when the occurrence is in more than one.
            const inContext = shot.context && Array.isArray(n.contexts) && n.contexts.length > 1
                ? 'Pictured in ' + shot.context + '.'
                : '';
            const caption = [inContext, shot.cropped ? 'Only part of the element fits in the picture.' : ''].filter(Boolean).join(' ');
            const tag = elementTagOf(n.html);
            const alt = (name ? name + ': the' : 'The') + ' flagged ' + (tag ? tag + ' element' : 'element') + ', with a box drawn around it';
            return '<figure class="node-screenshot">' +
                '<img src="' + escapeAttr(shot.url) + '" alt="' + escapeAttr(alt) + '" loading="lazy">' +
                (caption ? '<figcaption>' + escapeHtml(caption) + '</figcaption>' : '') +
                '</figure>';
        }
        const why = shot.skipped === 'max-reached' && shot.max
            ? `the scan reached its limit of ${shot.max} pictures.`
            : shot.skipped === 'rule-limit' && shot.max
                ? `this rule reached its limit of ${shot.max} ${shot.max === 1 ? 'picture' : 'pictures'}.`
                : (SCREENSHOT_SKIP_LABELS[shot.skipped] || shot.skipped);
        const detail = shot.error ? ' (' + shot.error.replace(/\.$/, '') + ')' : '';
        return '<div class="node-detail node-screenshot-none"><strong>No picture:</strong> ' + escapeHtml(detail ? why.replace(/\.$/, '') + detail + '.' : why) + '</div>';
    }

    function buildInstancesListHtml(nodes, type = 'fail') {
        const list = dedupeWithUrlMerge(nodes);
        // Questions in the order a review takes them: likely failures first.
        const ordered = type === 'cantTell'
            ? list.map((n, i) => ({n, i}))
                .sort((a, b) => (REVIEW_GROUP_RANK[reviewGroupOfNode(a.n)] - REVIEW_GROUP_RANK[reviewGroupOfNode(b.n)]) || (a.i - b.i))
                .map((x) => x.n)
            : list;
        // Steps every question shares are shown once, above them.
        const shared = type === 'cantTell' ? sharedHowToCheck(ordered) : null;
        return (shared ? buildHowToCheckHtml(shared, {lang: ordered[0].lang, forAll: true}) : '') + ordered
            .map((n, nodeIndex) => {
                const selector = Array.isArray(n.target) ? n.target.join(', ') : '';
                const rawHtml = (n.html || '').replace(/\s+/g, ' ').trim();
                const shortHtml = rawHtml.length > 250 ? rawHtml.slice(0, 247) + '…' : rawHtml;
                const failure = (n.failureSummary || '').trim();
                const urls = [...new Set((Array.isArray(n.urls) ? n.urls : []))].map(url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`).join(', ');
                const instanceLabel = type === 'fail' ? 'Occurrence' : 'Instance';
                const inContexts = contextsLabel(n);

                const selectorPart = selector
                    ? '<div class="example-node-header">' +
                    '<h2>' + instanceLabel + ' ' + (nodeIndex + 1) +
                    (urls?.length ? ' <span>URLs: ' + urls + '</span>' : '') +
                    (inContexts ? ' <span class="node-contexts">' + escapeHtml(inContexts) + '</span>' : '') +
                    (n.lean ? ' ' + leanBadgeHtml(reviewGroupOfNode(n)) : '') + '</h2>' +
                    '<code hidden="hidden">' + escapeHtml(selector) + '</code>' +
                    '</div>'
                    : '<div class="example-node-header"><h2>Instance ' +
                    (nodeIndex + 1) +
                    (inContexts ? ' <span class="node-contexts">' + escapeHtml(inContexts) + '</span>' : '') +
                    '</h2><code>(no target selector)</code></div>';

                const htmlPart = shortHtml
                    ? '<div class="example-node-code"><div class="example-node-html"><code>' + escapeHtml(shortHtml) + '</code><button type="button" class="copy-selector-btn" data-selector="' + escapeAttr(selector) + '">Copy selector</button></div></div>'
                    : '';

                const failurePart = failure
                    ? '<div class="node-detail"' + langAttr(n.lang) + '>' + convertIndentedBlockToHtml(escapeAngleBrackets(failure)) + '</div>'
                    : '';

                const sourceAtomicRules = normalizeStringListUnique(n?.sourceAtomicRules);
                const sourceAtomicFromContrib = normalizeStringListUnique(
                    (Array.isArray(n?.sourceContributors) ? n.sourceContributors : []).map((c) => c?.testId)
                );
                const resolvedAtomicRules = sourceAtomicRules.length ? sourceAtomicRules : sourceAtomicFromContrib;
                const sourceLine = resolvedAtomicRules.length
                    ? '<div class="node-detail"><strong>' + (resolvedAtomicRules.length === 1 ? 'Check' : 'Checks') + ':</strong> <code>' +
                    escapeHtml(resolvedAtomicRules.join(', ')) +
                    '</code></div>'
                    : '';

                return '<div class="example-node">' + selectorPart + htmlPart + buildElementScreenshotHtml(n, (selector ? instanceLabel : 'Instance') + ' ' + (nodeIndex + 1)) + failurePart + buildOccurrenceDetailsHtml(n) + buildOccurrenceGuidanceHtml(n, {stepsShown: !!shared}) + sourceLine + '</div>';
            })
            .join('');
    }

    // Body of the "View details" dialog for a can't-tell rollup that matched no
    // single element (e.g. wcag-4.1.2-name). Lists the contributing atomic checks
    // a human must verify, reusing the same node/detail markup as the occurrence
    // dialog so both dialogs render consistently.
    function buildReviewHintsBodyHtml(hints) {
        if (hints.partlyChecked) return buildPartlyCheckedBodyHtml(hints);
        const checks = Array.isArray(hints.checksIds) ? hints.checksIds : [];
        const contrib = Array.isArray(hints.contributors) ? hints.contributors : [];

        const intro = hints.isComposite
            ? 'This grouped rule matched no single element, so it could not be auto-verified. Review the contributing checks below manually.'
            : 'No direct element match was reported, so this could not be auto-verified. Review the contributing checks below manually.';

        const checksItems = checks
            .map((c) => '<li><code>' + escapeHtml(String(c)) + '</code></li>')
            .join('');
        const checksBlock = checksItems
            ? '<div class="node-detail"><strong>Checks to review:</strong><ul>' + checksItems + '</ul></div>'
            : '';

        const contribItems = contrib
            .map((c) => {
                const id = c && c.testId ? String(c.testId) : '';
                if (!id) return '';
                const outcome = c && c.outcome ? ' (' + String(c.outcome) + ')' : '';
                return '<li><code>' + escapeHtml(id) + '</code>' + escapeHtml(outcome) + '</li>';
            })
            .filter(Boolean)
            .join('');
        const contribBlock = contribItems
            ? '<div class="node-detail"><strong>Contributors:</strong><ul>' + contribItems + '</ul></div>'
            : '';

        const reasonBlock = hints.reasonCode
            ? '<div class="node-detail"><strong>Reason:</strong> <code>' + escapeHtml(String(hints.reasonCode)) + '</code></div>'
            : '';

        return (
            '<div class="example-node">' +
            '<div class="node-detail">' + escapeHtml(intro) + '</div>' +
            checksBlock +
            contribBlock +
            reasonBlock +
            '</div>'
        );
    }

    /** "Partly checked: 1 of 2 checks were not selected for this scan". */
    function partlyCheckedText(p) {
        return `Partly checked: ${p.notSelected} of ${p.checks} check${p.checks === 1 ? '' : 's'} `
            + `${p.notSelected === 1 ? 'was' : 'were'} not selected for this scan`;
    }

    // Body of the dialog for a criterion the scan checked in part: it ran some
    // of the criterion's checks (named in the scan step), none of them failed,
    // and the others did not run, so the scan cannot say the criterion is met.
    function buildPartlyCheckedBodyHtml(hints) {
        const notSelected = (Array.isArray(hints.contributors) ? hints.contributors : [])
            .filter((c) => c && c.testId && c.notSelected)
            .map((c) => '<li><code>' + escapeHtml(String(c.testId)) + '</code></li>')
            .join('');
        return (
            '<div class="example-node">' +
            '<div class="node-detail">' + escapeHtml(partlyCheckedText(hints.partlyChecked) + '.') + ' '
            + escapeHtml('The checks it ran found no failure, but the criterion is only met if the others pass too. Run them, or review it by hand.') + '</div>' +
            (notSelected ? '<div class="node-detail"><strong>Not selected:</strong><ul>' + notSelected + '</ul></div>' : '') +
            '</div>'
        );
    }

    function leanBadgeHtml(group) {
        if (group !== 'leanFail' && group !== 'leanPass') return '';
        return '<span class="lean-badge lean-badge-' + (group === 'leanFail' ? 'fail' : 'pass') + '">' +
            escapeHtml(REVIEW_GROUP_WORDS[group].toLowerCase()) + '</span>';
    }

    // How a review row's questions lean: { leanFail, leanPass, open }.
    function reviewGroupCounts(nodes) {
        const out = {leanFail: 0, leanPass: 0, open: 0};
        for (const n of Array.isArray(nodes) ? nodes : []) out[reviewGroupOfNode(n)] += 1;
        return out;
    }

    // A review row's group: likely fails when any of its questions does,
    // likely passes when all of them do, else it needs a person.
    function reviewGroupOfIssue(issue) {
        const c = reviewGroupCounts(issue?.nodes);
        if (c.leanFail) return 'leanFail';
        if (c.leanPass && !c.open) return 'leanPass';
        return 'open';
    }

    // Review rows in the order a review takes them (likely failures first),
    // by severity within each group.
    function sortForReview(items) {
        return sortByImpact(items, impactOrder)
            .map((issue, i) => ({issue, i}))
            .sort((a, b) => (REVIEW_GROUP_RANK[reviewGroupOfIssue(a.issue)] - REVIEW_GROUP_RANK[reviewGroupOfIssue(b.issue)]) || (a.i - b.i))
            .map((x) => x.issue);
    }

    // How many of the findings' questions (cantTell occurrences, a failing
    // rule's too) lean fail.
    function countLikelyFailures(findings) {
        let n = 0;
        for (const f of Array.isArray(findings) ? findings : []) {
            for (const occ of Array.isArray(f?.occurrences) ? f.occurrences : []) {
                if (getOccurrenceOutcome(occ, f.outcome) === 'cantTell' && occ?.lean?.toward === 'fail') n += 1;
            }
        }
        return n;
    }

    // " (2 likely fail)", beside a count of questions, or '' with none.
    function likelyFailText(n) {
        return n > 0 ? ' (' + n + ' likely ' + (n === 1 ? 'fails' : 'fail') + ')' : '';
    }

    // ["2 likely fail", "1 needs a person"], for a row whose questions lean.
    function reviewGroupCountsParts(nodes) {
        const c = reviewGroupCounts(nodes);
        if (!c.leanFail && !c.leanPass) return [];
        const parts = [];
        if (c.leanFail) parts.push(c.leanFail + ' likely ' + (c.leanFail === 1 ? 'fails' : 'fail'));
        if (c.leanPass) parts.push(c.leanPass + ' likely ' + (c.leanPass === 1 ? 'passes' : 'pass'));
        if (c.open) parts.push(c.open + ' ' + (c.open === 1 ? 'needs' : 'need') + ' a person');
        return parts;
    }

    function buildInstancesCellHtmlForIssue({issue, nodes, nodeCount, index, rowIndex, ruleId, impact, type}) {
        if (!nodeCount) {
            const hints = (issue && issue.reviewHints && typeof issue.reviewHints === 'object')
                ? issue.reviewHints
                : null;

            const hasHints = !!hints && (
                (Array.isArray(hints.checksIds) && hints.checksIds.length > 0) ||
                (Array.isArray(hints.contributors) && hints.contributors.length > 0) ||
                !!hints.reasonCode
            );

            if (type !== 'cantTell' || !hasHints) {
                return '<span class="instances-meta">No instances reported.</span>';
            }

            const safeReviewRule = String(ruleId || 'rule')
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, '-')
                .slice(0, 40);
            const reviewDialogId = `occ-s${index}-r${rowIndex}-${safeReviewRule}-review`;

            const partly = hints.partlyChecked || null;

            // Match the occurrence-row pattern: compact cell + "View details" dialog.
            return (
                '<div class="instances-meta' + (partly ? ' instances-meta--note' : '') + '">' + (partly ? escapeHtml(partlyCheckedText(partly)) : 'Needs review') + '</div>' +
                '<button type="button" class="src-dialog-trigger" data-dialog-id="' +
                reviewDialogId +
                '">View details</button>' +
                '<dialog id="' +
                reviewDialogId +
                '" class="src-dialog" aria-labelledby="' +
                reviewDialogId +
                '-title">' +
                '<div class="src-dialog-header">' +
                '<p id="' +
                reviewDialogId +
                '-title" class="lab-dialog-title"><code>' +
                escapeHtml(ruleId || '') +
                '</code></p>' +
                '<p class="src-dialog-meta">Impact: ' +
                escapeHtml(impact || 'unknown') +
                (partly ? ' · Partly checked</p>' : ' · Needs manual review</p>') +
                '<button type="button" class="src-dialog-close" aria-label="Close dialog">Close</button>' +
                '</div>' +
                '<div class="src-dialog-body">' +
                buildReviewHintsBodyHtml(hints) +
                '</div>' +
                '<div class="src-dialog-footer">' +
                '<button type="button" class="src-dialog-close">Close</button>' +
                '</div>' +
                '</dialog>'
            );
        }

        const safeRule = String(ruleId || 'rule')
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .slice(0, 40);

        const dialogId = `occ-s${index}-r${rowIndex}-${safeRule}`;
        // The occurrences are drawn when the dialog is first opened
        // (lazy-dialogs.js): drawn here, for every finding of every scan, they
        // were most of a large report's page.
        const lazyBodyId = registerLazyBody(() => buildInstancesListHtml(nodes, type));

        const instanceLabel = type === 'fail' ? 'occurrence' : 'instance';
        // Each part is kept on one line; a narrow column wraps between them.
        const leaning = type === 'cantTell'
            ? reviewGroupCountsParts(nodes)
                .map((part) => '<span class="instances-lean__part">' + escapeHtml(part) + '</span>')
                .join(', ')
            : '';

        return (
            '<div class="instances-meta">' +
            nodeCount +
            ' ' + instanceLabel +
            (nodeCount === 1 ? '' : 's') +
            (leaning ? '<br><span class="instances-lean">' + leaning + '</span>' : '') +
            '</div>' +
            '<button type="button" class="src-dialog-trigger" data-dialog-id="' +
            dialogId +
            '">View details</button>' +
            '<dialog id="' +
            dialogId +
            '" class="src-dialog" aria-labelledby="' +
            dialogId +
            '-title">' +
            '<div class="src-dialog-header">' +
            '<p id="' +
            dialogId +
            `-title" class="lab-dialog-title"><code>` +
            escapeHtml(ruleId || '') +
            '</code></p>' +
            '<p class="src-dialog-meta">Impact: ' +
            escapeHtml(impact || 'unknown') +
            ' · ' +
            nodeCount +
            ' ' + instanceLabel +
            (nodeCount === 1 ? '' : 's') +
            '</p>' +
            '<button type="button" class="src-dialog-close" aria-label="Close dialog">Close</button>' +
            '</div>' +
            '<div class="src-dialog-body" data-lazy-body="' + lazyBodyId + '" data-lazy-count="' + nodeCount + '"></div>' +
            '<div class="src-dialog-footer">' +
            '<span class="src-dialog-meta">' +
            nodeCount +
            ' ' + instanceLabel +
            (nodeCount === 1 ? '' : 's') +
            ' listed.</span>' +
            '<button type="button" class="src-dialog-close">Close</button>' +
            '</div>' +
            '</dialog>'
        );
    }

    function buildIssueRowHtml(issue, {index, rowIndex, type}) {
        const impactClass = issue?.impact ? 'impact-' + issue.impact : '';
        const nodes = Array.isArray(issue?.nodes) ? issue.nodes : [];
        const nodeCount = nodes.length;

        const issueWords = {
            fail: 'Fail',
            cantTell: 'Review',
            pass: 'Pass'
        }

        const status = issueWords[type]
            ? resultGlyphHtml(type, {size: 'sm'}) + ' ' + issueWords[type] +
                (type === 'cantTell' && reviewGroupOfIssue(issue) !== 'open' ? ' ' + leanBadgeHtml(reviewGroupOfIssue(issue)) : '')
            : '';

        const groupedTagsHtml = buildGroupedTagsHtml(issue);
        const helpLink = buildHelpLinkHtml(issue);

        const instancesCell = buildInstancesCellHtmlForIssue({
            issue,
            nodes,
            nodeCount,
            index,
            rowIndex,
            ruleId: issue.id || '',
            impact: issue.impact || 'unknown',
            type
        });

        // A review row whose questions likely fail stands out from the other
        // review rows, still in the review color, not the failure one.
        const rowClass = type === 'cantTell' && reviewGroupOfIssue(issue) === 'leanFail' ? type + ' lean-fail' : type;

        // Each cell names its column (data-label), which a phone shows in
        // the cell when the rows are laid out as cards; the roles keep them a
        // table to a screen reader once they are (see .results-table).
        return (
            '<tr role="row" class="' + rowClass + '">' +
            '<td role="cell" data-label="Status"><span class="issue-status">' +
            status +
            '</span></td>' +
            '<td role="cell" data-label="Severity" class="' +
            impactClass +
            '">' +
            escapeHtml(issue.impact || 'unknown') +
            '</td>' +
            '<td role="cell" data-label="Description">' +
            withLang(escapeHtml(issue.help || issue.description || ''), issue.titleLang || issue.lang) +
            (issue.id ? '<br />Rule: ' + escapeHtml(issue.id).replaceAll(',', ', ') : '') +
            (helpLink ? ' (' + helpLink + ')' : '') +
            '</td>' +
            '<td role="cell" data-label="Occurrences">' +
            instancesCell +
            '</td>' +
            (showEngineColumn ? '<td role="cell" data-label="Engine" class="engine-name">' + escapeHtml(issue.engine?.name || '') + '</td>' : '') +
            '<td role="cell" data-label="Criteria">' +
            groupedTagsHtml +
            '</td>' +
            '</tr>'
        );
    }

    const impactOrder = ['critical', 'serious', 'moderate', 'minor', 'info'];

    function sortByImpact(items, impactOrder) {
        const orderIndex = new Map(
            impactOrder.map((value, index) => [value, index])
        );

        return items.slice().sort((a, b) => {
            const aIndex = orderIndex.has(a.impact)
                ? orderIndex.get(a.impact)
                : Number.POSITIVE_INFINITY;

            const bIndex = orderIndex.has(b.impact)
                ? orderIndex.get(b.impact)
                : Number.POSITIVE_INFINITY;

            return aIndex - bIndex;
        });
    }

    // ---------------------------------------------------------------------
    // Shared issues table shell (used by ungrouped and grouped render paths)
    // ---------------------------------------------------------------------

    // Whether the results tables have an Engine column: only for a report
    // more than one engine ran (the more-engines add-on), as with surea11y
    // alone every row would say the same. Set for the whole report before it
    // is drawn (setReportEngines), so all its tables have the same columns.
    let showEngineColumn = false;

    function setReportEngines(scans) {
        showEngineColumn = collectEngineOptions(scans).length > 1;
    }

    // Every results table has the same column widths, so the tables of a
    // report's scans and groups line up one under another (the tables are
    // laid out fixed: .results-table). Description, the longest, gets the most.
    const ISSUES_TABLE_COLUMNS = [
        {label: 'Status', width: 11, withEngine: 10},
        {label: 'Severity', width: 11, withEngine: 10},
        {label: 'Description', width: 42, withEngine: 36},
        {label: 'Occurrences', width: 17, withEngine: 16},
        {label: 'Engine', width: 0, withEngine: 10, engine: true},
        {label: 'Criteria', width: 19, withEngine: 18}
    ];

    function issuesTableColumns() {
        return ISSUES_TABLE_COLUMNS.filter((c) => showEngineColumn || !c.engine);
    }

    function buildIssuesTableColgroupHtml() {
        return '<colgroup>' +
            issuesTableColumns()
                .map((c) => '<col' + (c.engine ? ' class="engine-name"' : '') + ' style="width: ' + (showEngineColumn ? c.withEngine : c.width) + '%">')
                .join('') +
            '</colgroup>';
    }

    function buildIssuesTableHeaderHtml() {
        return '<thead role="rowgroup"><tr role="row">' +
            issuesTableColumns()
                .map((c) => '<th role="columnheader" scope="col"' + (c.engine ? ' class="engine-name"' : '') + '>' + c.label + '</th>')
                .join('') +
            '</tr></thead>';
    }

    function buildIssuesTableShellHtml({ caption, rowsFail, rowsCantTell, failCount, cantTellCount }) {
        const bodyHtml = rowsFail + rowsCantTell;
        return (
            '<div class="table-container' + (rowsFail.length > 0 ? '' : ' cantTell')  + '">' +
            '<table role="table" class="results-table" aria-label="Accessibility results: ' + escapeAttr(caption || '') + '">' +
            buildIssuesTableColgroupHtml() +
            buildIssuesTableHeaderHtml() +
            '<tbody role="rowgroup">' +
            (bodyHtml || '') +
            '</tbody>' +
            '</table>' +
            '</div>'
        );
    }

    function buildIssuesTableHtml(issues, params = {index: 0, label: 'Scan'}, groupingSpec = null, coverageSummary = null) {
        const {fail, cantTell} = issues;
        const {index, label, json} = params;

        const hasAny = (Array.isArray(fail) && fail.length) || (Array.isArray(cantTell) && cantTell.length);
        if (!hasAny) {
            return '<div class="no-results">No accessibility violations detected for the selected filters or rules.</div>';
        }

        const normalizedGroups = normalizeGroupingSpec(groupingSpec);

        // Default behavior, single table, same as today
        if (!normalizedGroups.length) {
            const rowsFail = sortByImpact(fail, impactOrder).map((issue, idx) => buildIssueRowHtml(issue, {
                index,
                rowIndex: idx,
                type: 'fail'
            })).join('');

            const rowsCantTell = sortForReview(cantTell).map((issue, idx) => buildIssueRowHtml(issue, {
                index,
                rowIndex: idx,
                type: 'cantTell'
            })).join('');

            return buildIssuesTableShellHtml({
                caption: label,
                rowsFail,
                rowsCantTell,
                failCount: Array.isArray(fail) ? fail.length : 0,
                cantTellCount: Array.isArray(cantTell) ? cantTell.length : 0
            });
        }

        // Grouped behavior, one table per group, plus Others
        const { buckets: failBuckets, notInWcag: failNotInWcag, unmatched: failOthers } = groupIssuesBySpec(fail, normalizedGroups);
        const { buckets: cantTellBuckets, notInWcag: cantTellNotInWcag, unmatched: cantTellOthers } = groupIssuesBySpec(cantTell, normalizedGroups);

        const groupOrder = normalizedGroups.map(g => g.group);

        function buildGroupBadgeHtml(groupSpec) {
            // Coverage is measured per WCAG criterion: a group that names
            // none has no badge.
            if (!coverageSummary || !groupSpec || !Array.isArray(groupSpec.WCAG)) return '';

            const topic = summarizeTopic(coverageSummary, groupSpec.WCAG);
            const text = topicBadgeText(topic);
            if (!text) return '';

            return '<p class="issues-group-coverage issues-group-coverage-' + escapeHtml(topic.state) + '">'
                + escapeHtml(text) + '</p>';
        }

        function buildOneGroupTable(groupLabel, groupFail, groupCantTell, groupSpec) {
            const groupHasAny = (groupFail && groupFail.length) || (groupCantTell && groupCantTell.length);
            const badge = buildGroupBadgeHtml(groupSpec);

            // A topic with no findings is still rendered when there is a badge to show:
            // dropping it made "nothing was checked here" look like "nothing was wrong".
            if (!groupHasAny && !badge) return '';

            const rowsFail = sortByImpact(groupFail || [], impactOrder).map((issue, idx) => buildIssueRowHtml(issue, {
                index,
                rowIndex: idx,
                type: 'fail'
            })).join('');

            const rowsCantTell = sortForReview(groupCantTell || []).map((issue, idx) => buildIssueRowHtml(issue, {
                index,
                rowIndex: idx,
                type: 'cantTell'
            })).join('');

            const body = groupHasAny
                ? buildIssuesTableShellHtml({
                    caption: label + ' , group ' + groupLabel,
                    rowsFail,
                    rowsCantTell,
                    failCount: Array.isArray(groupFail) ? groupFail.length : 0,
                    cantTellCount: Array.isArray(groupCantTell) ? groupCantTell.length : 0
                })
                : '<p class="issues-group-empty">No automated findings in this topic.</p>';

            return (
                '<section class="issues-group' + (rowsFail.length > 0 ? '' : ' cantTell')  + '">' +
                '<h4 class="issues-group-title">' + escapeHtml(groupLabel) + '</h4>' +
                badge +
                body +
                '</section>'
            );
        }

        let out = '';

        for (const groupName of groupOrder) {
            const fb = failBuckets.find(b => b.group === groupName);
            const cb = cantTellBuckets.find(b => b.group === groupName);

            out += buildOneGroupTable(
                groupName,
                fb ? fb.items : [],
                cb ? cb.items : [],
                normalizedGroups.find(g => g.group === groupName) || null
            );
        }

        // A standard's requirements that correspond to no WCAG criterion, when
        // no group named them; then anything else no group took.
        out += buildOneGroupTable(NOT_IN_WCAG_GROUP, failNotInWcag, cantTellNotInWcag, null);
        out += buildOneGroupTable(OTHERS_GROUP, failOthers, cantTellOthers, null);

        // If somehow everything ended up empty (should not happen), fallback to the old message
        if (!out) {
            return '<div class="no-results">No accessibility violations detected for the selected filters or rules.</div>';
        }

        return out;
    }

    // A scan's best-practice findings (canonical.bestPractices), as issue rows
    // split the way the requirements' are.
    function getBestPracticeIssues(scan) {
        const list = Array.isArray(scan?.canonical?.bestPractices) ? scan.canonical.bestPractices : [];
        const url = scan?.url || '';
        const rowsFor = (outcome) => mergeCompositeIssueRows(list
            .flatMap((finding) => splitFindingByOccurrenceOutcome(finding))
            .filter((f) => f && f.outcome === outcome)
            .map((f) => findingToIssueRow(f, url, standardIdOf(scan))));
        return {fail: rowsFor('fail'), cantTell: rowsFor('cantTell')};
    }

    // The best practices a scan included, in a section of their own below the
    // requirements: they test no requirement of the scan's target, so they
    // count toward no criterion, score or compliance rate. Empty when the scan
    // found none failing or to review.
    function buildBestPracticesSectionHtml(scan, {index, label}) {
        const {fail, cantTell} = getBestPracticeIssues(scan);
        if (!fail.length && !cantTell.length) return '';
        const headingId = `bp-s${index}`;
        const counts = [
            fail.length ? `${fail.length} failing` : '',
            cantTell.length ? `${cantTell.length} to review` : ''
        ].filter(Boolean).join(', ');
        return (
            '<section class="best-practices" aria-labelledby="' + escapeAttr(headingId) + '">' +
            '<h4 class="issues-group-title" id="' + escapeAttr(headingId) + '">Best practices</h4>' +
            '<p class="best-practices-note">' + escapeHtml(counts) + '. Good practice beyond the conformance target: '
            + 'these count toward no criterion, score or compliance rate.</p>' +
            buildIssuesTableHtml({fail, cantTell}, {index: `${index}bp`, label: `${label}: best practices`}) +
            '</section>'
        );
    }

    function renderTable(scan, index) {
        const container = document.createElement('div');
        container.classList.add('results-container');
        if (!scan) return container;
        const label = scan.label || scan.id || 'Scan ' + index;
        const bestPractices = buildBestPracticesSectionHtml(scan, {index, label});
        const hasFindings = getCanonicalFindings(scan).length > 0;
        if (!hasFindings && !bestPractices) return container;

        const json = scan?.report?.json;

        const fail = getScanViolationsList(scan);
        const cantTell = getScanIncompleteList(scan);

        container.innerHTML = (hasFindings
            ? buildIssuesTableHtml({fail, cantTell}, {index, label, json}, ACTIVE_ISSUE_GROUPS, scan?.metrics?.coverageSummary || null)
            : '') + bestPractices;

        return container;
    }

    function buildUrlRow(url) {
        const row = document.createElement('div');
        row.className = 'scan-url line-ellipsis one-line-ellipsis';

        row.innerHTML =
            '<a href="' +
            escapeAttr(url) +
            '" target="_blank" rel="noopener noreferrer" class="scan-url-link">' +
            escapeHtml(url) +
            '</a>';

        return row;
    }

    function createScanWrapper(scan, id, index) {
        const header = document.createElement('div');
        header.className = 'scan-header';
        const heading = document.createElement('h3');
        heading.setAttribute('tabindex', '-1');
        heading.id = `sc-${id}`;
        heading.appendChild(document.createTextNode('Scan: '));

        const {nameText, nameInput} = buildScanNameEditParts(scan, index);
        heading.appendChild(nameText);
        heading.appendChild(nameInput);

        const excludedBadge = document.createElement('span');
        excludedBadge.className = 'scan-excluded-badge';
        excludedBadge.textContent = 'Excluded';
        excludedBadge.hidden = scan?.includedInReport !== false;
        heading.appendChild(excludedBadge);

        header.appendChild(heading);

        const {tagsRegion, tagsDisplay, tagsEditor} = buildScanTagsParts(scan, id);
        header.appendChild(tagsRegion);

        const scanResultsWrapper = document.createElement('div');
        scanResultsWrapper.className = 'scan-results-wrapper';
        scanResultsWrapper.setAttribute('data-scan-id', id);

        if (globalThis.A11Y_SCAN_SORT) {
            const v = globalThis.A11Y_SCAN_SORT.scanSortValues(scan);
            scanResultsWrapper.setAttribute('data-sort-order', String(Number(index) || 0));
            scanResultsWrapper.setAttribute('data-sort-failures', String(v.failures));
            scanResultsWrapper.setAttribute('data-sort-occurrences', String(v.occurrences));
        }

        const scanResultsContainer = document.createElement('div');
        scanResultsContainer.classList.add('scan-results-container');

        const scanResultsMeta = document.createElement('div');
        scanResultsMeta.classList.add('scan-results-meta');


        return {
            scanResultsWrapper, header, scanResultsContainer, scanResultsMeta,
            nameText, nameInput, excludedBadge, tagsDisplay, tagsEditor
        };
    }

    function defaultScanLabel(scan, index) {
        return String(scan?.id || (index != null ? `Scan ${index + 1}` : 'Scan') || '').trim();
    }

    /** Builds the (initially hidden) name text/input pair shared by the rename button. */
    function buildScanNameEditParts(scan, index) {
        const nameText = document.createElement('span');
        nameText.className = 'scan-name-text';
        nameText.textContent = scan?.label || defaultScanLabel(scan, index);
        if (scan?.id) nameText.dataset.scanId = scan.id;

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'scan-name-input';
        nameInput.hidden = true;
        nameInput.setAttribute('aria-label', 'Edit scan name');
        if (scan?.id) nameInput.dataset.scanId = scan.id;

        return {nameText, nameInput};
    }

    /**
     * The tag area of a scan header: read-only chips plus the (initially hidden)
     * editor the edit-tags button swaps in. The region carries the scan id so the
     * chips can be repainted in place after an edit.
     */
    function buildScanTagsParts(scan, id) {
        const tagsRegion = document.createElement('span');
        tagsRegion.className = 'scan-tags-region';
        if (id) tagsRegion.dataset.scanId = id;

        const tagsDisplay = document.createElement('span');
        tagsDisplay.className = 'scan-tags-display';
        tagsDisplay.innerHTML = scanTagChipsHtml(scan?.scanTags);

        const tagsEditor = document.createElement('span');
        tagsEditor.className = 'scan-tags-edit';
        tagsEditor.hidden = true;

        tagsRegion.append(tagsDisplay, tagsEditor);

        return {tagsRegion, tagsDisplay, tagsEditor};
    }

    /**
     * Current tags for a scan, read from the rendered chips rather than the
     * `scan` object: `scan` is a clone taken at render time (see
     * prepareDataForReport), so it goes stale after an edit that only patches
     * the DOM and the live payload (see updateScanTags in a11y-ui.js).
     */
    function readDisplayedTags(tagsDisplay) {
        return Array.from(tagsDisplay.querySelectorAll('.scan-tag')).map((el) => el.textContent.trim()).filter(Boolean);
    }

    function buildScanTagsEditButton(scan, {tagsDisplay, tagsEditor}) {
        const editBtn = iconButton({
            className: 'secondary-button icon-button scan-tags-editbtn',
            ariaLabel: 'Edit scan tags',
            title: 'Edit scan tags',
            iconName: 'tag'
        });
        if (scan?.id) {
            editBtn.dataset.scanAction = 'edit-tags';
            editBtn.dataset.scanId = scan.id;
        }

        const canEdit = typeof onEditScanTags === 'function' && scan?.id;
        if (!canEdit) {
            editBtn.disabled = true;
            editBtn.setAttribute('aria-disabled', 'true');
            return editBtn;
        }

        let widget = null;

        function exitEdit() {
            tagsEditor.hidden = true;
            tagsEditor.replaceChildren();
            tagsDisplay.hidden = false;
            widget = null;
            editBtn.setAttribute('aria-expanded', 'false');
            try {
                editBtn.focus();
            } catch {
                // ignore
            }
        }

        function save() {
            const tags = widget ? widget.getTags() : [];
            exitEdit();
            onEditScanTags(scan.id, tags);
        }

        function enterEdit() {
            widget = buildTagsInputControl({
                fieldId: `scan-tags-edit__${scan.id}`,
                labelText: 'Scan tags',
                placeholder: 'Add a tag…',
                getSuggestions: () => (typeof getScanTagSuggestions === 'function' ? getScanTagSuggestions() : []),
            });
            widget.setTags(readDisplayedTags(tagsDisplay));

            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'scan-tags-edit__save';
            saveBtn.textContent = 'Save';
            saveBtn.addEventListener('click', save);

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'secondary-button scan-tags-edit__cancel';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', exitEdit);

            // The widget calls preventDefault on the Escape that closes its
            // suggestion listbox, so the editor only leaves on an Escape the
            // widget did not already consume.
            tagsEditor.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape' || e.defaultPrevented) return;
                e.preventDefault();
                exitEdit();
            });

            tagsEditor.replaceChildren(widget.el, saveBtn, cancelBtn);
            tagsEditor.hidden = false;
            tagsDisplay.hidden = true;
            editBtn.setAttribute('aria-expanded', 'true');

            requestAnimationFrame(() => {
                try {
                    widget.entry.focus();
                } catch {
                    // ignore
                }
            });
        }

        editBtn.setAttribute('aria-expanded', 'false');
        editBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (tagsEditor.hidden) enterEdit(); else exitEdit();
        });

        return editBtn;
    }

    function buildScanRenameButton(scan, index, {nameText, nameInput}) {
        const renameBtn = iconButton({
            className: 'secondary-button icon-button scan-rename',
            ariaLabel: 'Rename scan',
            title: 'Rename scan',
            iconName: 'edit'
        });
        if (scan?.id) {
            renameBtn.dataset.scanAction = 'rename';
            renameBtn.dataset.scanId = scan.id;
        }

        const canRename = typeof onRenameScan === 'function' && scan?.id;

        function enterEdit() {
            // Read the currently displayed name rather than `scan.label`: `scan` here is a
            // clone taken at render time (see prepareDataForReport), so it can go stale after
            // a rename that only patches the DOM + the live payload (see renameScan in a11y-ui.js).
            nameInput.value = nameText.textContent || defaultScanLabel(scan, index);
            nameText.classList.add('visually-hidden');
            nameInput.hidden = false;
            requestAnimationFrame(() => {
                try {
                    nameInput.focus();
                    nameInput.select();
                } catch {
                    // ignore
                }
            });
        }

        function exitEdit() {
            nameInput.hidden = true;
            nameText.classList.remove('visually-hidden');
        }

        function save() {
            const raw = String(nameInput.value || '').trim();
            exitEdit();
            try {
                renameBtn.focus();
            } catch {
                // ignore
            }
            if (canRename) onRenameScan(scan.id, raw || null);
        }

        function cancel() {
            exitEdit();
            try {
                renameBtn.focus();
            } catch {
                // ignore
            }
        }

        if (canRename) {
            renameBtn.addEventListener('click', (e) => {
                e.preventDefault();
                enterEdit();
            });

            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    save();
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancel();
                }
            });

            nameInput.addEventListener('blur', () => {
                if (nameInput.hidden) return;
                save();
            });
        } else {
            renameBtn.disabled = true;
            renameBtn.setAttribute('aria-disabled', 'true');
        }

        return renameBtn;
    }

    function buildScanIncludeToggleButton(scan, options = {}) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'secondary-button scan-include-toggle';

        const isIncluded = scan?.includedInReport !== false;
        btn.textContent = isIncluded ? 'Exclude from report' : 'Include in report';
        btn.setAttribute('aria-pressed', isIncluded ? 'true' : 'false');
        if (scan?.id) {
            btn.dataset.scanAction = 'toggle';
            btn.dataset.scanId = scan.id;
        }

        if (typeof onToggleScanIncludedInReport === 'function' && scan?.id) {
            btn.addEventListener('click', () => {
                onToggleScanIncludedInReport(scan.id);
            });
        } else {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        }

        return btn;
    }

    function buildScanMoveButtons(scan, index, total) {
        const wrapper = document.createElement('span');
        wrapper.className = 'scan-move-controls';

        const isFirst = index === 0;
        const isLast = index === (total - 1);

        const canMove = typeof onMoveScan === 'function' && scan?.id;

        const upBtn = document.createElement('button');
        upBtn.type = 'button';
        upBtn.className = 'secondary-button icon-button scan-move-up';
        upBtn.textContent = '▲';
        upBtn.setAttribute('aria-label', 'Move scan up');
        if (scan?.id) {
            upBtn.dataset.scanAction = 'move-up';
            upBtn.dataset.scanId = scan.id;
        }
        // The listener is attached whatever the current position: reordering
        // re-enables the ends in place rather than re-rendering, so a button
        // bound only while enabled would go inert once it stopped being first.
        if (canMove) upBtn.addEventListener('click', () => onMoveScan(scan.id, -1));
        if (!canMove || isFirst) {
            upBtn.disabled = true;
            upBtn.setAttribute('aria-disabled', 'true');
        }

        const downBtn = document.createElement('button');
        downBtn.type = 'button';
        downBtn.className = 'secondary-button icon-button scan-move-down';
        downBtn.textContent = '▼';
        downBtn.setAttribute('aria-label', 'Move scan down');
        if (scan?.id) {
            downBtn.dataset.scanAction = 'move-down';
            downBtn.dataset.scanId = scan.id;
        }
        if (canMove) downBtn.addEventListener('click', () => onMoveScan(scan.id, 1));
        if (!canMove || isLast) {
            downBtn.disabled = true;
            downBtn.setAttribute('aria-disabled', 'true');
        }

        wrapper.appendChild(upBtn);
        wrapper.appendChild(downBtn);

        return wrapper;
    }

    function isSkippedScan(scan) {
        return !!(scan && (scan.skipped || scan.skipInfo));
    }

    function generateScanUrlData(scan) {
        const urlFromA11y = scan?.canonical?.page?.url || null;
        if (!urlFromA11y) return;

        return buildUrlRow(urlFromA11y);
    }

    function generateScanMetadata(scan) {
        const meta = document.createElement('div');
        meta.className = 'stream-counts';

        const bits = [];
        const profile = globalThis.A11Y_REPORT_SCAN?.scanProfile(scan);
        if (profile?.label) bits.push(String(profile.label));
        const optIn = optInRulesLabel(scan);
        if (optIn) bits.push(`Plus ${optIn}`);
        if (scan?.context) bits.push(`Context: ${scan.context}`);
        // The language Set language showed the page in.
        const language = scan?.canonical?.page?.language?.requested;
        if (language) bits.push(`Language: ${language}`);

        // Canonical-first counts
        const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
        const failCount = findings.length ? findings.filter(f => f?.outcome === 'fail').length : null;
        const cantTellCount = findings.length ? findings.filter(f => f?.outcome === 'cantTell').length : null;
        const passCount = findings.length ? findings.filter(f => f?.outcome === 'pass').length : null;

        // Fallback to any summary counts if canonical is missing
        const s = scan?.summary || {};
        const fail = (failCount !== null) ? failCount : (s.failCount ?? 0);
        const cantTell = (cantTellCount !== null) ? cantTellCount : (s.reviewCount ?? 0);
        const pass = (passCount !== null) ? passCount : (s.passesCount ?? 0);

        const prefix = bits.length ? (bits.join(' · ') + ': ') : '';
        const likely = likelyFailText(countLikelyFailures(findings));
        meta.innerHTML = escapeHtml(prefix) +
            '<span class="stream-fail">' + resultGlyphHtml('fail') + ' ' + (fail || 0) + ' fail</span>, ' +
            '<span class="stream-cantTell">' + resultGlyphHtml('cantTell') + ' ' + (cantTell || 0) + ' can\'t tell' + likely + '</span>, ' +
            '<span class="stream-pass">' + resultGlyphHtml('pass') + ' ' + (pass || 0) + ' pass</span>';

        return meta;
    }

    // Notes on what a scan could not see on the page (a hook the page's own
    // scripts got around, a page shown in forced colors, a page that did not
    // follow Set language's language): they qualify some
    // results rather than the whole scan, so they sit below the results,
    // collapsed, not with the scan's header.
    const SCAN_NOTICES_AFTER = new Set(['listener-hook', 'internals-hook', 'live-region-hook', 'forced-colors', 'language-mismatch']);

    // The distinct messages of a scan's notices, those that qualify some
    // results (`after`) or the rest.
    function scanNoticeMessages(scan, after) {
        const notices = Array.isArray(scan?.canonical?.notices) ? scan.canonical.notices : [];
        return [...new Set(notices
            .filter((n) => SCAN_NOTICES_AFTER.has(n?.code) === after)
            .map((n) => String(n?.message || '').trim())
            .filter(Boolean))];
    }

    // What an engine said about how the scan ran, such as rule ids it has
    // none of or a scope that matched nothing: a scan can look clean
    // because of it, so it sits with the scan's header, not in a table.
    function buildScanNotices(scan) {
        const messages = scanNoticeMessages(scan, false);
        if (!messages.length) return null;

        const box = document.createElement('div');
        box.className = 'hint scan-notices';
        const title = document.createElement('p');
        title.className = 'scan-notices-title';
        title.textContent = messages.length === 1 ? 'Note on this scan' : 'Notes on this scan';
        const ul = document.createElement('ul');
        for (const m of messages) {
            const li = document.createElement('li');
            li.textContent = m;
            ul.appendChild(li);
        }
        box.append(title, ul);
        return box;
    }

    // The notes that qualify some results, below them and collapsed, as
    // "Closest to the limit" is.
    function buildScanNoticesAfter(scan) {
        const messages = scanNoticeMessages(scan, true);
        if (!messages.length) return null;

        const details = document.createElement('details');
        details.className = 'a11y-details scan-notices-after';
        const summary = document.createElement('summary');
        summary.textContent = `What this scan could not see (${messages.length} ${messages.length === 1 ? 'note' : 'notes'})`;
        const intro = document.createElement('p');
        intro.className = 'hint';
        intro.textContent = 'Parts of this page surea11y could not fully see, and which results that affects.';
        const ul = document.createElement('ul');
        for (const m of messages) {
            const li = document.createElement('li');
            li.textContent = m;
            ul.appendChild(li);
        }
        details.append(summary, intro, ul);
        return details;
    }

    // "Closest to the limit": for each rule that measures against a
    // threshold, the passing element that came closest to it. A pass with
    // almost no room is the result a small change will flip, so it is
    // worth seeing before it does.
    function buildMarginsSection(scan) {
        const margins = scanMargins(scan);
        if (!margins.length) return null;

        const near = margins.filter(isNearMiss).length;
        const details = document.createElement('details');
        details.className = 'a11y-details a11y-margins';

        const summary = document.createElement('summary');
        summary.textContent = 'Closest to the limit'
            + (near ? ` (${near} near ${near === 1 ? 'miss' : 'misses'})` : '');
        details.appendChild(summary);

        const intro = document.createElement('p');
        intro.className = 'hint';
        intro.textContent = 'For each rule that measures against a limit, the element that met it with the least room. '
            + 'These are passes; a near miss is one a small change in colour, text or layout would turn into a failure.';
        details.appendChild(intro);

        const wrap = document.createElement('div');
        wrap.className = 'a11y-margins-wrap';
        // A merged scan's margin says in which of its contexts it was measured.
        const contextsTotal = scan?.mergedScan === true && Array.isArray(scan.contexts)
            ? scan.contexts.filter((c) => c && !c.skipped).length
            : 0;
        const rows = margins.map((m) => {
            const nearMiss = isNearMiss(m);
            const where = contextsTotal ? contextsLabel({contexts: m.contexts, contextsTotal}) : '';
            return `<tr${nearMiss ? ' class="a11y-margins-near"' : ''}>`
                + `<th scope="row">${escapeHtml(m.title || m.ruleId)}`
                + (m.title && m.title !== m.ruleId ? ` <code>${escapeHtml(m.ruleId)}</code>` : '') + '</th>'
                + `<td>${escapeHtml(formatMarginValue(m))}</td>`
                + `<td>${escapeHtml(formatMarginLimit(m))}</td>`
                + `<td>${escapeHtml(formatMarginRoom(m))}${nearMiss ? ' <span class="a11y-margins-badge">near miss</span>' : ''}</td>`
                + `<td>${m.selector ? `<code>${escapeHtml(m.selector)}</code>` : '—'}`
                + (where ? ` <span class="margin-contexts">${escapeHtml(where)}</span>` : '') + '</td>'
                + '</tr>';
        }).join('');
        wrap.innerHTML = '<table class="a11y-margins-table">'
            + '<thead><tr><th scope="col">Rule</th><th scope="col">Closest</th><th scope="col">Limit</th>'
            + '<th scope="col">Room left</th><th scope="col">Element</th></tr></thead>'
            + `<tbody>${rows}</tbody></table>`;
        details.appendChild(wrap);
        return details;
    }

    function buildScreenshotsSection(scan) {
        const screenshotsEls = buildScreenshotElements(scan);

        const screenshotsContainer = document.createElement('div');
        screenshotsContainer.classList.add('screenshot-preview');

        if (screenshotsEls.length) {
            screenshotsEls.forEach((btn) => screenshotsContainer.appendChild(btn));
            // A merged scan's screenshots, one per context: the first full
            // size, the rest small, in rows of three.
            if (screenshotsEls.length > 1 && screenshotsEls.some((el) => el.classList?.contains('screenshot-context-figure'))) {
                screenshotsContainer.classList.add('screenshot-preview--contexts');
            }
        } else {
            const noImg = document.createElement('div');
            noImg.className = 'hint';
            noImg.textContent = 'No screenshots available for this scan.';
            screenshotsContainer.appendChild(noImg);
        }

        // A page larger than a picture can be is pictured from its top left
        // (screenshot-capture.js): the scan still checked all of it.
        if (Array.isArray(scan?.screenshots) && scan.screenshots.some((shot) => shot && shot.clipped === true)) {
            const clipped = document.createElement('p');
            clipped.className = 'hint screenshot-clipped';
            clipped.textContent = 'The picture shows only the top of the page: the page is larger than a picture can be. The scan checked all of it.';
            screenshotsContainer.appendChild(clipped);
        }

        return screenshotsContainer;
    }

    function buildTableSection(scan, index) {
        const table = renderTable(scan, index);
        const tableContainer = document.createElement('div');
        tableContainer.classList.add('table-results-container');
        tableContainer.appendChild(table);

        return tableContainer;
    }

    function renderSkippedScan(scan, scanResultsContainer) {
        if (scan?.url) {
            scanResultsContainer.appendChild(buildUrlRow(scan.url));
        }
        const box = document.createElement('div');
        box.className = 'hint';

        const bits = [];
        bits.push('This scan was skipped.');
        if (scan?.skipInfo?.reason) bits.push(scan.skipInfo.reason);

        if (scan?.skipInfo?.estimatedNodes != null && scan?.skipInfo?.threshold != null) {
            bits.push(`Estimated nodes: ${scan.skipInfo.estimatedNodes} (threshold: ${scan.skipInfo.threshold})`);
        }

        box.innerHTML = '<p>' + escapeHtml(bits.join(' · ')) + '</p>';

        const ul = document.createElement('ul');
        (
            Array.isArray(scan?.skipInfo?.suggestions)
                ? scan.skipInfo.suggestions
                : [
                    'Limit the scan to a smaller region',
                    'Paginate or chunk very large tables',
                    'Disable heavy rules only for this view'
                ]
        ).forEach((s) => {
            const li = document.createElement('li');
            li.textContent = s;
            ul.appendChild(li);
        });

        box.appendChild(ul);
        scanResultsContainer.appendChild(box);
    }

    /**
     * A merged scan's contexts (docs/design/merged-scan-design.md), in the order they
     * ran: "Merged from 4 contexts: Light · desktop, Dark · desktop, ...".
     */
    function buildMergedContexts(scan) {
        const contexts = scan?.mergedScan === true && Array.isArray(scan.contexts) ? scan.contexts : [];
        if (!contexts.length) return null;
        const p = document.createElement('p');
        p.className = 'scan-contexts';
        const lead = document.createElement('strong');
        lead.textContent = `Merged from ${contexts.length} context${contexts.length === 1 ? '' : 's'}:`;
        // Each context with its own tags, which describe it rather than the
        // scan: "Dark · mobile (mobile, dark)".
        p.append(lead, ' ' + contexts
            .map((c) => {
                const notes = [...(Array.isArray(c?.scanTags) ? c.scanTags.map(String) : []), ...(c?.skipped ? ['skipped'] : [])];
                return String(c?.name || '') + (notes.length ? ` (${notes.join(', ')})` : '');
            })
            .join('; '));
        return p;
    }

    function renderScan(scan, index, options = {}) {
        const {scanResultsWrapper, header, scanResultsContainer, scanResultsMeta, nameText, nameInput, tagsDisplay, tagsEditor} =
            createScanWrapper(scan, scan.id, index);

        if (scan?.includedInReport === false) {
            scanResultsWrapper.classList.add('scan-excluded-from-report');
        }

        // "Failures only" hides the whole scan, not just its can't-tell tables,
        // when there is no failure left in it to show.
        if (isFailureFreeScan(scan)) {
            scanResultsWrapper.classList.add('scan-no-failures');
        }

        const renameBtn = buildScanRenameButton(scan, index, {nameText, nameInput});
        const editTagsBtn = buildScanTagsEditButton(scan, {tagsDisplay, tagsEditor});
        const includeToggleBtn = buildScanIncludeToggleButton(scan);
        const moveButtonsEl = buildScanMoveButtons(scan, index, options.total);

        const headerControls = document.createElement('span');
        headerControls.className = 'scan-header-controls';
        headerControls.append(renameBtn, editTagsBtn, moveButtonsEl, includeToggleBtn);

        if (isSkippedScan(scan)) {
            scanResultsMeta.appendChild(generateScanMetadata(scan));
            scanResultsWrapper.appendChild(header);
            header.appendChild(headerControls);
            const skippedContextsEl = buildMergedContexts(scan);
            if (skippedContextsEl) scanResultsWrapper.appendChild(skippedContextsEl);

            renderSkippedScan(scan, scanResultsWrapper);
            resultsEl.appendChild(scanResultsWrapper);
        } else {
            scanResultsWrapper.appendChild(header);
            header.appendChild(headerControls);

            const scanUrlEl = generateScanUrlData(scan);
            if (scanUrlEl) scanResultsMeta.appendChild(scanUrlEl);
            scanResultsMeta.appendChild(generateScanMetadata(scan));
            scanResultsWrapper.appendChild(scanResultsMeta);
            const contextsEl = buildMergedContexts(scan);
            if (contextsEl) scanResultsWrapper.appendChild(contextsEl);
            // Below the one-line meta row, full width: a note can run long.
            const noticesEl = buildScanNotices(scan);
            if (noticesEl) scanResultsWrapper.appendChild(noticesEl);

            let metricsElements = undefined;
            if (scan.metrics) {
                const {narrativeEls, metricsEls} = generateA11yMetricsContents({
                    a11ySummary: scan.metrics.a11ySummary,
                    domMetrics: scan.metrics.domMetrics,
                    coverageSummary: scan.metrics.coverageSummary,
                    metricDefs: scan.metrics.metricDefs
                });
                scanResultsWrapper.append(...narrativeEls);
                metricsElements = metricsEls;
            }

            scanResultsContainer.appendChild(buildScreenshotsSection(scan));
            scanResultsContainer.appendChild(buildTableSection(scan, index));
            scanResultsWrapper.appendChild(scanResultsContainer);
            // Below the screenshot and table row, not a third column of it.
            const marginsEl = buildMarginsSection(scan);
            if (marginsEl) scanResultsWrapper.appendChild(marginsEl);
            const noticesAfterEl = buildScanNoticesAfter(scan);
            if (noticesAfterEl) scanResultsWrapper.appendChild(noticesAfterEl);

            if (scan.metrics) {
                scanResultsWrapper.append(...metricsElements);
            }

            resultsEl.appendChild(scanResultsWrapper);
        }
    }

    function renderScreenshot(screenshot, index) {
        if (!screenshot) return false;

        const label = 'Screenshot: ' + (screenshot?.name || index);

        let src = null;
        if (typeof screenshot.publicUrl === 'string' && screenshot.publicUrl) {
            src = screenshot.publicUrl;
        } else if (typeof screenshot.dataUrl === 'string' && screenshot.dataUrl) {
            src = screenshot.dataUrl;
        } else if (screenshot.buffer) {
            src = bufferToObjectURL(screenshot.buffer);
        }

        if (!src) return false;

        const card = document.createElement('article');
        card.className = 'screenshot-card';

        const h3 = document.createElement('h3');
        h3.className = 'screenshot-caption';
        h3.textContent = label;
        card.appendChild(h3);

        // This is the page URL (not the image URL), keep showing it when available
        if (screenshot.url) card.appendChild(buildUrlRow(screenshot.url));

        const img = imgToBtn(src, label, screenshot.viewportRatio);
        img.onclick = () => dialogs.screenshotsDialog.openById(src);
        card.appendChild(img);
        if (screenshot.clipped === true) {
            const clipped = document.createElement('p');
            clipped.className = 'hint screenshot-clipped';
            clipped.textContent = 'Only the top of the page: the page is larger than a picture can be.';
            card.appendChild(clipped);
        }
        // If we created an object URL from a buffer, revoke it once the image loads
        if (screenshot.buffer && typeof src === 'string' && src.startsWith('blob:')) {
            img.addEventListener('load', () => {
                try {
                    URL.revokeObjectURL(src);
                } catch { /* ignore */
                }
            }, {once: true});
        }

        screenshotsEl.appendChild(card);

        return true;
    }

    function bufferToObjectURL(buffer, mime = "image/jpeg") {
        if (!buffer) return null;
        const bytes = new Uint8Array(buffer.data || buffer);
        const blob = new Blob([bytes], {type: mime});
        return URL.createObjectURL(blob);
    }

    // `range` ([start, end)) draws only those scans, appended after the ones
    // already drawn, so a long report can be drawn a few scans at a time.
    function renderAllScans(scans, options = {}) {
        if (!Array.isArray(scans)) return;

        const {range, ...scanOptions} = options;
        const [start, end] = Array.isArray(range) ? range : [0, scans.length];
        scans.slice(start, end).forEach((scan, offset) => renderScan(scan, start + offset, {...scanOptions, total: scans.length}));
    }

    function renderAllScreenshots(screenshots) {
        if (!Array.isArray(screenshots)) return;

        let visibleIndex = 1;
        for (const screenshot of screenshots) {
            const rendered = renderScreenshot(screenshot, visibleIndex);
            if (rendered !== false) visibleIndex += 1;
        }
    }

    function sharedTargetId(scans) {
        const ids = new Set(
            (Array.isArray(scans) ? scans : [])
                .filter((scan) => scan && !scan.skipped && !scan.skipInfo)
                .map((scan) => standardIdOf(scan))
        );
        return ids.size === 1 ? [...ids][0] : null;
    }

    function renderScansReport(data, options = {}) {
        const globalFindings = data.a11yGlobalFindings;
        if (!globalFindings) return null;

        const wrapper = document.createElement('div');
        wrapper.className = 'grouped-results';

        const {scanPresentationMode} = options;
        const scanMode = scanPresentationMode || 'analysis';

        let fail = [];
        let cantTell = [];
        let pass = [];
        let notApplicable = [];

        const hasGlobal =
            globalFindings &&
            Array.isArray(globalFindings.fail) &&
            Array.isArray(globalFindings.cantTell) &&
            Array.isArray(globalFindings.pass);

        if (!hasGlobal) {
            const tableContainer = document.createElement('div');
            tableContainer.classList.add('results-container');
            tableContainer.innerHTML = `
        <h3>Summary of all scans</h3>
        <div class="no-results">
            Global canonical findings are missing, cannot render the grouped report.
        </div>
    `;
            wrapper.appendChild(tableContainer);
            return wrapper;
        }

        // The summary spans every scan, so it follows their standard only when
        // they all checked against the same one.
        const targetId = sharedTargetId(data.scans);
        const toRow = (f) => findingToIssueRow(f, '', targetId);
        fail = mergeCompositeIssueRows(globalFindings.fail.map(toRow));
        cantTell = mergeCompositeIssueRows(globalFindings.cantTell.map(toRow));
        pass = mergeCompositeIssueRows(globalFindings.pass.map(toRow));
        notApplicable = Array.isArray(globalFindings.notApplicable)
            ? mergeCompositeIssueRows(globalFindings.notApplicable.map(toRow))
            : [];

        const violationsTableHtml = buildIssuesTableHtml(
            {fail, cantTell},
            {index: "global", label: 'Final report'},
            ACTIVE_ISSUE_GROUPS,
            data?.metrics?.coverageSummary || null
        );

        const tableContainer = document.createElement('div');
        tableContainer.classList.add('results-container');
        tableContainer.innerHTML = `<h3>Summary of all scans</h3>
            <div class="scan-results-meta">
            <span></span>
            <div class="stream-counts"><span class="stream-fail">${resultGlyphHtml('fail')} ${fail.length || 0} fail</span>, <span class="stream-cantTell">${resultGlyphHtml('cantTell')} ${cantTell.length || 0} can't tell${likelyFailText(cantTell.reduce((n, row) => n + reviewGroupCounts(row.nodes).leanFail, 0))}</span>, <span class="stream-pass">${resultGlyphHtml('pass')} ${pass.length ?? 0} pass</span></div>
        </div>
        ${violationsTableHtml}`;
        wrapper.appendChild(tableContainer);

        // Straight after the summary table and outside the analysis metrics:
        // where the failures are is a reading of the failures themselves, so
        // it shows in every presentation mode, not only "Findings and analysis".
        placeDispersionSection(wrapper, options.dispersionScans);

        if (scanMode === 'analysis' && data.metrics) {
            const renderedMetrics = generateA11yMetricsContents({
                a11ySummary: data.metrics.a11ySummary,
                domMetrics: data.metrics.domMetrics,
                coverageSummary: data.metrics.coverageSummary,
                metricDefs: data.metrics.metricDefs
            }) || {};

            const narrativeEls = Array.isArray(renderedMetrics.narrativeEls) ? renderedMetrics.narrativeEls : [];
            const metricsEls = Array.isArray(renderedMetrics.metricsEls) ? renderedMetrics.metricsEls : [];

            if (narrativeEls.length) wrapper.append(...narrativeEls);
            if (metricsEls.length) wrapper.append(...metricsEls);
        }

        return wrapper;
    }

    /**
     * "Where the failures are" (docs/design/issue-dispersion-design.md), computed from
     * the scans in view, in the report's scan order, collapsed to start with.
     * Returns '' when the shared modules are not loaded, so a page without
     * them renders as before, and when no rule fails in the scans in view:
     * there is nothing to place, and the totals already say so.
     */
    function buildDispersionSectionHtml(scans) {
        const core = globalThis.A11Y_ISSUE_DISPERSION;
        const view = globalThis.A11Y_ISSUE_DISPERSION_VIEW;
        if (!core || !view || !Array.isArray(scans)) return '';
        const analysis = core.analyseDispersion(scans);
        if (!analysis.rulesFailing) return '';
        return view.reportSectionHTML(analysis, {id: 'dsp-report', linkScans: true, open: false});
    }

    function placeDispersionSection(wrapper, scans) {
        const html = buildDispersionSectionHtml(scans);
        if (!html) return;
        const holder = document.createElement('div');
        holder.innerHTML = html;
        wrapper.appendChild(holder.firstElementChild);
    }

    function setIssueGroupingSpec(specOrNull) {
        // Null means disable grouping
        if (specOrNull == null) {
            ACTIVE_ISSUE_GROUPS = null;
            return;
        }

        // Validate shape
        if (!isValidGroupingSpecShape(specOrNull)) {
            // Invalid, disable grouping entirely (per your requirement)
            ACTIVE_ISSUE_GROUPS = null;
            return;
        }

        // Normalize and keep only meaningful items
        const normalized = normalizeGroupingSpec(specOrNull);
        ACTIVE_ISSUE_GROUPS = normalized.length ? normalized : null;
    }

    return {
        setReportEngines,
        setIssueGroupingSpec,
        renderScansReport,
        buildDispersionSectionHtml,
        renderAllScans,
        renderAllScreenshots
    };
}
