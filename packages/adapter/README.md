# @sk/adapter

A thin platform adapter that bridges the browser-agnostic `@sk/core` engine to the concrete WebExtension and DOM environment.

## Responsibilities

It supplies the small platform-specific helpers the engine cannot provide itself, concentrating browser branching that would otherwise leak into the engine.

## Boundaries

It depends on `@sk/core` and is allowed to touch `chrome.*`/`window`, keeping those platform concerns out of the engine.
