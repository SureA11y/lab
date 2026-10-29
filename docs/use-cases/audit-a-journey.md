# Audit a user journey

**For** accessibility specialists, QA and anyone asked "how accessible is our
checkout?". **You get** a report with a scan of every state the journey goes
through, each failure tied to its element and criterion, and what a person
still has to check.

Pages are rarely the problem on their own: the cookie banner covers the
content, the menu only exists once opened, the error only after a wrong
entry, the cart only with something in it. A workflow takes the browser
through the journey and scans each state on the way.

## Steps

1. Start the app (`npm start`, http://127.0.0.1:3000) and set **URL to scan**
   to where the journey starts. Each scan step's **Profile** is what you
   report against, WCAG 2.2 AA unless you choose another.
2. Build the journey with steps, scanning after each state worth checking.
   For a shop:

   | Step | Fields |
   | --- | --- |
   | Click | `#accept-cookies` |
   | A11y scan | label `Home` |
   | Click by text | `Products`, inside `header nav` |
   | Wait for selector | `.products` |
   | A11y scan | label `Product list`, context `main` |
   | Click by text | `Canvas shoes` |
   | Click | `#add-to-cart` |
   | A11y scan | label `Added to the cart` |

   `examples/specs/shopping-flow.spec.json` is this journey on the demo shop:
   open it with **Load config**.
3. Press **Dry run** to see that every step finds what it needs, then
   **Run**.
4. Read the report. Each scan is one state; its findings say what failed,
   where and against which criterion, and **needs review** lists what the
   checks could not decide and a person has to.
5. **Download report** to hand it on: a page to read, and the JSON to open
   again.

## Variations

- Limit a scan to the part of the page the state changed (a dialog, a menu)
  with its **context**, so findings are not repeated from the page behind.
- Scan a state under several conditions: a **Set viewport** step for a phone,
  **Set color scheme and contrast** for dark mode, **Emulate vision deficiency**, each
  followed by a scan.
- Group repeated steps (log in, accept the banner) into a **custom step**, and
  use it in every journey.
- Export the workflow (**Export config**) and run it again after the fixes:
  the [comparison](compare-releases-and-environments.md) says what changed.

## See also

[The lab app](../app.md) · [Step reference](../step-definitions.html) ·
[Reading the report](../a11y-summary-ui-guide.html)
