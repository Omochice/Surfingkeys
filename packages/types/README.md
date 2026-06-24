# @sk/types

Ambient TypeScript declarations shared across every package.
It augments built-in DOM interfaces with non-standard or not-yet-typed members the source touches, so the rest of the codebase can use them without per-file casts.

## Responsibilities

This package contributes type information only; it ships no runtime code.
It extends the lib DOM types with the non-standard and newer browser members the codebase relies on.

## Boundaries

The declarations are pure DOM and contain no `chrome`/WebExtension types.
This lets `@sk/core` include them while staying free of browser-extension globals.
