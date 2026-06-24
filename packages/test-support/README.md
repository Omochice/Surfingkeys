# @sk/test-support

Shared test scaffolding for the Vitest suites across the workspace.
It is a development-only dependency and ships in no production bundle.

## Responsibilities

The package provides the two pieces every suite touching browser globals needs.

- `setup` — a Vitest setup module that installs a minimal `chrome.*` stub (so content modules touching `chrome` at import time load under jsdom) and shims `Element.setHTML` with DOMPurify where the runtime lacks the Sanitizer API.
- `helpers` — assertion utilities such as `expectDefined`, which both checks a value and narrows it for the type checker.

## Boundaries

It depends on `vitest` and `dompurify` only, and is referenced exclusively from test configuration and test files.
