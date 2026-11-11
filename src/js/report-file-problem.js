// Why a file picked in Open report cannot be opened, in plain words. The
// checks behind it speak in schema paths ("$ , needs \"url\""), which mean
// nothing to someone who only picked the wrong file; this says what is wrong
// with the file instead. Kept apart from the DOM so it can be tested alone.

// The fields every report has, by what a reader would call them.
const FIELD_NAMES = {
    url: 'page address',
    scans: 'list of scans',
    reportVersion: 'format version',
    runId: 'run id',
    timestamp: 'date',
};

const NOT_A_REPORT = 'This file is not a surea11y report';

/**
 * The plain sentence for why a staged file cannot be opened, from the error
 * its check threw. A check error carries `reportProblem` (its first schema
 * problem: path, keyword, message); reading the file as JSON failing carries
 * `notJson`; anything else (a zip that cannot be read) already speaks plainly
 * and keeps its words.
 */
export function plainReportFileProblem(error) {
    if (!error) return `${NOT_A_REPORT}.`;
    if (error.notJson) return `${NOT_A_REPORT}: it is not a JSON file, or it is damaged.`;
    const problem = error.reportProblem;
    if (!problem) {
        const text = String(error.message || error).trim();
        return text ? sentence(text) : `${NOT_A_REPORT}.`;
    }
    const atTop = problem.path === '$';
    if (atTop && problem.keyword === 'type') return `${NOT_A_REPORT}: it holds no report.`;
    if (atTop && problem.keyword === 'required') {
        const name = /"([^"]+)"/.exec(problem.message || '')?.[1] || '';
        const what = FIELD_NAMES[name];
        return `${NOT_A_REPORT}: it has no ${what || `"${name}"`}.`;
    }
    if (problem.path === '$.reportVersion') {
        return 'This report was saved in a format this app does not read.';
    }
    // Deeper down: a report, but a part of it is not as the app writes it.
    return `This report cannot be opened: a part of it is not as the app writes it (${problem.path.replace(/^\$\.?/, '') || 'the top'} ${problem.message}).`;
}

function sentence(text) {
    const capital = text.charAt(0).toUpperCase() + text.slice(1);
    return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
