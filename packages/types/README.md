# @sk/types

Ambient TypeScript declarations shared across every package.
It augments built-in DOM interfaces with non-standard or not-yet-typed members the source touches, so the rest of the codebase can use them without per-file casts.

## Responsibilities

This package contributes type information only; it ships no runtime code.
The single declaration file extends the lib DOM types with the members listed below.

- `Element.scrollIntoViewIfNeeded` and `Element.setHTML` — a non-standard WebKit/Blink method and the Sanitizer API method that are absent from the bundled `lib.dom.d.ts`.
- `Event.sk_*` flags — Surfingkeys' own markers carried on dispatched events.
- `Window.find` / `Window.frameId` and `Document.dictEnabled` — non-standard globals the engine reads.

## Boundaries

The declarations are pure DOM and contain no `chrome`/WebExtension types.
This lets `@sk/core` include the file while keeping `types: []`, preserving the engine's freedom from browser-extension globals.
Each package lists this file in its tsconfig `include`, because ambient script declarations are pulled in by a program's own include list rather than through module imports.
