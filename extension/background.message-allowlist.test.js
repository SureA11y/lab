'use strict';

// PING has its own reply handler (used for a manual liveness check), but the
// top-level message allowlist rejected it before it could ever be reached -
// it always got "Unsupported message" instead of the {ok:true, pong:true}
// the handler actually returns.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function loadBackgroundWithMockApi() {
    let listener = null;

    globalThis.chrome = {
        runtime: {
            onMessage: { addListener(fn) { listener = fn; } },
            sendMessage() {}
        },
        tabs: {},
        commands: null
    };
    delete globalThis.browser;

    delete require.cache[require.resolve('./background.js')];
    require('./background.js');

    return { listener };
}

describe('background: PING message', () => {
    test('reaches its handler and gets a pong reply, instead of being rejected by the allowlist', () => {
        const { listener } = loadBackgroundWithMockApi();

        let response = null;
        listener({ type: 'PING' }, {}, (res) => { response = res; });

        assert.equal(response.ok, true);
        assert.equal(response.pong, true);
        assert.equal(typeof response.when, 'number');
    });
});
