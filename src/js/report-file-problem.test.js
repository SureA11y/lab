import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plainReportFileProblem} from './report-file-problem.js';

// The check's error, as validateReportOrThrow (report-data.js) throws it.
function checkError(problem) {
    const error = new Error(`Invalid report file (x.json): ${problem.path} , ${problem.message}`);
    error.reportProblem = problem;
    return error;
}

test('a file with no page address says so, without the schema path', () => {
    const text = plainReportFileProblem(checkError({path: '$', keyword: 'required', message: 'needs "url"'}));
    assert.equal(text, 'This file is not a surea11y report: it has no page address.');
    assert.doesNotMatch(text, /\$|needs|Invalid/);
});

test('each field a report needs has a name a reader knows', () => {
    assert.equal(
        plainReportFileProblem(checkError({path: '$', keyword: 'required', message: 'needs "scans"'})),
        'This file is not a surea11y report: it has no list of scans.',
    );
    assert.equal(
        plainReportFileProblem(checkError({path: '$', keyword: 'required', message: 'needs "somethingElse"'})),
        'This file is not a surea11y report: it has no "somethingElse".',
    );
});

test('a file that is not JSON, or holds no object, is not a report', () => {
    const notJson = new Error('Invalid JSON');
    notJson.notJson = true;
    assert.equal(plainReportFileProblem(notJson), 'This file is not a surea11y report: it is not a JSON file, or it is damaged.');
    assert.equal(
        plainReportFileProblem(checkError({path: '$', keyword: 'type', message: 'must be an object, not an array'})),
        'This file is not a surea11y report: it holds no report.',
    );
});

test('a report of another format version says the app does not read it', () => {
    assert.equal(
        plainReportFileProblem(checkError({path: '$.reportVersion', keyword: 'const', message: 'must be 4'})),
        'This report was saved in a format this app does not read.',
    );
});

test('a problem deeper in a report names where, as one sentence', () => {
    const text = plainReportFileProblem(checkError({path: '$.scans[2].canonical', keyword: 'type', message: 'must be an object, not a string'}));
    assert.equal(text, 'This report cannot be opened: a part of it is not as the app writes it (scans[2].canonical must be an object, not a string).');
});

test('an error that already speaks plainly keeps its words, as a sentence', () => {
    assert.equal(plainReportFileProblem(new Error('not a readable zip file')), 'Not a readable zip file.');
    assert.equal(plainReportFileProblem(null), 'This file is not a surea11y report.');
});
