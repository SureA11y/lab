'use strict';

/**
 * Which requirements each rule checks, per version of Sample Standard: core's
 * rules and the pack's own. A scan with the standard's profile runs every
 * rule listed here, and each requirement becomes one result (a rollup) that
 * fails when one of its rules fails. `note` says why the rule checks the
 * requirement; docs and reviewers read it.
 */

const ROWS = {
  // Core's rules.
  'img-alt-present': { requirements: ['1'], note: 'An image with no alternative fails 1.' },
  'link-name-present': { requirements: ['2'], note: 'A link with no name fails 2.' },
  'heading-order': { requirements: ['5'], note: 'A skipped heading level fails 5.' },
  'page-title-present': { requirements: ['6'], note: 'A page with no title fails 6.' },
  // The pack's own.
  'sample-link-text-specific': {
    requirements: ['2'],
    note: 'A link named "read more" fails 2.'
  },
  'sample-new-window-review': {
    requirements: ['3'],
    note: 'Asks whether a link opening a new window says so.'
  },
  'sample-contrast-enhanced': {
    requirements: ['4'],
    note: 'Text below 7:1 fails 4.'
  }
};

const RULE_REQUIREMENTS = { '1.0': ROWS };

module.exports = { RULE_REQUIREMENTS };
