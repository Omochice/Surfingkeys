# @sk/extension

The installable WebExtension itself.
It is the top-level composition root that assembles every `@sk/*` package into a Manifest V3 build for Chrome and Firefox, using [WXT](https://wxt.dev/).

## Responsibilities

The app owns the entrypoints, the build pipeline, and the manifest; it contains almost no feature logic of its own.

- Entrypoints wire packages to the WebExtension runtime: `background.ts` runs `@sk/background`'s `start`, `content.ts` runs `@sk/content`'s `start`, and the HTML files (`frontend`, `options`, `popup`, `start`) are the extension pages.
- `wxt.config.ts` builds the manifest and drives the build, including per-browser branching for permissions, minimum versions, and the `Element.setHTML` floor.
- Build-time assets and steps live here: icon generation (`generate-icons.ts`), the shared `content.css`, and the Chrome-only user-scripts `api.js` library bundle (`src/user_scripts`).

## Boundaries

This is the highest layer and depends on the runtime packages (`@sk/background`, `@sk/content`, `@sk/core`, `@sk/messaging`, `@sk/common`); no package depends back on it.
Browser selection happens here through `import.meta.env.FIREFOX` and the manifest builder, so the underlying packages stay browser-neutral.
