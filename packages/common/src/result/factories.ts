import type {
  ChromeRuntimeError,
  DecodeError,
  DomApiError,
  HttpError,
  UserCodeError,
} from "./types";

export const chromeRuntimeError = (op: string, cause: unknown): ChromeRuntimeError => ({
  kind: "chrome-runtime",
  op,
  cause,
});

export const userCodeError = (source: UserCodeError["source"], cause: unknown): UserCodeError => ({
  kind: "user-code",
  source,
  cause,
});

export const decodeError = (input: string, cause: unknown): DecodeError => ({
  kind: "decode",
  input,
  cause,
});

export const httpError = (url: string, cause: unknown, status?: number): HttpError => ({
  kind: "http",
  url,
  cause,
  ...(status != null ? { status } : {}),
});

export const domApiError = (op: string, cause: unknown): DomApiError => ({
  kind: "dom-api",
  op,
  cause,
});
