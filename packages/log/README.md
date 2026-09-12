# @sk/log

Logging primitives that know nothing about where log records come from or where they end up.
The level gate and the destinations are both injected, so any layer can host a logger by supplying its own gate and sinks.

## Responsibilities

It defines the log levels, the sink signature, a logger factory that consults the injected gate on every call and forwards enabled records to every sink, and a host factory pairing such a logger with the list of sinks it writes to.
Behind subpath exports it also ships an OTLP/HTTP sink, a helper turning uncaught errors and rejections into records, and the envelope one context uses to relay records to another.

## Boundaries

It must stay free of WebExtension APIs; `fetch` and the DOM event interface are the only platform surfaces it touches.
Reading the stored log levels belongs to the layer that owns that storage, which passes the decision in as a predicate.
Sending a relayed record belongs to the layer that owns the messaging channel; this package only defines what travels.
