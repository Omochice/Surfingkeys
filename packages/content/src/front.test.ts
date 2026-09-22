import { runtime } from "@sk/messaging/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createFront from "./front";

vi.mock("./uiframe", () => ({
  default: vi.fn(),
}));

import Trie from "@sk/core/trie";

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

// The detail array is mutated by args.shift() inside the listener, so dispatching
// to all stacked listeners would corrupt later ones. Capturing it lets us call it
// directly, in isolation.

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

function invokeFrontSK(handler: SKFrontHandlerFn, args: unknown[]): void {
  handler(new CustomEvent("surfingkeys:front", { detail: args }));
}

function makeContentEvent(
  payload: Record<string, unknown>,
  overrides: Partial<MessageEventInit> = {},
): MessageEvent {
  return new MessageEvent("message", {
    data: { surfingkeysContentData: payload },
    origin: window.location.origin,
    ...overrides,
  });
}

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

describe("createFront window message handler — action dispatch", () => {
  it("dispatches surfingkeys:user CustomEvent for executeUserCommand action", () => {
    const { handler, restore } = captureMessageHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
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
    createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "visualClear" }));

    expect(visual.visualClear).toHaveBeenCalledOnce();
  });

  it("calls visual.emptySelection for emptySelection action", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "emptySelection" }));

    expect(visual.emptySelection).toHaveBeenCalledOnce();
  });

  it("calls visual.visualEnter with query for visualEnter action", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
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
      createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
      restore();
      const messageHandler = handler()!;

      messageHandler(makeContentEvent({ action: "visualUpdate", query: "search" }));

      await vi.runAllTimersAsync();

      expect(visual.visualUpdate).toHaveBeenCalledWith("search");
    } finally {
      vi.useRealTimers();
    }
  });

  it("visual.visualClear cancels a pending visualUpdate timer", async () => {
    vi.useFakeTimers();
    try {
      const visual = makeVisual();
      const { handler, restore } = captureMessageHandler();
      createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
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

  it("deactivated/activated actions toggle the frontActive flag", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "deactivated" }));
    messageHandler(makeContentEvent({ action: "visualClear" }));
    expect(visual.visualClear).not.toHaveBeenCalled();

    messageHandler(makeContentEvent({ action: "activated" }));
    messageHandler(makeContentEvent({ action: "visualClear" }));
    expect(visual.visualClear).toHaveBeenCalledOnce();
  });
});

describe("createFront addSearchAlias — getSearchSuggestions with function listSuggestion", () => {
  it("calls the listSuggestion function with the right arguments", () => {
    const { handler, restore } = captureMessageHandler();
    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restore();
    const messageHandler = handler()!;

    const suggestionFn = vi.fn((_response: any, _ctx: any) => ["result1", "result2"]);
    front.addSearchAlias("g", "https://google.com?q=", {
      prompt: "Google",
      suggestionUrl: "https://suggest.google.com/",
      parseSuggestion: suggestionFn,
    });

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

describe("createFront getSearchSuggestions — non-function listSuggestion dispatches SKEvent", () => {
  it("dispatches surfingkeys:user getSearchSuggestions when listSuggestion is not a function", () => {
    const { handler, restore } = captureMessageHandler();
    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restore();
    const messageHandler = handler()!;

    const nonFn = { notAFunction: true };
    front.addSearchAlias("w", "https://en.wikipedia.org/", {
      prompt: "Wiki",
      suggestionUrl: "https://en.wikipedia.org/w/suggest",
      parseSuggestion: nonFn as any,
    });

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
    expect(matchingEvent?.[1]).toMatchObject({ url: "https://en.wikipedia.org/w/suggest" });

    cleanup();
  });
});

describe("createFront actions[dialogResponse] — triggers onDialogResponseOk callback", () => {
  it("calls onDialogResponseOk when result is Ok", () => {
    const { handler: msgHandler, restore: restoreMsg } = captureMessageHandler();
    const { handler: skHandler, restore: restoreSK } = captureFrontSKHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restoreMsg();
    restoreSK();
    const messageHandler = msgHandler()!;
    const frontHandler = skHandler()!;

    const onOk = vi.fn();
    invokeFrontSK(frontHandler, ["showDialog", "Are you sure?", onOk]);

    messageHandler(makeContentEvent({ action: "dialogResponse", result: "Ok" }));

    expect(onOk).toHaveBeenCalledOnce();
  });

  it("does not call onDialogResponseOk when result is not Ok", () => {
    const { handler: msgHandler, restore: restoreMsg } = captureMessageHandler();
    const { handler: skHandler, restore: restoreSK } = captureFrontSKHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
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
    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

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

describe("createFront chooseTab — notify delegation", () => {
  let savedSendMessage: unknown;

  beforeEach(() => {
    savedSendMessage = (globalThis as any).chrome.runtime.sendMessage;
  });

  afterEach(() => {
    (globalThis as any).chrome.runtime.sendMessage = savedSendMessage;
  });

  it("calls notify focusTabByIndex when the keymap's repeats is a non-empty string", () => {
    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    const normal = {
      mappings: makeTrie(),
      getLurkMode: vi.fn(() => undefined),
      keymap: { repeats: "3" },
    };
    const front = createFront({
      insert: makeInsert(),
      normal,
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    front.chooseTab();

    const calls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "focusTabByIndex",
    );
    expect(calls).toHaveLength(1);
  });
});

describe("createFront openOmnibar", () => {
  it("calls createUiHost (triggers newFrontEnd) because openOmnibar is not hideKeystroke", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    front.openOmnibar({ type: "OmniQuery", extra: "search term", style: "" });

    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

describe("createFront showUsage / getAllAnnotations — includes lurk mode trie", () => {
  it("consults getLurkMode when building annotations for showUsage", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const normal = makeNormal(true);
    const front = createFront({
      insert: makeInsert(),
      normal,
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    front.showUsage();

    expect(normal.getLurkMode).toHaveBeenCalled();
    expect(mockCreateUiHost).toHaveBeenCalled();
  });
});

describe("createFront SKEvent front channel — hideKeystroke / showKeystroke", () => {
  it("showKeystroke triggers newFrontEnd (createUiHost) on the first keystroke", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const { handler: skHandler, restore } = captureFrontSKHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
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

    expect(mockCreateUiHost).toHaveBeenCalled();
  });
});

describe("createFront SKEvent front channel — removeMapkey", () => {
  afterEach(() => {
    (createUiHost as ReturnType<typeof vi.fn>).mockReset();
  });

  it("sends a removeMapkey command carrying the mode and the keystroke", async () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockImplementation((_browser: unknown, onReady: (host: unknown) => void) => {
      onReady({});
    });

    const { handler: skHandler, restore } = captureFrontSKHandler();
    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restore();
    const frontHandler = skHandler()!;

    // The command only reaches the frontend once the UI host exists, so open something first.
    front.openOmnibar({ type: "OmniQuery", extra: "search term", style: "" });
    const command = vi.fn();
    front.command = command;

    invokeFrontSK(frontHandler, ["removeMapkey", "Omnibar", "<Ctrl-j>"]);

    await vi.waitFor(() => {
      expect(command).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "removeMapkey",
          mode: "Omnibar",
          keystroke: "<Ctrl-j>",
        }),
      );
    });
  });
});

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
    createFront({ insert, normal: makeNormal(), visual: makeVisual(), browser: makeBrowser() });
    restore();
    const frontHandler = skHandler()!;

    invokeFrontSK(frontHandler, ["applySettingsFromSnippets", { enableEmojiInsertion: true }]);

    expect(insert.enableEmojiInsertion).toHaveBeenCalledOnce();
  });
});

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

    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    const focusFrameHandler = capturedHandlers["focusFrame"];
    expect(focusFrameHandler).toBeDefined();

    // jsdom does not implement scrollIntoView — stub it.
    document.body.scrollIntoView = vi.fn();

    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});

    (window as any).frameId = "frame-42";
    focusFrameHandler!({ frameId: "frame-42" }, undefined, () => {});

    expect(focus).toHaveBeenCalledOnce();
    const frameEl = document.getElementById("sk_frame");
    expect(frameEl).not.toBeNull();
  });
});

describe("createFront window message handler — DictoriumViewReady activates when inactive", () => {
  it("sets frontActive=true on DictoriumViewReady, enabling subsequent actions", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "deactivated" }));
    expect(visual.visualClear).not.toHaveBeenCalled();

    messageHandler(
      new MessageEvent("message", {
        data: { dictorium_data: { type: "DictoriumViewReady" } },
        origin: window.location.origin,
      }),
    );

    messageHandler(makeContentEvent({ action: "visualClear" }));
    expect(visual.visualClear).toHaveBeenCalledOnce();
  });
});

describe("createFront window message handler — activated message while inactive", () => {
  it("routes the activated message through the inactive path and re-activates", () => {
    const visual = makeVisual();
    const { handler, restore } = captureMessageHandler();
    createFront({ insert: makeInsert(), normal: makeNormal(), visual, browser: makeBrowser() });
    restore();
    const messageHandler = handler()!;

    messageHandler(makeContentEvent({ action: "deactivated" }));
    messageHandler(makeContentEvent({ action: "activated" }));
    messageHandler(makeContentEvent({ action: "visualClear" }));

    expect(visual.visualClear).toHaveBeenCalledOnce();
  });
});

describe("createFront window message handler — stopImmediatePropagation behavior", () => {
  it("does not stop propagation for dictorium_data messages", () => {
    const { handler, restore } = captureMessageHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
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

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("calls stopImmediatePropagation for surfingkeysContentData messages", () => {
    const { handler, restore } = captureMessageHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
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

describe("createFront removeSearchAlias — queues applyUICommand for removeSearchAlias", () => {
  it("queues a removeSearchAlias command in uiUserSettings", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    expect(() => {
      front.removeSearchAlias("g");
    }).not.toThrow();

    expect(mockCreateUiHost).not.toHaveBeenCalled();
  });
});

describe("createFront setHintsCharacters — queues applyUICommand", () => {
  it("does not throw and does not create the frontend iframe", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    expect(() => {
      front.setHintsCharacters("asdfghjkl");
    }).not.toThrow();

    expect(mockCreateUiHost).not.toHaveBeenCalled();
  });
});

describe("createFront executeCommand — triggers newFrontEnd", () => {
  it("calls createUiHost (creates frontend iframe) to deliver the executeCommand action", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    front.executeCommand("tabNext");

    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

describe("createFront getUsage — builds annotations and delivers via newFrontEnd", () => {
  it("calls createUiHost and invokes the callback via successById callback", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    const cb = vi.fn();
    front.getUsage(cb);

    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

describe("createFront actions[getPageText] — ack path posts body text", () => {
  it("posts body.innerText back via runtime.postTopMessage after Promise resolves", async () => {
    const { handler, restore } = captureMessageHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
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
    expect(postedArg?.surfingkeysUiHostData?.data).toBe("hello from body");

    delete (document.body as any).innerText;
    postSpy.mockRestore();
  });
});

describe("createFront actions[getBackFocus] — calls window.focus", () => {
  it("calls window.focus when the action is dispatched", () => {
    const { handler, restore } = captureMessageHandler();
    createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restore();
    const messageHandler = handler()!;

    const focusSpy = vi.spyOn(window, "focus").mockImplementation(() => {});

    messageHandler(makeContentEvent({ action: "getBackFocus" }));

    expect(focusSpy).toHaveBeenCalledOnce();

    focusSpy.mockRestore();
  });
});

describe("createFront addSearchAlias — without suggestionURL skips listSuggestions", () => {
  it("leaves no suggestion handler for the alias URL, so nothing is sent back", async () => {
    const { handler, restore } = captureMessageHandler();
    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restore();
    const messageHandler = handler()!;
    const postSpy = vi.spyOn(runtime, "postTopMessage").mockImplementation(() => {});

    front.addSearchAlias("d", "https://duckduckgo.com/?q=", { prompt: "DuckDuckGo" });
    front.addSearchAlias("s", "https://sentinel.example.com/", {
      prompt: "Sentinel",
      suggestionUrl: "https://sentinel.example.com/suggest",
      parseSuggestion: vi.fn(() => ["suggested"]),
    });

    const askFor = (url: string) =>
      messageHandler(
        makeContentEvent({
          action: "getSearchSuggestions",
          url,
          response: "raw",
          requestUrl: `${url}test`,
          query: "test",
          ack: true,
          id: 1,
        }),
      );

    askFor("https://sentinel.example.com/suggest");
    await Promise.resolve();
    expect(postSpy).toHaveBeenCalledOnce();

    postSpy.mockClear();
    const userEvents = listenForSKEvent("user");
    askFor("https://duckduckgo.com/?q=");
    await Promise.resolve();
    expect(postSpy).not.toHaveBeenCalled();
    expect(userEvents.detail).toHaveLength(0);

    userEvents.cleanup();
    postSpy.mockRestore();
  });
});

describe("createFront window message — frontendDestroyed resets frontend", () => {
  it("allows newFrontEnd to be created again after frontendDestroyed", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    // Capture the message handler belonging to THIS front so the frontendDestroyed
    // event resets its own frontendPromise (not a sibling instance's closure).
    const { handler, restore } = captureMessageHandler();
    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restore();
    const messageHandler = handler()!;

    mockCreateUiHost.mockClear();
    front.executeCommand("tabNext");
    expect(mockCreateUiHost).toHaveBeenCalledOnce();

    mockCreateUiHost.mockClear();
    messageHandler(
      new MessageEvent("message", {
        data: { surfingkeysContentData: { action: "frontendDestroyed" } },
        origin: window.location.origin,
      }),
    );

    front.executeCommand("tabNext2");
    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });
});

describe("createFront self.attach — calls showModeStatus", () => {
  it("does not throw and creates the frontend iframe", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    expect(() => {
      front.attach();
    }).not.toThrow();

    expect(mockCreateUiHost).toHaveBeenCalledOnce();
  });

  it("does not call createUiHost again if frontend already exists", () => {
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });

    front.attach();
    const firstCount = mockCreateUiHost.mock.calls.length;

    front.attach();
    expect(mockCreateUiHost.mock.calls.length).toBe(firstCount);
  });
});

describe("createFront self.detach — schedules tryDetach on the uiHost", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls uiHost.tryDetach after 3000 ms", async () => {
    vi.useFakeTimers();
    const tryDetach = vi.fn();
    const mockCreateUiHost = createUiHost as ReturnType<typeof vi.fn>;
    mockCreateUiHost.mockClear();
    mockCreateUiHost.mockImplementation((_browser: any, cb: (res: any) => void) => {
      cb({ tryDetach });
    });

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    front.attach();

    front.detach();
    await vi.runAllTimersAsync();

    expect(tryDetach).toHaveBeenCalledOnce();

    mockCreateUiHost.mockReset();
  });
});

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

    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    front.attach();

    // detach() schedules uiHostDetaching via frontendPromise.then(...).
    // Flush microtasks so the .then callback fires and uiHostDetaching is set
    // before attach() runs, which clears it.
    front.detach();
    await Promise.resolve();
    front.attach();

    await vi.runAllTimersAsync();

    expect(tryDetach).not.toHaveBeenCalled();

    mockCreateUiHost.mockReset();
  });
});

describe("createFront actions[getSearchSuggestions] — non-function dispatches user event with callbackId", () => {
  it("dispatches surfingkeys:user with a string callbackId as the last argument", () => {
    const { handler: msgHandler, restore: restoreMsg } = captureMessageHandler();
    const front = createFront({
      insert: makeInsert(),
      normal: makeNormal(),
      visual: makeVisual(),
      browser: makeBrowser(),
    });
    restoreMsg();
    const messageHandler = msgHandler()!;

    front.addSearchAlias("z", "https://zeta.example.com/", {
      prompt: "Zeta",
      suggestionUrl: "https://zeta.example.com/suggest",
      parseSuggestion: { notAFunction: true } as any,
    });

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

    const evt = captured.find((d) => d[0] === "getSearchSuggestions");
    expect(evt).toBeDefined();
    expect(evt?.[1]).toMatchObject({ callbackId: expect.stringMatching(/.+/) });
  });
});
