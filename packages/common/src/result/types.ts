/**
 * Tagged union covering every failure mode we currently catch across the extension. Lower layers
 * return `Result<T, SkError>`; the presentation layer decides whether and how to surface each
 * variant to the user.
 */
export type SkError = ChromeRuntimeError | UserCodeError | DecodeError | HttpError | DomApiError;

export type ChromeRuntimeError = {
  readonly kind: "chrome-runtime";
  readonly op: string;
  readonly cause: unknown;
};

export type UserCodeError = {
  readonly kind: "user-code";
  readonly source: "snippet" | "callback" | "command";
  readonly cause: unknown;
};

export type DecodeError = {
  readonly kind: "decode";
  readonly input: string;
  readonly cause: unknown;
};

export type HttpError = {
  readonly kind: "http";
  readonly url: string;
  readonly status?: number;
  readonly cause: unknown;
};

export type DomApiError = {
  readonly kind: "dom-api";
  readonly op: string;
  readonly cause: unknown;
};
