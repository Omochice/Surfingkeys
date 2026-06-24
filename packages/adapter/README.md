# @sk/adapter

A thin platform adapter that bridges the browser-agnostic `@sk/core` engine to the concrete WebExtension and DOM environment.

## Responsibilities

The package supplies the small, platform-specific helpers the engine cannot provide itself.

- `log` — level-gated logging that reads the `logLevels` setting from `chrome.storage.local`.
- `platform-utils` — environment glue: the `isInUIFrame` probe, issue reporting, localization loading (`initL10n`), and favicon resolution that differs between Chrome and Firefox.

## Boundaries

This package depends on `@sk/core` and touches `chrome.*`/`window`.
It concentrates the platform branching that would otherwise leak into the engine, keeping `@sk/core` free of browser globals.
