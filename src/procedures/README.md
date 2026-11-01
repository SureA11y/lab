# Procedures for what no rule evaluates

How a person assesses, by hand, the requirements that neither `@surea11y/core` nor `@surea11y/pack-en301549` has a rule for. Core and the pack give procedures only for what their rules can report on: a `cantTell` finding's steps, and the facets of the criteria and clauses they evaluate. Everything else is here, so that the lab can offer a whole standard for a manual audit. They are in English.

## How the lab shows them

The testing guide reads a standard's procedures through core, with the lab's added (`src/server-side/lab-procedures.js`), so it shows every requirement of WCAG and EN 301 549, each with its procedures:

- **WCAG criteria** no core rule evaluates: their steps join core's English dictionary, so core reads them as its own, for the criterion and for an EN 301 549 clause that restates it ("which fails EN 301 549 9.1.2.3"). Core takes a facet's tools from its own registry, so the lab adds them, and keeps a list to the tools, automation and rules asked for as core does.
- **EN 301 549's own requirements**: the pack is given to core with them in its `standard.procedures` (`en301549.js` reads `en301549.json` for each version), in the groups of the standard's chapters (chapter 4, 5 to 13, with 9.6 and 9.7 after chapter 9's principles).
- **What core or the pack gives comes first.** A WCAG facet core has steps for, and a requirement the pack gives, keep theirs.
- **In another language**, the lab's text is in English and marked so, and core counts it as missing, so the standard is complete only in English. The guide still offers the other languages, saying how many texts each shows in English ("Français (French), 299 texts in English"). A report, which reads a requirement's procedures only in a language the standard is all in, reads them in English.

A core without its procedures entry (`@surea11y/core/procedures`, 1.15) is used as it is, and the guide shows what it showed before.

| File | Holds |
|---|---|
| [`wcag.json`](wcag.json) | The 51 WCAG 2.2 criteria no core rule evaluates, with 54 facets: each criterion's `id`, `title` and `level`, and its facets' `id`, `label`, `automation`, `tools`, `steps`, `passWhen` and `failWhen`. |
| [`en301549.json`](en301549.json) | EN 301 549's own requirements, which restate no WCAG criterion and no rule evaluates: chapter 4, chapters 5 to 8, 9.6, 9.7 and 9.4.1.1 (void in V4.1.1), chapters 10, 11 and 13, and chapter 12, in V3.2.1 and V4.1.1, in the shape the pack kept them in. |
| [`en301549-annex-b.json`](en301549-annex-b.json) | Table B.2 of EN 301 549 V4.1.1 for the clause 4.2 criteria, which the V4.1.1 related-clauses facets are checked against. |
| [`en301549-annex-b-v4.1.1.md`](en301549-annex-b-v4.1.1.md) | The same table as read from the standard, with its pages, and Annex C's test for each clause 4.2 criterion. |

## Reading them

- A facet's `tools` are what it needs besides a browser: `keyboard`, `pointer`, `screen-reader`, `zoom`, `contrast-theme` and `devtools`. With none, a browser alone.
- In `wcag.json`, `{{requirement}}` in a `failWhen` is the requirement the procedure is read as, filled in when it is shown: `WCAG 1.2.3` read as the criterion, `EN 301 549 9.1.2.3` read as the clause that restates it.
- In `en301549.json`, a value that differs between versions is an object keyed by version (`{ "V3.2.1": "…", "V4.1.1": "…" }`). In a list of steps, an item that names one version only is left out of the other. `versions` on a requirement or a facet lists the versions it is in, where it isn't in both.
- A chapter 4 `related-clauses` facet takes its text from `templates`, filling in `{id}` and its own `{column}`, `{need}`, `{clauses}` and `{example}`. In V4.1.1, the clauses it names have to be ones Table B.2 marks P (primary) for the criterion, and are named chapter 9's first. The criterion then relates to the WCAG criteria that the chapter 9 clauses marked P for it restate. In V3.2.1, the clauses are named as listed, and relate to the criteria they restate.

The test beside them (`procedures.test.js`) keeps them well formed, and `src/server-side/lab-procedures.test.js` checks how core reads them.

## Where they came from

They were moved from `SureA11y/core` (`src/procedures/registry.js` and `src/i18n/procedures/en.json`) and from `SureA11y/pack-en301549` (`own-procedures.json`, `annex-b.js` and `docs/annex-b-v4.1.1.md`). Their translations into French, German, Spanish and Japanese remain in those repositories' history.

A requirement that gains a rule in core or the pack takes its procedures back there, and leaves this folder.
