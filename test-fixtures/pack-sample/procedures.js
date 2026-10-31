'use strict';

/**
 * How a person assesses each of Sample Standard's requirements by hand, per
 * version: what proceduresFor gives for a requirement (core's
 * docs/PROCEDURES.md), and the help a manual review or a conformance report
 * reads. Each requirement takes one of three forms:
 *
 * - { wcag: '<criterion>' }: it restates a WCAG criterion, and takes that
 *   criterion's facets and procedures, in every language core has them.
 * - { wcag, replace: { <facet>: { tools, steps, passWhen, failWhen } } }:
 *   it restates a criterion but tests some of its facets its own way. The
 *   facets are core's (src/coverage/wcag-facets.js, or proceduresFor of the
 *   criterion), and a facet named here shows these steps instead of core's
 *   when the requirement is read; read as WCAG, the criterion stays core's.
 * - { facets: [{ id, label, automation, tools, steps, passWhen, failWhen }] }:
 *   a requirement of its own, with the test objectives a person checks.
 *   relatesTo may name the WCAG criteria it relates to without restating
 *   any, which relatedRequirements reads both ways.
 *
 * Steps are short, in English, for someone without accessibility training,
 * from a whole page in a browser; passWhen and failWhen say what they see,
 * and failWhen names the requirement it fails: as written here, or as
 * {{requirement}}, which reads as the standard's name and the requirement
 * ("Sample Standard 6"), as core's procedures do. tools lists what they need
 * besides a browser: keyboard, pointer, screen-reader, zoom, contrast-theme,
 * devtools.
 *
 * GROUPS puts the requirements of each version in groups, such as themes or
 * chapters, as listProcedures and procedureChecklist show them.
 */

const PROCEDURES = {
  '1.0': {
    1: { wcag: '1.1.1' },
    2: { wcag: '2.4.4' },
    3: {
      facets: [
        {
          id: 'new-window-warned',
          label: 'A link that opens a new window says so before it is followed',
          automation: 'manual',
          tools: ['devtools', 'screen-reader'],
          steps: [
            'Find each link that opens a new window or tab: in the developer tools, search the page for target="_blank", and follow the links that look as if they might.',
            'For each, look at the link and listen to it with a screen reader for a word or icon that says it opens a new window.'
          ],
          passWhen: 'Every link that opens a new window says so, on screen and to a screen reader.',
          failWhen: 'A link opens a new window without saying so, which fails requirement 3.'
        }
      ]
    },
    4: { wcag: '1.4.6' },
    5: {
      // WCAG doesn't ask for it (requirements.js maps it to no criterion), but
      // it is about the same structure as 1.3.1.
      relatesTo: ['1.3.1'],
      facets: [
        {
          id: 'heading-levels-in-order',
          label: 'Heading levels go down one at a time',
          automation: 'partial',
          tools: ['devtools'],
          steps: [
            "List the page's headings in order, with their levels: a browser extension that outlines headings, or the developer tools' accessibility tree.",
            'Check that the first is a level 1 heading and that each following heading is at most one level deeper than the one before it.'
          ],
          passWhen:
            'The page starts with a level 1 heading and no heading skips a level going down.',
          failWhen: 'A heading skips a level (an h2 followed by an h4), which fails requirement 5.'
        }
      ]
    },
    6: {
      wcag: '2.4.2',
      replace: {
        'page-title-descriptive': {
          steps: [
            "Read the page's title: the text on its browser tab, or the <title> element in the developer tools.",
            'Check that it names the page first, then the site, separated by a dash ("Offers - Shop").'
          ],
          passWhen: 'The title names the page, then the site.',
          failWhen:
            'The title is missing, names only the site, or puts the site first, which fails requirement 6.'
        }
      }
    }
  }
};

const GROUPS = {
  '1.0': [
    { id: 'content', title: 'Content', requirements: ['1', '4', '5', '6'] },
    { id: 'links', title: 'Links', requirements: ['2', '3'] }
  ]
};

module.exports = { PROCEDURES, GROUPS };
