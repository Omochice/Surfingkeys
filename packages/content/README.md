# @sk/content

The content-script and user-interface layer.
It is the composition root that instantiates the `@sk/core` engine inside a real page and renders Surfingkeys' on-page UI.

## Responsibilities

It wires the engine to the browser and owns everything the user sees on the page, including the omnibar and the other UI surfaces built with Solid.

## Boundaries

This is the top application layer and the only package that depends on the engine, adapter, and messaging together.
It is where browser, engine, and UI are composed; lower packages must not depend back on it.
