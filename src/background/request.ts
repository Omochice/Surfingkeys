import { Result } from "@praha/byethrow";

import { httpError, type HttpError } from "../common/result";

const CHARSET_RE = /(?:charset|encoding)\s*=\s*['"]? *([\w-]+)/i;

/**
 * Thrown when a response arrives with a non-2xx status. `fetch` only rejects on network failures,
 * so this marker lets the `catch` arm distinguish an HTTP error and forward its status to
 * `httpError`.
 */
class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * Fetches a URL and decodes the body using the charset advertised in its `content-type` header
 * (falling back to UTF-8). Shared by the settings storage (snippet loading), the `request` message
 * handler, and the Gist closure, so it lives in its own module rather than inside any one concern.
 *
 * @param url - The URL to fetch.
 * @param headers - Optional request headers.
 * @param data - Optional request body; its presence switches the method to POST.
 */
export function request(
  url: string,
  headers?: Record<string, string>,
  data?: string,
): Result.ResultAsync<string, HttpError> {
  return Result.try({
    try: async () => {
      const res = await fetch(url, {
        method: data !== undefined ? "POST" : "GET",
        headers: headers ?? {},
        body: data ?? null,
      });
      if (!res.ok) {
        throw new HttpStatusError(res.status);
      }
      const charsetMatch = res.headers.get("content-type")?.match(CHARSET_RE);
      const charset = charsetMatch && charsetMatch.length > 1 ? charsetMatch[1]! : "utf-8";
      const buf = await res.arrayBuffer();
      return new TextDecoder(charset).decode(buf);
    },
    catch: (cause) =>
      httpError(url, cause, cause instanceof HttpStatusError ? cause.status : undefined),
  });
}
