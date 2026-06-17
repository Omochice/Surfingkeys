import { Result } from "@praha/byethrow";
import { expectDefined } from "@sk/test-support/helpers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { request } from "./request";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Builds a minimal `Response`-like object so tests stay decoupled from a real fetch. */
function fakeResponse(
  body: string,
  { ok, status, contentType }: { ok: boolean; status: number; contentType?: string },
) {
  return {
    ok,
    status,
    headers: { get: (name: string) => (name === "content-type" ? (contentType ?? null) : null) },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

describe("request", () => {
  it("decodes the body on a 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse("hello", { ok: true, status: 200 })),
    );

    const result = await request("https://example.test/ok");

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.value).toBe("hello");
    }
  });

  it("honors the charset advertised in content-type", async () => {
    // Shift_JIS bytes for "あ" (0x82 0xA0) decode to U+3042 only under that charset.
    const shiftJisBuf = new Uint8Array([0x82, 0xa0]).buffer;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name === "content-type" ? "text/plain; charset=Shift_JIS" : null),
        },
        arrayBuffer: async () => shiftJisBuf,
      })),
    );

    const result = await request("https://example.test/sjis");

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.value).toBe("あ");
    }
  });

  it("fails with status 404 instead of returning the error page as content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse("<html>not found</html>", { ok: false, status: 404 })),
    );

    const result = await request("https://example.test/missing");

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.error.kind).toBe("http");
      expect(result.error.status).toBe(404);
    }
  });

  it("fails with status 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse("<html>boom</html>", { ok: false, status: 500 })),
    );

    const result = await request("https://example.test/error");

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.error.status).toBe(500);
    }
  });

  it("fails without a status when fetch rejects on a network error", async () => {
    const cause = new TypeError("network down");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw cause;
      }),
    );

    const result = await request("https://example.test/offline");

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expectDefined(result.error);
      expect(result.error.status).toBeUndefined();
      expect(result.error.cause).toBe(cause);
    }
  });
});
