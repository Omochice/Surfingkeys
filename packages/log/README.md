# @sk/log

Logging primitives that know nothing about where log records come from or where they end up.
The level gate and the destinations are both injected, so any layer can host a logger by supplying its own gate and sinks.

## Responsibilities

It defines the log levels, the sink signature and a logger factory that consults the injected gate on every call and forwards enabled records to every sink.

## Boundaries

It must stay free of browser and WebExtension APIs.
Reading the stored log levels belongs to the layer that owns that storage, which passes the decision in as a predicate.
