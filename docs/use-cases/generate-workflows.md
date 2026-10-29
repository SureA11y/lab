# Generate workflows

**For** teams who would rather produce workflows than click them together: from
a list of URLs, from end-to-end tests, from a design system's component
catalogue, or with an AI assistant. **You get** workflows a tool wrote that
are checked before they run, and that open in the app for a person to read
and correct.

A workflow is a JSON file, a **run spec**, described in full by
`schemas/run-spec.v1.schema.json`: every step, every field, every value a
field takes. Whatever writes JSON can write one.

```json
{
  "$schema": "./schemas/run-spec.v1.schema.json",
  "type": "a11y-run-spec",
  "specVersion": 1,
  "url": "https://www.example.com/",
  "actions": [
    { "type": "click", "selector": "#accept-cookies", "label": "Accept cookies" },
    { "type": "a11yScan", "label": "Home" }
  ]
}
```

## Write, check, try, run

1. **Write** the spec. With `$schema` pointing at the schema, an editor
   completes step types and fields and flags mistakes as you type.
2. **Check** it, without a browser:

   ```bash
   node src/cli/run-workflow.js generated.spec.json --check
   ```

   Every problem at once, each with where it is
   (`$.actions[2].selector …`): errors that would stop the run, and warnings
   for fields a step does not take. Exit 2 when it cannot run.
3. **Try** it against the site: `--dry-run` takes every step without
   scanning and says which would fail, and where. Exit 4 when the workflow
   does not fit the site as it stands.
4. **Run** it, or open it in the app with **Load config** to read it and
   adjust it first.

## Writing them with a script

`examples/integrations/sitemap-to-batch.js` is one: it turns a sitemap into a
batch spec. The same pattern turns other material into workflows: a list of
pages into rows, a test suite's journeys into steps, a component catalogue
into one scan per story.

## Writing them with an AI assistant

`docs/configuration_contract.json` holds what a generator needs in one file:
the formats, the rules a valid workflow follows, the catalogue of steps with
their fields, examples, and a prompt template (`promptTemplate`) to start
from. Give it to the assistant with what the workflow should do ("log in,
open the third product, add it to the cart, scan each page"), then check and
try the result as above. `--check` and `--dry-run` are what make generated
workflows safe to run: a mistake shows before any scan, with where it is.

Keep a person in the loop: open generated workflows in the app before they
run unattended, and keep them in version control like other tests.

## See also

[Step reference](../step-definitions.html) ·
[The runner's guide: the spec file](../scheduled-scans-guide.md#the-spec-file) ·
[Examples](../../examples/README.md)
