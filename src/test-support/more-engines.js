'use strict';

// Tests of the lab with several engines at once need the more-engines add-on
// (addons/more-engines). Without it they are skipped, and say why: the
// default install has surea11y alone, and engine-addons.test.js tests that.

const { listEngines } = require('../server-side/a11y-engine');

const installed = listEngines().engines.some((e) => e && e.id === 'axe');

module.exports = {
    MORE_ENGINES_SKIP: installed ? false : 'needs the more-engines add-on (npm run addon:install -- more-engines)',
};
