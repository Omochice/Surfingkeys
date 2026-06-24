# @sk/background

The extension background (service worker) logic.
It answers messages from content scripts and owns state that only the privileged background context can reach.

## Responsibilities

It implements the browser-data features and privileged services the content side requests.

## Boundaries

Per-browser differences are injected as an adapter so the shared handlers stay browser-neutral.
It depends on `@sk/common` and does not depend on the engine or content packages.
