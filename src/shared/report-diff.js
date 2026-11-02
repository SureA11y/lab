'use strict';

// Rule- and occurrence-level diff engine for the run comparison ("Compare")
// tab. Pure and DOM-free; the renderer turns its output into the mockup layout.
//
// Two framings:
//  - 'evolution' — directional (same subject over time). Rules classify as
//    resolved / new / persistent; occurrences as fixed / still / new.
//  - 'ab' — symmetric (two builds/variants, no winner). Rules classify as
//    aonly / bonly / both; occurrences as aonly / bonly / both.
//
// Robustness: the primary diff is at the RULE level (a rule id carries no DOM,
// so it is stable across markup churn). Occurrence pairing is best-effort — keyed
// by page path + selector — and is presented as illustrative detail, not a hard
// identity claim. A wrapper div that shifts a selector will read as fixed+new
// rather than a matched pair; that is an accepted limit of element-level detail.
//
// Browser: available as globalThis.A11Y_REPORT_DIFF.
// Node:    module.exports.


(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./report-identity.js'), require('./report-format.js'), () => require('./shared-profiles.js'));
    } else {
        if (!root.A11Y_REPORT_IDENTITY || !root.A11Y_REPORT_FORMAT) {
            throw new Error('report-diff.js: load report-identity.js and report-format.js before this file');
        }
        // shared-profiles.js is read when a comparison runs, so it may load
        // after this file.
        root.A11Y_REPORT_DIFF = factory(root.A11Y_REPORT_IDENTITY, root.A11Y_REPORT_FORMAT, () => root.A11Y_SHARED_PROFILES);
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (identity, reportFormat, sharedProfilesOf) {

    /**
     * The reports read on the profiles they share (shared-profiles.js):
     * { reports, basis }, the reports as they are when they checked the same
     * profiles, or share none.
     */
    function compareOnShared(reports) {
        const api = sharedProfilesOf && sharedProfilesOf();
        return api ? api.compareOnShared(reports) : { reports, basis: null };
    }

    const { reportIdentity, assignBaselineAndCurrent, describeComparison } = identity;

    const SEV_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3, unknown: 4 };
    const SEV_ORDER = ['critical', 'serious', 'moderate', 'minor', 'unknown'];

    function sevRank(s) { return SEV_RANK[s] == null ? 4 : SEV_RANK[s]; }
    function moreSevere(a, b) { return sevRank(a) <= sevRank(b) ? a : b; }
    function normSev(s) { const k = String(s || 'unknown'); return SEV_RANK[k] == null ? 'unknown' : k; }

    const { pagePath, occurrenceIdOf } = reportFormat;

    function firstWcag(f) {
        const sc = f && f.wcag && Array.isArray(f.wcag.sc) ? f.wcag.sc : [];
        for (const e of sc) {
            const ref = (e && typeof e === 'object') ? e.ref : e;
            if (ref) return String(ref);
        }
        const std = f && f.standards && Array.isArray(f.standards.wcag) ? f.standards.wcag : [];
        for (const e of std) { if (e && e.ref) return String(e.ref); }
        return '';
    }

    // The RGAA criteria a finding names (only scans that targeted RGAA carry
    // them), added to a rule's list once each, in RGAA's own order.
    function addRgaa(list, f) {
        for (const e of (f && Array.isArray(f.rgaa) ? f.rgaa : [])) {
            const c = e && e.criterion ? String(e.criterion) : '';
            if (c && !list.includes(c)) list.push(c);
        }
        list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }

    // The requirements a finding names of any standard besides WCAG and EN
    // 301 549, one from a pack: [{ standard, requirement }]. An older report's
    // RGAA criteria are `rgaa`'s, so its RGAA mappings are not counted twice.
    function otherStandardsOf(f) {
        const legacyRgaa = f && Array.isArray(f.rgaa) && f.rgaa.length > 0;
        const out = [];
        const mappings = f && f.standards && Array.isArray(f.standards.normativeMappings) ? f.standards.normativeMappings : [];
        for (const m of mappings) {
            const standard = m && typeof m.standard === 'string' ? m.standard.trim() : '';
            if (!standard || !m.requirement || standard === 'WCAG' || standard === 'EN 301 549') continue;
            if (standard === 'RGAA' && legacyRgaa) continue;
            out.push({ standard, requirement: String(m.requirement) });
        }
        return out;
    }

    // Adds a finding's other standards to a rule's list, [{ standard,
    // requirements }], each standard once and its requirements in its order.
    function mergeStandards(list, entries) {
        for (const e of entries || []) {
            let s = list.find((x) => x.standard === e.standard);
            if (!s) { s = { standard: e.standard, requirements: [] }; list.push(s); }
            for (const r of e.requirements || [e.requirement]) if (r && !s.requirements.includes(r)) s.requirements.push(r);
            s.requirements.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        }
        list.sort((a, b) => a.standard.localeCompare(b.standard));
        return list;
    }

    function titleLangOf(f) {
        const l = f && (f.titleLang || f.lang);
        return typeof l === 'string' && l.trim() && l.trim().toLowerCase() !== 'en' ? l.trim() : null;
    }

    /** How many elements a collected rule is on: those listed, and those counted only. */
    function sizeOf(rule) {
        return rule ? rule.occ.size + (Number(rule.unlisted) > 0 ? Number(rule.unlisted) : 0) : 0;
    }

    function occKey(o, scanUrl) {
        const url = (o && o.pageUrl) ? o.pageUrl : (scanUrl || '');
        return `${pagePath(url)}##${reportFormat.elementTarget(o)}`;
    }

    // Merge a report's findings of one outcome by rule id across all its scans.
    // -> Map ruleId -> { ruleId, title, severity, wcag, occ: Map(key -> occ) }
    //
    // `outcome` defaults to 'fail', which is the whole ingest path for both diff
    // engines. The series engine passes 'cantTell' as well, for the checks that
    // reported something a human has to confirm: a rule that stops failing and
    // starts needing review has not been fixed, and reading only failures cannot
    // tell those two apart.
    function collectFailingRules(report, { outcome = 'fail' } = {}) {
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        const byRule = new Map();

        for (const scan of scans) {
            const scanUrl = scan && scan.url ? String(scan.url) : '';
            const findings = scan && scan.canonical && Array.isArray(scan.canonical.findings)
                ? scan.canonical.findings : [];

            for (const f of findings) {
                if (!f || f.outcome !== outcome) continue;
                const ruleId = f.ruleId || f.id;
                if (!ruleId) continue;

                let entry = byRule.get(ruleId);
                if (!entry) {
                    entry = {
                        ruleId,
                        title: f.title || f.description || ruleId,
                        severity: normSev(f.severity),
                        wcag: firstWcag(f),
                        rgaa: [],
                        // The title's language when it is not the page's
                        // English: an RGAA rollup's is French.
                        titleLang: titleLangOf(f),
                        occ: new Map(),
                    };
                    byRule.set(ruleId, entry);
                } else {
                    entry.severity = moreSevere(entry.severity, normSev(f.severity));
                    if (!entry.wcag) entry.wcag = firstWcag(f);
                }
                addRgaa(entry.rgaa, f);
                // Elements the rule counted and did not list (core's contrast
                // rules list 50): counted with those it listed (sizeOf).
                if (Number(f.unlisted) > 0) entry.unlisted = (entry.unlisted || 0) + Number(f.unlisted);
                const others = otherStandardsOf(f);
                if (others.length) entry.standards = mergeStandards(entry.standards || [], others);

                const occs = Array.isArray(f.occurrences) ? f.occurrences : [];
                for (const o of occs) {
                    const key = occKey(o, scanUrl);
                    if (!entry.occ.has(key)) {
                        entry.occ.set(key, {
                            key,
                            // The occurrence's id in every report, saved or
                            // not: the rule's, with this page and element.
                            occurrenceId: occurrenceIdOf(ruleId, o, scanUrl),
                            pageUrl: (o && o.pageUrl) ? o.pageUrl : scanUrl,
                            target: Array.isArray(o && o.target) ? o.target.join(' ') : '',
                        });
                    }
                }
            }
        }
        return byRule;
    }

    function mergeRgaaLists(a, b) {
        const out = [];
        for (const e of [a, b]) for (const c of (e && Array.isArray(e.rgaa) ? e.rgaa : [])) if (!out.includes(c)) out.push(c);
        return out.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    }

    function pagesCount(entry) {
        if (!entry) return 0;
        const set = new Set();
        for (const o of entry.occ.values()) set.add(pagePath(o.pageUrl));
        return set.size;
    }

    // Occurrences within one rule, paired by page-path + selector.
    function diffOccurrences(a, b, mode) {
        const aMap = a ? a.occ : new Map();
        const bMap = b ? b.occ : new Map();
        const keys = new Set([...aMap.keys(), ...bMap.keys()]);
        const rows = [];
        for (const k of keys) {
            const oa = aMap.get(k);
            const ob = bMap.get(k);
            let tag;
            if (mode === 'ab') tag = (oa && ob) ? 'both' : (oa ? 'aonly' : 'bonly');
            else tag = (oa && ob) ? 'still' : (oa ? 'fixed' : 'new');
            const src = ob || oa;
            rows.push({ key: k, occurrenceId: src.occurrenceId, tag, pageUrl: src.pageUrl, target: src.target });
        }
        const tagRank = mode === 'ab'
            ? { bonly: 0, aonly: 1, both: 2 }
            : { new: 0, fixed: 1, still: 2 };
        rows.sort((x, y) => (tagRank[x.tag] - tagRank[y.tag]) || x.target.localeCompare(y.target));
        return rows;
    }

    function severityRollup(rules) {
        const out = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
        for (const r of rules.values()) out[r.severity] += sizeOf(r);
        return out;
    }

    function totalOcc(rules) {
        let n = 0;
        for (const r of rules.values()) n += sizeOf(r);
        return n;
    }

    // The elements with at least one failure, each once whatever it breaks:
    // an occurrence's key is its page and element, the same in every rule.
    function brokenElements(rules) {
        const keys = new Set();
        for (const r of rules.values()) for (const key of r.occ.keys()) keys.add(key);
        return keys.size;
    }

    function score(report) {
        const s = report && report.metrics && report.metrics.a11ySummary && report.metrics.a11ySummary.scores;
        return s || {};
    }
    function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : null; }
    // Scores arrive as long means (67.45054945...), and they reach the prose now,
    // not just the KPI cards, so the rounding lives at module level.
    function round2(v) { return Math.round(v * 100) / 100; }

    // ---- rule-level rows ----

    function diffRules(aRules, bRules, mode) {
        const ids = new Set([...aRules.keys(), ...bRules.keys()]);
        const rows = [];
        for (const id of ids) {
            const a = aRules.get(id);
            const b = bRules.get(id);
            const aCount = sizeOf(a);
            const bCount = sizeOf(b);
            const meta = b || a;

            let category;
            if (mode === 'ab') category = (aCount > 0 && bCount > 0) ? 'both' : (aCount > 0 ? 'aonly' : 'bonly');
            else category = (aCount > 0 && bCount > 0) ? 'persistent' : (aCount > 0 ? 'resolved' : 'new');

            rows.push({
                ruleId: id,
                title: meta.title,
                titleLang: meta.titleLang || null,
                severity: meta.severity,
                wcag: meta.wcag,
                rgaa: mergeRgaaLists(a, b),
                // Another standard's requirements, only where a finding names one.
                ...(((a && a.standards) || (b && b.standards))
                    ? { standards: mergeStandards(mergeStandards([], a && a.standards), b && b.standards) }
                    : {}),
                aCount,
                bCount,
                delta: bCount - aCount,
                pages: Math.max(pagesCount(a), pagesCount(b)),
                category,
                occ: diffOccurrences(a, b, mode),
            });
        }
        rows.sort((x, y) =>
            sevRank(x.severity) - sevRank(y.severity)
            || Math.abs(y.delta) - Math.abs(x.delta)
            || x.ruleId.localeCompare(y.ruleId));
        return rows;
    }

    // ---- verdict + narrative (deterministic) ----

    // Two things move between runs, and they move independently: how many rules
    // fail, and in how many places they fail. A run can fix no rule at all and
    // still be better (same rules, fewer elements), or lose a rule and still be
    // worse (the survivors spread). So every number below travels with its unit,
    // the sentence that carries the claim is the one built from the measure that
    // actually moved, and the tone is only good when nothing moved the wrong way
    // on either axis.

    // "3 fewer failing instances" / "1 more failing instance"
    function movedInstances(delta) {
        const v = Math.abs(delta);
        return `${v} ${delta < 0 ? 'fewer' : 'more'} ${v === 1 ? 'failure' : 'failures'}`;
    }
    // "2 fewer rules" / "1 more rule"
    function movedRules(delta) {
        const v = Math.abs(delta);
        return `${v} ${delta < 0 ? 'fewer' : 'more'} ${v === 1 ? 'problem' : 'problems'}`;
    }
    function countInstances(v) { return `${v} ${v === 1 ? 'failure' : 'failures'}`; }
    function countRules(v) { return `${v} ${v === 1 ? 'problem' : 'problems'}`; }
    function sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

    function evolutionVerdict(stats, rows) {
        const resolved = rows.filter((r) => r.category === 'resolved').length;
        const added = rows.filter((r) => r.category === 'new').length;
        const persistent = rows.filter((r) => r.category === 'persistent').length;

        const net = stats.failuresB - stats.failuresA;   // failing instances
        const ruleNet = added - resolved;                // rules that fail (== rulesB - rulesA)
        const i = sign(net);
        const r = sign(ruleNet);

        // A negative delta is the good direction on both axes.
        const better = (i < 0 ? 1 : 0) + (r < 0 ? 1 : 0);
        const worse = (i > 0 ? 1 : 0) + (r > 0 ? 1 : 0);

        let tone, headline, badge, dominant;
        if (better && worse) { tone = 'mixed'; headline = 'moved both ways'; badge = 'Mixed result'; dominant = 'mixed'; }
        else if (better) { tone = 'good'; headline = 'improved'; badge = 'Net improvement'; dominant = (better === 2) ? 'both' : (i < 0 ? 'instances' : 'rules'); }
        else if (worse) { tone = 'bad'; headline = 'regressed'; badge = 'Net regression'; dominant = (worse === 2) ? 'both' : (i > 0 ? 'instances' : 'rules'); }
        else { tone = 'neutral'; headline = 'held steady'; badge = 'No net change'; dominant = 'none'; }

        // The claim sentence. Nine combinations of (rules moved, instances moved),
        // each stating both axes so the verdict cannot rest on the axis that
        // stood still.
        const one = stats.rulesB === 1;
        let claim;
        if (i === 0 && r === 0) {
            claim = stats.rulesB === 0
                ? 'Neither run had a failing rule.'
                : `No change on either measure: the same ${countRules(stats.rulesB)} `
                    + `${one ? 'fails' : 'fail'}, in the same ${stats.failuresB} places.`;
        } else if (i === 0) {
            claim = `The same ${countInstances(stats.failuresB)} overall, now `
                + `${r < 0 ? 'concentrated in' : 'spread across'} ${movedRules(ruleNet)}.`;
        } else if (r === 0) {
            claim = `${movedInstances(net)} — the same ${countRules(stats.rulesB)} `
                + (i < 0
                    ? `${one ? 'still fails' : 'still fail'}, just in fewer places.`
                    : `${one ? 'now fails' : 'now fail'} in more places.`);
        } else if (i === r) {
            claim = `${movedInstances(net)}, spread across ${movedRules(ruleNet)}.`;
        } else if (r < 0) {
            claim = `${movedRules(ruleNet)} failing, but ${movedInstances(net)} — `
                + 'the problems that remain fail in more places.';
        } else {
            claim = `${movedInstances(net)} overall, but ${movedRules(ruleNet)} failing than before.`;
        }

        // The rule tally follows the claim rather than carrying it, so a zero here
        // reads as context and never as the reason for the verdict.
        const tally = `Problems: ${resolved} fixed, ${added} newly failing, ${persistent} still failing.`;

        return {
            mode: 'evolution', tone, badge, headline, lead: `${claim} ${tally}`,
            resolved, added, persistent, net, ruleNet, dominant,
        };
    }

    function abVerdict(stats, rows) {
        const aOnly = rows.filter((r) => r.category === 'aonly').length;
        const bOnly = rows.filter((r) => r.category === 'bonly').length;
        const both = rows.filter((r) => r.category === 'both').length;

        const sA = num(stats.scoreA);
        const sB = num(stats.scoreB);
        const fA = stats.failuresA;
        const fB = stats.failuresB;

        // Two measures, computed independently, so they can point opposite ways.
        // Whichever one the standings rest on gets named; when they disagree the
        // standings say so instead of picking the flattering one.
        const scoreLeader = (sA == null || sB == null) ? null : (sA === sB ? 'tie' : (sA > sB ? 'a' : 'b'));
        const instLeader = fA === fB ? 'tie' : (fA < fB ? 'a' : 'b');

        let leader;
        let basis;
        if (scoreLeader == null) { leader = instLeader; basis = 'instances'; }
        else if (scoreLeader === instLeader) { leader = scoreLeader; basis = 'both'; }
        else if (scoreLeader === 'tie') { leader = instLeader; basis = 'instances'; }
        else if (instLeader === 'tie') { leader = scoreLeader; basis = 'score'; }
        else { leader = 'split'; basis = 'split'; }

        const headline = leader === 'a' ? 'A leads'
            : (leader === 'b' ? 'B leads'
                : (leader === 'tie' ? 'Level result' : 'Too close to call'));
        const side = (k) => (k === 'a' ? 'A' : 'B');
        const scorePair = scoreLeader == null ? '' : `A ${round2(sA)} vs B ${round2(sB)}`;
        const instPair = `A ${fA} vs B ${fB}`;

        let claim;
        if (basis === 'split') {
            claim = `The two measures disagree: the accessibility score favours ${side(scoreLeader)} `
                + `(${scorePair}), the failure count favours ${side(instLeader)} (${instPair}).`;
        } else if (basis === 'both') {
            claim = leader === 'tie'
                ? `A and B are level: the same accessibility score (${round2(sA)}) and the same ${countInstances(fA)}.`
                : `${side(leader)} leads on both measures — accessibility score ${scorePair}, failures ${instPair}.`;
        } else if (basis === 'score') {
            claim = `${side(leader)} leads on the accessibility score (${scorePair}); both have the same ${countInstances(fA)}.`;
        } else if (scoreLeader === 'tie') {
            claim = `The accessibility scores are level at ${round2(sA)}; ${side(leader)} has fewer failures (${instPair}).`;
        } else if (leader === 'tie') {
            claim = `No accessibility score to compare, and both have the same ${countInstances(fA)}.`;
        } else {
            claim = `No accessibility score to compare; ${side(leader)} has fewer failures (${instPair}).`;
        }

        const rulesInPlay = aOnly + bOnly + both;
        const tally = `Of ${countRules(rulesInPlay)} in play, ${aOnly} fail only on A, `
            + `${bOnly} only on B, and ${both} on both.`;

        return {
            mode: 'ab', tone: 'neutral', badge: 'Standings · no winner declared',
            headline, lead: `${claim} ${tally}`,
            aOnly, bOnly, both, leader, basis, scoreLeader, instLeader,
        };
    }

    function narrative(mode, stats, rows, sevA, sevB) {
        const paras = [];
        // Which severity band moved most?
        const bandMove = SEV_ORDER.map((s) => ({ s, d: (sevB[s] || 0) - (sevA[s] || 0) }))
            .filter((x) => x.d !== 0)
            .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];

        if (mode === 'evolution') {
            if (bandMove) {
                const dir = bandMove.d < 0 ? 'dropped' : 'rose';
                paras.push(`The change concentrates in the ${bandMove.s} band, where failures ${dir} by ${Math.abs(bandMove.d)}.`);
            }
            const added = rows.filter((r) => r.category === 'new');
            if (added.length) {
                paras.push(`${added.length} ${added.length === 1 ? 'problem' : 'problems'} started failing that did not before — most severe: ${added.slice(0, 3).map((r) => r.title).join(', ')}.`);
            } else {
                paras.push('No rule started failing that did not before — every change was a reduction or held steady.');
            }
            const cA = num(stats.confidenceA), cB = num(stats.confidenceB);
            if (cA != null && cB != null && cB < cA) {
                paras.push(`Confidence dipped ${round2(cA)} → ${round2(cB)}; read the headline knowing the latest run had thinner evidence, not necessarily more barriers.`);
            }
        } else {
            const aOnly = rows.filter((r) => r.category === 'aonly');
            const bOnly = rows.filter((r) => r.category === 'bonly');
            if (bOnly.length) paras.push(`B's gaps: ${bOnly.slice(0, 3).map((r) => r.title).join(', ')}${bOnly.length > 3 ? ', …' : ''}.`);
            if (aOnly.length) paras.push(`A's gaps: ${aOnly.slice(0, 3).map((r) => r.title).join(', ')}${aOnly.length > 3 ? ', …' : ''}.`);
            const both = rows.filter((r) => r.category === 'both');
            if (both.length) paras.push(`${both.length} ${both.length === 1 ? 'problem fails' : 'problems fail'} on both builds — the shared gaps to fix regardless of which you ship.`);
        }
        return paras;
    }

    // ---- margins (room before failing) ----

    // Each rule's tightest pass across a report's scans: the margin with the
    // least room left (surea11y's canonical.margins). -> Map ruleId -> margin
    // plus the page it was measured on.
    function collectTightestMargins(report) {
        const out = new Map();
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        for (const scan of scans) {
            // A skipped scan has no canonical result at all.
            const canonical = scan && scan.canonical ? scan.canonical : null;
            const list = canonical && Array.isArray(canonical.margins) ? canonical.margins : [];
            if (!list.length) continue;
            const pageUrl = (canonical.page && canonical.page.url) || scan.url || null;
            for (const m of list) {
                if (!m || !m.ruleId || !Number.isFinite(m.headroom) || !Number.isFinite(m.value)) continue;
                const prev = out.get(m.ruleId);
                if (prev && prev.headroom <= m.headroom) continue;
                out.set(m.ruleId, {
                    ruleId: m.ruleId, title: m.title || m.ruleId, unit: m.unit, limit: m.limit,
                    threshold: m.threshold, value: m.value, headroom: m.headroom,
                    selector: m.selector || null, pageUrl,
                });
            }
        }
        return out;
    }

    // How many failing occurrences each check has across a report's scans,
    // by the check's own id (a margin is reported per check, a failure under
    // its rollup). A rollup's occurrence names its check (atomicCheckId).
    function failingOccurrencesByCheck(report) {
        const out = new Map();
        const scans = report && Array.isArray(report.scans) ? report.scans : [];
        for (const scan of scans) {
            const findings = scan && scan.canonical && Array.isArray(scan.canonical.findings) ? scan.canonical.findings : [];
            for (const f of findings) {
                if (!f || f.outcome !== 'fail') continue;
                const isRollup = f.meta && f.meta.atomic === false;
                for (const o of Array.isArray(f.occurrences) ? f.occurrences : []) {
                    const id = (o && o.atomicCheckId) || (isRollup ? null : f.ruleId);
                    if (id) out.set(id, (out.get(id) || 0) + 1);
                }
            }
        }
        return out;
    }

    // Changes in room smaller than what a reader is shown (a hundredth of a
    // ratio, half a pixel) read as the same.
    function roomStep(unit) { return unit === 'px' ? 0.5 : 0.01; }

    // How each rule's tightest pass moved between the two reports. A rule
    // with a margin on one side only passed there and either failed, or
    // measured nothing, on the other; the rule diff covers the failures.
    // Rows where the room shrank come first, the least room first.
    function diffMargins(a, b) {
        const ma = collectTightestMargins(a);
        const mb = collectTightestMargins(b);
        const failsA = failingOccurrencesByCheck(a);
        const failsB = failingOccurrencesByCheck(b);
        const ids = Array.from(new Set([...ma.keys(), ...mb.keys()]));
        const rows = ids.map((ruleId) => {
            const x = ma.get(ruleId) || null;
            const y = mb.get(ruleId) || null;
            let change;
            if (!x) change = 'bonly';
            else if (!y) change = 'aonly';
            else {
                const delta = y.headroom - x.headroom;
                change = Math.abs(delta) < roomStep(y.unit) ? 'same' : (delta < 0 ? 'closer' : 'further');
            }
            // When elements that passed now fail, the closest pass is another
            // element, so its room says nothing about the change: say that
            // the rule fails on more of them instead.
            if ((failsB.get(ruleId) || 0) > (failsA.get(ruleId) || 0)) change = 'failsMore';
            return { ruleId, title: (y || x).title, unit: (y || x).unit, a: x, b: y, change };
        });
        const rank = { failsMore: 0, closer: 1, bonly: 2, same: 3, further: 4, aonly: 5 };
        return rows.sort((r1, r2) => (rank[r1.change] - rank[r2.change])
            || ((r1.b ? r1.b.headroom : Infinity) - (r2.b ? r2.b.headroom : Infinity))
            || r1.ruleId.localeCompare(r2.ruleId));
    }

    // ---- public API ----

    function diffReports(reportA, reportB, { mode = 'evolution', order, document } = {}) {
        // Evolution orders oldest -> newest (baseline vs latest); A/B keeps the
        // caller's order (A and B are symmetric).
        //
        // `order: 'given'` keeps the caller's order even in evolution mode. A
        // timestamp records when a scan ran, not which version it covered — scan
        // v2 before v1 and the dates say the opposite of the truth — so the
        // caller is allowed to say which is the baseline.
        let a = reportA;
        let b = reportB;
        if (mode === 'evolution' && order !== 'given') {
            const ord = assignBaselineAndCurrent(reportA, reportB);
            a = ord.baseline;
            b = ord.current;
        }
        const swapped = a !== reportA;
        // Reports checked against different profiles are compared on those
        // they share: WCAG 2.2 AA + WAI-ARIA 1.2 beside WCAG 2.2 AA alone is
        // compared on WCAG 2.2 AA.
        const shared = compareOnShared([a, b]);
        [a, b] = shared.reports;

        const identityA = reportIdentity(a);
        const identityB = reportIdentity(b);

        const aRules = collectFailingRules(a);
        const bRules = collectFailingRules(b);

        const sevA = severityRollup(aRules);
        const sevB = severityRollup(bRules);

        const stats = {
            pagesA: Array.isArray(a && a.scans) ? a.scans.length : 0,
            pagesB: Array.isArray(b && b.scans) ? b.scans.length : 0,
            failuresA: totalOcc(aRules),
            failuresB: totalOcc(bRules),
            elementsA: brokenElements(aRules),
            elementsB: brokenElements(bRules),
            seriousCriticalA: sevA.critical + sevA.serious,
            seriousCriticalB: sevB.critical + sevB.serious,
            rulesA: aRules.size,
            rulesB: bRules.size,
            scoreA: num(score(a).avgPageAccessibility),
            scoreB: num(score(b).avgPageAccessibility),
            confidenceA: num(score(a).confidence),
            confidenceB: num(score(b).confidence),
        };

        const rows = diffRules(aRules, bRules, mode);
        const verdict = mode === 'ab' ? abVerdict(stats, rows) : evolutionVerdict(stats, rows);

        // Group rows by category for the segmented panes.
        const groups = {};
        for (const r of rows) (groups[r.category] = groups[r.category] || []).push(r);

        // The same document identity the series view carries, so a pair and a
        // series produce files that describe themselves the same way.
        const doc = describeComparison([a, b], {
            ...(document || {}),
            unit: mode === 'ab' ? { one: 'variant', many: 'variants' } : { one: 'run', many: 'runs' },
            framing: mode,
            ordered: mode !== 'ab' && order !== 'given',
        });

        if (shared.basis && shared.basis.comparedOn.length) doc.profiles = shared.basis;

        const result = {
            mode,
            // True when evolution ordering put the second argument first, so a
            // caller holding the reports knows which one is the baseline.
            swapped,
            document: doc,
            identityA,
            identityB,
            stats,
            severity: { a: sevA, b: sevB, order: SEV_ORDER },
            verdict,
            rows,
            groups,
            narrative: narrative(mode, stats, rows, sevA, sevB),
            // Room before failing, rule by rule: empty when neither report
            // has margins (other engines, or an older surea11y).
            margins: diffMargins(a, b),
        };
        // The two reports as compared (read on their shared profiles), in
        // the result's order, for a view that reads them further (where the
        // failures are). Not enumerable: the CLI writes the result to disk.
        Object.defineProperty(result, 'compared', { value: [a, b], enumerable: false });
        return result;
    }

    // collectFailingRules is exported so the N-way series engine
    // (report-multi-diff.js) ingests each report exactly the way the pairwise
    // diff does, instead of re-deriving the rule set from the payload.
    // pagePath travels with it so both engines normalize a page URL the same
    // way when they count how far a rule reaches.
    return {
        sizeOf, diffReports, collectFailingRules, collectTightestMargins, failingOccurrencesByCheck, pagePath, otherStandardsOf, mergeStandards, compareOnShared };
}));
