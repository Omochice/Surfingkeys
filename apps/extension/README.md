# @sk/extension

The installable WebExtension itself.
It is the top-level composition root that assembles every `@sk/*` package into a Manifest V3 build for Chrome and Firefox, using [WXT](https://wxt.dev/).

## Responsibilities

It owns the WebExtension entrypoints, the build pipeline, and the manifest, including the per-browser differences; it contains almost no feature logic of its own.

## Boundaries

This is the highest layer and depends on the runtime packages; no package depends back on it.
Browser selection happens here, so the underlying packages stay browser-neutral.
