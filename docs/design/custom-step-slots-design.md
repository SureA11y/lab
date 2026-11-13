# Custom step slots — design notes

A custom step can leave places in its steps where each call puts steps of
its own. It exists for steps that are the same everywhere but for one
point: a login that one site follows with a *Trust this device* click and
another with a cookie banner; a scan that one view needs a refresh and a
click before. Without it, that point became an input and an `if` on it
(enough for "click this selector or not"), or a copy of the custom step per
variant.

## Shape

The custom step declares its places beside its inputs, and a `slot` step
among its steps says where each runs:

```json
{
  "id": "log-in",
  "inputs": [{ "name": "user", "required": true }],
  "slots": [
    { "name": "beforeSubmit", "label": "Before signing in" },
    { "name": "afterSubmit", "label": "After signing in", "required": false }
  ],
  "actions": [
    { "type": "navigate", "url": "/login" },
    { "type": "type", "selector": "#user", "text": "{var:user}" },
    { "type": "slot", "slot": "beforeSubmit" },
    { "type": "click", "selector": "#sign-in" },
    { "type": "slot", "slot": "afterSubmit" }
  ]
}
```

A call gives steps for the places it needs, each list a step of its own
type, `slotSteps`, in the call's `slots` list:

```json
{
  "type": "runCustomStep",
  "customStepId": "log-in",
  "argsJson": "{\"user\":\"admin\"}",
  "slots": [
    { "type": "slotSteps", "slot": "afterSubmit", "actions": [{ "type": "clickByText", "labelText": "Trust this device" }] }
  ]
}
```

A place's name is any name the custom step gives it; nothing ties it to a
position. The Slot step goes anywhere a step can: first, last, between any
two, inside a group, an if or a repeat (where the call's steps then run
once a pass).

## Why each list is a step

As with a switch's cases (switch-step-design.md), making each place's list
a step reuses everything the editor and the engine already do with lists of
steps: nested lists, copy and paste of the steps in them, undo, collapsing,
disabling, numbering, the walks that find passwords, depth, nested scans. A
dedicated map (`slots: {afterSubmit: [...]}`) would have needed its own
path through each of them.

## Running

- The call checks its lists against the custom step's places: steps for a
  place it does not have are refused (they would never run, unnoticed), and
  a required place needs at least one enabled step. A disabled list gives
  nothing.
- A Slot step runs the call's steps for its place, or logs that the call
  gives none and goes on.
- **Variables:** the call's steps run inside the custom step's scope, so
  they read its inputs (`{var:user}`) as well as the workflow's variables.
- **Whose steps they are:** they run as the call's own. The custom step
  call stack and the places in force are the caller's while they run, so a
  Slot step among them is the caller's place (a custom step can hand its
  own place on to one it calls), and calling the same custom step from them
  is not taken for a cycle.
- A Slot step outside a custom step, or for a place it does not declare, is
  an error; so is a `slotSteps` step anywhere but in a call's `slots`.

## Paths and counting

The call's steps are numbered under the Slot step that runs them:
`…::customStep(log-in).5.1`. The step plan walks them there, as the
engine runs them, and counts the Slot step itself like any container; a
place given nothing counts only the Slot step. The scan and screenshot
estimates count a call's steps for its places once.

## The editor

- The custom step editor has a **Steps from the call** table under its
  inputs (the inputs table without a default column): name, label,
  required. A **Slot** step chooses one of them; it is only offered in a
  custom step's steps, and a place used by two Slot steps is an error on
  the second.
- A call shows **Steps for its places**: one list for each place of the
  chosen custom step, in its order, titled with the place's label. The
  editor keeps them: they have no move, copy or remove buttons, and the
  name is their title, not a field. Choosing another custom step, or
  changing its places, brings the lists up to date.
- Only the places a call gives steps for are saved.
- A list for a place the custom step no longer has (renamed, removed)
  stays while it holds steps, titled so and flagged on validation, so no
  step is lost; an empty one goes. A required place left empty is flagged
  too.
