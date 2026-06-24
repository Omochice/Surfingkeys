# @sk/common

Domain-agnostic building blocks shared by the other packages.
It carries no Surfingkeys or WebExtension knowledge, so any layer may depend on it without inheriting heavier concerns.

## Responsibilities

It provides result-handling utilities for modelling fallible operations without throwing, together with small general-purpose helpers.

## Boundaries

This is the lowest application layer above `@sk/types`.
It must stay free of browser APIs and feature logic.
