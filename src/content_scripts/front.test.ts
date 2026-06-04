/**
 * Tests for createFront: the factory that wires up the content-script ↔ frontend communication
 * layer.
 *
 * Isolation strategy: because createFront registers a capturing window "message" listener that
 * calls stopImmediatePropagation() for non-dictorium messages, each call to createFront would block
 * subsequent listeners registered by later tests. To isolate each test we spy on
 * window.addEventListener before calling createFront so we can capture the handler directly and
 * invoke it in-process, bypassing the stacking problem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runtime } from "./common/runtime";
import createFront from "./front";

// ---------------------------------------------------------------------------
// Mock the uiframe module so createUiHost never touches the real DOM or iframe.
// ---------------------------------------------------------------------------

vi.mock("./uiframe", () => ({
  default: vi.fn(),
}));

import Trie from "./common/trie";
// ---------------------------------------------------------------------------
// Helpers to build minimal mode stubs.
// ---------------------------------------------------------------------------
import createUiHost from "./uiframe";

function makeTrie(): Trie {
  const t = new Trie();
  t.add("a", { annotation: "test-a" });
  return t;
}

function makeInsert() {
  return {
    mappings: makeTrie(),
    enableEmojiInsertion: vi.fn(),
  };
}

function makeNormal(withLurk = false) {
  const lurk = withLurk ? { mappings: makeTrie() } : undefined;
  // Omit `repeats` so the object satisfies NormalLike under exactOptionalPropertyTypes.
  // Tests that need a non-empty repeats value assign it after construction.
  return {
    mappings: makeTrie(),
    getLurkMode: vi.fn(() => lurk),
  };
}

function makeVisual() {
  return {
    mappings: makeTrie(),
    findSentenceOf: vi.fn(() => ""),
    visualUpdate: vi.fn(),
    visualClear: vi.fn(),
    visualEnter: vi.fn(),
    emptySelection: vi.fn(),
  };
}

function makeBrowser() {
  return {};
}

// ---------------------------------------------------------------------------
// Capture the window "message" handler that createFront registers.
// front.ts registers its listener with `{capture: true}` as the third
// argument, so we spy on addEventListener to intercept exactly that call.
// ---------------------------------------------------------------------------

type MessageHandlerFn = (event: MessageEvent) => void;

function captureMessageHandler(): {
  handler: () => MessageHandlerFn | undefined;
  restore: () => void;
} {
  let captured: MessageHandlerFn | undefined;
  const origAddEventListener = window.addEventListener.bind(window);
  const spy = vi
    .spyOn(window, "addEventListener")
    .mockImplementation((type: string, listener: any, options?: any) => {
      if (type === "message" && options === true) {
        captured = listener as MessageHandlerFn;
      }
      origAddEventListener(type, listener, options);
    });
  return {
    handler: () => captured,
    restore: () => spy.mockRestore(),
  };
}

// ---------------------------------------------------------------------------
// Capture the document "surfingkeys:front" listener that createFront registers
// via initSKFunctionListener. The detail array is mutated by args.shift()
// inside the listener, so dispatching to all stacked listeners would corrupt
// later ones. Capturing it lets us call it directly, in isolation.
// ---------------------------------------------------------------------------

type SKFrontHandlerFn = (event: CustomEvent) => void;

function captureFrontSKHandler(): {
  handler: () => SKFrontHandlerFn | undefined;
  restore: () => void;
} {
  let captured: SKFrontHandlerFn | undefined;
  const origDocAddEventListener = document.addEventListener.bind(document);
  const spy = vi
    .spyOn(document, "addEventListener")
    .mockImplementation((type: string, listener: any, options?: any) => {
      if (type === "surfingkeys:front") {
        captured = listener as SKFrontHandlerFn;
      }
      origDocAddEventListener(type, listener, options);
    });
  return {
    handler: () => captured,
    restore: () => spy.mockRestore(),
  };
}

/** Invoke a captured surfingkeys:front handler with the given args, bypassing stacking. */
function invokeFrontSK(handler: SKFrontHandlerFn, args: unknown[]): void {
  handler(new CustomEvent("surfingkeys:front", { detail: args }));
}

/** Build a fake MessageEvent wrapping surfingkeys_content_data. */
function makeContentEvent(
  payload: Record<string, unknown>,
  overrides: Partial<MessageEventInit> = {},
): MessageEvent {
  return new MessageEvent("message", {
    data: { surfingkeys_content_data: payload },
    origin: window.location.origin,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Capture CustomEvents emitted on `document` for surfingkeys:* channels.
// ---------------------------------------------------------------------------

function listenForSKEvent(type: string): {
  detail: unknown[];
  cleanup: () => void;
} {
  const captured: unknown[] = [];
  const handler = (e: Event) => {
    captured.push((e as CustomEvent).detail);
  };
  document.addEventListener(`surfingkeys:${type}`, handler);
  return {
    detail: captured,
    cleanup: () => document.removeEventListener(`surfingkeys:${type}`, handler),
  };
}

// ---------------------------------------------------------------------------
// Suite: window message handler — action dispatch when _active is true
// ---------------------------------------------------------------------------

describe("createFront window message handler — action dispatch", () => {
  it("dispatches surfingkeys:user CustomEvent for executeUserCommand action", () => {
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    const { detail, cleanup } = listenForSKEvent("user");
    messageHandler(
      makeContentEvent({ action: "executeUserCommand", name: "myCmd", args: { x: 1 } }),
    );

    const lastDetail = detail[detail.length - 1] as unknown[];
    expect(lastDetail[0]).toBe("executeUserCommand");
    expect(lastDetail[1]).toBe("myCmd");
    expect(lastDetail[2]).toEqual({ x: 1 });

    cleanup();
  });

  it("calls visual.visualClear for visualClear action", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "visualClear" }));

    expect(visual.visualClear).toHaveBeenCalledOnce();
  });

  it("calls visual.emptySelection for emptySelection action", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "emptySelection" }));

    expect(visual.emptySelection).toHaveBeenCalledOnce();
  });

  it("calls visual.visualEnter with query for visualEnter action", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "visualEnter", query: "hello" }));

    expect(visual.visualEnter).toHaveBeenCalledWith("hello");
  });

  it("calls visual.visualUpdate via setTimeout for visualUpdate action", async () => {
    vi.useFakeTimers();
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "visualUpdate", query: "search" }));

    await vi.runAllTimersAsync();

    expect(visual.visualUpdate).toHaveBeenCalledWith("search");
    vi.useRealTimers();
  });

  it("visual.visualClear cancels a pending visualUpdate timer", async () => {
    vi.useFakeTimers();
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "visualUpdate", query: "search" }));
    messageHandler(makeContentEvent({ action: "visualClear" }));

    await vi.runAllTimersAsync();

    expect(visual.visualUpdate).not.toHaveBeenCalled();
    expect(visual.visualClear).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("deactivated/activated actions toggle the _active flag", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    // Deactivate: subsequent actions should NOT reach visual.
    messageHandler(makeContentEvent({ action: "deactivated" }));
    messageHandler(makeContentEvent({ action: "visualClear" }));
    expect(visual.visualClear).not.toHaveBeenCalled();

    // Re-activate via the special inactive-path for "activated".
    messageHandler(makeContentEvent({ action: "activated" }));
    messageHandler(makeContentEvent({ action: "visualClear" }));
    expect(visual.visualClear).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: addSearchAlias / getSearchSuggestions
// ---------------------------------------------------------------------------

describe("createFront addSearchAlias — getSearchSuggestions with function listSuggestion", () => {
  it("calls the listSuggestion function with the right arguments", () => {
    const { handler, restore } = captureMessageHandler();
    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    const suggestionFn = vi.fn((_response: any, _ctx: any) => ["result1", "result2"]);
    front.addSearchAlias(
      "g",
      "Google",
      "https://google.com?q=",
      "https://suggest.google.com/",
      suggestionFn,
    );

    messageHandler(
      makeContentEvent({
        action: "getSearchSuggestions",
        url: "https://suggest.google.com/",
        response: "raw",
        requestUrl: "https://suggest.google.com/?q=test",
        query: "test",
      }),
    );

    expect(suggestionFn).toHaveBeenCalledWith("raw", {
      url: "https://suggest.google.com/?q=test",
      query: "test",
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: getSearchSuggestions with non-function listSuggestion dispatches user event
// ---------------------------------------------------------------------------

describe("createFront getSearchSuggestions — non-function listSuggestion dispatches SKEvent", () => {
  it("dispatches surfingkeys:user getSearchSuggestions when listSuggestion is not a function", () => {
    const { handler, restore } = captureMessageHandler();
    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    const nonFn = { notAFunction: true };
    front.addSearchAlias(
      "w",
      "Wiki",
      "https://en.wikipedia.org/",
      "https://en.wikipedia.org/w/suggest",
      nonFn as any,
    );

    const { detail, cleanup } = listenForSKEvent("user");

    messageHandler(
      makeContentEvent({
        action: "getSearchSuggestions",
        url: "https://en.wikipedia.org/w/suggest",
        response: "raw",
        requestUrl: "https://en.wikipedia.org/w/suggest?q=test",
        query: "test",
      }),
    );

    const matchingEvent = (detail as unknown[][]).find(
      (d) => Array.isArray(d) && d[0] === "getSearchSuggestions",
    );
    expect(matchingEvent).toBeDefined();
    expect(matchingEvent?.[1]).toBe("https://en.wikipedia.org/w/suggest");

    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Suite: dialogResponse action
// ---------------------------------------------------------------------------

describe("createFront _actions[dialogResponse] — triggers onDialogResponseOk callback", () => {
  it("calls onDialogResponseOk when result is Ok", () => {
    // Capture both the window message handler and the surfingkeys:front SK handler
    // so that dispatching to them is direct and isolated from prior instances.
    const { handler: msgHandler, restore: restoreMsg } = captureMessageHandler();
    const { handler: skHandler, restore: restoreSK } = captureFrontSKHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restoreMsg();
    restoreSK();
    const messageHandler = msgHandler()!;
    const frontHandler = skHandler()!;

    const onOk = vi.fn();
    // showDialog is wired via initSKFunctionListener "front" channel.
    invokeFrontSK(frontHandler, ["showDialog", "Are you sure?", onOk]);

    messageHandler(makeContentEvent({ action: "dialogResponse", result: "Ok" }));

    expect(onOk).toHaveBeenCalledOnce();
  });

  it("does not call onDialogResponseOk when result is not Ok", () => {
    const { handler: msgHandler, restore: restoreMsg } = captureMessageHandler();
    const { handler: skHandler, restore: restoreSK } = captureFrontSKHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restoreMsg();
    restoreSK();
    const messageHandler = msgHandler()!;
    const frontHandler = skHandler()!;

    const onOk = vi.fn();
    invokeFrontSK(frontHandler, ["showDialog", "Are you sure?", onOk]);

    messageHandler(makeContentEvent({ action: "dialogResponse", result: "Cancel" }));

    expect(onOk).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: registerInlineQuery
// ---------------------------------------------------------------------------

describe("createFront registerInlineQuery — performInlineQuery dispatches user event", () => {
  let savedSendMessage: unknown;

  beforeEach(() => {
    savedSendMessage = (globalThis as any).chrome.runtime.sendMessage;
    (globalThis as any).chrome.runtime.sendMessage = vi.fn();
  });

  afterEach(() => {
    (globalThis as any).chrome.runtime.sendMessage = savedSendMessage;
  });

  it("performInlineQuery dispatches surfingkeys:user performInlineQuery after registerInlineQuery", () => {
    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    front.registerInlineQuery();

    const { detail, cleanup } = listenForSKEvent("user");
    front.performInlineQuery("hello", { top: 0, left: 0, height: 0, width: 0 }, vi.fn());

    const perfEvent = (detail as unknown[][]).find(
      (d) => Array.isArray(d) && d[0] === "performInlineQuery",
    );
    expect(perfEvent).toBeDefined();
    expect(perfEvent?.[1]).toBe("hello");

    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Suite: chooseTab delegates to RUNTIME when normal.repeats is non-empty
// ---------------------------------------------------------------------------

describe("createFront chooseTab — RUNTIME delegation", () => {
  let savedSendMessage: unknown;

  beforeEach(() => {
    savedSendMessage = (globalThis as any).chrome.runtime.sendMessage;
  });

  afterEach(() => {
    (globalThis as any).chrome.runtime.sendMessage = savedSendMessage;
  });

  it("calls RUNTIME focusTabByIndex when normal.repeats is non-empty string", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    const normal = {
      mappings: makeTrie(),
      getLurkMode: vi.fn(() => undefined),
      repeats: "3",
    };
    const front = createFront(makeInsert(), normal, null, makeVisual(), makeBrowser());

    front.chooseTab();

    const calls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "focusTabByIndex",
    );
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Suite: openOmniquery delegates correctly to openOmnibar
// ---------------------------------------------------------------------------

describe("createFront openOmniquery — shapes the call to openOmnibar", () => {
  it("calls createUiHost (triggers newFrontEnd) because openOmnibar is not hideKeystroke", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    front.openOmniquery({ query: "search term", style: "" });

    // openOmniquery -> openOmnibar -> self.command({action:"openOmnibar",...})
    // self.command sees frontendPromise==undefined, action!="hideKeystroke",
    // body!=null, so it calls newFrontEnd() which calls createUiHost.
    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: removeSearchAlias
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Suite: getAllAnnotations includes lurk mode mappings
// ---------------------------------------------------------------------------

describe("createFront showUsage / getAllAnnotations — includes lurk mode trie", () => {
  it("consults getLurkMode when building annotations for showUsage", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const normal = makeNormal(true);
    const front = createFront(makeInsert(), normal, null, makeVisual(), makeBrowser());

    front.showUsage();

    // getLurkMode was called during getAllAnnotations.
    expect(normal.getLurkMode).toHaveBeenCalled();
    // The showUsage action triggered newFrontEnd (createUiHost invoked once).
    expect(mockCreateUiHost).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: initSKFunctionListener "front" callbacks — hideKeystroke / showKeystroke
// ---------------------------------------------------------------------------

describe("createFront SKEvent front channel — hideKeystroke / showKeystroke", () => {
  it("showKeystroke triggers newFrontEnd (createUiHost) on the first keystroke", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const { handler: skHandler, restore } = captureFrontSKHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const frontHandler = skHandler()!;

    const mockMode = {
      mappings: (() => {
        const t = new Trie();
        t.add("x", { annotation: "do-x" });
        return t;
      })(),
    };
    invokeFrontSK(frontHandler, ["showKeystroke", "x", mockMode]);

    // showKeystroke calls self.command({action:"showKeystroke",...}), which
    // triggers newFrontEnd (createUiHost) on first use.
    expect(mockCreateUiHost).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: applySettingsFromSnippets — merges into runtime.conf and calls insert
// ---------------------------------------------------------------------------

describe("createFront applySettingsFromSnippets — enableEmojiInsertion propagates to insert", () => {
  let savedEmoji: boolean;

  beforeEach(() => {
    savedEmoji = runtime.conf.enableEmojiInsertion;
    runtime.conf.enableEmojiInsertion = false;
  });

  afterEach(() => {
    runtime.conf.enableEmojiInsertion = savedEmoji;
  });

  it("calls insert.enableEmojiInsertion when the snippet enables it", () => {
    const insert = makeInsert();
    const { handler: skHandler, restore } = captureFrontSKHandler();
    createFront(insert, makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const frontHandler = skHandler()!;

    invokeFrontSK(frontHandler, ["applySettingsFromSnippets", { enableEmojiInsertion: true }]);

    expect(insert.enableEmojiInsertion).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: runtime.on("focusFrame") handler
// ---------------------------------------------------------------------------

describe("createFront runtime.on focusFrame — highlights when frameId matches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "frameId");
    document.getElementById("sk_frame")?.remove();
  });

  it("appends sk_frame to documentElement when frameId matches", () => {
    const capturedHandlers: Record<string, (...args: any[]) => void> = {};
    const origOn = runtime.on.bind(runtime);
    vi.spyOn(runtime, "on").mockImplementation((msg: string, cb: (...args: any[]) => void) => {
      capturedHandlers[msg] = cb;
      origOn(msg, cb);
    });

    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    const focusFrameHandler = capturedHandlers["focusFrame"];
    if (focusFrameHandler == null) {
      return;
    }

    // jsdom does not implement scrollIntoView — stub it.
    document.body.scrollIntoView = vi.fn();

    (window as any).frameId = "frame-42";
    focusFrameHandler({ frameId: "frame-42" }, undefined, () => {});

    // The handler appends the sk_frame div to documentElement.
    const frameEl = document.getElementById("sk_frame");
    expect(frameEl).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite: window message handler — DictoriumViewReady activates when inactive
// ---------------------------------------------------------------------------

describe("createFront window message handler — DictoriumViewReady activates when inactive", () => {
  it("sets _active=true on DictoriumViewReady, enabling subsequent actions", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    // Deactivate first.
    messageHandler(makeContentEvent({ action: "deactivated" }));
    expect(visual.visualClear).not.toHaveBeenCalled();

    // Send a DictoriumViewReady message (uses dictorium_data key).
    messageHandler(
      new MessageEvent("message", {
        data: { dictorium_data: { type: "DictoriumViewReady" } },
        origin: window.location.origin,
      }),
    );

    // After DictoriumViewReady, _active should be true again.
    messageHandler(makeContentEvent({ action: "visualClear" }));
    expect(visual.visualClear).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: window message handler — activated while inactive (content_data path)
// ---------------------------------------------------------------------------

describe("createFront window message handler — activated message while inactive", () => {
  it("routes the activated message through the inactive path and re-activates", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "deactivated" }));
    messageHandler(makeContentEvent({ action: "activated" }));
    messageHandler(makeContentEvent({ action: "visualClear" }));

    expect(visual.visualClear).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: stopImmediatePropagation — not called for dictorium_data messages
// ---------------------------------------------------------------------------

describe("createFront window message handler — stopImmediatePropagation behavior", () => {
  it("does not stop propagation for dictorium_data messages", () => {
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    const stopSpy = vi.fn();
    const dictEvent = new MessageEvent("message", {
      data: { dictorium_data: { type: "SomeOtherDictoriumType" } },
      origin: window.location.origin,
    });
    Object.defineProperty(dictEvent, "stopImmediatePropagation", {
      value: stopSpy,
      writable: false,
    });

    messageHandler(dictEvent);

    // dictorium_data is present so stopImmediatePropagation must NOT be called.
    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("calls stopImmediatePropagation for surfingkeys_content_data messages", () => {
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    const stopSpy = vi.fn();
    const event = makeContentEvent({ action: "visualClear" });
    Object.defineProperty(event, "stopImmediatePropagation", {
      value: stopSpy,
      writable: false,
    });

    messageHandler(event);

    expect(stopSpy).toHaveBeenCalledOnce();
  });
});
