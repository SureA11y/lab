'use strict';

/**
 * Sample Standard's versions and requirements. Replace them with your standard's:
 * each requirement's id is the standard's own number, its title its wording,
 * and `wcagSc` the WCAG criteria it corresponds to (none when WCAG doesn't
 * ask for it), each one a criterion of the WCAG version the standard's
 * version is built on.
 */

// Oldest first: the standard's version, and the WCAG version it is built on.
const VERSIONS = [{ version: '1.0', wcagVersion: '2.2' }];

const REQUIREMENTS = {
  '1.0': {
    1: { title: 'Images have a text alternative', wcagSc: ['1.1.1'] },
    2: { title: 'Links say where they go', wcagSc: ['2.4.4'] },
    3: { title: 'Links that open a new window say so', wcagSc: [] },
    4: { title: 'Text contrast is at least 7:1', wcagSc: ['1.4.6'] },
    5: { title: 'Headings are in order', wcagSc: [] },
    6: { title: 'Pages have a title', wcagSc: ['2.4.2'] }
  }
};

module.exports = { VERSIONS, REQUIREMENTS };
