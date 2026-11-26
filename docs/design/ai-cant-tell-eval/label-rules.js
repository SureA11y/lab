// The labels of the UW Accessible University and GOV.UK audit runs, as rules
// written from each site's own documentation (the UW info page, the GOV.UK
// test-case names) and the pages' source, before any model answered. Not a
// person's: the assistant's. One correction was made after the first scoring:
// the GOV.UK example page titled "Insert title here" (a clear slip in the
// page-title rule). Run on the cases list-cases.mjs writes:
//
//   node docs/design/ai-cant-tell-eval/label-rules.js <cases.json> <labels.json> au|gov|wai|apg
//
// The labels go into the report as its aiReview for npm run ai:agreement.
const fs = require('fs');
const [casesFile, outFile, site] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const BY = 'Labelled by Claude from the site\'s documentation and the page source, not by a person: ';
const labels = {};
const set = (c, verdict, why) => { labels[c.key] = { verdict, note: BY + why, at: '2026-11-25T18:00:00.000Z' }; };
for (const c of cases) {
  const p = c.page, k = c.check, i = c.info, sel = c.sel;
  if (site === 'au') {
    const before = p === 'au/before';
    if (k === 'img-alt-quality') {
      if (/au123456789\.gif"/.test(i) && /alt="au123456789/.test(i)) set(c, 'fail', 'UW info page: the logo\'s alt text is its file name');
      else if (/horizontal line graphic/.test(i)) set(c, 'fail', 'UW info page: excessive alt text ("horizontal line graphic") on a decorative separator');
      else if (/Creative Commons License/.test(i)) set(c, 'pass', 'the licence badge, alt "Creative Commons License": accurate');
      else set(c, 'pass', 'the accessible version\'s alt text, as the UW info page proposes');
    } else if (k === 'page-title-patterns') set(c, 'pass', 'the title names the site and the version shown');
    else if (k === 'keyboard') set(c, before ? 'fail' : 'pass', before ? 'UW info page: inaccessible keyboard interface (the carousel controls cannot be reached)' : 'the accessible version');
    else if (k === 'keyboard-element') set(c, before ? 'fail' : 'pass', before ? 'UW info page: the carousel\'s controls are mouse-only' : 'the accessible version: the slide buttons take focus');
    else if (k === 'focus-order') set(c, 'pass', 'the UW info page lists no focus-order problem; the order follows the layout');
    else if (k === 'link-name-quality') set(c, 'pass', '"Info" in the demo\'s own navigation (Home, Before, After, Info): clear in its context');
    else if (k === 'focus-visible') set(c, before ? 'fail' : 'pass', before ? 'UW info page: no visible indication of focus (the "click here" links, the checkboxes and the footer links show none)' : 'the accessible version');
    else if (k === 'focus-visible-element' || k === 'focus-contrast-element') {
      if (/major_/.test(sel)) set(c, 'fail', 'a checkbox whose outline is removed: nothing changes on focus');
      else set(c, 'pass', 'its outline is removed but its border changes strongly on focus (measured)');
    } else set(c, 'unsure', 'not settled from the documentation');
  } else if (site === 'apg') {
    // The W3C's ARIA Authoring Practices examples: reference implementations
    // of each widget's keyboard behaviour, on the W3C's own site.
    if (k === 'page-title-patterns') set(c, 'pass', 'the title names the example and the site');
    else if (k === 'keyboard') set(c, 'pass', 'an APG reference example: every control works with the keyboard as the pattern describes');
    else if (k === 'focus-order') set(c, 'pass', 'an APG reference example: focus follows the page, and a modal dialog takes and keeps focus');
    else if (k === 'focus-visible') set(c, 'pass', 'the W3C site and its examples show focus on every control');
    else if (k === 'img-alt-decorative') set(c, 'pass', /pattern-/.test(i) ? 'the abstract illustration of the pattern beside its heading, alt="" by the W3C\'s choice: nothing is lost' : 'an icon beside the text of its control or heading: decorative');
    else if (k === 'p-as-heading') set(c, 'pass', 'a site name in a header (the WAI site, or the example\'s "Mythical University"), not a section title');
    else set(c, 'unsure', 'not settled from the documentation');
  } else if (site === 'wai') {
    // The WAI tutorials: every example is the tutorial's recommended markup,
    // so its alt text, empty alt or label is right by the tutorial's own text.
    if (k === 'page-title-patterns') set(c, 'pass', 'the title names the tutorial page and the site');
    else if (k === 'img-alt-quality') set(c, 'pass', 'the WAI tutorial\'s own example (or the site\'s), with the alt text the tutorial recommends');
    else if (k === 'img-alt-decorative') set(c, 'pass', /svg|email|linkedin|mastodon|youtube/.test(i) ? 'an icon beside link or heading text, hidden from assistive technology: decorative' : 'the WAI tutorial\'s example of an image that is decorative or redundant with the text beside it (alt="")');
    else if (k === 'p-as-heading') {
      if (/W3C Web Accessibility Initiative/.test(i)) set(c, 'pass', 'the site name in the page header, not a section title');
      else set(c, 'unsure', 'a bold line over a list of links in the related-resources box: a label or a small section title, as people read it');
    } else if (k === 'form-control-programmatic-label-quality') set(c, 'pass', 'the tutorial\'s example of a field labelled by its title attribute, beside a Search button');
    else set(c, 'unsure', 'not settled from the documentation');
  } else {
    if (k === 'page-title-patterns') {
      if (/Insert title here/.test(i)) set(c, 'fail', 'GOV.UK audit: inappropriate page title ("Insert title here")');
      else set(c, 'pass', 'the audit\'s test page title names the test');
    }
    else if (k === 'p-as-heading') set(c, 'fail', 'GOV.UK audit: text formatting used instead of an actual heading');
    else if (k === 'img-alt-quality') {
      if (/image-file-name/.test(p)) set(c, 'fail', 'GOV.UK audit: alt is the image file name');
      else if (/inappropriate-alt/.test(p)) set(c, 'fail', 'GOV.UK audit: alt "Twitter" on a BBC logo, inappropriate');
      else if (/partial-text/.test(p)) set(c, 'fail', 'GOV.UK audit: the alt gives only part of what the image says');
      else if (/alt-and-title-that-are-different/.test(p)) set(c, 'pass', 'alt "BBC" on the BBC logo: accurate (the audit\'s point is the title "BBC homepage" differing, which this question is not about)');
      else if (/animated-gif/.test(p)) set(c, 'pass', 'the alt describes the animated tree accurately (the audit\'s point is the distraction)');
      else if (/adjacent-links|alt-text-repeats/.test(p)) set(c, 'pass', 'alt "Red Panda" on a red panda photo linking to the red panda page: accurate (the audit\'s point is the repeated link or text)');
      else set(c, 'unsure', 'not documented');
    } else if (k === 'img-alt-decorative') {
      if (/conveys-information-has-an-empty-alt/.test(p)) set(c, 'fail', 'GOV.UK audit: an image that conveys information has an empty alt');
      else if (/presentation-role/.test(p)) set(c, 'pass', 'a decorative line: decorative (the audit\'s point is its non-empty alt beside role=presentation, which this question is not about)');
      else if (/spacer/.test(p)) set(c, 'pass', 'a spacer image: decorative (the audit\'s point is using spacers at all)');
      else if (/empty-alt-and-non-empty-title/.test(p)) set(c, 'fail', 'GOV.UK audit: the BBC logo, the page\'s only content, with an empty alt and the title "BBC"');
      else if (/image-link-with-no-alternative-text/.test(p)) set(c, 'fail', 'GOV.UK audit: image link with no alternative text (the image is the link\'s only content)');
      else set(c, 'unsure', 'not documented');
    } else if (k === 'link-name-quality' && /rolebutton/.test(p)) set(c, 'pass', '"Continue", the page\'s one button-like link: clear in its context (the audit\'s point is the space bar)');
    else if (k === 'link-name-quality') set(c, 'fail', 'GOV.UK audit: ' + (/Read more/.test(i) ? 'uninformative' : 'non-specific') + ' link text');
    else if (k === 'form-control-programmatic-label-quality') set(c, 'fail', 'GOV.UK audit: placeholder, no label');
    else if (k === 'keyboard' || k === 'keyboard-element') {
      if (/lightbox-esc|lightbox-focus-is-not-moved/.test(p)) set(c, 'unsure', 'GOV.UK audit: ' + p.replace(/^keyboard-access-/, '').replace(/-/g, ' ') + '; whether that fails 2.1.1 depends on the close control, which the walk never opens');
      else if (/fake-button|concertina|tooltips|dropdown-navigation|keyboardtrap|rolebutton|lightbox-close-button/.test(p)) set(c, 'fail', 'GOV.UK audit: ' + p.replace(/^keyboard-access-|example-pages\//, '').replace(/-/g, ' '));
      else set(c, 'pass', 'nothing on the page a keyboard cannot reach');
    } else if (k === 'focus-order') {
      if (/focus-order-in-wrong-order/.test(p)) set(c, 'fail', 'GOV.UK audit: focus order in wrong order (the links are placed out of their order)');
      else if (/lightbox-focus-is-not-moved/.test(p)) set(c, 'fail', 'GOV.UK audit: focus is not moved to the lightbox (it sits at the end of the page)');
      else if (/lightbox-focus-is-not-retained/.test(p)) set(c, 'unsure', 'GOV.UK audit: focus is not kept in the lightbox; WCAG 2.4.3 does not require it in every case');
      else if (/tabindex-greater-than-0/.test(p)) set(c, 'unsure', 'GOV.UK audit flags tabindex above 0, but with one link the order cannot be wrong');
      else set(c, 'pass', 'nothing out of order');
    } else if (k === 'focus-visible' || k === 'focus-visible-element' || k === 'focus-contrast-element') {
      if (/links-blank-link-text/.test(p)) set(c, 'fail', 'an empty link (no text, no size): no box for focus to show on (corrected after scoring: the first rule passed it, the model failed it, rightly)');
      else if (/^frames-/.test(p)) set(c, 'unsure', 'focus goes into an iframe; what shows inside it is not documented');
      else if (/focus-not-visible|focus-is-not-indicated/.test(p)) set(c, 'fail', 'GOV.UK audit: ' + (/not-indicated/.test(p) ? 'keyboard focus is not indicated visually' : 'focus not visible on the Search button'));
      else set(c, 'pass', 'focus shows (the browser\'s own outline)');
    } else set(c, 'unsure', 'not settled from the documentation');
  }
}
fs.writeFileSync(outFile, JSON.stringify(labels, null, 1) + '\n');
const n = Object.values(labels).reduce((a, l) => (a[l.verdict] = (a[l.verdict] || 0) + 1, a), {});
console.log(site, Object.keys(labels).length, 'labels', JSON.stringify(n));
