# @sk/test-support

Shared test scaffolding for the Vitest suites across the workspace.
It is a development-only dependency and ships in no production bundle.

## Responsibilities

It provides the common setup that suites touching browser globals need, including the WebExtension stub and DOM shims that let content modules run under jsdom, plus shared test assertions.

## Boundaries

It is referenced exclusively from test configuration and test files.
