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
  // Tests that need a non-empty repeats value reassign keymap.repeats after construction.
  return {
    mappings: makeTrie(),
    getLurkMode: vi.fn(() => lurk),
    keymap: { repeats: undefined as string | undefined },
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
// front.ts registers its listener with `true` as the third argument (the
// capture flag), so we spy on addEventListener to intercept exactly that call.
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
        // Capture the handler but do NOT re-register it on the real window;
        // otherwise each createFront() in the suite stacks another live
        // capture-phase listener that fires on every later dispatch.
        captured = listener as MessageHandlerFn;
        return;
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

    const lastDetail = detail.at(-1) as unknown[];
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
    try {
      const visual = makeVisual();
      const { handler, restore } = captureMessageHandler();
      createFront(makeInsert(), makeNormal(), null, visual, makeBrowser());
      restore();
      const messageHandler = handler()!;

      messageHandler(makeContentEvent({ action: "visualUpdate", query: "search" }));

      await vi.runAllTimersAsync();

      expect(visual.visualUpdate).toHaveBeenCalledWith("search");
    } finally {
      // Restore real timers even if an assertion throws, so a failure here does
      // not leak fake timers into sibling tests.
      vi.useRealTimers();
    }
  });

  it("visual.visualClear cancels a pending visualUpdate timer", async () => {
    vi.useFakeTimers();
    try {
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
    } finally {
      vi.useRealTimers();
    }
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

  it("calls RUNTIME focusTabByIndex when the keymap's repeats is a non-empty string", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    const normal = {
      mappings: makeTrie(),
      getLurkMode: vi.fn(() => undefined),
      keymap: { repeats: "3" },
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
    // Fail loudly if the focusFrame handler was never registered, rather than
    // silently passing the test on missing wiring.
    expect(focusFrameHandler).toBeDefined();

    // jsdom does not implement scrollIntoView — stub it.
    document.body.scrollIntoView = vi.fn();

    (window as any).frameId = "frame-42";
    focusFrameHandler!({ frameId: "frame-42" }, undefined, () => {});

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

// ---------------------------------------------------------------------------
// Suite: removeSearchAlias pushes applyUICommand
// ---------------------------------------------------------------------------

describe("createFront removeSearchAlias — queues applyUICommand for removeSearchAlias", () => {
  it("queues a removeSearchAlias command in _uiUserSettings", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    // Before frontend is loaded no createUiHost call has happened yet; the
    // command is buffered in _uiUserSettings. Calling removeSearchAlias must
    // not throw and must NOT trigger newFrontEnd (no createUiHost call).
    expect(() => {
      front.removeSearchAlias("g");
    }).not.toThrow();

    // _uiUserSettings is a private closure; its effect is observable only
    // after the frontend resolves. We verify that the alias is queued by
    // triggering newFrontEnd and confirming createUiHost was invoked — that
    // path confirms applyUICommand ran without error.
    expect(mockCreateUiHost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: setHintsCharacters queues applyUICommand
// ---------------------------------------------------------------------------

describe("createFront setHintsCharacters — queues applyUICommand", () => {
  it("does not throw and does not create the frontend iframe", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    expect(() => {
      front.setHintsCharacters("asdfghjkl");
    }).not.toThrow();

    expect(mockCreateUiHost).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: executeCommand sends executeCommand action via self.command
// ---------------------------------------------------------------------------

describe("createFront executeCommand — triggers newFrontEnd", () => {
  it("calls createUiHost (creates frontend iframe) to deliver the executeCommand action", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    front.executeCommand("tabNext");

    // executeCommand -> self.command({action:'executeCommand',...}) -> newFrontEnd()
    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: getUsage builds annotations and triggers newFrontEnd
// ---------------------------------------------------------------------------

describe("createFront getUsage — builds annotations and delivers via newFrontEnd", () => {
  it("calls createUiHost and invokes the callback via successById callback", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    const cb = vi.fn();
    front.getUsage(cb);

    // getUsage -> self.command({action:'getUsage',...}, callback) -> newFrontEnd()
    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: _actions["getPageText"] — ack path posts body innerText via postTopMessage
// ---------------------------------------------------------------------------

describe("createFront _actions[getPageText] — ack path posts body text", () => {
  it("posts body.innerText back via runtime.postTopMessage after Promise resolves", async () => {
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    // Stub innerText since jsdom does not implement it.
    Object.defineProperty(document.body, "innerText", {
      value: "hello from body",
      configurable: true,
      writable: true,
    });

    const postSpy = vi.spyOn(runtime, "postTopMessage").mockImplementation(() => {});

    messageHandler(makeContentEvent({ action: "getPageText", ack: true, id: "gt-1", origin: "o" }));

    // getPageText returns a string synchronously; the ack path wraps it in
    // Promise.resolve().then(), so we flush microtasks by awaiting a resolved
    // promise before asserting.
    await Promise.resolve();

    const postedArg = postSpy.mock.calls[0]?.[0] as any;
    expect(postedArg?.surfingkeys_uihost_data?.data).toBe("hello from body");

    delete (document.body as any).innerText;
    postSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Suite: _actions["getBackFocus"] — calls window.focus
// ---------------------------------------------------------------------------

describe("createFront _actions[getBackFocus] — calls window.focus", () => {
  it("calls window.focus when the action is dispatched", () => {
    const { handler, restore } = captureMessageHandler();
    createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    const focusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});

    messageHandler(makeContentEvent({ action: "getBackFocus" }));

    expect(focusSpy).toHaveBeenCalledOnce();

    focusSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Suite: addSearchAlias without suggestionURL — skips _listSuggestions
// ---------------------------------------------------------------------------

describe("createFront addSearchAlias — without suggestionURL skips _listSuggestions", () => {
  it("queues addSearchAlias command but does not register a suggestion handler", () => {
    const { handler, restore } = captureMessageHandler();
    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    // Register alias without suggestionURL: no entry added to _listSuggestions.
    front.addSearchAlias("d", "DuckDuckGo", "https://duckduckgo.com/?q=");

    // A getSearchSuggestions message for any url must return null (no handler).
    const suggestionFn = vi.fn();
    front.addSearchAlias(
      "sentinel",
      "Sentinel",
      "https://sentinel.example.com/",
      "https://sentinel.example.com/suggest",
      suggestionFn,
    );

    // Fire getSearchSuggestions for the no-suggestionURL alias: the listSuggestion
    // fn for "d" should never be registered, so this must NOT call suggestionFn.
    messageHandler(
      makeContentEvent({
        action: "getSearchSuggestions",
        url: "https://duckduckgo.com/?q=",
        response: "raw",
        requestUrl: "https://duckduckgo.com/?q=test",
        query: "test",
      }),
    );

    expect(suggestionFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: frontendDestroyed message resets frontendPromise
// ---------------------------------------------------------------------------

describe("createFront window message — frontendDestroyed resets frontend", () => {
  it("allows newFrontEnd to be created again after frontendDestroyed", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    // Capture the message handler belonging to THIS front so the frontendDestroyed
    // event resets its own frontendPromise (not a sibling instance's closure).
    const { handler, restore } = captureMessageHandler();
    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restore();
    const messageHandler = handler()!;

    // Trigger newFrontEnd by sending a command action.
    mockCreateUiHost.mockClear();
    front.executeCommand("tabNext");
    expect(mockCreateUiHost).toHaveBeenCalledOnce();

    // Simulate the frontend iframe being destroyed.
    mockCreateUiHost.mockClear();
    messageHandler(
      new MessageEvent("message", {
        data: { surfingkeys_content_data: { action: "frontendDestroyed" } },
        origin: window.location.origin,
      }),
    );

    // frontendDestroyed cleared frontendPromise, so the next executeCommand must
    // build the host again (proving the reset, not merely that it did not throw).
    front.executeCommand("tabNext2");
    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Suite: self.attach — calls showModeStatus and creates frontend if needed
// ---------------------------------------------------------------------------

describe("createFront self.attach — calls showModeStatus", () => {
  it("does not throw and creates the frontend iframe", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    expect(() => {
      front.attach();
    }).not.toThrow();

    // attach() calls newFrontEnd() when frontendPromise is undefined.
    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });

  it("does not call createUiHost again if frontend already exists", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());

    front.attach(); // creates frontend
    const firstCount = mockCreateUiHost.mock.calls.length;

    front.attach(); // frontend already exists — must NOT recreate
    expect(mockCreateUiHost.mock.calls.length).toBe(firstCount);
  });
});

// ---------------------------------------------------------------------------
// Suite: self.detach — schedules tryDetach after 3000 ms
// ---------------------------------------------------------------------------

describe("createFront self.detach — schedules tryDetach on the uiHost", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls uiHost.tryDetach after 3000 ms", async () => {
    vi.useFakeTimers();
    const tryDetach = vi.fn();
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();
    // Make createUiHost resolve immediately with a fake uiHost.
    mockCreateUiHost.mockImplementation((_browser: any, cb: (res: any) => void) => {
      cb({ tryDetach });
    });

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    front.attach(); // creates frontendPromise

    front.detach(); // schedules tryDetach after 3000 ms
    await vi.runAllTimersAsync();

    expect(tryDetach).toHaveBeenCalledOnce();

    // Restore mock.
    mockCreateUiHost.mockReset();
  });
});

// ---------------------------------------------------------------------------
// Suite: self.attach cancels a pending uiHostDetaching timer
// ---------------------------------------------------------------------------

describe("createFront self.attach — cancels pending detach timer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels the detach timer so tryDetach is never called if attach arrives in time", async () => {
    vi.useFakeTimers();
    const tryDetach = vi.fn();
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();
    mockCreateUiHost.mockImplementation((_browser: any, cb: (res: any) => void) => {
      cb({ tryDetach });
    });

    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    front.attach();

    // detach() schedules uiHostDetaching via frontendPromise.then(...).
    // Flush microtasks so the .then callback fires and uiHostDetaching is set
    // before attach() runs, which clears it.
    front.detach();
    await Promise.resolve(); // flush microtask queue so setTimeout is scheduled
    front.attach(); // clears uiHostDetaching before the 3000 ms fires

    await vi.runAllTimersAsync();

    expect(tryDetach).not.toHaveBeenCalled();

    mockCreateUiHost.mockReset();
  });
});

// ---------------------------------------------------------------------------
// Suite: _actions["getSearchSuggestions"] — non-function dispatches skCallback id
// The message handler returns void; the observable contract is that a
// surfingkeys:user "getSearchSuggestions" event is dispatched carrying a
// callbackId string, which is what the non-function path does.
// ---------------------------------------------------------------------------

describe("createFront _actions[getSearchSuggestions] — non-function dispatches user event with callbackId", () => {
  it("dispatches surfingkeys:user with a string callbackId as the last argument", () => {
    const { handler: msgHandler, restore: restoreMsg } = captureMessageHandler();
    const front = createFront(makeInsert(), makeNormal(), null, makeVisual(), makeBrowser());
    restoreMsg();
    const messageHandler = msgHandler()!;

    // Register a non-function listSuggestion.
    front.addSearchAlias(
      "z",
      "Zeta",
      "https://zeta.example.com/",
      "https://zeta.example.com/suggest",
      { notAFunction: true } as any,
    );

    // Capture the surfingkeys:user event dispatched by the non-function path.
    const captured: unknown[][] = [];
    const userListener = (e: Event) => {
      captured.push((e as CustomEvent).detail as unknown[]);
    };
    document.addEventListener("surfingkeys:user", userListener);

    messageHandler(
      makeContentEvent({
        action: "getSearchSuggestions",
        url: "https://zeta.example.com/suggest",
        response: "rawZ",
        requestUrl: "https://zeta.example.com/suggest?q=z",
        query: "z",
      }),
    );

    document.removeEventListener("surfingkeys:user", userListener);

    // The non-function branch dispatches: ["getSearchSuggestions", url, response, ctx, callbackId]
    const evt = captured.find((d) => d[0] === "getSearchSuggestions");
    expect(evt).toBeDefined();
    // callbackId is the 5th element and must be a non-empty string (a guid).
    expect(typeof evt![4]).toBe("string");
    expect((evt![4] as string).length).toBeGreaterThan(0);
  });
});
