# Check behind a login

**For** anyone whose important pages are behind an account. **You get**
workflows that log in, with the password kept out of every file: the
workflow, its saved configuration, the report and the logs.

## In the app

Add a **Set password value** step for the password field. Its value is hidden
on screen and never saved: an exported configuration records only that a
value is needed, and asks for it again when loaded. Fine for runs you start
yourself.

## For runs nobody watches

The step can name an environment variable instead of holding the password:

```json
{ "type": "setPassword", "selector": "#password", "value": { "$env": "SHOP_PASSWORD" } }
```

Whatever runs the workflow reads the variable as the run starts and gives the
value to the browser only; everything written keeps the reference.

```bash
SHOP_PASSWORD='…' node src/cli/run-workflow.js examples/specs/login.spec.json
```

A variable that is not set stops the run before a browser opens, saying which.
`--check` warns about it, since the machine that checks a workflow is not
always the one that runs it.

| Where the run happens | Where the variable comes from |
| --- | --- |
| Command line | Your shell, a scheduler's environment, a secrets manager's wrapper |
| GitHub Actions | The step's `env`, from the repository's secrets ([CI guide](../ci-action.md)) |
| Container | `docker run -e SHOP_PASSWORD …` |
| The app, or its queue | The environment of the lab's server |

In the app, such a field shows "From the environment: SHOP_PASSWORD"; typing
a value replaces the reference for that run.

## Tips

- Use a test account made for checking, with no real data behind it.
- Put the login in a custom step, and use it at the start of every workflow.
- Check the login page itself too: it is often where the worst problems are
  (`examples/specs/login.spec.json` scans it before logging in).

## See also

[The runner's guide: passwords](../scheduled-scans-guide.md#passwords)
