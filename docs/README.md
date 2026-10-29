# Documentation

## Start

- [Getting started](getting-started.md): install, a first scan in the app, a
  first run from the command line, a first comparison.
- [Use cases](use-cases/README.md): some of the things the lab is good for,
  each step by step. They are a starting point, not the list: the pieces
  combine in ways no guide covers.
- [Examples](../examples/README.md): workflows, a demo shop to run them
  against, integration scripts, CI and container files, all runnable.

## Use the app

- [The lab app](app.md): building workflows, running them, reading and
  downloading reports, comparing them, batches and the queue.
- [Reading the report](a11y-summary-ui-guide.html): what each part of a report
  shows. [The metrics](a11y-metrics-reference.html): what each score means and
  how it is computed.
- [Step reference](step-definitions.html): every workflow step and its fields.

## Run without the app

- [The command-line runner](scheduled-scans-guide.md): running workflows
  unattended, baselines, exit codes, batches, secrets, scheduling. The same
  guide as a page to send someone: [unattended-scans.html](unattended-scans.html).
- [In a container](container.md): the runner, the app and a browser in one image.
- [In GitHub Actions](ci-action.md): a check on every pull request.

## Integrate

- [The HTTP API](http-api.md): start runs and take their reports from another
  tool; open reports in the app by address. Described as OpenAPI in
  `schemas/http-api.openapi.json`.
- [Reports and their format](report-package.md): what a report holds, the
  package it downloads as, occurrence ids, and the schemas for reports,
  comparisons and diffs.
- [The schemas](../schemas/): workflows (`run-spec`, `batch-spec`,
  `app-config`), results (`report`, `comparison`, `diff`) and the API. Point a
  file's `$schema` at one for completion and checking in an editor.
- [The configuration contract](configuration_contract.json): everything a tool
  needs to write valid workflows, the step catalogue included, in one
  machine-readable file: what to hand a generator, from a script to an AI
  assistant.

## Configure and extend

- [Configuration](configuration.md): environment variables, engine settings
  and add-ons.
- [Engines](engines.md): how scan engines plug in, and how to add one in an
  add-on. [More engines](../addons/more-engines/README.md): the add-on with
  axe-core, Alfa, Pa11y and QualWeb.

## Design notes

[design/](design/) keeps the reasoning behind each feature, the alternatives
considered and what was left out on purpose: a record for contributors, not a
guide. Some describe their feature as it was first built.
