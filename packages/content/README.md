# @sk/content

The content-script and user-interface layer.
It is the composition root that instantiates the `@sk/core` engine inside a real page and renders Surfingkeys' on-page UI.

## Responsibilities

The package wires the engine to the browser and owns everything the user sees.

- Composition: `content` builds the engine, `createEngineEnv` supplies the `EngineEnv` the core requires, and `settingsApplication` applies stored settings.
- UI host: `uiframe` hosts the sandboxed UI iframe and validates cross-window messages, while `front` is the in-page front controller.
- UI surfaces, built with Solid: `ui/frontend`, `ui/omnibar`, `ui/command` and `commandLine`, and the `options`/`start` extension pages.

## Boundaries

This is the top application layer and the only package that depends on the engine, adapter, and messaging together, plus `solid-js`.
It is where browser, engine, and UI are composed; lower packages must not depend back on it.
