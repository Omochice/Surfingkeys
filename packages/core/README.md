# @sk/core

The browser-agnostic Surfingkeys engine.
It implements the modal keyboard model — what keys do — independently of any concrete WebExtension environment.

## Responsibilities

The engine owns the key-input pipeline and the editing modes and features driven by it.

## Boundaries

The engine never touches `chrome`/`browser` APIs directly.
The capabilities it needs from the host are declared as a contract and injected at composition roots, which keeps the engine testable and portable across browsers.
