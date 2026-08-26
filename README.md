# MetaManager docs

The public documentation for [metamanager.dev](https://metamanager.dev), built
with [Mintlify](https://mintlify.com).

```sh
npm install
npm run dev        # local preview
npm test           # validate + broken links + a11y + audit
```

## What is documented

Only the public API surface: `GET /inspect`, `GET /entitlements`, `GET /health`.

`/auth/*`, `/api/*` and `/polar/webhook` are deliberately **not** documented.
They are the web application's own surface — cookie-authenticated, shaped for
the browser, and free to change without notice. `scripts/audit.mjs` fails the
build if any of them appears in the OpenAPI spec or the navigation.

## The issue reference is generated

`guides/issues.mdx` is built from the checker's own rule table:

```sh
npm run issues
```

Issue codes are a public contract, and a hand-written list would drift from it
the first time a rule changed. The generator imports `RULES` from
`platform/api/src/report/issues.js` and renders each rule against two stub
contexts — any wording that differs between them came from the page rather than
the rule, and is replaced with `N` so no invented measurement is presented as
fact.

**Re-run it after changing any rule**, or the reference will describe a checker
that no longer exists.

## This started as a clone

The site was cloned from another product's docs and rewritten. `scripts/audit.mjs`
guards against that origin leaking back in: any file mentioning the original
product fails the audit. Do not weaken that check.

## Deploying

Mintlify builds from the connected repository. There is no deploy step here.
