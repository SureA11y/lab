#!/bin/bash
# The work of the GitHub Action in action.yml: run a spec, batch or saved
# configuration with the lab's runner, put its summary in the job's summary,
# and say what came of it. Kept as a script so it runs the same anywhere:
#
#   LAB_SPEC=specs/checkout.json LAB_OUT=out bash ci/github-action.sh
#
# Inputs (environment): LAB_SPEC (required), LAB_OUT (default a11y-out;
# {stamp} in it becomes the time),
# LAB_STORE, LAB_BASELINE, LAB_ARGS (more options, split on spaces),
# LAB_FAIL_ON (exit codes that fail the step, default "1 2 3 4 130").
# Writes GITHUB_STEP_SUMMARY and GITHUB_OUTPUT when they are set.

set -u

LAB_DIR="$(cd "$(dirname "$0")/.." && pwd)"
spec="${LAB_SPEC:?LAB_SPEC names the spec, batch spec or configuration to run}"
out="${LAB_OUT:-a11y-out}"
# {stamp} in the folder is the time, as the runner names its own: keeping
# each run's folder beside the last, in a cached store, is what lets
# --baseline auto find it next time.
out="${out//\{stamp\}/$(date -u +%Y-%m-%dT%H-%M-%S-%3NZ)}"
fail_on=" ${LAB_FAIL_ON:-1 2 3 4 130} "

args=("$spec" --out "$out")
[ -n "${LAB_STORE:-}" ] && args+=(--store "$LAB_STORE")
[ -n "${LAB_BASELINE:-}" ] && args+=(--baseline "$LAB_BASELINE")
# shellcheck disable=SC2206 # options are split on spaces on purpose
[ -n "${LAB_ARGS:-}" ] && args+=(${LAB_ARGS})

node "$LAB_DIR/src/cli/run-workflow.js" "${args[@]}"
code=$?

# A run writes summary.md in its folder; a batch, one per row's folder.
summaries=()
if [ -f "$out/summary.md" ]; then
    summaries=("$out/summary.md")
elif [ -d "$out" ]; then
    while IFS= read -r file; do summaries+=("$file"); done < <(find "$out" -mindepth 2 -maxdepth 2 -name summary.md | sort)
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
        if [ ${#summaries[@]} -eq 0 ]; then
            echo "### Accessibility run"
            echo
            echo "The run wrote no summary (exit $code): see the step's log."
        fi
        for file in "${summaries[@]}"; do
            cat "$file"
            echo
        done
    } >> "$GITHUB_STEP_SUMMARY"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
        echo "exit-code=$code"
        echo "out-dir=$out"
    } >> "$GITHUB_OUTPUT"
fi

case "$fail_on" in
    *" $code "*) echo "The accessibility run exited $code, which fails this step (fail-on: ${LAB_FAIL_ON:-1 2 3 4 130})."; exit "$code" ;;
esac
exit 0
