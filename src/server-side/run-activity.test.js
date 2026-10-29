'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createRunActivity } = require('./run-activity');

const labels = { repeat: 'Repeat', forEachElement: 'Iterate', a11yScan: 'A11y scan', click: 'Click', navigate: 'Navigate to URL' };
const start = (actionPath, actionType, label = null) => ({ extra: { stepEvent: 'action-start', actionPath, actionType, label } });
const end = (actionPath) => ({ extra: { stepEvent: 'action-end', actionPath } });
const iteration = (actionPath, index, total) => ({ extra: { stepEvent: 'loop-iteration', actionPath, index, total } });

function activity(entries) {
    const a = createRunActivity({ labelOf: (t) => labels[t] });
    for (const e of entries) a.push(e);
    return a.describe();
}

describe('run activity', () => {
    test('nothing before the first step', () => {
        assert.equal(activity([{ type: 'info', message: 'browsing to …' }]), null);
    });

    test('the step running, by its label when it has one', () => {
        assert.equal(activity([start('1', 'click')]), 'Click');
        assert.equal(activity([start('1', 'click'), end('1'), start('2', 'a11yScan', 'Home')]), 'A11y scan “Home”');
    });

    test('inside loops, with their iteration and total', () => {
        assert.equal(activity([
            start('1', 'repeat'), iteration('1', 33, 120),
            start('1.1', 'forEachElement', 'Products'), iteration('1.1', 4, null),
            start('1.1.1', 'a11yScan', 'Product'),
        ]), 'Repeat 34 of 120 › Iterate “Products” 5 › A11y scan “Product”');
    });

    test('back to the loop once its step ends, and no loop once it ends', () => {
        const entries = [start('1', 'repeat'), iteration('1', 0, 2), start('1.1', 'navigate'), end('1.1')];
        assert.equal(activity(entries), 'Repeat');
        assert.equal(activity([...entries, end('1'), start('2', 'a11yScan')]), 'A11y scan');
    });

    test('steps of items running side by side: the latest started', () => {
        assert.equal(activity([
            start('1', 'forEachElement'), iteration('1', 0, 3), iteration('1', 1, 3),
            start('1.1', 'click'), start('1.1', 'a11yScan'), end('1.1'),
        ]), 'Iterate 2 of 3 › Click');
    });

    test('an unknown step type is named by its type', () => {
        assert.equal(activity([start('1', 'mystery')]), 'mystery');
    });
});
