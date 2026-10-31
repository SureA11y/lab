'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('an installed standard pack\'s profiles become targets; the lab\'s own stay as they are', () => {
    const t = require('./conformance-targets.js');
    const before = JSON.stringify(t.SCAN_TARGETS['en301549-v3.2.1']);
    const added = t.registerStandardProfiles([
        { profiles: [{ id: 'en301549-v3.2.1', label: 'Changed', wcagVersion: '2.2' }, { id: 'demo-2.0', label: 'Demo Standard 2.0', wcagVersion: '2.1' }, { id: 'Not An Id', label: 'x' }] },
    ]);
    assert.deepEqual(added, ['demo-2.0']);
    assert.equal(JSON.stringify(t.SCAN_TARGETS['en301549-v3.2.1']), before);
    assert.equal(t.scanTargetId('demo-2.0'), 'demo-2.0');
    assert.equal(t.profileId('demo-2.0'), 'demo-2.0');
    assert.deepEqual(t.resolveScanTarget({ profile: 'demo-2.0' }), { level: 'AA', version: '2.1', profile: 'demo-2.0' });
    assert.equal(t.SCAN_TARGETS['demo-2.0'].label, 'Demo Standard 2.0');
    assert.ok(t.CONFORMANCE_TARGETS['demo-2.0'], 'a standard');
    assert.deepEqual(t.registerStandardProfiles([{ profiles: [{ id: 'demo-2.0' }] }]), [], 'once');
});
