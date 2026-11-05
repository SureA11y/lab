'use strict';

/**
 * main-issues-table.js
 * Minimal issues table renderer for the extension UI.
 *
 * Exposes:
 *   globalThis.A11Y_ISSUES_TABLE.renderInto(outEl, scan, options?)
 *
 * It expects scan.canonical.findings in your canonical format:
 *   finding: { outcome, ruleId/id, severity, title/help/description, helpUrl, wcag:{sc:[]}, provenance:{engine:{name}}, occurrences:[{target, html, failureSummary, pageUrl}] }
 */
(function () {
    if (globalThis.A11Y_ISSUES_TABLE?.__loaded) return;

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttr(str) {
        // good enough for attributes
        return escapeHtml(str).replace(/`/g, '&#096;');
    }

    const extApi = globalThis.browser || globalThis.chrome;

    // Only the DevTools panel can drive the Elements inspector; this same file
    // also runs in the popup, where the devtools namespace is absent.
    function canInspectElements() {
        return typeof extApi?.devtools?.inspectedWindow?.eval === 'function';
    }

    // Select the occurrence in the Elements panel. Resolves false when the
    // selector matches nothing in the page, which is expected for a report
    // opened against a page that has since changed.
    // An element in a shadow tree is found through its shadow hosts,
    // outermost first: its own selector only holds inside its shadow root.
    function inspectSelector(selector, shadowHosts = []) {
        const hosts = Array.isArray(shadowHosts) ? shadowHosts.map(String) : [];
        const expr =
            '(function(){var root=document,hosts=' + JSON.stringify(hosts) + ';' +
            'for(var i=0;i<hosts.length;i++){var h=root.querySelector(hosts[i]);if(!h||!h.shadowRoot)return false;root=h.shadowRoot;}' +
            'var el=root.querySelector(' + JSON.stringify(String(selector)) + ');' +
            'if(!el)return false;inspect(el);return true;})()';

        return new Promise((resolve) => {
            try {
                extApi.devtools.inspectedWindow.eval(expr, (result, exceptionInfo) => {
                    resolve(!exceptionInfo && result === true);
                });
            } catch {
                resolve(false);
            }
        });
    }

    // The panel is not always a secure context and the clipboard API can be
    // rejected there, so fall back to a throwaway textarea + execCommand.
    async function copyText(text) {
        const value = String(text || '');
        if (!value) return false;

        if (navigator.clipboard?.writeText && globalThis.isSecureContext) {
            try {
                await navigator.clipboard.writeText(value);
                return true;
            } catch {
                // fall through to the textarea path
            }
        }

        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        ta.remove();
        return ok;
    }

    // Confirm the outcome on the button itself: the dialog is modal, so it
    // covers whatever status line the panel would otherwise use.
    function flashButtonResult(btn, ok, okLabel, failLabel) {
        if (btn.dataset.restoreLabel == null) btn.dataset.restoreLabel = btn.textContent;
        btn.textContent = ok ? okLabel : failLabel;
        btn.classList.toggle('is-ok', ok);
        btn.classList.toggle('is-failed', !ok);

        clearTimeout(Number(btn.dataset.restoreTimer));
        btn.dataset.restoreTimer = String(setTimeout(() => {
            btn.textContent = btn.dataset.restoreLabel;
            btn.classList.remove('is-ok', 'is-failed');
        }, 1400));
    }

    // Result-state glyph tiles — SureA11y design system "five outcomes".
    // A filled tile with the glyph knocked out (styling in ui.css,
    // .result-glyph*); colour + glyph + word, never colour alone. The
    // app's outcome keys map to the design system's state keys:
    // cantTell → "unknown", notApplicable → "na".
    const RESULT_GLYPHS = {
        fail:          { cls: 'fail',     glyph: '✕' },
        cantTell:      { cls: 'unknown',  glyph: '?' },
        pass:          { cls: 'pass',     glyph: '✓' },
        notApplicable: { cls: 'na',       glyph: '–' },
        advisory:      { cls: 'advisory', glyph: '!' },
    };

    function resultGlyphHtml(outcome, size) {
        const g = RESULT_GLYPHS[outcome];
        if (!g) return '';
        const sm = size === 'sm' ? ' result-glyph--sm' : '';
        return '<span class="result-glyph result-glyph--' + g.cls + sm + '" aria-hidden="true">' + g.glyph + '</span>';
    }

    function getFindings(scan) {
        return Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];
    }

    function getFindingsByOutcome(scan, outcome) {
        const out = [];
        for (const finding of getFindings(scan)) {
            const expanded = splitFindingByOccurrenceOutcome(finding);
            for (const f of expanded) {
                if (f && f.outcome === outcome) out.push(f);
            }
        }
        return out;
    }

    let bestPracticesSections = 0;

    // As the app's scan view: the best practices a scan included
    // (canonical.bestPractices), in a section of their own below the
    // requirements. They count toward no criterion, score or rate.
    function buildBestPracticesSectionHtml(scan, { url, label, enableDialogs }) {
        const list = Array.isArray(scan?.canonical?.bestPractices) ? scan.canonical.bestPractices : [];
        const rowsFor = (outcome) => mergeCompositeIssueRows(list
            .flatMap((finding) => splitFindingByOccurrenceOutcome(finding))
            .filter((f) => f && f.outcome === outcome)
            .map((f) => findingToIssueRow(f, url, (globalThis.A11Y_REPORT_SCAN?.scanListingStandardId(scan) ?? null))));
        const fail = rowsFor('fail');
        const cantTell = rowsFor('cantTell');
        if (!fail.length && !cantTell.length) return '';
        const counts = [
            fail.length ? `${fail.length} failing` : '',
            cantTell.length ? `${cantTell.length} to review` : ''
        ].filter(Boolean).join(', ');
        // Several scans render into one panel, so each section names its own.
        bestPracticesSections += 1;
        const headingId = `bp-heading-${bestPracticesSections}`;
        return (
            '<section class="best-practices" aria-labelledby="' + headingId + '">' +
            '<h2 class="best-practices-title" id="' + headingId + '">Best practices</h2>' +
            '<p class="best-practices-note">' + escapeHtml(counts) + '. Good practice beyond the conformance target: '
            + 'these count toward no criterion, score or compliance rate.</p>' +
            buildIssuesTableHtml({ fail, cantTell }, { index: `bp${bestPracticesSections}`, label: `${label}: best practices` }, { enableDialogs }) +
            '</section>'
        );
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
            out.push({testId, outcome});
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
                text.includes('visually hidden')
                || text.includes('opacityzero')
                || text.includes('clipped')
                || text.includes('css-hidden')
                || text.includes('focus-trap')
            ) {
                out.push('css-hidden-focus');
            }
        }

        return normalizeStringListUnique(out);
    }

    function normalizeScToken(v) {
        const s = (v == null) ? '' : String(v);
        const m = s.match(/\b(\d+\.\d+\.\d+)\b/);
        return m ? m[1] : '';
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
            const entry = byClause.get(clause) || {clause, title: m.title || '', versions: []};
            if (m.version && !entry.versions.includes(m.version)) entry.versions.push(m.version);
            byClause.set(clause, entry);
        }
        return [...byClause.values()];
    }

    // RGAA "1.1": one pill per RGAA criterion. Findings carry them only when
    // the scan targeted RGAA, the one time core names them.
    function rgaaPills(entries) {
        return (Array.isArray(entries) ? entries : [])
            .filter((e) => e && e.criterion)
            .map((e) => ({standard: 'RGAA', text: String(e.criterion)}));
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

    // EN 301 549 "9.1.1.1" when both versions of the standard have the
    // clause, and "9.2.5.8 (V4.1.1)" when only one does, since the two restate
    // different WCAG versions. Under an EN 301 549 target the version is
    // already known, so it is left out.
    function en301549Pills(clauses) {
        return (Array.isArray(clauses) ? clauses : [])
            .map((c) => {
                const versions = Array.isArray(c?.versions) ? c.versions : [];
                return {
                    standard: 'EN 301 549',
                    text: c.clause + (versions.length === 1 && !c.versionImplied ? ' (' + versions[0] + ')' : '')
                };
            });
    }

    // A finding's criteria, grouped by standard, as the app lists them: the
    // standard's name once, over pills holding only the numbers, so the pills
    // stay short enough to wrap within the column. Each pill still says its
    // standard to a screen reader ("WCAG 1.4.3", the name visually hidden),
    // and the name over the group is hidden from it, so it is not heard
    // twice. "EN 301 549" is spelled out because "EN" alone reads as English.
    function buildGroupedTagsHtml(issue) {
        const pills = [
            ...(Array.isArray(issue?.SC) ? issue.SC : []).map((t) => ({standard: 'WCAG', text: String(t)})),
            ...en301549Pills(issue?.EN),
            ...rgaaPills(issue?.RGAA)
        ];
        const groups = new Map();
        for (const pill of pills) {
            if (!groups.has(pill.standard)) groups.set(pill.standard, []);
            groups.get(pill.standard).push(pill.text);
        }
        if (!groups.size) return '';
        return '<div class="crit-groups">' +
            [...groups].map(([standard, texts]) =>
                '<div class="crit-group">' +
                '<span class="crit-group__name" aria-hidden="true">' + escapeHtml(standard) + '</span>' +
                '<span class="crit-group__pills">' +
                texts.map((text) => '<span class="tag-pill"><span class="visually-hidden">' + escapeHtml(standard) + ' </span>' + escapeHtml(text) + '</span>').join(' ') +
                '</span>' +
                '</div>'
            ).join('') +
            '</div>';
    }

    function buildHelpLinkHtml(issue) {
        return issue?.helpUrl
            ? '<a href="' + escapeAttr(issue.helpUrl) + '" target="_blank" rel="noreferrer">details</a>'
            : '';
    }

    function escapeAngleBrackets(str) {
        return String(str ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function convertIndentedBlockToHtml(inputText) {
        const lines = String(inputText ?? '').replace(/\r\n/g, '\n').split('\n');
        const titleLine = (lines[0] || '').trim();
        const items = lines
            .slice(1)
            .filter(line => /^\s+/.test(line))
            .map(line => line.trim());

        if (!items.length) return titleLine;

        let html = `<details class="failure-details"><summary>${escapeHtml(titleLine)}</summary><ul>`;
        for (const item of items) html += `<li>${escapeHtml(item)}</li>`;
        html += `</ul></details>`;
        return html;
    }

    // What each check of a rollup said about one element, when more than one
    // flagged it (the occurrence's `checks`), or null.
    function checksOfOccurrence(occ) {
        const list = Array.isArray(occ?.checks) ? occ.checks : [];
        const out = list
            .filter((c) => c && typeof c === 'object' && String(c.checkId || '').trim())
            .map((c) => ({
                checkId: String(c.checkId).trim(),
                failureSummary: typeof c.failureSummary === 'string' ? c.failureSummary : '',
                hint: typeof c.hint === 'string' ? c.hint : '',
                uncertainty: c.uncertainty && typeof c.uncertainty === 'object' ? c.uncertainty : null,
                lean: c.lean && (c.lean.toward === 'fail' || c.lean.toward === 'pass') ? c.lean : null,
                howToCheck: c.howToCheck && Array.isArray(c.howToCheck.steps) ? c.howToCheck : null,
                details: c.details && typeof c.details === 'object' ? c.details : null
            }));
        return out.length > 1 ? out : null;
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
                    outcome: String(c?.outcome || '').trim()
                }))
                .filter((c) => c.testId)
            : [];
        const contributorTestIds = normalizeStringListUnique(contributors.map((c) => c.testId));

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
                // A question's lean and the steps that answer it (core 1.14).
                lean: occ?.lean && (occ.lean.toward === 'fail' || occ.lean.toward === 'pass') ? occ.lean : null,
                howToCheck: occ?.howToCheck && Array.isArray(occ.howToCheck.steps) ? occ.howToCheck : null,
                details: occ?.details && typeof occ.details === 'object' ? occ.details : null,
                shadowHostSelectors: Array.isArray(occ?.shadowHostSelectors) ? occ.shadowHostSelectors : null,
                // An element more than one check of a rollup flagged: what each said.
                ...(checksOfOccurrence(occ) ? { checks: checksOfOccurrence(occ) } : {})
            };
        });

        const scRaw = Array.isArray(f?.wcag?.sc) ? f.wcag.sc : [];
        const sc = [...new Set(scRaw.map(normalizeScToken).filter(Boolean))];

        return {
            id: f?.ruleId || f?.id || '',
            impact: f?.severity || 'unknown',
            help: f?.title || f?.help || f?.description || '',
            lang: typeof f?.lang === 'string' ? f.lang : '',
            description: f?.description || '',
            helpUrl: f?.helpUrl || '',
            SC: sc,
            EN: en301549ForTarget(en301549ClausesOf(f), targetId),
            RGAA: Array.isArray(f?.rgaa) ? f.rgaa : [],
            engine: (f?.provenance?.engine) ? f.provenance.engine : {},
            reviewHints: {
                isComposite: (f?.meta?.atomic === false) || checksIds.length > 0 || contributors.length > 0,
                reasonCode: rollup?.reasonCode ? String(rollup.reasonCode) : '',
                checksIds,
                contributors
            },
            nodes
        };
    }

    const impactOrder = ['critical', 'serious', 'moderate', 'minor', 'info'];

    function sortByImpact(items) {
        const orderIndex = new Map(impactOrder.map((v, i) => [v, i]));
        return (items || []).slice().sort((a, b) => {
            const ai = orderIndex.has(a.impact) ? orderIndex.get(a.impact) : Number.POSITIVE_INFINITY;
            const bi = orderIndex.has(b.impact) ? orderIndex.get(b.impact) : Number.POSITIVE_INFINITY;
            return ai - bi;
        });
    }

    function dedupeWithUrlMerge(arr) {
        const map = new Map();
        for (const item of arr || []) {
            const { urls, ...rest } = item;
            const key = JSON.stringify(rest);
            if (!map.has(key)) {
                map.set(key, { ...rest, urls: Array.from(new Set(urls || [])) });
            } else {
                const cur = map.get(key);
                cur.urls = Array.from(new Set([...(cur.urls || []), ...(urls || [])]));
            }
        }
        return Array.from(map.values());
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

    // The review group of a question, as the app and core's own report group
    // them: its lean points to a failure, to a pass, or nowhere.
    function reviewGroupOfNode(n) {
        const toward = n?.lean?.toward;
        return toward === 'fail' ? 'leanFail' : toward === 'pass' ? 'leanPass' : 'open';
    }

    const REVIEW_GROUP_WORDS = { leanFail: 'Likely fails', leanPass: 'Likely passes', open: 'Needs a person' };
    const REVIEW_GROUP_RANK = { leanFail: 0, leanPass: 1, open: 2 };

    function leanBadgeHtml(group) {
        if (group !== 'leanFail' && group !== 'leanPass') return '';
        return '<span class="lean-badge lean-badge-' + (group === 'leanFail' ? 'fail' : 'pass') + '">' +
            escapeHtml(REVIEW_GROUP_WORDS[group].toLowerCase()) + '</span>';
    }

    // A review row's group: likely fails when any of its questions does,
    // likely passes when all of them do, else it needs a person.
    function reviewGroupOfIssue(issue) {
        const counts = { leanFail: 0, leanPass: 0, open: 0 };
        for (const n of Array.isArray(issue?.nodes) ? issue.nodes : []) counts[reviewGroupOfNode(n)] += 1;
        if (counts.leanFail) return 'leanFail';
        if (counts.leanPass && !counts.open) return 'leanPass';
        return 'open';
    }

    // Review rows in the order a review takes them: likely failures first.
    function sortForReview(items) {
        return sortByImpact(items)
            .map((issue, i) => ({ issue, i }))
            .sort((a, b) => (REVIEW_GROUP_RANK[reviewGroupOfIssue(a.issue)] - REVIEW_GROUP_RANK[reviewGroupOfIssue(b.issue)]) || (a.i - b.i))
            .map((x) => x.issue);
    }

    function buildLeanHtml(n) {
        const lean = n?.lean;
        if (!lean) return '';
        const group = reviewGroupOfNode(n);
        const why = typeof lean.why === 'string' ? lean.why.trim() : '';
        const caution = typeof lean.caution === 'string' ? lean.caution.trim() : '';
        const m = lean.measured;
        const measured = m && Number.isInteger(m.agreed) && Number.isInteger(m.cases) && m.cases > 0
            ? 'right in ' + m.agreed + ' of ' + m.cases + ' known cases'
            : '';
        return '<div class="node-detail node-lean node-lean-' + (group === 'leanFail' ? 'fail' : 'pass') + '">' +
            '<strong>' + escapeHtml(REVIEW_GROUP_WORDS[group]) + ':</strong> ' +
            (why ? withLang(escapeHtml(why), n.lang) : '') +
            (measured ? ' <span class="node-lean-measured">(' + escapeHtml(measured) + ')</span>' : '') +
            (caution ? '<br><strong>Caution:</strong> ' + withLang(escapeHtml(caution), n.lang) : '') +
            '</div>';
    }

    // The steps that answer a question, and what a person sees if it passes
    // and if it fails, collapsed behind "How to check (3 steps)", as in the
    // lab's app. `forAll` says they stand for every instance listed.
    function buildHowToCheckHtml(h, { lang = '', forAll = false } = {}) {
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
    // shown once, above the instances. Null otherwise.
    function sharedHowToCheck(nodes) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (list.length < 2 || !list.every((n) => n?.howToCheck)) return null;
        const key = JSON.stringify(list[0].howToCheck);
        return list.every((n) => JSON.stringify(n.howToCheck) === key) ? list[0].howToCheck : null;
    }

    function buildOccurrenceGuidanceHtml(n, { stepsShown = false } = {}) {
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
        if (!stepsShown) out += buildHowToCheckHtml(n.howToCheck, { lang: n.lang });
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
    // and, for an element in a shadow tree, the hosts that lead to it. As in
    // the lab's results view (src/js/a11y-ui.rendering.js).
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

    function buildInstancesListHtml(nodes, type = 'fail') {
        const instanceLabel = type === 'fail' ? 'Occurrence' : 'Instance';
        const list = dedupeWithUrlMerge(nodes);
        // Questions in the order a review takes them: likely failures first.
        const ordered = type === 'cantTell'
            ? list.map((n, i) => ({ n, i }))
                .sort((a, b) => (REVIEW_GROUP_RANK[reviewGroupOfNode(a.n)] - REVIEW_GROUP_RANK[reviewGroupOfNode(b.n)]) || (a.i - b.i))
                .map((x) => x.n)
            : list;
        // Steps every question shares are shown once, above them.
        const shared = type === 'cantTell' ? sharedHowToCheck(ordered) : null;

        return (shared ? buildHowToCheckHtml(shared, { lang: ordered[0].lang, forAll: true }) : '') + ordered
            .map((n, nodeIndex) => {
                const selector = Array.isArray(n.target) ? n.target.join(', ') : '';
                const rawHtml = (n.html || '').replace(/\s+/g, ' ').trim();
                const shortHtml = rawHtml.length > 250 ? rawHtml.slice(0, 247) + '…' : rawHtml;
                const failure = (n.failureSummary || '').trim();

                const urls = [...new Set((Array.isArray(n.urls) ? n.urls : []))]
                    .map(url => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`)
                    .join(', ');

                const selectorPart = selector
                    ? '<div class="example-node-header">' +
                    '<h2>' + instanceLabel + ' ' + (nodeIndex + 1) +
                    (urls ? ' <span class="node-urls">URLs: ' + urls + '</span>' : '') +
                    (n.lean ? ' ' + leanBadgeHtml(reviewGroupOfNode(n)) : '') +
                    '</h2>' +
                    '<div class="node-selector-row">' +
                    '<code class="node-selector">' + escapeHtml(selector) + '</code>' +
                    '<span class="node-selector-actions">' +
                    '<button type="button" class="copy-selector-btn" data-selector="' + escapeAttr(selector) + '">Copy selector</button>' +
                    (canInspectElements()
                        ? '<button type="button" class="inspect-selector-btn" data-selector="' + escapeAttr(selector) + '"' +
                        (Array.isArray(n.shadowHostSelectors) && n.shadowHostSelectors.length
                            ? ' data-shadow-hosts="' + escapeAttr(JSON.stringify(n.shadowHostSelectors)) + '"'
                            : '') +
                        ' title="Select this element in the Elements panel">Inspect</button>'
                        : '') +
                    '</span>' +
                    '</div>' +
                    '</div>'
                    : '<div class="example-node-header"><h2>' + instanceLabel + ' ' + (nodeIndex + 1) + '</h2><code class="node-selector">(no target selector)</code></div>';

                const htmlPart = shortHtml
                    ? '<div class="example-node-code"><code>' + escapeHtml(shortHtml) + '</code></div>'
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

                // One element several checks flagged: what each said, under
                // its own heading, the element shown once above them.
                if (Array.isArray(n.checks) && n.checks.length > 1) {
                    const hosts = buildOccurrenceDetailsHtml({ shadowHostSelectors: n.shadowHostSelectors });
                    const perCheck = n.checks.map((c) => {
                        const said = (c.failureSummary || '').trim();
                        return '<div class="node-check"><h3 class="node-check-title">Check: <code>' + escapeHtml(c.checkId) + '</code></h3>' +
                            (said ? '<div class="node-detail"' + langAttr(n.lang) + '>' + convertIndentedBlockToHtml(escapeAngleBrackets(said)) + '</div>' : '') +
                            buildOccurrenceDetailsHtml({ details: c.details }) +
                            buildOccurrenceGuidanceHtml({ ...c, lang: n.lang }, { stepsShown: !!shared }) +
                            '</div>';
                    }).join('');
                    return '<div class="example-node">' + selectorPart + htmlPart + hosts +
                        '<p class="node-detail node-checks-lead">' + n.checks.length + ' checks flagged this element:</p>' + perCheck + '</div>';
                }

                return '<div class="example-node">' + selectorPart + htmlPart + failurePart + buildOccurrenceDetailsHtml(n) + buildOccurrenceGuidanceHtml(n, { stepsShown: !!shared }) + sourceLine + '</div>';
            })
            .join('');
    }

    // Body of the "details" dialog for a can't-tell rollup that matched no single
    // element (e.g. wcag-4.1.2-name). Lists the contributing atomic checks a human
    // must verify, reusing the same node/detail markup as the occurrence dialog.
    function buildReviewHintsBodyHtml(hints) {
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

    function buildReviewHintsCellHtml({ hints, index, rowIndex, ruleId, impact, enableDialogs }) {
        const shortLabel = 'Needs review';

        // Minimal mode: keep it to a compact label, no dialog (mirrors the
        // count-only fallback used for occurrence rows).
        if (!enableDialogs) {
            return '<span class="instances-meta">' + escapeHtml(shortLabel) + '</span>';
        }

        const safeRule = String(ruleId || 'rule').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
        const dialogId = `occ-s${index}-r${rowIndex}-${safeRule}-review`;
        const ruleLabel = ruleId || 'rule';
        const triggerAriaLabel = 'View manual-review guidance for ' + ruleLabel + ', ' + (impact || 'unknown') + ' impact';
        const closeAriaLabel = 'Close review guidance for ' + ruleLabel;

        return (
            '<div class="instances-meta">' + escapeHtml(shortLabel) + '</div>' +
            '<button type="button" class="src-dialog-trigger" data-dialog-id="' + escapeAttr(dialogId) + '" aria-label="' + escapeAttr(triggerAriaLabel) + '">details</button>' +
            '<dialog id="' + escapeAttr(dialogId) + '" class="src-dialog" aria-labelledby="' + escapeAttr(dialogId) + '-title">' +
            '<div class="src-dialog-header">' +
            '<p id="' + escapeAttr(dialogId) + '-title" class="lab-dialog-title"><code>' + escapeHtml(ruleId || '') + '</code></p>' +
            '<p class="src-dialog-meta">Impact: ' + escapeHtml(impact || 'unknown') + ' · Needs manual review</p>' +
            '<button type="button" class="src-dialog-close" aria-label="' + escapeAttr(closeAriaLabel) + '">Close</button>' +
            '</div>' +
            '<div class="src-dialog-body">' + buildReviewHintsBodyHtml(hints) + '</div>' +
            '<div class="src-dialog-footer">' +
            '<button type="button" class="src-dialog-close" aria-label="' + escapeAttr(closeAriaLabel) + '">Close</button>' +
            '</div>' +
            '</dialog>'
        );
    }

    function buildInstancesCellHtml({ nodes, index, rowIndex, ruleId, impact, type, enableDialogs, reviewHints }) {
        const nodeCount = Array.isArray(nodes) ? nodes.length : 0;
        if (!nodeCount) {
            const hints = (reviewHints && typeof reviewHints === 'object') ? reviewHints : null;
            const hasHints = !!hints && (
                (Array.isArray(hints.checksIds) && hints.checksIds.length > 0) ||
                (Array.isArray(hints.contributors) && hints.contributors.length > 0) ||
                !!hints.reasonCode
            );
            // A cantTell rollup (e.g. wcag-4.1.2-name) is emitted only when a
            // contributing check actually ran and came back inconclusive, so it
            // always carries the checks/contributors that need a human. Surface
            // them behind a "details" dialog like the occurrence rows, instead of
            // a bare, composite-name-only "No instances".
            if (type === 'cantTell' && hasHints) {
                return buildReviewHintsCellHtml({ hints, index, rowIndex, ruleId, impact, enableDialogs });
            }
            return '<span class="instances-meta">No instances reported.</span>';
        }

        const instanceLabel = type === 'fail' ? 'occurrence' : 'instance';

        // Minimal mode: just show the count, no dialogs
        if (!enableDialogs) {
            return '<span class="instances-meta">' + nodeCount + ' ' + impact + '</span>';
        }

        // Dialog mode (matches your app behavior closely)
        const safeRule = String(ruleId || 'rule').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 40);
        const dialogId = `occ-s${index}-r${rowIndex}-${safeRule}`;
        const instancesList = buildInstancesListHtml(nodes, type);
        const instanceCountLabel = nodeCount + ' ' + instanceLabel + (nodeCount === 1 ? '' : 's');
        const ruleLabel = ruleId || 'rule';
        const triggerAriaLabel = 'View details for ' + ruleLabel + ', ' + (impact || 'unknown') + ' impact, ' + instanceCountLabel;
        const closeAriaLabel = 'Close details for ' + ruleLabel;

        return (
            '<div class="instances-meta">' + nodeCount + ' ' + impact + '</div>' +
            '<button type="button" class="src-dialog-trigger" data-dialog-id="' + escapeAttr(dialogId) + '" aria-label="' + escapeAttr(triggerAriaLabel) + '">details</button>' +
            '<dialog id="' + escapeAttr(dialogId) + '" class="src-dialog" aria-labelledby="' + escapeAttr(dialogId) + '-title">' +
            '<div class="src-dialog-header">' +
            '<p id="' + escapeAttr(dialogId) + '-title" class="lab-dialog-title"><code>' + escapeHtml(ruleId || '') + '</code></p>' +
            '<p class="src-dialog-meta">Impact: ' + escapeHtml(impact || 'unknown') + ' · ' +
            instanceCountLabel +
            '</p>' +
            '<button type="button" class="src-dialog-close" aria-label="' + escapeAttr(closeAriaLabel) + '">Close</button>' +
            '</div>' +
            '<div class="src-dialog-body">' + instancesList + '</div>' +
            '<div class="src-dialog-footer">' +
            '<span class="src-dialog-meta">' + instanceCountLabel + ' listed.</span>' +
            '<button type="button" class="src-dialog-close" aria-label="' + escapeAttr(closeAriaLabel) + '">Close</button>' +
            '</div>' +
            '</dialog>'
        );
    }

    function buildIssueRowHtml(issue, { index, rowIndex, type, enableDialogs }) {
        const impactClass = issue?.impact ? 'impact-' + issue.impact : '';
        const nodes = Array.isArray(issue?.nodes) ? issue.nodes : [];

        const statusTextMap = { fail: 'Failed', cantTell: 'Needs review', pass: 'Passed' };
        const group = type === 'cantTell' ? reviewGroupOfIssue(issue) : 'open';
        const status = resultGlyphHtml(type, 'sm') + (group !== 'open' ? leanBadgeHtml(group) : '');
        const statusText = statusTextMap[type] || '';

        const groupedTagsHtml = buildGroupedTagsHtml(issue);
        const helpLink = buildHelpLinkHtml(issue);

        const instancesCell = buildInstancesCellHtml({
            nodes,
            index,
            rowIndex,
            ruleId: issue.id || '',
            impact: issue.impact || 'unknown',
            type,
            enableDialogs,
            reviewHints: issue.reviewHints
        });

        // The roles keep the cells a table to a screen reader when a narrow
        // panel lays the rows out as cards (see .issues-table in ui.css).
        return (
            '<tr role="row" class="' + escapeAttr(type || '') + (group === 'leanFail' ? ' lean-fail' : '') + '">' +
            '<td role="cell" class="issue-status">' + status + '<span class="visually-hidden">' + escapeHtml(statusText) + '</span></td>' +
            '<td role="cell" class="issue-status ' + escapeAttr(impactClass) + '">' + instancesCell + '</td>' +
            '<td role="cell">' +
            // The groups are a block of their own, so no line break after them.
            groupedTagsHtml +
            withLang(escapeHtml(issue.help || issue.description || ''), issue.lang) +
            (issue.id ? '<br />Rule: ' + escapeHtml(issue.id) : '') +
            (helpLink ? ' (' + helpLink + ')' : '') +
            '</td>' +
            '</tr>'
        );
    }

    function buildIssuesTableShellHtml({ ariaLabel, bodyHtml, failCount, cantTellCount }) {
        return (
            '<div class="table-container">' +
            '<table role="table" class="issues-table" aria-label="Accessibility results: ' + escapeAttr(ariaLabel || '') + '">' +
            '<colgroup>' +
            '<col style="width: 8%">' +
            '<col style="width: 11%">' +
            '<col style="width: 60%">' +
            '</colgroup>' +
            '<thead role="rowgroup"><tr role="row">' +
            '<th role="columnheader" scope="col" class="issue-status">Status</th>' +
            '<th role="columnheader" scope="col" class="issue-status">Issues</th>' +
            '<th role="columnheader" scope="col">Description</th>' +
            '</tr></thead>' +
            '<tbody role="rowgroup">' + (bodyHtml || '') + '</tbody>' +
            '</table>' +
            '</div>'
        );
    }

    function buildIssuesTableHtml({ fail, cantTell }, { index, label }, options) {
        const hasAny = (fail && fail.length) || (cantTell && cantTell.length);
        if (!hasAny) {
            return '<div class="no-results">No accessibility violations detected for the selected filters or rules.</div>';
        }

        const enableDialogs = !!options?.enableDialogs;

        const rowsFail = sortByImpact(fail).map((issue, idx) =>
            buildIssueRowHtml(issue, { index, rowIndex: idx, type: 'fail', enableDialogs })
        ).join('');

        const rowsCantTell = sortForReview(cantTell).map((issue, idx) =>
            buildIssueRowHtml(issue, { index, rowIndex: idx, type: 'cantTell', enableDialogs })
        ).join('');

        return buildIssuesTableShellHtml({
            ariaLabel: label,
            bodyHtml: rowsFail + rowsCantTell,
            failCount: Array.isArray(fail) ? fail.length : 0,
            cantTellCount: Array.isArray(cantTell) ? cantTell.length : 0
        });
    }

    // Summary line shown above each results table: fail / can't tell / pass counts,
    // mirroring the app's per-scan `.stream-counts` header. Counts come straight from
    // canonical.findings (same source the app uses), falling back to any summary counts
    // carried on the scan when canonical is absent.
    function buildScanSummaryLineHtml(scan) {
        const findings = Array.isArray(scan?.canonical?.findings) ? scan.canonical.findings : [];

        const failCanonical = findings.length ? findings.filter(f => f?.outcome === 'fail').length : null;
        const cantTellCanonical = findings.length ? findings.filter(f => f?.outcome === 'cantTell').length : null;
        const passCanonical = findings.length ? findings.filter(f => f?.outcome === 'pass').length : null;

        const s = scan?.summary || {};
        const fail = (failCanonical !== null) ? failCanonical : (s.failCount ?? 0);
        const cantTell = (cantTellCanonical !== null) ? cantTellCanonical : (s.reviewCount ?? 0);
        const pass = (passCanonical !== null) ? passCanonical : (s.passesCount ?? 0);

        const bits = [];
        // Every profile it checked against: "WCAG 2.2 AA + WAI-ARIA 1.2".
        const profilesLabel = globalThis.A11Y_REPORT_SCAN?.scanProfilesLabel(scan);
        if (profilesLabel) bits.push(String(profilesLabel));
        if (scan?.context) bits.push('Context: ' + scan.context);
        const prefix = bits.length ? (escapeHtml(bits.join(' · ')) + ': ') : '';

        return (
            '<div class="stream-counts">' + prefix +
            '<span class="stream-fail">' + resultGlyphHtml('fail', 'sm') + ' ' + (fail || 0) + ' fail</span>, ' +
            '<span class="stream-cantTell">' + resultGlyphHtml('cantTell', 'sm') + ' ' + (cantTell || 0) + ' can\'t tell</span>, ' +
            '<span class="stream-pass">' + resultGlyphHtml('pass', 'sm') + ' ' + (pass || 0) + ' pass</span>' +
            '</div>'
        );
    }

    // Notes on what a scan could not see on the page (a hook the page's own
    // scripts got around, forced colors) qualify some results, not the whole
    // scan: they go below the results, collapsed, as in the lab.
    const SCAN_NOTICES_AFTER = new Set(['listener-hook', 'internals-hook', 'live-region-hook', 'forced-colors', 'language-mismatch']);
    function scanNoticeMessages(scan, after) {
        const notices = Array.isArray(scan?.canonical?.notices) ? scan.canonical.notices : [];
        return [...new Set(notices
            .filter((n) => SCAN_NOTICES_AFTER.has(n?.code) === after)
            .map((n) => String(n?.message || '').trim())
            .filter(Boolean))];
    }

    // Notes on how the scan ran (canonical.notices): a scope that matched
    // nothing, a page still loading. They can explain a scan that looks clean.
    function buildScanNoticesHtml(scan) {
        const messages = scanNoticeMessages(scan, false);
        if (!messages.length) return '';
        return '<div class="hint scan-notices"><p class="scan-notices-title">' +
            (messages.length === 1 ? 'Note on this scan' : 'Notes on this scan') + '</p><ul>' +
            messages.map((m) => '<li>' + escapeHtml(m) + '</li>').join('') + '</ul></div>';
    }

    function buildScanNoticesAfterHtml(scan) {
        const messages = scanNoticeMessages(scan, true);
        if (!messages.length) return '';
        return '<details class="a11y-details scan-notices-after"><summary>What this scan could not see (' +
            messages.length + (messages.length === 1 ? ' note' : ' notes') + ')</summary>' +
            '<p class="hint">Parts of this page surea11y could not fully see, and which results that affects.</p><ul>' +
            messages.map((m) => '<li>' + escapeHtml(m) + '</li>').join('') + '</ul></details>';
    }

    // Margins, read as the lab's src/js/margins.js reads them: ratios to two
    // decimals, whole pixels, "less than" under the smallest step, and a near
    // miss under a tenth of a ratio or a pixel of room.
    const NEAR_MISS_ROOM = { ratio: 0.1, px: 1 };
    const isRatioMargin = (m) => m && m.unit !== 'px';
    function formatMarginValue(m, n = m.value) {
        return isRatioMargin(m) ? `${Number(n).toFixed(2)}:1` : `${Math.round(n)} px`;
    }
    function formatMarginLimit(m) {
        const threshold = isRatioMargin(m) ? `${m.threshold}:1` : `${m.threshold} px`;
        return `${m.limit === 'max' ? 'at most' : 'at least'} ${threshold}`;
    }
    function formatMarginRoom(m) {
        if (isRatioMargin(m)) {
            return m.headroom < 0.01 ? 'less than 0.01' : (Math.floor(m.headroom * 100) / 100).toFixed(2);
        }
        return m.headroom < 1 ? 'less than 1 px' : `${Math.round(m.headroom)} px`;
    }
    function isNearMiss(m) {
        if (!m || !Number.isFinite(m.headroom)) return false;
        return m.headroom < (isRatioMargin(m) ? NEAR_MISS_ROOM.ratio : NEAR_MISS_ROOM.px);
    }

    // "Closest to the limit": for each measuring rule, the pass with the
    // least room. Starts collapsed; near misses show in the summary count.
    function buildMarginsHtml(scan) {
        const margins = (Array.isArray(scan?.canonical?.margins) ? scan.canonical.margins : [])
            .filter((m) => m && m.ruleId && Number.isFinite(m.value) && Number.isFinite(m.headroom))
            .slice()
            .sort((a, b) => Number(isNearMiss(b)) - Number(isNearMiss(a)) || String(a.ruleId).localeCompare(String(b.ruleId)));
        if (!margins.length) return '';
        const near = margins.filter(isNearMiss).length;
        const rows = margins.map((m) => {
            const nearMiss = isNearMiss(m);
            return '<tr' + (nearMiss ? ' class="a11y-margins-near"' : '') + '>' +
                '<th scope="row">' + escapeHtml(m.title || m.ruleId) +
                (m.title && m.title !== m.ruleId ? ' <code>' + escapeHtml(m.ruleId) + '</code>' : '') + '</th>' +
                '<td>' + escapeHtml(formatMarginValue(m)) + '</td>' +
                '<td>' + escapeHtml(formatMarginLimit(m)) + '</td>' +
                '<td>' + escapeHtml(formatMarginRoom(m)) + (nearMiss ? ' <span class="a11y-margins-badge">near miss</span>' : '') + '</td>' +
                '<td>' + (m.selector ? '<code>' + escapeHtml(m.selector) + '</code>' : '—') + '</td>' +
                '</tr>';
        }).join('');
        return '<details class="a11y-details a11y-margins">' +
            '<summary>Closest to the limit' + (near ? ` (${near} near ${near === 1 ? 'miss' : 'misses'})` : '') + '</summary>' +
            '<p class="hint">For each rule that measures against a limit, the element that met it with the least room. ' +
            'These are passes; a near miss is one a small change in colour, text or layout would turn into a failure.</p>' +
            '<div class="a11y-margins-wrap"><table class="a11y-margins-table">' +
            '<thead><tr><th scope="col">Rule</th><th scope="col">Closest</th><th scope="col">Limit</th>' +
            '<th scope="col">Room left</th><th scope="col">Element</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table></div></details>';
    }

    function renderInto(outEl, scan, options = {}) {
        if (!outEl) return;

        // outEl is the <pre>, used as a container rather than preformatted text.
        outEl.classList.add('out-as-html');
        outEl.textContent = '';

        const url = scan?.url || scan?.canonical?.page?.url || '';
        const label = scan?.label || scan?.id || 'Scan';

        const fail = mergeCompositeIssueRows(getFindingsByOutcome(scan, 'fail').map(f => findingToIssueRow(f, url, (globalThis.A11Y_REPORT_SCAN?.scanListingStandardId(scan) ?? null))));
        const cantTell = mergeCompositeIssueRows(getFindingsByOutcome(scan, 'cantTell').map(f => findingToIssueRow(f, url, (globalThis.A11Y_REPORT_SCAN?.scanListingStandardId(scan) ?? null))));

        const bestPractices = buildBestPracticesSectionHtml(scan, { url, label, enableDialogs: options.enableDialogs !== false });
        const hasRequirements = getFindings(scan).length > 0;

        outEl.innerHTML =
            buildScanSummaryLineHtml(scan) +
            buildScanNoticesHtml(scan) +
            (hasRequirements || !bestPractices
                ? buildIssuesTableHtml(
                    { fail, cantTell },
                    { index: 0, label },
                    { enableDialogs: options.enableDialogs !== false } // default true
                )
                : '') +
            bestPractices +
            buildMarginsHtml(scan) +
            buildScanNoticesAfterHtml(scan);

        // Wire dialog open/close behavior (delegated)
        if (options.enableDialogs !== false) {
            // prevent duplicate listeners if renderInto is called repeatedly
            if (!outEl.__a11yIssuesDlgBound) {
                outEl.__a11yIssuesDlgBound = true;

                outEl.addEventListener('click', (event) => {
                    const trigger = event.target.closest('.src-dialog-trigger');
                    if (trigger) {
                        const id = trigger.getAttribute('data-dialog-id');
                        const dlg = id ? document.getElementById(id) : null;
                        if (dlg && typeof dlg.showModal === 'function') {
                            dlg.showModal();
                            // prevent stacking a new backdrop-close listener every time
                            // this same dialog is reopened
                            if (!dlg.__a11yBackdropBound) {
                                dlg.__a11yBackdropBound = true;
                                dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
                            }
                            dlg.querySelector('.src-dialog-body')?.scrollTo({ top: 0 });
                        }
                        return;
                    }

                    const closeBtn = event.target.closest('.src-dialog-close');
                    if (closeBtn) {
                        closeBtn.closest('dialog')?.close();
                        return;
                    }

                    const copyBtn = event.target.closest('.copy-selector-btn');
                    if (copyBtn) {
                        copyText(copyBtn.getAttribute('data-selector'))
                            .then((ok) => flashButtonResult(copyBtn, ok, 'Copied', 'Copy failed'))
                            .catch(() => flashButtonResult(copyBtn, false, 'Copied', 'Copy failed'));
                        return;
                    }

                    const inspectBtn = event.target.closest('.inspect-selector-btn');
                    if (inspectBtn) {
                        // The Elements panel takes over the DevTools window, so
                        // close the modal first or it hides the selection.
                        inspectBtn.closest('dialog')?.close();
                        let hosts = [];
                        try { hosts = JSON.parse(inspectBtn.getAttribute('data-shadow-hosts') || '[]'); } catch { hosts = []; }
                        inspectSelector(inspectBtn.getAttribute('data-selector'), hosts)
                            .then((ok) => flashButtonResult(inspectBtn, ok, 'Inspecting', 'Not on page'))
                            .catch(() => flashButtonResult(inspectBtn, false, 'Inspecting', 'Not on page'));
                    }
                });
            }
        }
    }

    globalThis.A11Y_ISSUES_TABLE = {
        __loaded: true,
        renderInto,
        // Exposed so a test can hold them to the lab's src/js/margins.js.
        formatMarginValue,
        formatMarginLimit,
        formatMarginRoom,
        isNearMiss
    };
})();