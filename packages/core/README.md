# @sk/core

The browser-agnostic Surfingkeys engine.
It implements the modal keyboard model — what keys do — independently of any concrete WebExtension environment.

## Responsibilities

The engine owns the input pipeline and the features driven by it, grouped below.

- Modes and the mode graph: `mode`, `modeGraph`, `normal`, `visual`, `insert`, together with mode-specific concerns such as `specialKeys` and `scrollDetection`.
- Key handling: `trie`, `keyboardUtils`, `keymap`, `repeatCount`, the public mapping API (`api`), and the default mappings and configuration (`default`, `applyDefaultMappings`, `conf`).
- Feature behaviour: `hints`, `clipboard`, `cursorPrompt`, `observer`, and the shared `utils`/`events`.

## Boundaries

The engine never imports `chrome`/`browser` seams directly.
The capabilities it needs from the host — messaging, URL resolution, logging, the UI-frame check — are declared as the `EngineEnv` contract in `engineEnv.ts` and injected at composition roots.
Concrete implementations live in `@sk/adapter`, `@sk/messaging`, and `@sk/content`.
This keeps the engine testable and portable across browsers.
