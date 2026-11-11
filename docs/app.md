# The lab app

The app is where workflows are built and watched, and where reports are read,
downloaded and compared. Start it with `npm start` and open
http://127.0.0.1:3000 (`PORT` and `HOST` change where it listens). It has four
tabs:

| Tab | What it is for |
| --- | --- |
| **run workflow** | Build a workflow, run it, and read its report |
| **open report** | Open saved reports: one, or several merged into one |
| **compare** | Compare reports: two side by side, or up to 24 as a dashboard |
| **queue** | Batches: many runs of a workflow, a few at a time, each kept on the server |

## Building a workflow

A workflow is the page to start on and the steps to take there. The
**Configuration** section holds what applies to the whole run:

- **URL to scan**: the page the workflow starts on.
- **Scenario name**: what the run is called, in reports and file names.
- **Run settings**, the button at the end of that line, opens them in a
  dialog; under the line a chip says what each one is, in the dialog's words
  ("Colors: Browser default"), so what the run will use is seen at a glance
  (the ones changed from their default stand out, and a chip opens the dialog
  at its setting):
  - **How the page is shown**, from the first page on: its **Viewport**
    (the window size, from a phone to a wide desktop), **Colors** (light or
    dark), **High contrast** (forced colors, as Windows' contrast themes) and
    **Language** (one from the list, or any tag or variable with Other…).
    Steps can change them as the workflow goes; their **Run default** comes
    back to these.
  - **Connection**: **Certificates**, Refuse untrusted unless you choose
    Accept untrusted, for a site whose certificate the browser does not trust
    (a test server's own, or any site on a network that checks its traffic).
    Refused, the run fails on it, says why, and offers **Run again, accepting
    this certificate**. Accepted, the browser cannot tell the site from one
    pretending to be it, so sign in only where you trust the network; the
    chip reads as a warning, and the run's log says it accepted them.

What a scan checks, its **Include selectors** and **Exclude selectors** (limit
it to the parts of the page some CSS selectors match, `main, footer`, or leave
parts out, a third-party widget, a chat button), is each scan step's own: left
out parts are blurred in its screenshots. A configuration saved with them for
the whole run opens with them on each of its scans, as the run applied them.

What a scan checks against, its **profile**, is each scan step's choice:
WCAG 2.2 at Level A, AA or AAA, or EN 301 549 (V4.1.1 or V3.2.1), WCAG 2.2 AA
unless it says otherwise. A scan can check against several at once: one WCAG
level and any of the standards, such as WCAG 2.2 AA with WAI-ARIA 1.2
([Check against a standard](use-cases/check-against-a-standard.md#several-profiles-in-one-scan)). A scan's pictures are its screenshots; for a PNG
and an MHTML copy of the page at a point of the workflow, add a **Save
evidence** step there.

![The run workflow tab: the configuration, and the first steps of a workflow that accepts the cookie banner and scans](assets/screens/app-workflow.png)

The **workflow** below is the steps, in order. There are about forty kinds:
clicking, typing, choosing from a list, waiting, scrolling, moving through
pages, changing the window size or colour scheme, and scanning; and steps
that hold others: a group, a condition, a loop over the elements a selector
finds or a list of values, a crawl that follows links, and a **Merged scan**,
whose scans are reported as one. [The step reference](step-definitions.html)
lists every step and field.

- A step can be folded, switched off without removing it, and given its own
  title; a step with a title of its own shows its kind as a small pill
  before it (*Set variable* · *1 - The start locale*). A card shows its
  Collapse button and a ⋯; its other buttons (info, switch off, move up and
  down, copy, remove) show when the pointer is on the card or focus is in
  it, and are in the ⋯ menu on a touch screen or a narrow card. A
  condition's branches read **Then** and **Otherwise (optional)**, and an
  empty list says *Nothing runs here.* with one **Add step** button.
  Its fields share the card's width, a URL, a selector, a text or a value
  on a row of its own. They check themselves as you type, and the workflow
  is checked again before it runs, so a mistake shows at the step, not
  halfway through a run.
- The **steps panel** beside the workflow lists its steps as a tree, to find
  them and go to them, and to select several to switch off, on, or change
  together. On a screen 1280px wide or more it is open each time the app
  loads, an outline that stays in view as the steps scroll; narrower, it is
  a rail at the left until shown. Selecting opens it, as steps are ticked
  there.
- **Variables** carry values between steps: read a page's text or count its
  elements into one, and use it as `{var:name}` in any field.
- **Custom steps** are workflows of your own, with inputs, used as one step:
  "log in", "accept the cookie banner", "open the product called {var:name}".
  Above the custom step editor, every custom step is a button, the one being
  edited marked: choose another to edit it. A custom step's **Inputs** are a
  table, a row each: its **Name** (what its steps read, as `{var:name}`), a
  **Label** (what a call to it shows for the input; left empty, the name in
  words: *Element screenshots* for `elementScreenshots`) and whether a call
  must give it (**Required**), with **Add input** and a remove button per
  row. They are saved as `inputs: [{name, required, label}]`.
- A password goes in **Set password value**: it is hidden on screen and never
  saved. For runs nobody watches, the step can read it from an environment
  variable instead ([the runner's guide](scheduled-scans-guide.md#passwords)).
  A configuration loaded back has its passwords empty: each step with one
  to type says **Needs password**, on its card and in the steps panel, and a
  banner at the top of the workflow says how many are left (*4 passwords to
  type again*), the workflow's and those of the custom steps it runs, with
  **Go to the next one**. Run and Dry run wait for them, and put focus on the
  first.

**Run** runs the workflow and shows its progress, step by step, with a log.
**Dry run** takes every step but the scans, screenshots and evidence, and
says which steps would fail, and where: the quick way to see whether a
workflow still fits a site that has changed.

**Export config**, in the Configuration header beside **Load config**,
downloads the workflow, with the form as you left it, as a `*.a11y-config.json`
file. **Load config** opens one, or a run spec written by
hand or by a tool; **Append config** adds one's steps to the workflow you
have. A link with the workflow in it (`?state=`) opens it in someone else's
app. What a file's steps hold that the app does not use, a key no field of
the step reads (a switch's cases under `actions`, an `if` with `selector`), is
left out, and the load says so as a warning, step by step: *Step 8 (Switch):
'actions' was not used, so 6 nested steps were left out*. The rest loads, and
a required field the file left empty shows as one at once.

## Reading a report

![A report's scan of the demo shop's products page: three failures, each with its severity, rule, occurrences and WCAG criterion, then the checks that need review](assets/screens/app-report.png)

A report has one section per scan: what failed, what passed, and what a
person still has to check, by WCAG criterion (or by the standard's own
requirements, for EN 301 549), with the elements each finding is
about, their HTML, a screenshot of each, and how to check by hand where a
person has to look. Above them, the summary: scores, what the scans covered,
and how much of the profile automated checks can reach at all.
[Reading the report](a11y-summary-ui-guide.html) goes through it part by part,
and [the metrics reference](a11y-metrics-reference.html) explains each score.

Scans can be reordered, renamed, left out of the download, and filtered by
tag and by the profile they were checked against (offered when the scans'
profiles differ); a download of the report holds the scans the filters show,
so one report can give one download per profile. A scan with some of its
profiles turned off is scored again on the ones still on, from the page
measurements the report kept, and the score says so (a report too old to keep
them shows none). Each finding lists its
criteria under their standard's name. Their findings can be grouped by WCAG principle, by WCAG level, by the
Accessibility Product Standard's KPIs, or by a grouping of your own, loaded
as a JSON file: a list of groups, each naming its requirements in WCAG or
EN 301 549 terms, or those of another installed standard, by its name as its
findings give it.

At the top of the summary, a card says how much of the run shares a layout
("61 of 62 pages share a layout, in 10 templates (largest: 41)."), counting
the templates as the review lists them, and what merging the largest one not
merged yet would do ("Merging Product pages can shorten the report from 62
scans to 22."); once groups are merged, it says what the report is now
("1 group merged: the report shows 22 scans instead of 62."). A bar shows
the templates and a stack their pages' pictures, and **Review scans** opens
the review over the report. On the left, every pattern the scans' URLs
repeat is a group, nested where one narrows another
(`/blog/accessibility/{slug}` inside `/blog/{slug}/{slug}`): a group needs
several different pages sharing the shape of their address under a fixed
part of it, on one host, and a run whose URLs repeat nothing has none. A
group is named from its pages' titles where they share something: the part
most of them end with, without the site's name ("Blog - Insights pages"),
or a word most of them have ("Product pages"); its URL pattern is the
muted line under the name, and a name you give replaces the suggestion.
Below them, the groups made by hand, the scans in no group, and the scans a
Merged scan step made.

In the middle, the selected group's pages are a grid of their screenshots,
those that differ from the others first, each with one short badge
("Differs · 8 own failures"): a page with failures few others have (its own
content's), or that lacks the template's failures, or much bigger or
smaller than the others (built otherwise, perhaps another template). Select
a picture to see it large with what it shares with the template, what is
only on that page, and the template's failures it lacks; Previous and Next,
with "3 of 41", move through the group. Tick pages (Shift selects a range)
and one row of actions says what applies to them: **Exclude** or
**Include**, **Take out of group**, and under **More**, **Group by hand…**
and **Add to group…**; **Clear selection** ends it.

On the right, the group's name, then whether it is merged, in words, and a
button that says what it covers: "Not merged · Merge all 41 pages…". It
first shows what it changes ("Scans in the report 62 → 22") to apply or
cancel; applied, the panel says "Merged · Shown as 1 scan in the report · 41
pages", the grid says so and each page in the merged scan is marked, and
**Unmerge…** undoes it the same way. Under it, what to do with the group's
pages: **Keep one page, exclude the rest…** (which asks first, listing
them), **Exclude all**, **Include all** and **Show only these** (a view,
like the tag filter: nothing is excluded, and a line in the summary shows
every scan again); then what its scans fail on most of them (the
template's, fixed once) and on a few (their content's). Merged, a failure
of the template is listed once, "On all 5 pages", a page's own failure
stays on that page ("On 2 of 5 pages"), and the report counts the group
once in its totals and the issue dispersion. The merged scan's card shows
its pages as a strip of pictures, each failure of its table says on how
many of its pages it is ("On 40 of 41 pages", "On all 41 pages"), and
**Review this group** and **Unmerge…** open the review on it; every scan in
a group says which on its card ("In Product pages · 3 of 23"), the name
opening the review there. The report keeps every scan: unmerging shows them
as they were. The review is the app's: a downloaded HTML report leaves out
its card and its buttons, a merged scan's actions among them, and keeps
what a merged scan stands for, its pages' pictures and names, how many
pages each failure is on, and the group each scan is in, as text. The scans
in no group can be shown alone, grouped by hand, or excluded after a
confirmation that lists them; they are never merged, as unrelated pages are
not a template. A scan the run merged from several contexts says "Merged by
the run" and can be unmerged into its contexts the same way, after seeing
what it changes, or have a context taken out; the review's header counts
it among the merged scans, "(by the run)". Reports saved before the lab
kept the contexts' own scans say they can't, and so do runs whose Merged
scan step had **Keep each context's scan** turned off, which keeps the
report smaller. Every change can be undone.

What you group, name, merge and change is saved with the report; its
download leaves the excluded scans out, as it always does, and keeps the
merged groups' scans, so they can be unmerged and compared page by page.
**Download merged** instead saves each merged group as the one scan it is
shown as: smaller, but for good. The conformance report, the manual
checklist and the comparisons count a merged group page by page, as it was
scanned, and say which groups the report view shows merged.

```json
[
  { "group": "Images", "WCAG": ["1.1.1"] },
  { "group": "Forms", "WCAG": ["1.3.1", "3.3.2"], "EN 301 549": ["9.3.3.2"] }
]
```

A WCAG criterion is matched exactly; an EN 301 549 clause, or another
standard's requirement, also by its number's start (`"9.3"` is every clause
under 9.3). A requirement of another
standard also counts as the WCAG criteria it corresponds to, so the WCAG
groupings group EN 301 549 scans too. An issue no group takes
goes to "Not in WCAG" when it corresponds to no WCAG criterion, and to
"Others" otherwise.

A finding's **View details** is titled with the rule's name, its rule id
under it. What all its occurrences share (what is wrong, how to fix it, the
check, why there is no picture) is said once at the top; the occurrences
follow, grouped by the page they were found on, each with its element and
the selector **Copy selector** copies.

## Downloading and sharing

**Download report** gives a package: the report as a page to read, its JSON to
open again in the app, its pictures, and the configuration it ran. Its menu
also downloads the report as a single HTML file, or with the scans the tag
and profile filters hide. [Reports and their format](report-package.md) describes the
package. A link can open a report in the app directly:
`http://127.0.0.1:3000/?report=<url of its JSON or zip>`
([how](http-api.md#opening-reports-in-the-app-by-address)).

**Download as a single file** gives the report as one HTML page. It keeps
the controls that still work without the app, as the reader's own: **Sort
scans**, **View all scans** and **Show in each scan** (findings, findings
and analysis, or failures only). Its contents list the scans by name, and
it follows the reader's light or dark scheme until they choose one with its
theme button.

**Close report**, beside the Download menu, takes the report off the screen,
once you confirm: changes made to it in the app go with it, unless it was
downloaded first.

## A conformance report

**Conformance report**, in the Download menu, gives an Accessibility
Conformance Report in the layout of the VPAT 2.5 (WCAG and EU edition), as
one HTML file: a table per WCAG level and the EN 301 549 chapters.
**Conformance report (Word)** gives the same as a `.docx`, to edit and sign
in Word. The HTML file opens with what was evaluated in a sentence (how many
pages, and the address patterns most of them share), with every page,
linked, in an appendix at its end; it follows the reader's light or dark
scheme on screen, and prints light. It starts
as a draft from the report's scans, which never says "Supports": a failure is
"Does Not Support", nothing to apply to is "Not Applicable", and the rest is
"Not Evaluated", with what the scans asked a person to check.

**Review conformance**, beside the Download menu, is where a person decides:
the product's details, and each criterion's conformance level and remarks,
over the draft. Under each criterion, **How to check it by hand** gives what a
person checks that automated checks don't decide: the steps, what passing and
failing look like, and what it takes (a keyboard, a screen reader, zoom), from
surea11y core's test procedures, where the installed core has them. EN 301
549's own requirements (chapter 4, chapter 9's 9.6 and, in V4.1.1, 9.7,
chapter 12 and the other chapters, as the report's version numbers them) have
theirs too, from the EN 301 549 pack; chapter 9's clauses are the WCAG
criteria, reviewed once. A report scanned against another installed
standard's profile has that standard's requirements of its own too, in
sections by its groups ([Standards](configuration.md#standards)). Each
check takes a result (Passes, Fails, Doesn't apply), kept in the report with
the review; once every check of a criterion has one, the dialog suggests its
level, and **Use it** sets that level, with remarks written from the answers
where you have written none. The conformance report, in HTML and in Word,
lists each criterion's answered checks under its remarks, and its evaluation
methods say how many were answered.

**Manual review checklist**, in the Download menu where the core has the
procedures, is the same for every criterion of the report's target, and EN
301 549's own requirements, as a page
to print or share: what the scans found, what has been recorded so far, and
each check a person makes, with its steps. What you record is saved in the report as you go, so its
downloads carry it, and opening the report again brings it back. **Copy the
review of another report** fills in what this report has not decided yet from
an earlier one, so a new run keeps the verdicts of the last review.

## The testing guide

**Testing guide**, the book icon in the app's header, opens in a tab of its
own: how a person checks each requirement of a standard by hand, from
surea11y core's test procedures, where the installed core has them. Choose
WCAG (2.2, 2.1 or 2.0, and its levels), EN 301 549 or another installed
standard, or the best practices, and search it. Each requirement is a card in
the standard's own groups, with a link to it to copy; each of its checks says
whether automated checks decide it, decide part of it, or leave it to a
person, what it needs (a keyboard, a screen reader, zoom…), the steps, and
what passing and failing look like. The guide opens with every check folded
to its title, to see each requirement at a glance: open one by its title, or
all of them with **Expand all** (**Collapse all** folds them again). A link
to one requirement opens its checks, and the browser's find in page opens
the check it finds a word in. **Filters**
narrow the guide to the checks that need a screen reader, say, or to what
only a person can judge, and add the technical details: the rules behind a
check, and the questions scans ask about single elements. The contents beside
it follow where you are. Once its title scrolls away, a bar at the top keeps
the logo (back to the scanner), **Expand all**, **Collapse all** and **Back
to top** in reach. Once the filters scroll away too, it says what is shown
on a **Filters** button, which opens them under the bar to change them where
you are. On a phone it also opens the contents over the page (**Contents**),
with Expand all and Collapse all. The address keeps what is chosen, so a link opens
the guide at one requirement (`/guide?standard=wcag&id=1.4.3`). **Save as a
page** downloads the same, as one page to keep or print; the colour theme is
the app's. It records nothing: results go in a report's Review conformance.

**The procedures are in English, for now.** The lab's own procedures, for
what no surea11y rule evaluates (`src/procedures/`), are in English, so no
standard is complete in another language: the guide reads every standard in
English and offers no other. A link that asks for one (`&locale=fr`) opens
the guide in English, and a note under the filters says so. A report's "How
to check it by hand" is in English too, whatever language its scans ran in.

A finding's **View details** links to the guide too, above its own steps,
which stay as they are: "The full method, in the testing guide", for each
criterion or requirement it names that the guide has, in the latest version
that has it. A downloaded report leaves these links out, since the guide is
the lab's.

## Opening saved reports

The **open report** tab opens reports saved before: their JSON, or a
package's zip. What you add opens at once; several are merged into one
report with all their scans, and stay listed, to choose which scans and
screenshots of each to keep and load again (**Load 2 reports**). A file that
is not a report does not hold the others back: it is skipped, and its row in
the list says why in plain words ("This file is not a surea11y report: it
has no page address."). Reports saved by older versions of the lab open as
they always did.

The pictures of a report from **Download report** are in its zip, not in its
JSON. A JSON taken out of the zip and opened on its own says so, in the
list of files and once it is loaded: open the zip to see them.

## Comparing reports

![The compare tab: the demo shop's release 2 against release 1, accessibility improved, with the change in failures, broken elements and kinds of problem](assets/screens/app-compare.png)

The **compare** tab takes two reports or more, from files, zips, the run
workflow tab or the queue.

- **Two reports** are compared side by side: what was fixed, what is new, what
  still fails, rule by rule and element by element, with the scores beside
  each other.
- **Three to 24** make a dashboard: what each report cleared and introduced,
  how long each problem has been open, which criteria moved, what is still
  waiting on a person, and whether each run covered enough to be compared.

Say what the reports are, **runs over time**, **versions** or **variants**,
and the comparison reads accordingly. A comparison can be named and
annotated, and downloaded as a page, or with its reports as a zip that opens
in the tab again.

When the reports were checked against more than one profile (WCAG 2.2 AA +
WAI-ARIA 1.2, say), **Profiles compared** has a switch for each profile every
report checked. Turn one off and the comparison is read on the others: a
rule's finding is what the profiles still on make of it, a requirement of a
profile turned off goes, and each report's score is counted again on what is
left, from the page measurements the report kept (a report too old to keep
them shows no score). The choice is saved in the zip.

With two profiles or more compared, the **By profile** section says how much
of the comparison each one accounts for: every broken element is put down to
the one profile that flags it, or to *More than one profile* when several do
(WCAG 2.5.8 and EN 301 549's 9.2.5.8 flag the same small targets), so the
rows add up to the comparison's broken elements (with two reports, to those
fixed, newly broken and still broken too). Beside them, under **On its own**,
is each profile read alone: its problems, failures and score, which overlap
and don't add up.

On large reports, a change (a profile turned on or off, path prefixes, what
the reports are, a report moved or removed) takes a moment to read the reports
again: the comparison dims and says it is updating until the new one is
drawn, and the activity panel lists the change when it is slow.

Pages are matched across reports by their path and query. When no page is in
every report (a site under `/v1/` beside the same one under `/v2/`), the
comparison says so, since every failure then reads as fixed or new, and reads
each report on the profiles every report checked on some page. To compare
such a site page by page, list the prefixes to leave out under **Ignore path
prefixes** (`/v1, /v2`) and choose **Match pages**; when each report sits
under a folder of its own, the tab offers those folders in one click. Only
the matching changes: the addresses shown and linked stay each report's own.
The zip keeps the prefixes, and the runner takes them as
`--ignore-path-prefix`.

## Batches and the queue

The **Batch** section runs the workflow once per row of a JSON list: each row
its own name, starting page and variables.

```json
[
  { "name": "Shoes", "url": "https://shop.example/shoes", "vars": { "product": "Shoes" } },
  { "name": "Bags",  "url": "https://shop.example/bags",  "vars": { "product": "Bags" } }
]
```

With the batch on, **Run** sends it to the **queue**, which runs as many at a
time as the batch has, up to eight (or the number set in **Runs at the same
time**), and keeps every result on the server as it finishes
(`reports/batches/<start time>/`). A run can be watched live; the whole batch
downloads as one zip and goes to the compare tab in one go. A batch whose
workflow types a password asks for it once, before it starts. Each run's
status says when it was reached, in full (*6 Nov 2026, 11:33*; a running
one when it started), and *Ran again* under it when its result came from
Run again, so a result from another day stands out from the batch's.

A run that has ended can change, while no other batch runs: in a finished
batch, and in the running one too, so a run that failed is run again or
deleted without waiting for the rest of its batch. Run again there joins
the batch's runs still waiting, ahead of them, and starts once a run ends.
The pictures a result let go there used stay until the batch is deleted: a
run still going may use them too.

- **Run again**, on a row, runs it again from the workflow it saved, with its
  row's values. The row's result stays its **active** one, the one the
  batch's totals, zip and Send to Compare use, until you choose: a re-run
  cut short by a site going down is no better than what it would replace.
  While it runs, the row shows two lines under its name: the active result,
  and the run as it goes. Once it has a result, a third line says how it
  compares (*Run again finished: 2 failing, 4 fewer than the active result;
  same 4 scans*, or *Run again did not finish*) and offers **Keep: the new
  one · the active one · both**, the suggested one in bold. The new one
  replaces the active one; the active one lets the new one go; both keeps
  the new one as a **version** of the row, the active one staying active.
  What is let go is deleted, with the pictures and evidence only it used.
  Until you choose, the row's Run again and Delete are disabled, and say
  so when pressed. If the re-run ends
  with no result (the site was down, it was cancelled), there is nothing to
  choose: the active one stays and the row says so.
  A row with versions says so under its name (**2 versions**): opened, it
  lists each of its results, the active one marked, each to open or
  download; another can be made the active one (**Make active**) or
  deleted. A row keeps five results at most. Passwords are never saved, so a workflow that types one always
  asks for it first; those still typed in the open workflow come filled in,
  to confirm or change. Each password says which one it is: the steps it
  sits inside and its own step (*In: Step 3: Group · “Second factor” ›
  Step 2*), the steps just before it, with what they type (*After: Set
  field value · Email = “jorge@shop.com”*; another password shows as
  *(hidden)*), and the runs it is for. Resuming an interrupted batch asks
  the same way.
  The batch keeps its own start, end and total time.
- **Delete**, on a row, removes it from the batch once confirmed: its result
  and its versions, and the pictures and evidence that only they used. A batch's only row is not
  deleted on its own: delete the batch instead.

Each action of a row keeps its place, so nothing moves when a run ends:
Watch and Cancel, or Open and Download, first, then Run again and Delete.
A place with nothing in it is left empty. An action held for a reason the
row does not show (another batch runs, a result to choose, the batch's
only run) is shown disabled and says why when pressed.

Whatever is deleted is gone from the batch: its folder, its zip and Send to
Compare. The configuration saved beside the batch when it started stays as it
was. A batch takes no runs added to it once it has finished: queue a new
batch instead.

The same batches run from the command line ([the runner's guide](scheduled-scans-guide.md)).
