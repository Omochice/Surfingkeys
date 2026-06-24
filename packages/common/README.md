# @sk/common

Domain-agnostic building blocks shared by the other packages.
It carries no Surfingkeys or WebExtension knowledge, so any layer may depend on it without inheriting heavier concerns.

## Responsibilities

The package exposes two independent entry points described below.

- `@sk/common/result` — a typed `Result` value plus factories and helpers built on `@praha/byethrow`, used to model fallible operations (for example `ChromeRuntimeError` and `domApiError`) instead of throwing.
- `@sk/common/utils` — small pure helpers such as query/regex construction and title-or-URL filtering.

## Boundaries

This is the lowest application layer above `@sk/types`.
It depends only on `@praha/byethrow` and must stay free of browser APIs and feature logic.
