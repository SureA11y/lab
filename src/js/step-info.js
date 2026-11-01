// What a step's info dialog says: the step, its fields, and the context it
// runs in. Moved out of actions-builder.module.js's createActionsBuilder;
// what it shares with the rest of the editor it reaches through `builder`.

import {createEl} from './a11y-ui.utils.js';

/**
 * builder: accessors for what the rest shares with this part
 * (nothing).
 */
export function createStepInfo(builder) {
    // ---- Info dialog builders ----
    function escapeInfoHtml(s) {
        return String(s).replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
    }

    function buildGlobalContextHelp(_actionKey) {
        const wrap = document.createElement("div");
        const ul = document.createElement("ul");
        ul.innerHTML = [
            "<li><code>:ctx</code> in selectors refers to the current element when inside <code>forEachElement</code>. Example: <code>:ctx .title</code></li>",
            "<li>Iteration variables are available inside many string fields:",
            "<ul>",
            "<li><code>{index}</code> zero-based index, starts at 0</li>",
            "<li><code>{oneBased}</code> one-based index, starts at 1</li>",
            "<li><code>{total}</code> total iterations when known</li>",
            "</ul>",
            "</li>",
            "<li>Examples:",
            "<ul>",
            "<li>Selector using context: <code>:ctx a.item-{oneBased}</code></li>",
            "<li>Label templating: <code>Item {oneBased} of {total}</code></li>",
            "</ul>",
            "</li>",
            "<li>Workflow variables:",
            "<ul>",
            "<li>Use <code>{var:name}</code> in any string field to insert a variable set earlier with <code>getText</code>, <code>getCount</code> or <code>setVar</code></li>",
            "<li>Number fields (for example <code>repeat</code> repetitions) also accept <code>{var:name}</code>. The value is turned into a number when the step runs, so text such as <code>5</code> works too</li>",
            "<li>Inside <code>forEachElement</code>, variables set during the current iteration override global variables of the same name</li>",
            "</ul>",
            "</li>"
        ].join("");
        wrap.appendChild(createEl("h5", {}, "Context and variables"));
        wrap.appendChild(ul);
        return wrap;
    }

    function buildActionInfoContent(actionKey, actionDef) {
        const body = document.createElement("div");

        if (actionDef.description) {
            body.appendChild(createEl("p", {}, actionDef.description));
        }

        const fields = actionDef.fields || {};
        const names = Object.keys(fields);
        if (names.length) {
            // A field's example, or for a switch or a list of choices, which
            // an example says little about, its default, marked as such.
            const exampleHtml = (def) => {
                if (def.example != null && String(def.example).trim() !== "") {
                    return `<code>${escapeInfoHtml(String(def.example))}</code>`;
                }
                const choices = def.type === "boolean" || Array.isArray(def.options) || Array.isArray(def.enum);
                if (choices && def.default != null && String(def.default) !== "") {
                    return `<code>${escapeInfoHtml(String(def.default))}</code> <span class="sb-action-info__default">(default)</span>`;
                }
                return "";
            };
            const anyExamples = names.some((n) => exampleHtml(fields[n] || {}) !== "");

            const table = document.createElement("table");
            table.setAttribute("aria-label", "Fields");
            table.className = "sb-action-info__fields";

            // Fixed widths, Description the widest: it says the most.
            const widths = anyExamples ? [16, 11, 9, 44, 20] : [18, 12, 10, 60];

            table.innerHTML = [
                "<colgroup>",
                widths.map((w) => `<col style="width: ${w}%">`).join(""),
                "</colgroup>",
                "<thead><tr>",
                "<th scope=\"col\">Field</th>",
                "<th scope=\"col\">Type</th>",
                "<th scope=\"col\">Required</th>",
                "<th scope=\"col\">Description</th>",
                anyExamples ? "<th scope=\"col\">Example</th>" : "",
                "</tr></thead>",
                "<tbody></tbody>"
            ].join("");

            const tbody = table.querySelector("tbody");

            names.forEach((name) => {
                const def = fields[name] || {};
                const type = String(def.type || "any");
                const required = def.required ? "yes" : "no";
                const desc = def.description ? String(def.description) : "";
                const alias = (fields[name] && fields[name].alias) ? String(fields[name].alias) : "";

                const tr = document.createElement("tr");
                tr.innerHTML = [
                    `<td><strong>${escapeInfoHtml(alias || name)}</strong></td>`,
                    // "string | string[]", so a long type wraps between its parts.
                    `<td><code>${escapeInfoHtml(type.split("|").join(" | "))}</code></td>`,
                    `<td>${required}</td>`,
                    `<td>${escapeInfoHtml(desc)}</td>`,
                    anyExamples ? `<td>${exampleHtml(def)}</td>` : ""
                ].join("");
                tbody.appendChild(tr);
            });

            body.appendChild(createEl("h5", {}, "Fields"));
            body.appendChild(table);
        }

        const extras = document.createElement("div");
        const optionLines = [];
        Object.entries(actionDef.fields || {}).forEach(([name, def]) => {
            if (Array.isArray(def.options) || Array.isArray(def.enum)) {
                const opts = (def.options || def.enum).map((o) => {
                    if (typeof o === "object") return String(o.label ?? o.value);
                    return String(o);
                });
                optionLines.push(`<li><code>${name}</code>: ${opts.join(", ")}</li>`);
            }
        });
        if (optionLines.length) {
            extras.appendChild(createEl("h5", {}, "Allowed values"));
            const ul = document.createElement("ul");
            ul.innerHTML = optionLines.join("");
            extras.appendChild(ul);
            body.appendChild(extras);
        }

        if (Array.isArray(actionDef.examples) && actionDef.examples.length) {
            body.appendChild(createEl("h5", {}, "Use cases"));
            const ul = document.createElement("ul");
            actionDef.examples.forEach((ex) => {
                const li = document.createElement("li");
                const title = typeof ex === "string" ? ex : ex.title || "";
                li.textContent = title;
                ul.appendChild(li);
            });
            body.appendChild(ul);

            const codeSnippets = actionDef.examples
                .map((ex) => (ex && typeof ex === "object" && ex.snippet ? ex.snippet : null))
                .filter(Boolean);
            if (codeSnippets.length) {
                const codeWrap = document.createElement("div");
                codeWrap.className = "sb-action-info__examples";
                codeWrap.appendChild(createEl("p", {}, "Example snippets:"));
                codeSnippets.forEach((snippet) => {
                    const pre = document.createElement("pre");
                    const code = document.createElement("code");
                    code.textContent =
                        typeof snippet === "string"
                            ? snippet
                            : JSON.stringify(snippet, null, 2);
                    pre.appendChild(code);
                    codeWrap.appendChild(pre);
                });
                body.appendChild(codeWrap);
            }
        }

        body.appendChild(buildGlobalContextHelp(actionKey));
        return body;
    }

    return {
        buildActionInfoContent,
    };
}
