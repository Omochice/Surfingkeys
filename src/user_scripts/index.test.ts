import { describe, expect, it, vi } from "vitest";

import createUserScript, { _isDomainApplicable, createCssSelectorForElements } from "./index";

// ---------------------------------------------------------------------------
// Helpers to capture CustomEvents dispatched on document
// ---------------------------------------------------------------------------

function captureEvents(type: string, fn: () => void): CustomEvent[] {
  const captured: CustomEvent[] = [];
  const handler = (e: Event) => captured.push(e as CustomEvent);
  document.addEventListener(type, handler);
  fn();
  document.removeEventListener(type, handler);
  return captured;
}

// ---------------------------------------------------------------------------
// _isDomainApplicable
// ---------------------------------------------------------------------------

describe("_isDomainApplicable", () => {
  it("returns true when no domain is provided", () => {
    expect(_isDomainApplicable(undefined)).toBe(true);
  });

  it("returns false when the domain regex matches neither document.location.href nor window.origin", () => {
    // A regex that can never match any URL or origin string.
    expect(_isDomainApplicable(/this-domain-will-never-match\.example/)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createCssSelectorForElements
// ---------------------------------------------------------------------------

describe("createCssSelectorForElements", () => {
  it("adds the CSS class to a single HTMLElement passed directly and returns 1", () => {
    const el = document.createElement("div");
    const count = createCssSelectorForElements("my-class", el);
    expect(count).toBe(1);
    expect(el.classList.contains("my-class")).toBe(true);
  });

  it("adds the CSS class to each HTMLElement in an array and returns the array length", () => {
    const a = document.createElement("span");
    const b = document.createElement("span");
    const count = createCssSelectorForElements("another-class", [a, b]);
    expect(count).toBe(2);
    expect(a.classList.contains("another-class")).toBe(true);
    expect(b.classList.contains("another-class")).toBe(true);
  });

  it("filters out non-HTMLElement entries from an array and counts only valid elements", () => {
    const el = document.createElement("p");
    const count = createCssSelectorForElements("valid-class", [el, "not-an-element", null, 42]);
    expect(count).toBe(1);
    expect(el.classList.contains("valid-class")).toBe(true);
  });

  it("returns 0 and adds no classes when passed a non-element, non-array value", () => {
    const count = createCssSelectorForElements("no-class", "totally-not-an-element");
    expect(count).toBe(0);
  });

  it("returns 0 for an empty array", () => {
    const count = createCssSelectorForElements("empty-class", []);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// cmap — dispatches surfingkeys:front with ["addMapkey", "Omnibar", ...]
// ---------------------------------------------------------------------------

describe("cmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:front event with addMapkey / Omnibar args", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.cmap("ctrl-n", "ctrl-j", /this-domain-will-never-match\.example/);
    });

    const addMapkeyEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "addMapkey",
    );
    expect(addMapkeyEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mapkey — stores user function + dispatches surfingkeys:api
// ---------------------------------------------------------------------------

describe("mapkey (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['mapkey', keys, annotation, opts]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const jscode = vi.fn();
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.mapkey("g", "Go somewhere", jscode);
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "mapkey" &&
        e.detail[1] === "g" &&
        e.detail[2] === "Go somewhere",
    );
    expect(evt).not.toBeUndefined();
  });

  it("does not dispatch when domain option regex does not match", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.mapkey("z", "unreachable", vi.fn(), {
        domain: /this-domain-will-never-match\.example/,
      });
    });

    const mapkeyEvents = events.filter((e) => Array.isArray(e.detail) && e.detail[0] === "mapkey");
    expect(mapkeyEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// imapkey — stores user function + dispatches surfingkeys:api
// ---------------------------------------------------------------------------

describe("imapkey (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['imapkey', keys, annotation, opts]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.imapkey("i", "Insert mode action", vi.fn());
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "imapkey" &&
        e.detail[1] === "i" &&
        e.detail[2] === "Insert mode action",
    );
    expect(evt).not.toBeUndefined();
  });

  it("does not dispatch when domain option regex does not match", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.imapkey("i", "unreachable", vi.fn(), {
        domain: /this-domain-will-never-match\.example/,
      });
    });

    const imapkeyEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "imapkey",
    );
    expect(imapkeyEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// vmapkey — stores user function + dispatches surfingkeys:api
// ---------------------------------------------------------------------------

describe("vmapkey (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['vmapkey', keys, annotation, opts]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.vmapkey("v", "Visual mode action", vi.fn());
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "vmapkey" &&
        e.detail[1] === "v" &&
        e.detail[2] === "Visual mode action",
    );
    expect(evt).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// addCommand — stores command + dispatches surfingkeys:front
// ---------------------------------------------------------------------------

describe("addCommand (via api returned by factory)", () => {
  it("dispatches a surfingkeys:front event with ['addCommand', name, description]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:front", () => {
      capturedApi.addCommand("myCmd", "My command description", vi.fn());
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
});

// ---------------------------------------------------------------------------
// map / imap / lmap / vmap — dispatch surfingkeys:api
// ---------------------------------------------------------------------------

describe("map (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['map', new_keystroke, old_keystroke, domain, annotation]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.map("e", "E", undefined, "my map");
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "map" &&
        e.detail[1] === "e" &&
        e.detail[2] === "E",
    );
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[4]).toBe("my map");
  });
});

describe("imap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['imap', ...]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.vmap("n", "N");
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "vmap" && e.detail[1] === "n",
    );
    expect(evt).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// addSearchAlias — ASCII validation + surfingkeys:api dispatch
// ---------------------------------------------------------------------------

describe("addSearchAlias (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event containing the alias and search_url", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.addSearchAlias("g", "Google", "https://www.google.com/search?q=");
    });

    const evt = events.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "addSearchAlias" &&
        e.detail[1] === "g" &&
        e.detail[3] === "https://www.google.com/search?q=",
    );
    expect(evt).not.toBeUndefined();
  });

  it("includes 'user' as the source in the dispatched event detail", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.addSearchAlias("d", "DDG", "https://duckduckgo.com/?q=");
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "addSearchAlias");
    expect(evt).not.toBeUndefined();
    // detail[6] is the source string "user"
    expect((evt as CustomEvent).detail[6]).toBe("user");
  });

  it("throws for a non-ASCII alias character", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    expect(() => {
      capturedApi.addSearchAlias("日", "Japanese", "https://example.com/?q=");
    }).toThrow();
  });

  it("passes suggestion_url through to the dispatch detail", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.addSearchAlias(
        "b",
        "Bing",
        "https://bing.com/search?q=",
        "s",
        "https://bing.com/suggest?q=",
      );
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "addSearchAlias");
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[5]).toBe("https://bing.com/suggest?q=");
  });
});

// ---------------------------------------------------------------------------
// unmap / iunmap / vunmap / unmapAllExcept — surfingkeys:api dispatches
// ---------------------------------------------------------------------------

describe("unmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['unmap', keystroke, domain]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const domain = /example\.com/;
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.unmap("g", domain);
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "unmap" && e.detail[1] === "g",
    );
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[2]).toBe(domain);
  });
});

describe("iunmap (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['iunmap', keystroke]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
  it("dispatches a surfingkeys:api event with ['unmapAllExcept', keystrokes, domain]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const domain = /example\.com/;
    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.unmapAllExcept(["a", "b"], domain);
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "unmapAllExcept");
    expect(evt).not.toBeUndefined();
    expect((evt as CustomEvent).detail[1]).toEqual(["a", "b"]);
    expect((evt as CustomEvent).detail[2]).toBe(domain);
  });
});

// ---------------------------------------------------------------------------
// removeSearchAlias — dispatches surfingkeys:api
// ---------------------------------------------------------------------------

describe("removeSearchAlias (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['removeSearchAlias', alias, ...]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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

// ---------------------------------------------------------------------------
// Clipboard.write / Clipboard.read — dispatch surfingkeys:api
// ---------------------------------------------------------------------------

describe("Clipboard.write (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['clipboard:write', text]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Clipboard.read(vi.fn());
    });

    const evt = events.find((e) => Array.isArray(e.detail) && e.detail[0] === "clipboard:read");
    expect(evt).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Hints.click — createCssSelectorForElements integration
// ---------------------------------------------------------------------------

describe("Hints.click (via api returned by factory)", () => {
  it("does nothing when no valid HTMLElement is in the links argument", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Hints.click([]);
    });

    const hintClickEvents = events.filter(
      (e) => Array.isArray(e.detail) && e.detail[0] === "hints:click",
    );
    expect(hintClickEvents).toHaveLength(0);
  });

  it("dispatches hints:click with the CSS selector string when passed a string", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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

// ---------------------------------------------------------------------------
// Hints.create — createCssSelectorForElements integration
// ---------------------------------------------------------------------------

describe("Hints.create (via api returned by factory)", () => {
  it("returns false when no valid HTMLElement is in the cssSelector argument", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const result = capturedApi.Hints.create([], vi.fn());
    expect(result).toBe(false);
  });

  it("dispatches hints:create with the selector string when passed a string", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

    const events = captureEvents("surfingkeys:api", () => {
      capturedApi.Hints.create("a", vi.fn());
    });

    const evt = events.find(
      (e) => Array.isArray(e.detail) && e.detail[0] === "hints:create" && e.detail[1] === "a",
    );
    expect(evt).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Normal / Visual / Front — dispatch surfingkeys:api
// ---------------------------------------------------------------------------

describe("Normal.feedkeys (via api returned by factory)", () => {
  it("dispatches a surfingkeys:api event with ['normal:feedkeys', keys]", () => {
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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
    let capturedApi: any;
    createUserScript("chrome-extension://test/", (api) => {
      capturedApi = api;
    });

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

// ---------------------------------------------------------------------------
// Default export factory
// ---------------------------------------------------------------------------

describe("default export factory", () => {
  // jsdom's document.location.href is "about:blank", which does not start with
  // any chrome-extension:// URL, so isInUIFrame() always returns false in jsdom.
  // The user function is therefore always called when window === top (jsdom default).

  it("calls the user function immediately when running in the top frame", () => {
    const uf = vi.fn();
    createUserScript("chrome-extension://abc/", uf);
    expect(uf).toHaveBeenCalledOnce();
  });

  it("passes api and settings objects to the user function", () => {
    let receivedApi: any;
    let receivedSettings: any;
    createUserScript("chrome-extension://abc/", (api, settings) => {
      receivedApi = api;
      receivedSettings = settings;
    });

    expect(receivedApi).toBeDefined();
    expect(typeof receivedApi.mapkey).toBe("function");
    expect(receivedSettings).toBeDefined();
  });
});
