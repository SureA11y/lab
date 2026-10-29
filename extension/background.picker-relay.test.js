'use strict';

// Chrome/Firefox deliver a runtime.sendMessage broadcast to every registered
// onMessage listener in the extension, including the sender's own. The
// A11Y_PICKER_RESULT relay used to call runtime.sendMessage unconditionally,
// so background's own listener received its own broadcast back, matched the
// same "relay this" branch again, and rebroadcast it forever. The fix only
// relays a message that actually came from a content script (sender.tab set).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function loadBackgroundWithMockApi() {
    let listener = null;
    const sendMessageCalls = [];

    globalThis.chrome = {
        runtime: {
            onMessage: {
                addListener(fn) { listener = fn; }
            },
            sendMessage(msg) {
                sendMessageCalls.push(msg);
                // Simulate the extension re-delivering its own broadcast to this
                // same listener, exactly as the real runtime.sendMessage does.
                if (listener) listener(msg, {}, () => {});
            }
        },
        tabs: {},
        commands: null
    };
    delete globalThis.browser;

    delete require.cache[require.resolve('./background.js')];
    require('./background.js');

    return { listener, sendMessageCalls };
}

describe('background: A11Y_PICKER_RESULT relay does not loop', () => {
    test('a message from a content script (sender.tab set) is relayed exactly once', () => {
        const { listener, sendMessageCalls } = loadBackgroundWithMockApi();
        const msg = { type: 'A11Y_PICKER_RESULT', value: 'x' };

        listener(msg, { tab: { id: 1 } }, () => {});

        assert.equal(sendMessageCalls.length, 1);
        assert.deepEqual(sendMessageCalls[0], msg);
    });

    test('a message with no sender.tab (the echoed broadcast itself) is never relayed', () => {
        const { listener, sendMessageCalls } = loadBackgroundWithMockApi();
        const msg = { type: 'A11Y_PICKER_RESULT', value: 'x' };

        listener(msg, {}, () => {});

        assert.equal(sendMessageCalls.length, 0);
    });
});
