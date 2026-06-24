# @sk/messaging

The content-script side of the messaging boundary between a page and the extension background.

## Responsibilities

The package wraps the raw `chrome.runtime` messaging surface and exposes the actions built on it.

- `runtime` — `RUNTIME`, a `Result`-returning wrapper over `chrome.runtime.sendMessage`; an `onMessage` dispatch registry (`on`/`bookMessage`/`releaseMessage`); and top-frame helpers (`getTopURL`, `postTopMessage`).
- `messagingActions` — higher-level operations that issue background calls, such as `tabOpenLink` and `httpRequest`.

## Boundaries

It deliberately keeps the callback-based `chrome.runtime` API rather than the promise polyfill, because `RUNTIME` is frequently fire-and-forget and the promise form would turn every dropped message port into an unhandled rejection.
It depends on `@sk/common` for `Result` and on `@sk/core` for `conf`, `repeatCount`, and events.
