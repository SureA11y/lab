'use strict';

/**
 * Builds docs/design/mockups/multi-report-comparison.html — the annotated walkthrough
 * of the multi-report Compare view.
 *
 *   node docs/design/mockups/multi-report/build-mockup.js
 *   node docs/design/mockups/multi-report/build-mockup.js --reports a.json b.json c.json
 *
 * It renders the SHIPPED component: the same engine (shared/report-multi-diff),
 * the same renderer (js/report-multi-renderer) and the same stylesheet block
 * the app and the exported comparison use. Only the page around it — the band,
 * the tabs, the annotations — belongs to the mockup. So this page cannot drift
 * from the product: if the dashboard changes, rebuilding shows the change.
 *
 * With --reports it renders from real exported reports instead of the bundled
 * mock ones. The engine takes any number, so the same command works with three
 * files or thirty.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');

const { diffReportSeries } = require(path.join(ROOT, 'src/shared/report-multi-diff.js'));
const plainLanguage = require(path.join(ROOT, 'src/shared/plain-language.js'));
const { trendReports, matrixReports, longTrendReports } = require('./mock-data.js');
const CHROME_CSS = require('./styles.js');

// The renderer reads the plain-language table off the global, exactly as it
// does in the browser.
globalThis.A11Y_PLAIN_LANGUAGE = plainLanguage;

const OUT = path.resolve(__dirname, '../multi-report-comparison.html');
// The artifact host wraps content in its own document skeleton, so that variant
// carries the same page without the outer html/head/body tags.
const ARTIFACT_OUT = path.resolve(__dirname, '../multi-report-comparison.artifact.html');

// ---------------------------------------------------------------------------
// the app's own styles, taken from the app's own files
// ---------------------------------------------------------------------------

/** Tokens, fonts and theme handling — what the exported comparison inlines. */
function baseStyles() {
    return fs.readFileSync(path.join(ROOT, 'src/report/report.css'), 'utf8')
        // The @font-face rules point at woff2 files next to the stylesheet;
        // this page pulls the same three faces from Google Fonts instead.
        .replace(/@font-face\s*\{[^}]*\}/g, '');
}

/** The Compare-tab block, extracted the way build:report extracts it. */
function compareStyles() {
    const css = fs.readFileSync(path.join(ROOT, 'src/css/compare.css'), 'utf8');
    const start = css.indexOf('/* compare:start');
    const end = css.indexOf('/* compare:end */');
    if (start === -1 || end === -1) throw new Error('compare markers missing from src/css/compare.css');
    return css.slice(css.indexOf('*/', start) + 2, end);
}

function loadReportsFromArgs(argv) {
    const at = argv.indexOf('--reports');
    if (at === -1) return null;
    const files = argv.slice(at + 1).filter((a) => !a.startsWith('--'));
    if (files.length < 2) throw new Error('--reports needs at least two report files');
    return files.map((f) => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8')));
}

function note(kind, html) {
    return `<aside class="note"><p class="note-k">${kind}</p>${html}</aside>`;
}

// The tab's own wrapper: the compare block scopes its tokens to .compare-panel,
// so the dashboard needs the same parent here that it has in the app and in the
// exported file.
function panel(html) {
    return `<div class="compare-panel">${html}</div>`;
}

// ---------------------------------------------------------------------------

function page({ views, trend, matrix, long, realData }) {
    const source = realData
        ? 'Rendered from the report files passed on the command line.'
        : 'Rendered from mock payloads in the shape the app exports — rule ids, titles, severities and WCAG '
          + 'references are the scanner\'s own vocabulary, the counts are invented to tell a legible story.';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Comparing Many Reports</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Public+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${baseStyles()}</style>
<style>${compareStyles()}</style>
<style>${CHROME_CSS}</style>
</head>
<body>
<header class="mock-band">
    <div class="wrap">
        <div class="mock-brandrow">
            <svg class="mock-mark" viewBox="0 0 64 64" role="img" aria-label="SureA11y">
                <rect width="64" height="64" rx="14" fill="#3BC98F"></rect>
                <path d="M17 33.5 L27.5 44 L48 18" fill="none" stroke="#04150E" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
            <span class="mock-wordmark">surea11y <span class="dim">compare</span></span>
            <span class="mock-tag">Walkthrough · the shipped view</span>
        </div>

        <h1>Comparing many reports, not just two</h1>
        <p class="sub">The Compare tab answers a question about two files. This is what it answers about a whole
            series — written to be read by whoever asks &ldquo;are we getting better?&rdquo;, not only by the
            person who runs the scanner. Everything below is the real component, rendered by the real engine.</p>

        <ul class="mock-meta">
            <li><b>${trend.columns.length} runs</b> over time</li>
            <li><b>${matrix.columns.length} variants</b> side by side</li>
            <li><b>${long.columns.length} runs</b> in the scale check</li>
            <li><b>Every number</b> computed, not drawn</li>
        </ul>

        <div class="mock-tabs" role="tablist" aria-label="Views">
            <button type="button" class="mock-tab" role="tab" id="tab-trend" aria-controls="view-trend" aria-selected="true">Over time</button>
            <button type="button" class="mock-tab" role="tab" id="tab-matrix" aria-controls="view-matrix" aria-selected="false" tabindex="-1">Across variants</button>
            <button type="button" class="mock-tab" role="tab" id="tab-scale" aria-controls="view-scale" aria-selected="false" tabindex="-1">At scale</button>
        </div>
    </div>
</header>

<main class="mock-views">
<div class="wrap">
    <section id="view-trend" role="tabpanel" aria-labelledby="tab-trend" tabindex="0">
        ${note('What you are looking at', `<p>Six nightly runs of one banking scenario over ten weeks, in one view.
            ${source} The page answers in this order: <strong>what state are we in</strong>,
            <strong>what changed</strong>, <strong>what do we do</strong>, and only then the evidence.
            Someone who stops reading after the first screen should still be right about the site.</p>`)}
        ${views.trend}
        ${note('Why this beats loading two files', `
            <p><strong>&ldquo;Hidden content still reachable by keyboard&rdquo; has been fixed and broken again
            across these six runs.</strong> Load Jun 30 against Jul 14 and the tool says it is fixed. Load
            Jul 14 against Jul 28 and it says it is a new regression. Both readings are wrong, and neither
            two-run comparison can tell you so — the pattern only exists once you look at more than two runs.</p>
            <p>The same is true of the headline: the site is much better than in June, <em>and</em> the Jul 28
            run gave instances back. A pair shows one of those facts at a time, and never shows which run is
            the best the site has ever been.</p>`)}
        ${note('How it stays honest', `
            <p>The latest run scanned more pages than the earlier ones. Absolute counts are not comparable
            across a workload change, so the caveat sits in the headline rather than in a footnote, and the
            verdict is read from the rule categories instead.</p>
            <p>Nothing is encoded by colour alone: severity and direction are written in words, every heat cell
            prints its number, and every chart has a table of the same figures underneath it.</p>`)}
    </section>

    <section id="view-matrix" role="tabpanel" aria-labelledby="tab-matrix" tabindex="0" hidden>
        ${note('What you are looking at', `<p>One release, exported four times filtered by scan tag —
            desktop, tablet, mobile and high contrast. Nothing is ordered in time, so there is no
            &ldquo;improved&rdquo; or &ldquo;regressed&rdquo;: the question is <strong>what fails
            everywhere</strong> versus <strong>what fails in one place only</strong>.</p>`)}
        ${views.matrix}
        ${note('Why this beats loading two files', `
            <p>Answering this with a two-report view takes six separate comparisons and a person to hold all
            six in their head. Even then, &ldquo;fails on tablet and mobile but not desktop&rdquo; — the row
            that names a breakpoint as the cause — is not something any single pair can state.</p>
            <p>The business reading is in the headline: ${matrix.verdict.universal} rules fail on every
            variant. Those are design-system bugs, and one fix clears them everywhere. That is the difference
            between a backlog of ${matrix.rows.length} items and a backlog of ${matrix.verdict.universal}.</p>`)}
    </section>

    <section id="view-scale" role="tabpanel" aria-labelledby="tab-scale" tabindex="0" hidden>
        ${note('What you are looking at', `<p>The same component fed ${long.columns.length} nightly runs.
            Nothing in the design is tied to a handful of columns.</p>`)}
        ${views.scale}
        ${note('What changes as the series grows', `
            <ul>
                <li><strong>Up to ~12 columns</strong> — everything renders as in the first view.</li>
                <li><strong>12 to ~24</strong> — the time axis samples its labels, heat cells narrow, and the
                    grid scrolls sideways under a pinned first column. Numbers stay printed.</li>
                <li><strong>Beyond that</strong> — the tab holds 24 at once and says so. For a year of
                    nightlies the answer is selection, not more columns: a window (last 10 / last 30), or one
                    column per week keeping that week's worst run. Both happen before the diff, so the engine
                    is untouched.</li>
            </ul>
            <p>Cost is linear: one ingest per report, no pairwise explosion. Thirty reports is thirty passes,
            not four hundred and thirty-five comparisons.</p>`)}
    </section>
</div>
</main>

<section class="feas">
    <div class="wrap">
        <h2>What this is made of</h2>
        <p class="lede">Shipped, and rendered above by the same code the app runs. This page is built by
            <span class="mono">docs/design/mockups/multi-report/build-mockup.js</span>, which imports the renderer and
            extracts the stylesheet from the app rather than keeping copies — so it cannot drift from what the
            tab shows.</p>

        <div class="phases">
            <article class="phase">
                <p class="phase-n">Engine</p>
                <h3>One pass per report</h3>
                <p>An N-way rule index: every category, stat, verdict and sentence derives from one
                    rule-by-column matrix. Pure, DOM-free, unit-tested.</p>
                <span class="cost">shared/report-multi-diff.js</span>
            </article>
            <article class="phase">
                <p class="phase-n">Words</p>
                <h3>Plain language by criterion</h3>
                <p>One sentence per WCAG success criterion about who is affected and what happens to them,
                    with rule-level overrides where a criterion covers several distinct failures.</p>
                <span class="cost">shared/plain-language.js</span>
            </article>
            <article class="phase">
                <p class="phase-n">View</p>
                <h3>The dashboard</h3>
                <p>Hero, headline numbers, charts, ranked fixes and the run-by-run grid. Namespaced under
                    <span class="mono">.cmp2 .dash-*</span> so a downloaded comparison carries it too.</p>
                <span class="cost">js/report-multi-renderer.js</span>
            </article>
            <article class="phase">
                <p class="phase-n">Next</p>
                <h3>The headless runner</h3>
                <p>The run store already keeps timestamped runs per scenario. A <span class="mono">--series</span>
                    flag would feed the last N straight into this engine and write this page unattended.</p>
                <span class="cost">not built yet</span>
            </article>
        </div>

        <div class="ledger">
            <table>
                <thead><tr><th scope="col">Piece</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead>
                <tbody>
                    <tr><th scope="row" class="mono">shared/report-diff.js</th>
                        <td class="state"><span class="tag tag--edit">one export added</span></td>
                        <td>Its rule-collection pass is exported so the series engine ingests reports exactly the
                            way the pairwise diff does. Behaviour unchanged.</td></tr>
                    <tr><th scope="row" class="mono">shared/report-multi-diff.js</th>
                        <td class="state"><span class="tag tag--new">new</span></td>
                        <td>The matrix, the categories, the verdicts, the column labels. Everything above comes
                            from here.</td></tr>
                    <tr><th scope="row" class="mono">js/report-comparison-controller.js</th>
                        <td class="state"><span class="tag tag--edit">holds a list</span></td>
                        <td>Two reports render the pairwise diff that already shipped; three or more render the
                            dashboard. Removing one drops back.</td></tr>
                    <tr><th scope="row" class="mono">cli/run-store.js</th>
                        <td class="state"><span class="tag tag--have">unchanged</span></td>
                        <td>Already stores one directory per scenario with timestamped runs — that is the series
                            a headless trend would read.</td></tr>
                    <tr><th scope="row">Occurrence-level detail</th>
                        <td class="state"><span class="tag tag--have">unchanged</span></td>
                        <td>Never computed across N columns. Element pairing is claimed only by the two-report
                            view, which is what a pair of columns drills down into.</td></tr>
                </tbody>
            </table>
        </div>
    </div>
</section>

<script>
(function () {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
    function select(tab) {
        tabs.forEach(function (t) {
            var on = t === tab;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
            document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
        });
    }
    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () { select(tab); });
        tab.addEventListener('keydown', function (e) {
            var i = tabs.indexOf(tab);
            var to = e.key === 'ArrowRight' ? (i + 1) % tabs.length
                : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
                : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
            if (to < 0) return;
            e.preventDefault();
            select(tabs[to]);
            tabs[to].focus();
        });
    });

    // The dashboard's own behaviour, copied from src/report/report.js so this
    // page behaves like a downloaded comparison: grid filters and chart tooltips.
    document.querySelectorAll('.cmp2--dash').forEach(function (scope) {
        scope.addEventListener('click', function (event) {
            var chip = event.target.closest && event.target.closest('[data-dash-filter]');
            if (!chip || !scope.contains(chip)) return;
            var bar = chip.parentElement;
            bar.querySelectorAll('[data-dash-filter]').forEach(function (c) {
                c.setAttribute('aria-pressed', String(c === chip));
            });
            var wanted = chip.dataset.dashFilter;
            var table = bar.parentElement.querySelector('table.dash-grid');
            if (!table) return;
            table.querySelectorAll('tbody tr').forEach(function (row) {
                row.hidden = wanted !== 'all' && row.dataset.dashCat !== wanted;
            });
        });

        var tip = null;
        function show(mark) {
            if (!tip) { tip = document.createElement('div'); tip.className = 'cmp2-tip'; document.body.append(tip); }
            tip.textContent = '';
            var value = document.createElement('b');
            value.textContent = mark.dataset.tipValue;
            tip.append(value, ' · ' + mark.dataset.tipLabel);
            tip.classList.add('on');
            var box = mark.getBoundingClientRect();
            tip.style.left = Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2) + 'px';
            tip.style.top = (box.top - tip.offsetHeight - 10) + 'px';
        }
        function hide() { if (tip) tip.classList.remove('on'); }
        [['mouseover', 'mouseout'], ['focusin', 'focusout']].forEach(function (pair) {
            scope.addEventListener(pair[0], function (event) {
                var mark = event.target.closest && event.target.closest('[data-tip-value]');
                if (mark && scope.contains(mark)) show(mark);
            });
            scope.addEventListener(pair[1], hide);
        });
    });
})();
</script>
</body>
</html>`;
}

function artifactVariant(html) {
    const head = html.slice(html.indexOf('<title>'), html.indexOf('</head>'));
    const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'));
    return `${head}\n${body}\n`;
}

// ---------------------------------------------------------------------------

async function main() {
    const { comparisonSeriesHTML } = await import(
        path.join(ROOT, 'src/js/report-multi-renderer.js')
    );

    const real = loadReportsFromArgs(process.argv);

    // The app names rules the way its reader does; the engine's own titles are
    // the fallback when nothing is injected.
    const ruleLabel = (row) => plainLanguage.plainFor(row.ruleId, row.wcag).name.toLowerCase();

    // A fixed compiled-on stamp and typed titles: the masthead is part of the
    // shipped component, so the walkthrough has to show one. Fixed rather than
    // taken from the clock so rebuilding this page does not change the file.
    const doc = (title, note) => ({ title, note, generatedAt: '2026-08-12T09:00:00Z' });

    const trend = diffReportSeries(real || trendReports(), {
        mode: 'trend', ruleLabel,
        document: doc('Web Banking, nightly regression', 'Ten weeks of nightly runs, read for the quarterly review.'),
    });
    const matrix = diffReportSeries(matrixReports(), {
        mode: 'matrix', ruleLabel,
        document: doc('Web Banking 3.4, device sweep', 'One release, exported once per device profile.'),
    });
    const long = diffReportSeries(longTrendReports(24), {
        mode: 'trend', ruleLabel, document: doc('Web Banking, a month of nightlies'),
    });

    const views = {
        trend: panel(comparisonSeriesHTML(trend)),
        matrix: panel(comparisonSeriesHTML(matrix)),
        scale: panel(comparisonSeriesHTML(long)),
    };

    const html = page({ views, trend, matrix, long, realData: !!real });

    fs.writeFileSync(OUT, html);
    fs.writeFileSync(ARTIFACT_OUT, artifactVariant(html));

    process.stdout.write(`wrote ${path.relative(process.cwd(), OUT)} (${(html.length / 1024).toFixed(0)} kB)\n`);
    process.stdout.write(`wrote ${path.relative(process.cwd(), ARTIFACT_OUT)}\n`);
    process.stdout.write(`trend: ${trend.columns.length} runs, ${trend.rows.length} rules · `
        + `variants: ${matrix.columns.length} · scale: ${long.columns.length} runs\n`);
}

main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exit(1);
});
