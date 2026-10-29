# Security

## What the lab trusts

The lab is a tool for people checking sites they work on. Its server assumes
that whoever can reach it may use it:

- **It has no login.** Anyone who can reach its port can start runs, read the
  reports it keeps, and delete them.
- **It opens any http or https page it is given,** in a real browser, from the
  machine it runs on. Reachable by others, it is a way into whatever that
  machine can reach: internal sites, cloud metadata addresses.
- **Workflows run what they say.** A workflow clicks, types and navigates as
  told; a custom CSS step injects what it is given into the page. Run
  workflows you trust, against sites you are allowed to test.

What it does keep out is the web: a page open in your browser cannot use the
lab, though the lab runs on your machine.

- **Other web pages are refused.** A browser names the page behind a request
  it sends to another site (its origin). The server answers only its own
  pages, the browser extension, and the origins listed in
  `A11Y_ALLOWED_ORIGINS`. Scripts and tools, which send no origin, are not
  affected.
- **Other names are refused.** A page can also reach the server through a
  name of its own that it points at your machine (DNS rebinding). The server
  answers only to `localhost`, IP addresses, the `HOST` it listens on, and
  the names listed in `A11Y_ALLOWED_HOSTS`. Behind a reverse proxy with a
  name of its own, add that name.

So:

- The server listens on `127.0.0.1` unless `HOST` says otherwise. Keep it
  there, or put it behind something that authenticates (a reverse proxy, a VPN,
  a gateway), on a network where the pages it can reach are ones it should.
- The container image listens on all of its own interfaces, as it must to be
  reached through a published port: publish it as `-p 127.0.0.1:3000:3000`.

## Secrets

A password typed in a **Set password value** step is never saved: not in an
exported configuration, a report, a log or the queue's files. A password read
from the environment (`{"$env": "NAME"}`) is given to the browser only;
everything written keeps the variable's name. Pages scanned while logged in
can still show personal data in their screenshots and HTML: scan with test
accounts.

## Reporting a vulnerability

Please report it privately, not in a public issue: use the repository's
**Security** tab, **Report a vulnerability**
(https://github.com/SureA11y/lab/security/advisories/new).
Say what is affected, how to reproduce it, and what it lets someone do. You
will get an answer within a week, and credit in the fix if you want it.
