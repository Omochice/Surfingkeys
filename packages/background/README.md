# @sk/background

The extension background (service worker) logic.
It answers messages from content scripts and owns state that only the privileged background context can reach.

## Responsibilities

Each unit exports a map of message handlers dispatched by `message.action`, composed at the `start` root.

- Browser-data features: `bookmarks`, `history`, `tabs`, and `tabHistory`.
- Cross-cutting services: `settings` (the in-memory `BackgroundConf`), `request` (privileged HTTP), and the per-browser glue in `chrome` and `firefox`.

## Boundaries

A handler returns a value (sent as the synchronous response) or a promise (awaited and sent asynchronously).
Per-browser differences are injected as a `BrowserAdapter`, so the shared handlers stay browser-neutral.
It depends on `@sk/common` and `valibot`, and depends on neither the engine nor the content packages.
