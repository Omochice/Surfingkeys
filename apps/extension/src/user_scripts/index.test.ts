import { beforeEach, describe, expect, it, vi } from "vitest";

import createUserScript from "./index";

// The user-script api built by the factory, rebuilt before each test. Note the
// factory's registries (userDefinedFunctions/userDefinedCommands in index.ts) are
// module-level and persist across tests, so cases use distinct keys rather than
// relying on a per-test reset of that state.
let capturedApi: any;

function askToRunUserScript(): void {
  document.dispatchEvent(new CustomEvent("surfingkeys:user", { detail: ["runUserScript"] }));
}

beforeEach(() => {
  createUserScript("chrome-extension://test/", (api) => {
    capturedApi = api;
  });
  askToRunUserScript();
});

function captureEvents(type: string, fn: () => void): CustomEvent[] {
  const captured: CustomEvent[] = [];
  const handler = (e: Event) => captured.push(e as CustomEvent);
  document.addEventListener(type, handler);
  fn();
  document.removeEventListener(type, handler);
  return captured;
}

describe("cmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:front event with addMapkey / Omnibar args", () => {
    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.cmap("ctrl-n", "ctrl-j");
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "addMapkey" &&
        e.detail[1] === "Omnibar" &&
        e.detail[2] === "ctrl-n" &&
        e.detail[3] === "ctrl-j",
    );
    expect(evt).not.toBeUndefined();
  });

  it("does not dispatch when domain regex does not match", () => {
    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.cmap("ctrl-n", "ctrl-j", { domain: /this-domain-will-never-match\.example/ });
    });

    const addMapkeyEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "addMapkey",
    );
    expect(addMapkeyEvents).toHaveLength(0);
  });
});

describe("cunmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:front event with removeMapkey / Omnibar args", () => {
    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.cunmap("<Ctrl-j>");
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "removeMapkey" &&
        e.detail[1] === "Omnibar" &&
        e.detail[2] === "<Ctrl-j>",
    );
    expect(evt).not.toBeUndefined();
  });

  it("does not dispatch when domain regex does not match", () => {
    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.cunmap("<Ctrl-j>", { domain: /this-domain-will-never-match\.example/ });
    });

    const removeMapkeyEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "removeMapkey",
    );
    expect(removeMapkeyEvents).toHaveLength(0);
  });
});

describe("mapkey (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['mapkey', keys, opts]", () => {
    const jscode = vi.fn();
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.mapkey("g", jscode, { annotation: "Go somewhere" });
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "mapkey" &&
        e.detail[1] === "g" &&
        (e.detail[2] as { annotation?: unknown }).annotation === "Go somewhere",
    );
    expect(evt).not.toBeUndefined();
  });

  it("does not dispatch when domain option regex does not match", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.mapkey("z", vi.fn(), {
        annotation: "unreachable",
        domain: /this-domain-will-never-match\.example/,
      });
    });

    const mapkeyEvents = events.filter((e) => Array.isArray(e.detail) && e.detail[0] === "mapkey");
    expect(mapkeyEvents).toHaveLength(0);
  });
});

describe("imapkey (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['imapkey', keys, opts]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.imapkey("i", vi.fn(), { annotation: "Insert mode action" });
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "imapkey" &&
        e.detail[1] === "i" &&
        (e.detail[2] as { annotation?: unknown }).annotation === "Insert mode action",
    );
    expect(evt).not.toBeUndefined();
  });

  it("does not dispatch when domain option regex does not match", () => {
    // Distinct key from the registration test above (registries persist across tests).
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.imapkey("qz", vi.fn(), {
        annotation: "unreachable",
        domain: /this-domain-will-never-match\.example/,
      });
    });

    const imapkeyEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "imapkey",
    );
    expect(imapkeyEvents).toHaveLength(0);
  });
});

describe("vmapkey (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['vmapkey', keys, opts]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.vmapkey("v", vi.fn(), { annotation: "Visual mode action" });
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "vmapkey" &&
        e.detail[1] === "v" &&
        (e.detail[2] as { annotation?: unknown }).annotation === "Visual mode action",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("addCommand (via api returned by factory)", () => {
  it("dispatches a surfingkeys:front event with ['addCommand', name, description]", () => {
    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.addCommand("myCmd", vi.fn(), { description: "My command description" });
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "addCommand" &&
        e.detail[1] === "myCmd" &&
        e.detail[2] === "My command description",
    );
    expect(evt).not.toBeUndefined();
  });

  it("dispatches an empty description when options is omitted", () => {
    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.addCommand("noDescCmd", vi.fn());
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "addCommand" && e.detail[1] === "noDescCmd",
    );
    expect((evt as CustomEvent).detail[2]).toBe("");
  });
});

describe("map (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['map', newKeystroke, oldKeystroke, options]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.map("e", "E", { annotation: "my map" });
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "map" &&
        e.detail[1] === "e" &&
        e.detail[2] === "E",
    );
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[3]).toEqual({ annotation: "my map" });
  });
});

describe("imap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['imap', ...]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.imap("ctrl-a", "ctrl-b");
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "imap" &&
        e.detail[1] === "ctrl-a" &&
        e.detail[2] === "ctrl-b",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("lmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['lmap', ...]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.lmap("x", "<Alt-i>");
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "lmap" && e.detail[1] === "x",
    );
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[2]).toBe("<Alt-i>");
  });
});

describe("vmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['vmap', ...]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.vmap("n", "N");
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "vmap" && e.detail[1] === "n",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("addSearchAlias (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event containing the alias and searchUrl", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.addSearchAlias("g", "https://www.google.com/search?q=", { prompt: "Google" });
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "addSearchAlias" &&
        e.detail[1] === "g" &&
        e.detail[2] === "https://www.google.com/search?q=",
    );
    expect(evt).not.toBeUndefined();
  });

  it("replaces the suggestion parser with 'user' in the dispatched event detail", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.addSearchAlias("d", "https://duckduckgo.com/?q=", {
        prompt: "DDG",
        parseSuggestion: () => [],
      });
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "addSearchAlias");
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[3].parseSuggestion).toBe("user");
  });

  it("throws for a non-ASCII alias character", () => {
    expect(() => {
      capturedApi.addSearchAlias("日", "https://example.com/?q=", { prompt: "Japanese" });
    }).toThrow();
  });

  it("passes suggestionUrl through to the dispatch detail", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.addSearchAlias("b", "https://bing.com/search?q=", {
        prompt: "Bing",
        suggestionUrl: "https://bing.com/suggest?q=",
      });
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "addSearchAlias");
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[3].suggestionUrl).toBe("https://bing.com/suggest?q=");
  });
});

describe("unmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['unmap', keystroke, options]", () => {
    const domain = /example\.com/;
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.unmap("g", { domain });
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "unmap" && e.detail[1] === "g",
    );
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[2]).toEqual({ domain });
  });
});

describe("iunmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['iunmap', keystroke]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.iunmap("i");
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "iunmap" && e.detail[1] === "i",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("vunmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['vunmap', keystroke]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.vunmap("v");
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "vunmap" && e.detail[1] === "v",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("unmapAllExcept (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['unmapAllExcept', keystrokes, options]", () => {
    const domain = /example\.com/;
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.unmapAllExcept(["a", "b"], { domain });
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "unmapAllExcept");
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[1]).toEqual(["a", "b"]);
    expect((evt as CustomEvent).detail[2]).toEqual({ domain });
  });
});

describe("removeSearchAlias (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['removeSearchAlias', alias, ...]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.removeSearchAlias("g", "s", "o");
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "removeSearchAlias" && e.detail[1] === "g",
    );
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[2]).toBe("s");
    expect((evt as CustomEvent).detail[3]).toBe("o");
  });
});

describe("Clipboard.write (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['clipboard:write', text]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Clipboard.write("hello world");
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "clipboard:write" &&
        e.detail[1] === "hello world",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("Clipboard.read (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['clipboard:read']", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Clipboard.read(vi.fn());
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "clipboard:read");
    expect(evt).not.toBeUndefined();
  });
});

describe("Hints.click (via api returned by factory)", () => {
  it("does nothing when no valid HTMLElement is in the links argument", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Hints.click([]);
    });

    const hintClickEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "hints:click",
    );
    expect(hintClickEvents).toHaveLength(0);
  });

  it("dispatches hints:click with the CSS selector string when passed a string", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Hints.click("a.link", true);
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "hints:click" && e.detail[1] === "a.link",
    );
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[2]).toBe(true);
  });

  it("adds the internal class to the element and dispatches hints:click with the class selector", () => {
    const el = document.createElement("a");
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Hints.click(el);
    });

    expect(el.classList.contains("surfingkeys--hints--clicking")).toBe(true);

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "hints:click" &&
        e.detail[1] === ".surfingkeys--hints--clicking",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("Hints.create (via api returned by factory)", () => {
  it("returns false when no valid HTMLElement is in the cssSelector argument", () => {
    const result = capturedApi.Hints.create([], vi.fn());
    expect(result).toBe(false);
  });

  it("dispatches hints:create with the selector string when passed a string", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Hints.create("a", vi.fn());
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "hints:create" && e.detail[1] === "a",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("Normal.feedkeys (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['normal:feedkeys', keys]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Normal.feedkeys("gg");
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "normal:feedkeys" && e.detail[1] === "gg",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("Visual.style (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['visual:style', element, style]", () => {
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Visual.style("marks", "color: red;");
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "visual:style" &&
        e.detail[1] === "marks" &&
        e.detail[2] === "color: red;",
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("Front.openOmnibar (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['front:openOmnibar', args]", () => {
    const args = { type: "SearchEngine" };
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Front.openOmnibar(args);
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "front:openOmnibar" && e.detail[1] === args,
    );
    expect(evt).not.toBeUndefined();
  });
});

describe("default export factory", () => {
  // jsdom's document.location.href is "about:blank", which does not start with
  // any chrome-extension:// URL, so isInUIFrame() always returns false in jsdom.

  it("passes api and settings objects to the user function", () => {
    let receivedApi: any;
    let receivedSettings: any;
    createUserScript("chrome-extension://abc/", (api, settings) => {
      receivedApi = api;
      receivedSettings = settings;
    });
    askToRunUserScript();

    expect(receivedApi).toBeDefined();
    expect(typeof receivedApi.mapkey).toBe("function");
    expect(receivedSettings).toBeDefined();
  });
});

function fireUser(detail: unknown[], target: EventTarget = document): void {
  target.dispatchEvent(new CustomEvent("surfingkeys:user", { detail, bubbles: true }));
}

describe("surfingkeys:user — callUserFunction", () => {
  it("invokes the registered user function with the passed parameter", () => {
    const jscode = vi.fn();
    capturedApi.mapkey("gx", jscode, { annotation: "run" });

    fireUser(["callUserFunction", "normal:gx", { foo: 1 }]);

    expect(jscode).toHaveBeenCalledWith({ foo: 1 });
  });

  it("does nothing for a key that was never registered", () => {
    const jscode = vi.fn();
    capturedApi.mapkey("gy", jscode, { annotation: "run" });

    fireUser(["callUserFunction", "normal:never-registered", {}]);

    expect(jscode).not.toHaveBeenCalled();
  });

  it("does not register the user function when the mapkey domain does not match", () => {
    const jscode = vi.fn();
    capturedApi.mapkey("gz", jscode, { annotation: "run", domain: /never-match\.example/ });

    fireUser(["callUserFunction", "normal:gz", {}]);

    expect(jscode).not.toHaveBeenCalled();
  });
});

describe("surfingkeys:user — executeUserCommand", () => {
  it("invokes the registered command with its spread args", () => {
    const action = vi.fn();
    capturedApi.addCommand("greet", action, { description: "say hi" });

    fireUser(["executeUserCommand", "greet", ["alice", "bob"]]);

    expect(action).toHaveBeenCalledWith("alice", "bob");
  });

  it("does nothing for an unknown command name", () => {
    const action = vi.fn();
    capturedApi.addCommand("known", action);

    fireUser(["executeUserCommand", "unknown-cmd", []]);

    expect(action).not.toHaveBeenCalled();
  });
});

describe("surfingkeys:user — onClipboardRead", () => {
  it("delivers the response to the callback registered via Clipboard.read", () => {
    const cb = vi.fn();
    capturedApi.Clipboard.read(cb);

    fireUser(["onClipboardRead", { data: "pasted text" }]);

    expect(cb).toHaveBeenCalledWith({ data: "pasted text" });
  });
});

describe("surfingkeys:user — onHintClicked", () => {
  it("calls the hints callback with (element, shiftKey) when one was registered via Hints.create", () => {
    const onHintKey = vi.fn();
    capturedApi.Hints.create("a", onHintKey);
    const element = document.createElement("a");
    // The listener is registered capture-phase on document, so the target must be
    // attached for the event to propagate down to it.
    document.body.appendChild(element);

    // capture-phase listener appends evt.target as the element argument.
    fireUser(["onHintClicked", true], element);

    expect(onHintKey).toHaveBeenCalledWith(element, true);

    element.remove();
  });
});

describe("readiness handshake", () => {
  it("announces itself when it loads", () => {
    const announcements = captureEvents("surfingkeys:userScriptReady", () => {
      createUserScript("chrome-extension://test/", () => {});
    });

    expect(announcements).toHaveLength(1);
  });

  it("leaves the snippet unapplied until the content script asks for it", () => {
    const snippet = vi.fn();

    createUserScript("chrome-extension://test/", snippet);

    expect(snippet).not.toHaveBeenCalled();
  });

  it("applies the snippet when the content script asks for it", () => {
    const snippet = vi.fn();
    createUserScript("chrome-extension://test/", snippet);

    askToRunUserScript();

    expect(snippet).toHaveBeenCalledTimes(1);
  });
});
