'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { createResourceSampler, processTreeRss } = require('./resource-sampler');

const PS = [
    '    1     0   1000',
    '  500     1  20000', // the browser
    '  501   500  30000', // a renderer
    '  502   500  10000', // the GPU process
    '  503   501   5000', // under a renderer
    '  900     1  99999', // something else
    'garbage line',
].join('\n');

describe('processTreeRss', () => {
    test('adds up the browser and every process under it', () => {
        assert.deepEqual(processTreeRss(PS, 500), { rssKb: 65000, processes: 4 });
    });

    test('is null when the browser is not listed', () => {
        assert.equal(processTreeRss(PS, 4242), null);
        assert.equal(processTreeRss(null, 500), null);
    });
});

describe('createResourceSampler', () => {
    test('samples Node memory, event loop and CPU, and the browser tree', async () => {
        const sampler = createResourceSampler({ browserPid: () => 500, readPs: async () => PS, platform: 'linux' });
        try {
            const s = await sampler.sample();
            assert.ok(s.heapUsedMb > 0 && s.heapLimitMb > s.heapUsedMb);
            assert.ok(s.heapPct > 0 && s.heapPct < 100);
            assert.ok(s.rssMb > 0);
            assert.ok('p99' in s.loopDelayMs && 'max' in s.loopDelayMs);
            assert.ok(s.cpuPct === null || s.cpuPct >= 0);
            assert.deepEqual(s.browser, { rssMb: 63.5, processes: 4 });
            const h = sampler.host();
            assert.equal(h.platform, 'linux');
            assert.ok(h.cpus >= 1 && h.heapLimitMb > 0);
        } finally {
            sampler.stop();
        }
    });

    test('has no browser figure without a browser, when ps fails, or on Windows', async () => {
        const cases = [
            { browserPid: () => null, readPs: async () => PS, platform: 'linux' },
            { browserPid: () => 500, readPs: async () => null, platform: 'darwin' },
            { browserPid: () => { throw new Error('gone'); }, readPs: async () => PS, platform: 'linux' },
            { browserPid: () => 500, readPs: async () => { throw new Error('should not run'); }, platform: 'win32' },
        ];
        for (const opts of cases) {
            const sampler = createResourceSampler(opts);
            try {
                assert.equal((await sampler.sample()).browser, null);
            } finally {
                sampler.stop();
            }
        }
    });
});
