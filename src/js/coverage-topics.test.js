'use strict';

const {test, describe, before} = require('node:test');
const assert = require('node:assert/strict');

let summarizeTopic;
let topicBadgeText;

before(async () => {
    ({summarizeTopic, topicBadgeText} = await import('./coverage-topics.js'));
});

function criterion(sc, {automation = 'automatic', status = 'supports', pass = 1, fail = 0, cantTell = 0, notApplicable = 0} = {}) {
    return {
        sc,
        automation,
        status,
        checks: {total: pass + fail + cantTell + notApplicable, pass, fail, cantTell, notApplicable, evaluated: pass + fail}
    };
}

const KEYBOARD = ['2.1.1', '2.1.2', '2.4.3', '2.4.7'];

describe('summarizeTopic', () => {
    test('counts only the criteria the topic lists', () => {
        const cov = {criteria: [criterion('2.1.1'), criterion('1.4.3'), criterion('2.4.7')]};
        const t = summarizeTopic(cov, KEYBOARD);
        assert.equal(t.inScope, 2);
        assert.equal(t.listed, 4);
    });

    test('a topic no automated check can reach is flagged as such, not as clean', () => {
        const cov = {criteria: KEYBOARD.map(sc => criterion(sc, {automation: 'notAutomatable', status: 'notEvaluated', pass: 0}))};
        const t = summarizeTopic(cov, KEYBOARD);
        assert.equal(t.state, 'notAutomatable');
        assert.equal(t.automatable, 0);
    });

    test('a reachable topic that this scan never evaluated is distinguished from one that passed', () => {
        const untested = summarizeTopic({criteria: [criterion('2.1.1', {status: 'notEvaluated', pass: 0})]}, KEYBOARD);
        const passed = summarizeTopic({criteria: [criterion('2.1.1')]}, KEYBOARD);
        assert.equal(untested.state, 'notEvaluated');
        assert.equal(passed.state, 'noFailures');
    });

    test('any failing criterion makes the topic read as failing', () => {
        const cov = {criteria: [criterion('2.1.1'), criterion('2.4.7', {status: 'doesNotSupport', pass: 0, fail: 1})]};
        const t = summarizeTopic(cov, KEYBOARD);
        assert.equal(t.state, 'failing');
        assert.equal(t.failing, 1);
    });

    test('partiallySupports counts as failing', () => {
        const t = summarizeTopic({criteria: [criterion('2.1.1', {status: 'partiallySupports', pass: 1, fail: 1})]}, KEYBOARD);
        assert.equal(t.failing, 1);
        assert.equal(t.state, 'failing');
    });

    test('criteria needing review are counted even when the topic otherwise passed', () => {
        const t = summarizeTopic({criteria: [criterion('2.1.1', {pass: 1, cantTell: 2})]}, KEYBOARD);
        assert.equal(t.needsReview, 1);
        assert.equal(t.state, 'noFailures');
    });

    test('manual-only criteria are counted separately from automatic ones', () => {
        const cov = {criteria: [criterion('2.1.1', {automation: 'manualOnly'}), criterion('2.4.7')]};
        const t = summarizeTopic(cov, KEYBOARD);
        assert.equal(t.manualOnly, 1);
        assert.equal(t.automatable, 1);
    });

    test('a topic matching nothing in the summary is unknown rather than empty-and-clean', () => {
        assert.equal(summarizeTopic({criteria: [criterion('1.4.3')]}, KEYBOARD).state, 'unknown');
    });

    test('missing input does not throw', () => {
        assert.equal(summarizeTopic(null, KEYBOARD).state, 'unknown');
        assert.equal(summarizeTopic({criteria: [criterion('2.1.1')]}, null).state, 'unknown');
        assert.equal(summarizeTopic(undefined, undefined).inScope, 0);
    });

    test('criterion refs are trimmed before matching', () => {
        assert.equal(summarizeTopic({criteria: [criterion('2.1.1')]}, ['  2.1.1  ']).inScope, 1);
    });
});

describe('topicBadgeText', () => {
    test('an unreachable topic says so outright', () => {
        const t = summarizeTopic({criteria: KEYBOARD.map(sc => criterion(sc, {automation: 'notAutomatable', pass: 0}))}, KEYBOARD);
        assert.equal(topicBadgeText(t), 'No automated check exists for any of these 4 criteria');
    });

    test('a reachable but unevaluated topic leads with reach and says none were evaluated', () => {
        const cov = {criteria: [criterion('2.1.1', {pass: 0, status: 'notEvaluated'}), criterion('2.4.7', {automation: 'notAutomatable', pass: 0, status: 'notEvaluated'})]};
        assert.equal(topicBadgeText(summarizeTopic(cov, KEYBOARD)), '1 of 2 machine-testable · none evaluated here');
    });

    test('an evaluated topic reports what was evaluated and what failed', () => {
        const cov = {criteria: [criterion('2.1.1'), criterion('2.4.7', {status: 'doesNotSupport', pass: 0, fail: 1})]};
        assert.equal(topicBadgeText(summarizeTopic(cov, KEYBOARD)), '2 of 2 machine-testable · 2 evaluated · 1 failing');
    });

    test('review counts are appended when present', () => {
        const cov = {criteria: [criterion('2.1.1', {pass: 1, cantTell: 1})]};
        assert.equal(topicBadgeText(summarizeTopic(cov, KEYBOARD)), '1 of 1 machine-testable · 1 evaluated · no automated failures · 1 need review');
    });

    test('a topic with nothing failing says so outright rather than staying silent', () => {
        const cov = {criteria: [criterion('2.1.1'), criterion('2.4.7')]};
        assert.equal(topicBadgeText(summarizeTopic(cov, KEYBOARD)), '2 of 2 machine-testable · 2 evaluated · no automated failures');
    });

    test('an unknown topic renders no badge at all', () => {
        assert.equal(topicBadgeText(summarizeTopic({criteria: []}, KEYBOARD)), '');
        assert.equal(topicBadgeText(null), '');
    });
});
