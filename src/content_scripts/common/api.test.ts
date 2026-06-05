import { beforeEach, describe, expect, it, vi } from "vitest";

import createAPI from "./api";
import KeyboardUtils from "./keyboardUtils";
import Trie from "./trie";

// ---------------------------------------------------------------------------
// Minimal ModeContext factory
// ---------------------------------------------------------------------------

function makeTrie(): Trie {
  const t = new Trie();
  return t;
}

function makeCtx() {
  const normalMappings = makeTrie();
  const insertMappings = makeTrie();
  const visualMappings = makeTrie();

  const clipboard = {
    read: vi.fn(),
    write: vi.fn(),
  };

  const insert: any = {
    name: "Insert",
    mappings: insertMappings,
    map_node: insertMappings,
    enter: vi.fn(),
    exit: vi.fn(),
  };

  const normal: any = {
    name: "Normal",
    mappings: normalMappings,
    map_node: normalMappings,
    feedkeys: vi.fn(),
    jumpVIMark: vi.fn(),
    passThrough: vi.fn(),
    scroll: vi.fn(),
    addLurkMap: vi.fn(),
  };

  const hints: any = {
    click: vi.fn(),
    create: vi.fn(),
    setCharacters: vi.fn(),
    setNumeric: vi.fn(),
    style: vi.fn(),
    dispatchMouseClick: vi.fn(),
  };

  const visual: any = {
    name: "Visual",
    mappings: visualMappings,
    map_node: visualMappings,
    style: vi.fn(),
  };

  const front: any = {
    executeCommand: vi.fn(),
    addSearchAlias: vi.fn(),
    removeSearchAlias: vi.fn(),
    openOmnibar: vi.fn(),
    openOmniquery: vi.fn(),
    registerInlineQuery: vi.fn(),
    setHintsCharacters: vi.fn(),
    chooseTab: vi.fn(),
    showUsage: vi.fn(),
    toggleStatus: vi.fn(),
    performInlineQuery: vi.fn(),
  };

  return { clipboard, insert, normal, hints, visual, front };
}

// ---------------------------------------------------------------------------
// mapkey — normal mode registration
// ---------------------------------------------------------------------------

describe("createAPI mapkey", () => {
  it("adds the encoded key to normal.mappings with the supplied annotation", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    const jscode = vi.fn();
    api.mapkey("g", "Go somewhere", jscode);

    const encoded = KeyboardUtils.encodeKeystroke("g");
    const node = ctx.normal.mappings.find(encoded);
    expect(node).not.toBeUndefined();
    expect(node?.meta?.annotation).toContain("Go somewhere");
  });

  it("stores the code function in the mapped node", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    const jscode = vi.fn();
    api.mapkey("x", "test action", jscode);

    const encoded = KeyboardUtils.encodeKeystroke("x");
    const node = ctx.normal.mappings.find(encoded);
    expect(node?.meta?.code).toBe(jscode);
  });

  it("does not add a mapping when the domain regex does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.mapkey("z", "unreachable", vi.fn(), { domain: /this-domain-will-never-match\.example/ });

    const encoded = KeyboardUtils.encodeKeystroke("z");
    const node = ctx.normal.mappings.find(encoded);
    expect(node).toBeUndefined();
  });

  it("stores repeatIgnore on the node when the option is set", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.mapkey("r", "no repeat", vi.fn(), { repeatIgnore: true });

    const encoded = KeyboardUtils.encodeKeystroke("r");
    const node = ctx.normal.mappings.find(encoded);
    expect(node?.meta?.repeatIgnore).toBe(true);
  });

  it("extracts feature_group from #N annotation prefix", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.mapkey("f", "#6Search selected with Google", vi.fn());

    const encoded = KeyboardUtils.encodeKeystroke("f");
    const node = ctx.normal.mappings.find(encoded);
    expect(node?.meta?.feature_group).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// vmapkey — visual mode registration
// ---------------------------------------------------------------------------

describe("createAPI vmapkey", () => {
  it("adds the key to visual.mappings, not normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.vmapkey("v", "visual action", vi.fn());

    const encoded = KeyboardUtils.encodeKeystroke("v");
    expect(ctx.visual.mappings.find(encoded)).not.toBeUndefined();
    expect(ctx.normal.mappings.find(encoded)).toBeUndefined();
  });

  it("assigns feature_group 9 for visual mode mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.vmapkey("q", "visual query", vi.fn());

    const encoded = KeyboardUtils.encodeKeystroke("q");
    const node = ctx.visual.mappings.find(encoded);
    // visual mode gets feature_group 9 per _mapkey implementation
    expect(node?.meta?.feature_group).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// imapkey — insert mode registration
// ---------------------------------------------------------------------------

describe("createAPI imapkey", () => {
  it("adds the key to insert.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.imapkey("i", "insert action", vi.fn());

    const encoded = KeyboardUtils.encodeKeystroke("i");
    expect(ctx.insert.mappings.find(encoded)).not.toBeUndefined();
    expect(ctx.normal.mappings.find(encoded)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// unmap — removes from normal mode
// ---------------------------------------------------------------------------

describe("createAPI unmap", () => {
  it("removes a previously mapped key from normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.mapkey("u", "test", vi.fn());
    const encoded = KeyboardUtils.encodeKeystroke("u");
    expect(ctx.normal.mappings.find(encoded)).not.toBeUndefined();

    api.unmap("u");
    expect(ctx.normal.mappings.find(encoded)).toBeUndefined();
  });

  it("does nothing when the domain regex does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.mapkey("w", "test", vi.fn());
    const encoded = KeyboardUtils.encodeKeystroke("w");

    api.unmap("w", /this-domain-will-never-match\.example/);

    // mapping should still be present because domain did not match
    expect(ctx.normal.mappings.find(encoded)).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// vunmap — removes from visual mode
// ---------------------------------------------------------------------------

describe("createAPI vunmap", () => {
  it("removes a previously mapped key from visual.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.vmapkey("b", "visual test", vi.fn());
    const encoded = KeyboardUtils.encodeKeystroke("b");
    expect(ctx.visual.mappings.find(encoded)).not.toBeUndefined();

    api.vunmap("b");
    expect(ctx.visual.mappings.find(encoded)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// iunmap — removes from insert mode
// ---------------------------------------------------------------------------

describe("createAPI iunmap", () => {
  it("removes a previously mapped key from insert.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.imapkey("j", "insert test", vi.fn());
    const encoded = KeyboardUtils.encodeKeystroke("j");
    expect(ctx.insert.mappings.find(encoded)).not.toBeUndefined();

    api.iunmap("j");
    expect(ctx.insert.mappings.find(encoded)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// unmapAllExcept — clears both normal and insert, keeping listed keys
// ---------------------------------------------------------------------------

describe("createAPI unmapAllExcept", () => {
  it("clears normal mappings except the ones listed", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.mapkey("a", "first", vi.fn());
    api.mapkey("b", "second", vi.fn());

    api.unmapAllExcept(["a"]);

    const encA = KeyboardUtils.encodeKeystroke("a");
    const encB = KeyboardUtils.encodeKeystroke("b");
    expect(ctx.normal.mappings.find(encA)).not.toBeUndefined();
    expect(ctx.normal.mappings.find(encB)).toBeUndefined();
  });

  it("clears insert mappings except the ones listed", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.imapkey("c", "insert c", vi.fn());
    api.imapkey("d", "insert d", vi.fn());

    api.unmapAllExcept(["c"]);

    const encC = KeyboardUtils.encodeKeystroke("c");
    const encD = KeyboardUtils.encodeKeystroke("d");
    expect(ctx.insert.mappings.find(encC)).not.toBeUndefined();
    expect(ctx.insert.mappings.find(encD)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// cmap — dispatches addMapkey event to front (Omnibar)
// ---------------------------------------------------------------------------

describe("createAPI cmap", () => {
  it("dispatches a surfingkeys:front event with Omnibar addMapkey args", () => {
    const ctx = makeCtx();
    createAPI(ctx as any);

    // cmap dispatches via dispatchSKEvent which fires a CustomEvent on document.
    // Capture it before creating the api.
    const captured: CustomEvent[] = [];
    const handler = (e: Event) => captured.push(e as CustomEvent);
    document.addEventListener("surfingkeys:front", handler);

    const api = createAPI(ctx as any);
    api.cmap("ctrl-n", "ctrl-j");

    document.removeEventListener("surfingkeys:front", handler);

    const evt = captured.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "addMapkey" &&
        e.detail[1] === "Omnibar" &&
        e.detail[2] === "ctrl-n" &&
        e.detail[3] === "ctrl-j",
    );
    expect(evt).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// map with ':' prefix — executes an omnibar command
// ---------------------------------------------------------------------------

describe("createAPI map with command-line prefix", () => {
  it("adds a normal mapping that calls front.executeCommand with the command", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.map("e", ":echo");

    const encoded = KeyboardUtils.encodeKeystroke("e");
    const node = ctx.normal.mappings.find(encoded);
    expect(node).not.toBeUndefined();

    // Invoke the bound code — it should delegate to front.executeCommand
    node!.meta!.code!();
    expect(ctx.front.executeCommand).toHaveBeenCalledWith("echo");
  });
});

// ---------------------------------------------------------------------------
// addSearchAlias — key mapping registrations
// ---------------------------------------------------------------------------

describe("createAPI addSearchAlias key mappings", () => {
  beforeEach(() => {
    // Ensure window.location.href is well-defined for domain checks
    Object.defineProperty(window, "location", {
      value: {
        href: "https://example.com/",
        hostname: "example.com",
        origin: "https://example.com",
      },
      configurable: true,
    });
  });

  it("registers the composed 'sg' search alias in normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("g", "Google", "https://www.google.com/search?q=");

    // Default leader key is 's', so the alias is the composed sequence 'sg'.
    // Walking only to the 's' root would pass even if the 'g' child were never
    // registered, so assert the leaf node carries the alias annotation + code.
    let node: any = ctx.normal.mappings;
    for (const ch of "sg") {
      node = node?.find(ch);
    }
    // The "#6" prefix is parsed off into feature_group, leaving the prompt
    // interpolated with the engine name in the annotation array.
    expect(node?.meta?.annotation).toEqual(["Search selected with {0}", "Google"]);
    expect(node?.meta?.feature_group).toBe(6);
    expect(typeof node!.meta!.code).toBe("function");
  });

  it("registers the open-omnibar key 'o<alias>' in normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("d", "DuckDuckGo", "https://duckduckgo.com/?q=");

    // 'od' should be registered
    let node: any = ctx.normal.mappings;
    for (const ch of "od") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
    expect(node.meta.annotation).not.toBeUndefined();
  });

  it("registers the vmapkey 's<alias>' in visual.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("g", "Google", "https://www.google.com/search?q=");

    // visual mode should have 'sg'
    let node: any = ctx.visual.mappings;
    for (const ch of "sg") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("calls front.addSearchAlias with alias, prompt, search_url and options", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    const suggestionCb = vi.fn();
    api.addSearchAlias(
      "b",
      "Bing",
      "https://bing.com/search?q=",
      "s",
      "https://bing.com/suggest?q=",
      suggestionCb,
    );

    expect(ctx.front.addSearchAlias).toHaveBeenCalledWith(
      "b",
      "Bing",
      "https://bing.com/search?q=",
      "https://bing.com/suggest?q=",
      suggestionCb,
      undefined,
    );
  });

  it("throws for a non-ASCII alias", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    expect(() => {
      api.addSearchAlias("日", "Japanese", "https://example.com/?q=");
    }).toThrow();
  });

  it("skips registering any key mappings when skipMaps is true", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    // Before: no mappings starting with 's' related to this alias
    api.addSearchAlias("k", "Kagi", "https://kagi.com/search?q=", "s", undefined, undefined, "o", {
      skipMaps: true,
    });

    // No 'sk' in normal mode
    let node: any = ctx.normal.mappings;
    for (const ch of "sk") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });

  it("registers uppercase alias mappings when alias has a lowercase form", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("g", "Google", "https://www.google.com/search?q=");

    // 'sG' (uppercase) should be registered in normal mappings
    let node: any = ctx.normal.mappings;
    for (const ch of "sG") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("uses a custom search_leader_key when provided", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("x", "Example", "https://example.com/?q=", "t");

    // 'tx' should be in normal.mappings (custom leader 't')
    let node: any = ctx.normal.mappings;
    for (const ch of "tx") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("uses a custom only_this_site_key when provided", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias(
      "y",
      "Yahoo",
      "https://search.yahoo.com/?q=",
      "s",
      undefined,
      undefined,
      "n",
    );

    // 'sny' should be in normal.mappings (custom only_this_site_key 'n')
    let node: any = ctx.normal.mappings;
    for (const ch of "sny") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// removeSearchAlias — unmaps registered keys
// ---------------------------------------------------------------------------

describe("createAPI removeSearchAlias", () => {
  it("removes normal mode mappings that addSearchAlias created", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("m", "MDN", "https://developer.mozilla.org/en-US/search?q=");

    // 'sm' should now be absent after removal
    api.removeSearchAlias("m");

    let node: any = ctx.normal.mappings;
    for (const ch of "sm") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });

  it("calls front.removeSearchAlias with the alias", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("p", "Python", "https://docs.python.org/3/search.html?q=");
    ctx.front.removeSearchAlias.mockClear();

    api.removeSearchAlias("p");

    expect(ctx.front.removeSearchAlias).toHaveBeenCalledWith("p");
  });
});

// ---------------------------------------------------------------------------
// searchSelectedWith — builds and opens the search URL
// ---------------------------------------------------------------------------

describe("createAPI searchSelectedWith", () => {
  it("passes the constructed URL to tabOpenLink via RUNTIME openLink", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    // Simulate a text selection of "surfingkeys"
    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "surfingkeys",
    } as any);

    // clipboard.read is synchronous in our mock — call cb immediately
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    api.searchSelectedWith("https://www.google.com/search?q=");

    // RUNTIME("openLink", ...) sends a chrome runtime message with action=openLink
    const openLinkCalls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "openLink",
    );
    expect(openLinkCalls).toHaveLength(1);
    expect(openLinkCalls[0]![0].url).toBe(
      `https://www.google.com/search?q=${encodeURIComponent("surfingkeys")}`,
    );

    getSelection.mockRestore();
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });

  it("prepends 'site:<hostname>' to query when onlyThisSite is true", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "test query",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    api.searchSelectedWith("https://www.google.com/search?q=", true);

    const openLinkCalls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "openLink",
    );
    expect(openLinkCalls).toHaveLength(1);
    const url = openLinkCalls[0]![0].url as string;
    // URL should contain the encoded "site:<hostname> test query"
    expect(url).toContain("site%3A");
    expect(url).toContain("test%20query");

    vi.restoreAllMocks();
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });

  it("opens the omnibar with pref set to the query when interactive is true", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "my query",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    api.searchSelectedWith("https://www.google.com/search?q=", false, true, "g");

    expect(ctx.front.openOmnibar).toHaveBeenCalledWith({
      type: "SearchEngine",
      extra: "g",
      pref: "my query",
    });

    vi.restoreAllMocks();
  });

  it("falls back to clipboard data when selection is empty", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "clipboard text" }));

    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    api.searchSelectedWith("https://www.google.com/search?q=");

    const openLinkCalls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "openLink",
    );
    expect(openLinkCalls[0]![0].url).toBe(
      `https://www.google.com/search?q=${encodeURIComponent("clipboard text")}`,
    );

    vi.restoreAllMocks();
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });

  it("handles search URL with {0} placeholder correctly", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "hello",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    const sendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = sendMessage;

    api.searchSelectedWith("https://example.com/search?q={0}&lang=en");

    const openLinkCalls = sendMessage.mock.calls.filter(
      (args: any[]) => args[0]?.action === "openLink",
    );
    expect(openLinkCalls[0]![0].url).toBe(
      `https://example.com/search?q=${encodeURIComponent("hello")}&lang=en`,
    );

    vi.restoreAllMocks();
    (globalThis as any).chrome.runtime.sendMessage = () => {};
  });
});

// ---------------------------------------------------------------------------
// lmap — delegates to normal.addLurkMap
// ---------------------------------------------------------------------------

describe("createAPI lmap", () => {
  it("calls normal.addLurkMap with the two keystroke arguments", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.lmap("x", "<Alt-i>");

    expect(ctx.normal.addLurkMap).toHaveBeenCalledWith("x", "<Alt-i>");
  });

  it("does not call normal.addLurkMap when domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.lmap("x", "<Alt-i>", /this-domain-will-never-match\.example/);

    expect(ctx.normal.addLurkMap).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Hints.setCharacters — delegates to hints and front
// ---------------------------------------------------------------------------

describe("createAPI Hints.setCharacters", () => {
  it("calls hints.setCharacters and front.setHintsCharacters with the provided string", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.Hints.setCharacters("asdfghjkl");

    expect(ctx.hints.setCharacters).toHaveBeenCalledWith("asdfghjkl");
    expect(ctx.front.setHintsCharacters).toHaveBeenCalledWith("asdfghjkl");
  });

  it("skips front.setHintsCharacters when front lacks it", () => {
    const ctx = makeCtx();
    ctx.front.setHintsCharacters = undefined;
    const api = createAPI(ctx as any);
    // The `if (front.setHintsCharacters)` guard takes its false arm; hints still
    // receives the update and nothing throws.
    api.Hints.setCharacters("qwerty");
    expect(ctx.hints.setCharacters).toHaveBeenCalledWith("qwerty");
  });
});

// ---------------------------------------------------------------------------
// mapkey override + prefix-precedence guard arms
// ---------------------------------------------------------------------------

describe("createAPI mapkey override and precedence", () => {
  it("rebinds a key to the newest code when the same key is mapped twice", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    const first = vi.fn();
    const second = vi.fn();
    api.mapkey("g", "first", first);
    api.mapkey("g", "second", second);

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("g"));
    // The override arm removes the old mapping and binds the new code.
    expect(node?.meta?.code).toBe(second);
    expect(node?.meta?.annotation).toContain("second");
  });

  it("refuses to add a longer key whose prefix is already a leaf mapping", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.mapkey("a", "leaf", vi.fn());
    // 'ab' would shadow the existing leaf 'a', so the precedence guard returns
    // early and 'ab' is never registered.
    api.mapkey("ab", "longer", vi.fn());

    let node: any = ctx.normal.mappings;
    for (const ch of "ab") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });

  it("overrides a branch node (no own meta) that has descendant mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    // 'ab' makes 'a' a branch node without its own meta. Mapping 'a' then removes
    // that branch (exercising the `old.meta` false arm that reports child metas)
    // and binds 'a' as a leaf.
    api.mapkey("ab", "deep", vi.fn());
    const aLeaf = vi.fn();
    api.mapkey("a", "now-a-leaf", aLeaf);

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("a"));
    expect(node?.meta?.code).toBe(aLeaf);
  });
});

// ---------------------------------------------------------------------------
// map — special-key and not-found arms
// ---------------------------------------------------------------------------

describe("createAPI map special-key and not-found arms", () => {
  it("registers a new alias for an <Esc> special key and notifies front", () => {
    const ctx = makeCtx();
    const dispatched: unknown[][] = [];
    document.addEventListener("surfingkeys:front", (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    const api = createAPI(ctx as any);

    api.map("w", "<Esc>");

    expect(
      dispatched.some(
        (d) => Array.isArray(d) && d[0] === "addMapkey" && d[1] === "Mode" && d[2] === "w",
      ),
    ).toBe(true);
  });

  it("does nothing observable in normal.mappings when the source keystroke is unknown", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.map("w", "totally-unknown-keystroke");

    // The else arm only logs a warning; no normal mapping is created for 'w'.
    expect(ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("w"))).toBeUndefined();
  });

  it("uses the supplied annotation for a command-line ':' mapping", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.map("e", ":echo", undefined, "#3Echo it");

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("e"));
    expect(node?.meta?.annotation).toContain("Echo it");
  });

  it("binds a ':' mapping with a plain annotation that carries no feature group", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    // No "#N" prefix → parseAnnotation yields no feature_group, exercising the
    // `ag.feature_group != null` false arm of createKeyTarget.
    api.map("e", ":echo", undefined, "plain label");

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("e"));
    expect(node?.meta?.annotation).toContain("plain label");
    expect(node?.meta?.feature_group).toBeUndefined();
  });

  it("does not register the mapping when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.map("e", ":echo", /this-domain-will-never-match\.example/);

    expect(ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("e"))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// unmap — special-key removal arm
// ---------------------------------------------------------------------------

describe("createAPI unmap special-key arm", () => {
  it("removes a previously mapped special-key alias from the special-key list", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    // Bind an alias to the <Esc> special key, then unmap it. The alias is not in
    // normal.mappings, so unmap walks specialKeys and splices it out.
    api.map("w", "<Esc>");
    const dispatched: unknown[][] = [];
    document.addEventListener("surfingkeys:front", (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    // Re-mapping after unmap should re-add the alias (proving it was removed).
    api.unmap("w");
    api.map("w", "<Esc>");
    const addCount = dispatched.filter(
      (d) => Array.isArray(d) && d[0] === "addMapkey" && d[2] === "w",
    ).length;
    expect(addCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// imap / vmap / iunmap / cmap / vunmap — registration + domain-guard arms
// ---------------------------------------------------------------------------

describe("createAPI imap / vmap", () => {
  it("imap maps a source insert mapping onto a new insert keystroke", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.imapkey("i", "insert source", vi.fn());
    api.imap("p", "i");

    expect(ctx.insert.mappings.find(KeyboardUtils.encodeKeystroke("p"))?.meta).not.toBeUndefined();
  });

  it("vmap maps a source visual mapping onto a new visual keystroke", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.vmapkey("v", "visual source", vi.fn());
    api.vmap("p", "v");

    expect(ctx.visual.mappings.find(KeyboardUtils.encodeKeystroke("p"))?.meta).not.toBeUndefined();
  });

  it("imap does nothing when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);
    api.imapkey("i", "insert source", vi.fn());
    api.imap("p", "i", /this-domain-will-never-match\.example/);
    expect(ctx.insert.mappings.find(KeyboardUtils.encodeKeystroke("p"))).toBeUndefined();
  });

  it("vmap does nothing when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);
    api.vmapkey("v", "visual source", vi.fn());
    api.vmap("p", "v", /this-domain-will-never-match\.example/);
    expect(ctx.visual.mappings.find(KeyboardUtils.encodeKeystroke("p"))).toBeUndefined();
  });
});

describe("createAPI unmapAllExcept domain guard", () => {
  it("keeps all mappings when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);
    api.mapkey("a", "first", vi.fn());
    api.mapkey("b", "second", vi.fn());

    api.unmapAllExcept(["a"], /this-domain-will-never-match\.example/);

    // Domain guard short-circuits, so even the un-listed 'b' survives.
    expect(ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("b"))?.meta).not.toBeUndefined();
  });
});

describe("createAPI unmap-family domain guard (no-op when domain mismatches)", () => {
  const noMatch = /this-domain-will-never-match\.example/;

  it("iunmap keeps the insert mapping when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);
    api.imapkey("j", "insert", vi.fn());
    api.iunmap("j", noMatch);
    expect(ctx.insert.mappings.find(KeyboardUtils.encodeKeystroke("j"))?.meta).not.toBeUndefined();
  });

  it("vunmap keeps the visual mapping when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);
    api.vmapkey("b", "visual", vi.fn());
    api.vunmap("b", noMatch);
    expect(ctx.visual.mappings.find(KeyboardUtils.encodeKeystroke("b"))?.meta).not.toBeUndefined();
  });

  it("cmap dispatches nothing when the domain does not match", () => {
    const ctx = makeCtx();
    const dispatched: unknown[][] = [];
    document.addEventListener("surfingkeys:front", (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    const api = createAPI(ctx as any);
    api.cmap("ctrl-n", "ctrl-j", noMatch);
    const omnibarAdds = dispatched.filter((d) => Array.isArray(d) && d[1] === "Omnibar");
    expect(omnibarAdds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addSearchAlias / removeSearchAlias — defensive front + uppercase-alias arms
// ---------------------------------------------------------------------------

describe("createAPI search-alias defensive arms", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: {
        href: "https://example.com/",
        hostname: "example.com",
        origin: "https://example.com",
      },
      configurable: true,
    });
  });

  it("addSearchAlias still registers key mappings when front lacks addSearchAlias", () => {
    const ctx = makeCtx();
    ctx.front.addSearchAlias = undefined;
    const api = createAPI(ctx as any);

    // The `&& front.addSearchAlias` short-circuit takes its false arm; local key
    // mappings are still created.
    api.addSearchAlias("g", "Google", "https://www.google.com/search?q=");
    let node: any = ctx.normal.mappings;
    for (const ch of "sg") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("removeSearchAlias does not unmap capital variants for an already-uppercase alias", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any);

    api.addSearchAlias("G", "Google", "https://www.google.com/search?q=");
    // capitalAlias === alias ("G"), so the `if (capitalAlias !== alias)` arm is
    // false and the base 'sG' mapping is the one removed.
    api.removeSearchAlias("G");
    let node: any = ctx.normal.mappings;
    for (const ch of "sG") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });
});
