# @sk/messaging

The content-script side of the messaging boundary between a page and the extension background.

## Responsibilities

It wraps the raw `chrome.runtime` messaging surface and the actions built on it, so other code reaches the background without touching the messaging API directly.

## Boundaries

It deliberately keeps the callback-based `chrome.runtime` API rather than the promise polyfill, because messages are often sent fire-and-forget and the promise form would surface dropped message ports as unhandled rejections.
It depends on `@sk/common` and `@sk/core`.
