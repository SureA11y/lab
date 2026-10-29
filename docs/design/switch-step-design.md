# Switch step — design notes

A step that picks one branch out of many by comparing a single value against a
list of cases. It exists so that routing by URL ("on this component's Examples
page, do this") or by a variable ("for this batch row, do that") reads as one
list instead of a run of separate condition steps that each repeat the subject.

## What it compares

The **subject** is read once, when the switch runs:

- **A URL part** (`subject: "url"`): the same parts as the URL condition step
  (`ifUrl`): domain name, port, path, query string, one query parameter
  (`paramName`) or fragment, read and normalized the same way
  (`src/workflow/engine/url-condition.js`).
- **A variable** (`subject: "var"`, `var: "<name>"`): the variable's value as
  text. An unset variable is "not present", like a missing query parameter.

Each **case** has a comparison (is equal to, is different from, contains, does
not contain) and a value, which supports `{var:name}`. The rules for an absent
subject are the URL condition's: it equals nothing and contains nothing, so
the negated comparisons are true for it.

## Which branch runs

**First match wins.** Cases are checked in order; the first one that matches
runs its actions and the rest are not checked. When none matches,
`defaultActions` runs (it may be empty). Exactly one branch runs, or none when
there is no default, and the log says which:
`switch: case 3 taken` / `switch: default taken`.

"Run every case that matches" was rejected: it makes the order of the cases
meaningless, makes "which branch ran" a list, and is what separate condition
steps already do.

A disabled case is skipped. A case keeps its position even when disabled, so
the numbering does not shift.

## Shape

```json
{
  "type": "switch",
  "subject": "url",
  "urlPart": "hash",
  "cases": [
    { "type": "case", "comparison": "contains", "value": "/avq-popover/examples", "actions": [] },
    { "type": "case", "comparison": "equals", "value": "/changelog", "actions": [] }
  ],
  "defaultActions": []
}
```

Each case is a step of its own type, `case`, held in the switch's `cases` list.
A case only runs as part of a switch: the engine refuses one met anywhere else.

## Why cases are steps

The step editor already handles a list of steps: adding, removing, moving up
and down, collapsing, copy and paste, undo, keyboard use and screen-reader
labels. Making each case a step reuses all of it, so the editor adapts to any
number of cases without a new kind of form. A dedicated "rows" widget was
rejected for that reason: it would have rebuilt every one of those behaviours.

The editor treats the `cases` list as one that holds only cases:

- The list offers a single "Add case" button instead of the step palette and
  shortcuts, and pasting into it only accepts a case.
- A case is left out of the step palette and the toolbar everywhere else, and
  cannot be pasted outside a `cases` list.
- A case's title shows its comparison and value ("Case · contains
  "/avq-popover/examples"") unless it has its own title, so a collapsed list
  reads as a routing table.

## Paths and the step counter

The engine numbers a case's steps under the case and the default's steps under
the switch, which is how the editor numbers them:

| Step | Path |
|---|---|
| the switch | `S` |
| step `j` of case `k` | `S.k.j` |
| step `j` of the default | `S.j` |

The case itself is not a step: it never starts or ends on its own, and the plan
does not count it. The plan records one node for the switch with the cost of
every branch; when the engine logs which branch it took (`stepEvent: "branch"`,
`taken: "case"` with `caseIndex`, or `taken: "default"`), the counter takes
back the cost of the worst branch less that of the one taken, as it does for
`if`.
