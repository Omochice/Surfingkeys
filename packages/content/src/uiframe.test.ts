import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import createUiHost from "./uiframe";

// createUiHost reaches the extension URL through chrome.runtime.getURL; the
// shared test setup stubs chrome under jsdom and getURL echoes the path back.
afterEach(() => {
  // Each createUiHost appends a host div to <html>; drop them so the next test
  // boots in isolation and lastElementChild points at its own host.
  document.documentElement.querySelectorAll(":scope > div").forEach((d) => d.remove());
});

/**
 * `onWindowMessage` is only exposed by being registered as a capture-phase window "message"
 * listener inside the iframe's load handler. Boot the host, drive the load event, and capture that
 * listener so a test can invoke it directly with a crafted event.
 */
function bootMessageHandler(): (event: MessageEvent) => void {
  let captured: ((event: MessageEvent) => void) | undefined;
  const origAdd = window.addEventListener.bind(window);
  const spy = vi
    .spyOn(window, "addEventListener")
    .mockImplementation((type: string, listener: any, opts?: any) => {
      if (type === "message" && opts === true) {
        captured = listener as (event: MessageEvent) => void;
        return;
      }
      origAdd(type, listener, opts);
    });
  createUiHost({}, vi.fn());
  const host = document.documentElement.lastElementChild as HTMLElement;
  const ifr = host.shadowRoot!.querySelector("iframe")!;
  // jsdom gives a shadow-DOM iframe no browsing context, so the load handler's
  // contentWindow is null; stub the postMessage it sends the initial frame to.
  Object.defineProperty(ifr, "contentWindow", {
    value: { postMessage: vi.fn() },
    configurable: true,
  });
  ifr.dispatchEvent(new Event("load"));
  spy.mockRestore();
  if (!captured) {
    throw new Error("window message handler was not captured");
  }
  return captured;
}

function fakeEvent(
  data: unknown,
  source: { postMessage: (...args: any[]) => void },
  stopImmediatePropagation: () => void = () => {},
): MessageEvent {
  return {
    data,
    source,
    timeStamp: 0,
    stopImmediatePropagation,
  } as unknown as MessageEvent;
}

describe("createUiHost window message handler — activeContent origin", () => {
  it("does not activate the content window when a forwarded message lacks an origin", () => {
    const onMessage = bootMessageHandler();
    const source = { postMessage: vi.fn() };

    onMessage(
      fakeEvent({ surfingkeys_uihost_data: { toFrontend: true, action: "showStatus" } }, source),
    );

    // A missing origin is not a valid postMessage targetOrigin, so the
    // activeContent branch must be skipped rather than posting to the content
    // window with an empty origin (which throws a DOMException).
    expect(source.postMessage).not.toHaveBeenCalled();
  });

  it("activates the content window when the forwarded message carries an origin", () => {
    const onMessage = bootMessageHandler();
    const source = { postMessage: vi.fn() };

    onMessage(
      fakeEvent(
        {
          surfingkeys_uihost_data: {
            toFrontend: true,
            action: "showStatus",
            origin: "https://example.com",
          },
        },
        source,
      ),
    );

    expect(source.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        surfingkeys_content_data: expect.objectContaining({ action: "activated" }),
      }),
      "https://example.com",
    );
  });

  it.each(["", "not a url"])(
    "does not activate the content window for the unusable origin %o",
    (origin) => {
      const onMessage = bootMessageHandler();
      const source = { postMessage: vi.fn() };

      onMessage(
        fakeEvent(
          { surfingkeys_uihost_data: { toFrontend: true, action: "showStatus", origin } },
          source,
        ),
      );

      expect(source.postMessage).not.toHaveBeenCalled();
    },
  );

  it("still activates a page that asks after a frame sent an unusable origin", () => {
    const onMessage = bootMessageHandler();
    const hostile = { postMessage: vi.fn() };
    const page = { postMessage: vi.fn() };

    onMessage(
      fakeEvent(
        { surfingkeys_uihost_data: { toFrontend: true, action: "showStatus", origin: "" } },
        hostile,
      ),
    );
    onMessage(
      fakeEvent(
        {
          surfingkeys_uihost_data: {
            toFrontend: true,
            action: "showStatus",
            origin: "https://example.com",
          },
        },
        page,
      ),
    );

    expect(page.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        surfingkeys_content_data: expect.objectContaining({ action: "activated" }),
      }),
      "https://example.com",
    );
  });
});

const ACTIVATION_ACTIONS = ["showStatus", "openOmnibar", "openFinder", "chooseTab"];

const actionArb = fc.oneof(
  fc.constantFrom(...ACTIVATION_ACTIONS, "initFrontendAck", "setFrontFrame", "destroyFrontendAck"),
  fc.string(),
);

/**
 * A uihost payload whose keys are each independently absent, because the handler branches on
 * absence and not merely on falsiness.
 *
 * `origin` is generated as a free string as well as a URL: the schema only requires a string, so an
 * unusable target origin is reachable from a page and must be covered.
 */
const uihostMessageArb = fc.record(
  {
    action: actionArb,
    origin: fc.oneof(fc.webUrl(), fc.string()),
    toFrontend: fc.anything(),
    toContent: fc.anything(),
    frameHeight: fc.anything(),
    pointerEvents: fc.oneof(fc.constantFrom("none", "auto"), fc.anything()),
    data: fc.anything(),
  },
  { requiredKeys: [] },
);

const envelopeArb = fc.record({ surfingkeys_uihost_data: uihostMessageArb });

const removeHosts = (): void => {
  document.documentElement.querySelectorAll(":scope > div").forEach((d) => d.remove());
};

type PostRecord = { target: unknown; payload: unknown };

const newSource = (log: PostRecord[] = []) => {
  const posts: PostRecord[] = [];
  return {
    posts,
    stub: {
      postMessage: (payload: unknown, target: unknown): void => {
        const record = { target, payload };
        posts.push(record);
        log.push(record);
      },
    },
  };
};

/**
 * `contentWindow` is replaced after {@link bootMessageHandler} has driven the load event, so the
 * recorder can be referenced with its own type instead of being read back off the element.
 */
function bootWithFrameRecorder(): {
  onMessage: (event: MessageEvent) => void;
  framePosts: PostRecord[];
} {
  const onMessage = bootMessageHandler();
  const ifr = document.documentElement.lastElementChild?.shadowRoot?.querySelector("iframe");
  if (ifr == null) {
    throw new Error("booted host has no iframe");
  }
  const framePosts: PostRecord[] = [];
  Object.defineProperty(ifr, "contentWindow", {
    value: {
      postMessage: (payload: unknown, target: unknown): void => {
        framePosts.push({ target, payload });
      },
    },
    configurable: true,
  });
  return { onMessage, framePosts };
}

const contentPayload = (payload: unknown): Record<string, unknown> | undefined => {
  if (typeof payload !== "object" || payload == null || !("surfingkeys_content_data" in payload)) {
    return undefined;
  }
  const { surfingkeys_content_data: data } = payload;
  return typeof data === "object" && data != null && !Array.isArray(data)
    ? Object.fromEntries(Object.entries(data))
    : undefined;
};

describe("createUiHost window message handler — fuzzed window messages", () => {
  // Each host owns `activeContent` and `lastStateOfPointerEvents`, so a host shared between runs
  // would let an earlier run decide a later one's branch and make a counterexample irreproducible
  // on its own.

  // This one is weaker than its name suggests: the source stubs below record a post instead of
  // validating its target origin, which a real WindowProxy does before throwing a SyntaxError. It
  // covers the handler's own logic, not every way a post out of it can fail.
  it("never throws on arbitrary message data", () => {
    fc.assert(
      fc.property(fc.oneof(fc.anything(), fc.jsonValue(), envelopeArb), (data) => {
        const { onMessage } = bootWithFrameRecorder();
        try {
          onMessage(fakeEvent(data, newSource().stub));
        } finally {
          removeHosts();
        }
      }),
    );
  });

  it("ignores a message without the uihost envelope and lets it propagate", () => {
    const withoutEnvelope = fc
      .oneof(fc.anything(), fc.jsonValue())
      .filter(
        (data) => typeof data !== "object" || data == null || !("surfingkeys_uihost_data" in data),
      );

    fc.assert(
      fc.property(withoutEnvelope, (data) => {
        const { onMessage, framePosts } = bootWithFrameRecorder();
        const source = newSource();
        const stopImmediatePropagation = vi.fn();
        try {
          onMessage(fakeEvent(data, source.stub, stopImmediatePropagation));
          expect(source.posts).toEqual([]);
          expect(framePosts).toEqual([]);
          // A message the handler does not own belongs to the page, so it must not be swallowed.
          expect(stopImmediatePropagation).not.toHaveBeenCalled();
        } finally {
          removeHosts();
        }
      }),
    );
  });

  it("consumes every message carrying the uihost envelope", () => {
    fc.assert(
      fc.property(envelopeArb, (data) => {
        const { onMessage } = bootWithFrameRecorder();
        const stopImmediatePropagation = vi.fn();
        try {
          onMessage(fakeEvent(data, newSource().stub, stopImmediatePropagation));
          expect(stopImmediatePropagation).toHaveBeenCalled();
        } finally {
          removeHosts();
        }
      }),
    );
  });

  it("does not activate the content window for any forwarded action when origin is absent", () => {
    const withoutOrigin = fc.record(
      {
        surfingkeys_uihost_data: fc.record({
          action: actionArb,
          toFrontend: fc.anything().filter((value) => Boolean(value)),
        }),
      },
      { requiredKeys: ["surfingkeys_uihost_data"] },
    );

    fc.assert(
      fc.property(withoutOrigin, (data) => {
        const { onMessage, framePosts } = bootWithFrameRecorder();
        const source = newSource();
        try {
          onMessage(fakeEvent(data, source.stub));
          expect(source.posts).toEqual([]);
          expect(framePosts.length).toBe(1);
        } finally {
          removeHosts();
        }
      }),
    );
  });

  it("keeps at most one content window active across arbitrary message sequences", () => {
    const stepArb = fc.record({ envelope: envelopeArb, sourceIndex: fc.nat({ max: 2 }) });

    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 12 }), (steps) => {
        const { onMessage } = bootWithFrameRecorder();
        const log: PostRecord[] = [];
        const sources = [newSource(log), newSource(log), newSource(log)];
        try {
          steps.forEach(({ envelope, sourceIndex }, at) => {
            // A forwarded `toContent` payload is the attacker's own object, which may itself claim
            // `action: "activated"`. Tagging every generated payload tells the two apart.
            const tagged = {
              surfingkeys_uihost_data: {
                ...envelope.surfingkeys_uihost_data,
                probeId: `step-${at}`,
              },
            };
            onMessage(fakeEvent(tagged, sources[sourceIndex]?.stub ?? newSource(log).stub));
          });

          let active = 0;
          log.forEach((record) => {
            const data = contentPayload(record.payload);
            if (data == null || "probeId" in data) return;
            if (data["action"] === "activated") active += 1;
            if (data["action"] === "deactivated") active -= 1;
            expect(active).toBeGreaterThanOrEqual(0);
            expect(active).toBeLessThanOrEqual(1);
          });

          const probe = { surfingkeys_uihost_data: { toContent: true, probeId: "probe" } };
          onMessage(fakeEvent(probe, newSource(log).stub));
          const reached = sources.filter((source) =>
            source.posts.some((record) => contentPayload(record.payload)?.["probeId"] === "probe"),
          );
          expect(reached.length).toBeLessThanOrEqual(1);
        } finally {
          removeHosts();
        }
      }),
    );
  });

  /** `postMessage` rejects any target origin that is neither a wildcard nor an absolute URL. */
  const isUsableTargetOrigin = (target: unknown): boolean =>
    target === "*" || target === "/" || (typeof target === "string" && URL.canParse(target));

  it("only ever posts to a content window with a usable target origin", () => {
    fc.assert(
      fc.property(fc.array(envelopeArb, { maxLength: 8 }), (envelopes) => {
        const { onMessage } = bootWithFrameRecorder();
        const log: PostRecord[] = [];
        try {
          envelopes.forEach((data) => {
            onMessage(fakeEvent(data, newSource(log).stub));
          });
          expect(log.filter((record) => !isUsableTargetOrigin(record.target))).toEqual([]);
        } finally {
          removeHosts();
        }
      }),
    );
  });
});
