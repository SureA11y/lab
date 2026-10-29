// The units the comparison tab counts in, named the same way in the
// two-report view and the series view:
//  - a problem is one row: a WCAG or RGAA criterion in a report read by
//    criterion (the default), a rule in one read by rule, or a mix when
//    best practices sit beside the criteria;
//  - a failure is one element on one page failing one problem, so an
//    element that breaks three criteria is three failures;
//  - a broken element is an element with at least one failure, once.

const CRITERION_ID = /^(wcag|rgaa)-\d/;

/** What the problems in `rows` are, in words: 'WCAG criteria', 'rules', ... */
export function problemKind(rows) {
    const ids = (Array.isArray(rows) ? rows : []).map((r) => String((r && r.ruleId) || ''));
    const criteria = ids.filter((id) => CRITERION_ID.test(id)).length;
    if (!ids.length || criteria === ids.length) {
        return ids.length && ids.every((id) => id.startsWith('rgaa-')) ? 'RGAA criteria' : 'WCAG criteria';
    }
    return criteria ? 'criteria and best-practice rules' : 'rules';
}

/** One problem of that kind: 'criterion' or 'rule'. */
export function problemOne(kind) {
    return kind === 'rules' ? 'rule' : 'criterion';
}

/** The sentence that says what one failure is. */
export function failureUnitNote(kind) {
    return `A failure is one element failing one ${problemOne(kind)} on one page, `
        + `so an element that breaks three ${kind} counts three times.`;
}
