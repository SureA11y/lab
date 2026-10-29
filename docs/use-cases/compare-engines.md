# Compare engines

**For** researchers and teams choosing or validating tools. **You get** the
same pages checked by several engines, side by side, each finding saying
which engine found it.

The lab scans with surea11y. The `more-engines` add-on adds axe-core, Alfa,
Pa11y (with axe-core or HTML_CodeSniffer) and QualWeb.

## Steps

1. Install the add-on and restart the server:

   ```bash
   npm run addon:install -- more-engines
   ```

2. In a workflow, add a **Merged scan** and, inside it, an **A11y scan** per
   engine, each with its **Engine** field set. The Merged scan reports them as
   one scan, findings marked by engine; a scan each, outside it, reports them
   apart.
3. Run it, and read the report with the **engine** lens, to see one engine's
   findings at a time.

## Things to know

- Engines check different things: each takes only the profiles it can
  express (axe-core a WCAG version and level, Alfa, Pa11y and QualWeb a WCAG
  level only), and only surea11y applies EN 301 549 in full. The
  step editor offers each scan the profiles its engine can check.
- The same problem found by two engines is two findings: they are not
  reconciled into one. Read differences with that in mind.
- The engines have their own licenses ([the add-on](../../addons/more-engines/README.md)).

## See also

[Engines](../engines.md): how an engine plugs in, and how to add one.
