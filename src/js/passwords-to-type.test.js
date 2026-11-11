'use strict';

// Passwords to type again, counted in saved steps (custom steps not open in
// an editor), and the Workflow's banner that says how many are left.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const { ACTION_DEFINITIONS: defs } = require('../workflow/action-definitions.js');

let M;
before(async () => {
    M = await import('./passwords-to-type.js');
});

const password = (extra = {}) => ({ type: 'setPassword', selector: '#p', valueMasked: true, ...extra });

describe('emptyPasswordsInActions', () => {
    test('counts each empty password in the steps that run, nested ones too, and says where the first is', () => {
        const got = M.emptyPasswordsInActions([
            { type: 'click', selector: 'a' },
            { type: 'group', actions: [password(), password({ value: 'typed' })] },
            password({ value: { $env: 'SHOP_PASSWORD' } }),
            password(),
            password({ disabled: true }),
            { type: 'group', disabled: true, actions: [password()] },
        ], defs);
        assert.deepEqual(got, { count: 2, firstPath: '2.1' });
    });

    test('a step says whether it has one of its own', () => {
        assert.equal(M.stepHasEmptyPassword(password(), defs), true);
        assert.equal(M.stepHasEmptyPassword(password({ value: 'x' }), defs), false);
        assert.equal(M.stepHasEmptyPassword({ type: 'group', actions: [password()] }, defs), false);
        assert.equal(M.stepHasEmptyPassword({ type: 'nope' }, defs), false);
    });
});

describe('customStepsWithEmptyPasswords', () => {
    const customSteps = [
        { id: 'login', name: 'Log in', actions: [password(), { type: 'runCustomStep', customStepId: 'otp' }] },
        { id: 'otp', name: 'One-time code', actions: [password()] },
        { id: 'unused', name: 'Nobody runs it', actions: [password()] },
        { id: 'checkout', name: 'Checkout', actions: [password(), password()] },
    ];

    test('only those the workflow runs, directly or through another custom step', () => {
        const workflow = [{ type: 'group', actions: [{ type: 'runCustomStep', customStepId: 'login' }] }];
        assert.deepEqual(M.customStepsWithEmptyPasswords(customSteps, workflow, defs),
            [{ index: 0, id: 'login', name: 'Log in', count: 1 }, { index: 1, id: 'otp', name: 'One-time code', count: 1 }]);
        assert.deepEqual(Array.from(M.customStepIdsRun(customSteps, workflow)), ['login', 'otp']);
    });

    test('not one called from a step turned off, and not the one open in the editor', () => {
        const workflow = [
            { type: 'runCustomStep', customStepId: 'login', disabled: true },
            { type: 'runCustomStep', customStepId: 'checkout' },
            { type: 'runCustomStep', customStepId: 'otp' },
        ];
        assert.deepEqual(M.customStepsWithEmptyPasswords(customSteps, workflow, defs, { skipIndex: 1 }).map((s) => [s.id, s.count]), [['checkout', 2]]);
    });
});

describe('the banner', () => {
    test('says how many are left, hides at none, and its button goes to the next one', () => {
        const doc = new JSDOM('<div id="b" hidden></div>').window.document;
        const host = doc.getElementById('b');
        let asked = 0;
        const banner = M.createPasswordsBanner({ host, onNext: () => { asked += 1; } });
        assert.equal(host.hidden, true);
        banner.update(4);
        assert.equal(host.hidden, false);
        assert.equal(host.querySelector('.passwords-banner__text').textContent, '4 passwords to type again: they are never saved with a configuration.');
        const button = host.querySelector('button');
        assert.equal(button.type, 'button');
        assert.equal(button.textContent, 'Go to the next one');
        button.click();
        assert.equal(asked, 1);
        banner.update(1);
        assert.match(host.textContent, /^1 password to type again/);
        assert.equal(button.textContent, 'Go to it');
        banner.update(0);
        assert.equal(host.hidden, true);
    });
});
