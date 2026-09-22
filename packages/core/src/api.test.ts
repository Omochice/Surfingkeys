import { beforeEach, describe, expect, it, vi } from "vitest";

import createAPI from "./api";
import type { EngineEnv } from "./engineEnv";
import KeyboardUtils from "./keyboardUtils";
import Trie from "./trie";

// api delegates tab-opening to env.tabOpenLink, so the stub exposes it as a spy the tests assert
// against; notify forwards to chrome.runtime.sendMessage to keep any other messaging inert.
const env: EngineEnv = {
  notify: (action, args) => {
    chrome.runtime.sendMessage({ ...args, action, needResponse: false });
  },
  isInUIFrame: () => false,
  reportIssue: () => {},
  tabOpenLink: vi.fn(),
  getExtensionURL: (path) => chrome.runtime.getURL(path),
  log: () => {},
  surfingkeys: undefined,
};

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
    keymap: { reset: vi.fn() },
    enter: vi.fn(),
    exit: vi.fn(),
  };

  const normal: any = {
    name: "Normal",
    mappings: normalMappings,
    keymap: { reset: vi.fn() },
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
    style: vi.fn(),
  };

  const front: any = {
    executeCommand: vi.fn(),
    addSearchAlias: vi.fn(),
    removeSearchAlias: vi.fn(),
    openOmnibar: vi.fn(),
    registerInlineQuery: vi.fn(),
    setHintsCharacters: vi.fn(),
    chooseTab: vi.fn(),
    showUsage: vi.fn(),
    toggleStatus: vi.fn(),
    performInlineQuery: vi.fn(),
  };

  return { clipboard, insert, normal, hints, visual, front };
}

describe("createAPI mapkey", () => {
  it("adds the encoded key to normal.mappings with the supplied annotation", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    const jscode = vi.fn();
    api.mapkey("g", jscode, { annotation: "Go somewhere" });

    const encoded = KeyboardUtils.encodeKeystroke("g");
    const node = ctx.normal.mappings.find(encoded);
    expect(node).not.toBeUndefined();
    expect(node?.meta?.annotation).toContain("Go somewhere");
  });

  it("stores the code function in the mapped node", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    const jscode = vi.fn();
    api.mapkey("x", jscode, { annotation: "test action" });

    const encoded = KeyboardUtils.encodeKeystroke("x");
    const node = ctx.normal.mappings.find(encoded);
    expect(node?.meta?.code).toBe(jscode);
  });

  it("does not add a mapping when the domain regex does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("z", vi.fn(), {
      annotation: "unreachable",
      domain: /this-domain-will-never-match\.example/,
    });

    const encoded = KeyboardUtils.encodeKeystroke("z");
    const node = ctx.normal.mappings.find(encoded);
    expect(node).toBeUndefined();
  });

  it("stores repeatIgnore on the node when the option is set", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("r", vi.fn(), { annotation: "no repeat", repeatIgnore: true });

    const encoded = KeyboardUtils.encodeKeystroke("r");
    const node = ctx.normal.mappings.find(encoded);
    expect(node?.meta?.repeatIgnore).toBe(true);
  });

  it("omitting annotation produces the same node as passing an empty string", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("m", vi.fn());
    const withoutAnnotation = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("m"))?.meta;

    api.mapkey("n", vi.fn(), { annotation: "" });
    const withEmptyAnnotation = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("n"))?.meta;

    expect(withoutAnnotation?.annotation).toBe(withEmptyAnnotation?.annotation);
    expect(withoutAnnotation?.annotation).toBe("");
  });

  it("takes the group from the options", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("f", vi.fn(), {
      annotation: "Search selected with Google",
      group: "searchSelectedWith",
    });

    const encoded = KeyboardUtils.encodeKeystroke("f");
    const node = ctx.normal.mappings.find(encoded);
    expect(node?.meta?.group).toBe("searchSelectedWith");
  });
});

describe("createAPI vmapkey", () => {
  it("adds the key to visual.mappings, not normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.vmapkey("v", vi.fn(), { annotation: "visual action" });

    const encoded = KeyboardUtils.encodeKeystroke("v");
    expect(ctx.visual.mappings.find(encoded)).not.toBeUndefined();
    expect(ctx.normal.mappings.find(encoded)).toBeUndefined();
  });

  it("assigns the Visual Mode group to visual mode mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.vmapkey("q", vi.fn(), { annotation: "visual query" });

    const encoded = KeyboardUtils.encodeKeystroke("q");
    const node = ctx.visual.mappings.find(encoded);
    expect(node?.meta?.group).toBe("visualMode");
  });
});

describe("createAPI imapkey", () => {
  it("adds the key to insert.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.imapkey("i", vi.fn(), { annotation: "insert action" });

    const encoded = KeyboardUtils.encodeKeystroke("i");
    expect(ctx.insert.mappings.find(encoded)).not.toBeUndefined();
    expect(ctx.normal.mappings.find(encoded)).toBeUndefined();
  });
});

describe("createAPI unmap", () => {
  it("removes a previously mapped key from normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("u", vi.fn(), { annotation: "test" });
    const encoded = KeyboardUtils.encodeKeystroke("u");
    expect(ctx.normal.mappings.find(encoded)).not.toBeUndefined();

    api.unmap("u");
    expect(ctx.normal.mappings.find(encoded)).toBeUndefined();
  });

  it("does nothing when the domain regex does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("w", vi.fn(), { annotation: "test" });
    const encoded = KeyboardUtils.encodeKeystroke("w");

    api.unmap("w", { domain: /this-domain-will-never-match\.example/ });

    expect(ctx.normal.mappings.find(encoded)).not.toBeUndefined();
  });
});

describe("createAPI vunmap", () => {
  it("removes a previously mapped key from visual.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.vmapkey("b", vi.fn(), { annotation: "visual test" });
    const encoded = KeyboardUtils.encodeKeystroke("b");
    expect(ctx.visual.mappings.find(encoded)).not.toBeUndefined();

    api.vunmap("b");
    expect(ctx.visual.mappings.find(encoded)).toBeUndefined();
  });
});

describe("createAPI iunmap", () => {
  it("removes a previously mapped key from insert.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.imapkey("j", vi.fn(), { annotation: "insert test" });
    const encoded = KeyboardUtils.encodeKeystroke("j");
    expect(ctx.insert.mappings.find(encoded)).not.toBeUndefined();

    api.iunmap("j");
    expect(ctx.insert.mappings.find(encoded)).toBeUndefined();
  });
});

describe("createAPI unmapAllExcept", () => {
  it("clears normal mappings except the ones listed", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("a", vi.fn(), { annotation: "first" });
    api.mapkey("b", vi.fn(), { annotation: "second" });

    api.unmapAllExcept(["a"]);

    const encA = KeyboardUtils.encodeKeystroke("a");
    const encB = KeyboardUtils.encodeKeystroke("b");
    expect(ctx.normal.mappings.find(encA)).not.toBeUndefined();
    expect(ctx.normal.mappings.find(encB)).toBeUndefined();
    expect(ctx.normal.keymap.reset).toHaveBeenCalledOnce();
  });

  it("clears insert mappings except the ones listed", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.imapkey("c", vi.fn(), { annotation: "insert c" });
    api.imapkey("d", vi.fn(), { annotation: "insert d" });

    api.unmapAllExcept(["c"]);

    const encC = KeyboardUtils.encodeKeystroke("c");
    const encD = KeyboardUtils.encodeKeystroke("d");
    expect(ctx.insert.mappings.find(encC)).not.toBeUndefined();
    expect(ctx.insert.mappings.find(encD)).toBeUndefined();
    expect(ctx.insert.keymap.reset).toHaveBeenCalledOnce();
  });
});

describe("createAPI cmap", () => {
  it("dispatches a surfingkeys:front event with Omnibar addMapkey args", () => {
    const ctx = makeCtx();
    createAPI(ctx as any, env);

    const captured: CustomEvent[] = [];
    const handler = (e: Event) => captured.push(e as CustomEvent);
    document.addEventListener("surfingkeys:front", handler);

    const api = createAPI(ctx as any, env);
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

describe("createAPI cunmap", () => {
  it("dispatches a surfingkeys:front event with Omnibar removeMapkey args", () => {
    const ctx = makeCtx();
    const captured: CustomEvent[] = [];
    const handler = (e: Event) => captured.push(e as CustomEvent);
    document.addEventListener("surfingkeys:front", handler);

    const api = createAPI(ctx as any, env);
    api.cunmap("<Ctrl-j>");

    document.removeEventListener("surfingkeys:front", handler);

    const evt = captured.find(
      (e) =>
        Array.isArray(e.detail) &&
        e.detail[0] === "removeMapkey" &&
        e.detail[1] === "Omnibar" &&
        e.detail[2] === "<Ctrl-j>",
    );
    expect(evt).not.toBeUndefined();
  });

  it("dispatches nothing when the domain does not match", () => {
    const ctx = makeCtx();
    const dispatched: unknown[][] = [];
    const handler = (e: Event) => dispatched.push((e as CustomEvent).detail);
    document.addEventListener("surfingkeys:front", handler);

    const api = createAPI(ctx as any, env);
    api.cunmap("<Ctrl-j>", { domain: /nomatch\.example\.com/ });

    document.removeEventListener("surfingkeys:front", handler);

    expect(dispatched.filter((d) => Array.isArray(d) && d[0] === "removeMapkey")).toHaveLength(0);
  });
});

describe("createAPI map with command-line prefix", () => {
  it("adds a normal mapping that calls front.executeCommand with the command", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.map("e", ":echo");

    const encoded = KeyboardUtils.encodeKeystroke("e");
    const node = ctx.normal.mappings.find(encoded);
    expect(node).not.toBeUndefined();

    node!.meta!.code!();
    expect(ctx.front.executeCommand).toHaveBeenCalledWith("echo");
  });

  it("warns instead of throwing when the iframe front omits executeCommand", () => {
    const ctx = makeCtx();
    ctx.front = {
      openOmnibar: vi.fn(),
      chooseTab: vi.fn(),
      showUsage: vi.fn(),
      toggleStatus: vi.fn(),
    };
    const log = vi.fn();
    const api = createAPI(ctx as any, { ...env, log });

    api.map("e", ":echo");
    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("e"));
    expect(() => node!.meta!.code!()).not.toThrow();
    expect(log).toHaveBeenCalledWith("warn", ":echo is not available in this frame.");
  });
});

describe("createAPI addSearchAlias key mappings", () => {
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

  it("registers the composed 'sg' search alias in normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("g", "https://www.google.com/search?q=", { prompt: "Google" });

    // Walking only to the 's' root would pass even if the 'g' child were never
    // registered, so the assertions below target the leaf node.
    let node: any = ctx.normal.mappings;
    for (const ch of "sg") {
      node = node?.find(ch);
    }
    expect(node?.meta?.annotation).toEqual(["Search selected with {0}", "Google"]);
    expect(node?.meta?.group).toBe("searchSelectedWith");
    expect(typeof node!.meta!.code).toBe("function");
  });

  it("registers the open-omnibar key 'o<alias>' in normal.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("d", "https://duckduckgo.com/?q=", { prompt: "DuckDuckGo" });

    let node: any = ctx.normal.mappings;
    for (const ch of "od") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
    expect(node.meta.annotation).not.toBeUndefined();
  });

  it("registers the vmapkey 's<alias>' in visual.mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("g", "https://www.google.com/search?q=", { prompt: "Google" });

    let node: any = ctx.visual.mappings;
    for (const ch of "sg") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("calls front.addSearchAlias with alias, searchUrl and the omnibar options", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    const suggestionCb = vi.fn();
    api.addSearchAlias("b", "https://bing.com/search?q=", {
      prompt: "Bing",
      searchLeaderKey: "s",
      suggestionUrl: "https://bing.com/suggest?q=",
      parseSuggestion: suggestionCb,
    });

    expect(ctx.front.addSearchAlias).toHaveBeenCalledWith("b", "https://bing.com/search?q=", {
      prompt: "Bing",
      suggestionUrl: "https://bing.com/suggest?q=",
      parseSuggestion: suggestionCb,
      faviconUrl: undefined,
    });
  });

  it("falls back to the alias as the prompt when none is given", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("q", "https://example.com/?q=");

    let node: any = ctx.normal.mappings;
    for (const ch of "sq") {
      node = node?.find(ch);
    }
    expect(node?.meta?.annotation).toEqual(["Search selected with {0}", "q"]);
  });

  it("throws for a non-ASCII alias", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    expect(() => {
      api.addSearchAlias("日", "https://example.com/?q=", { prompt: "Japanese" });
    }).toThrow();
  });

  it("skips registering any key mappings when skipMaps is true", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("k", "https://kagi.com/search?q=", { prompt: "Kagi", skipMaps: true });

    let node: any = ctx.normal.mappings;
    for (const ch of "sk") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });

  it("registers uppercase alias mappings when alias has a lowercase form", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("g", "https://www.google.com/search?q=", { prompt: "Google" });

    let node: any = ctx.normal.mappings;
    for (const ch of "sG") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("uses a custom searchLeaderKey when provided", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("x", "https://example.com/?q=", { prompt: "Example", searchLeaderKey: "t" });

    let node: any = ctx.normal.mappings;
    for (const ch of "tx") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("uses a custom onlyThisSiteKey when provided", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("y", "https://search.yahoo.com/?q=", {
      prompt: "Yahoo",
      onlyThisSiteKey: "n",
    });

    let node: any = ctx.normal.mappings;
    for (const ch of "sny") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });
});

describe("createAPI removeSearchAlias", () => {
  it("removes normal mode mappings that addSearchAlias created", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("m", "https://developer.mozilla.org/en-US/search?q=", { prompt: "MDN" });

    api.removeSearchAlias("m");

    let node: any = ctx.normal.mappings;
    for (const ch of "sm") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });

  it("removes the mappings of an alias added with custom keys", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("r", "https://example.com/?q=", {
      searchLeaderKey: "t",
      onlyThisSiteKey: "n",
    });

    api.removeSearchAlias("r", { searchLeaderKey: "t", onlyThisSiteKey: "n" });

    let node: any = ctx.normal.mappings;
    for (const ch of "tnr") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });

  it("calls front.removeSearchAlias with the alias", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("p", "https://docs.python.org/3/search.html?q=", { prompt: "Python" });
    ctx.front.removeSearchAlias.mockClear();

    api.removeSearchAlias("p");

    expect(ctx.front.removeSearchAlias).toHaveBeenCalledWith("p");
  });
});

describe("createAPI searchSelectedWith", () => {
  it("passes the constructed URL to tabOpenLink", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    const tabOpenLink = vi.mocked(env.tabOpenLink);
    tabOpenLink.mockClear();

    const getSelection = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "surfingkeys",
    } as any);

    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    api.searchSelectedWith("https://www.google.com/search?q=");

    expect(tabOpenLink).toHaveBeenCalledTimes(1);
    expect(tabOpenLink).toHaveBeenCalledWith(
      `https://www.google.com/search?q=${encodeURIComponent("surfingkeys")}`,
    );

    getSelection.mockRestore();
  });

  it("prepends 'site:<hostname>' to query when onlyThisSite is true", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "test query",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    const tabOpenLink = vi.mocked(env.tabOpenLink);
    tabOpenLink.mockClear();

    api.searchSelectedWith("https://www.google.com/search?q=", { onlyThisSite: true });

    expect(tabOpenLink).toHaveBeenCalledTimes(1);
    const url = tabOpenLink.mock.calls[0]![0] as string;
    expect(url).toContain("site%3A");
    expect(url).toContain("test%20query");

    vi.restoreAllMocks();
  });

  it("opens the omnibar with initialQuery set to the query when interactive is true", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "my query",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    api.searchSelectedWith("https://www.google.com/search?q=", { interactive: true, alias: "g" });

    expect(ctx.front.openOmnibar).toHaveBeenCalledWith({
      type: "SearchEngine",
      extra: "g",
      initialQuery: "my query",
    });

    vi.restoreAllMocks();
  });

  it("falls back to clipboard data when selection is empty", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "clipboard text" }));

    const tabOpenLink = vi.mocked(env.tabOpenLink);
    tabOpenLink.mockClear();

    api.searchSelectedWith("https://www.google.com/search?q=");

    expect(tabOpenLink).toHaveBeenCalledWith(
      `https://www.google.com/search?q=${encodeURIComponent("clipboard text")}`,
    );

    vi.restoreAllMocks();
  });

  it("handles search URL with {0} placeholder correctly", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "hello",
    } as any);
    ctx.clipboard.read.mockImplementation((cb: any) => cb({ data: "" }));

    const tabOpenLink = vi.mocked(env.tabOpenLink);
    tabOpenLink.mockClear();

    api.searchSelectedWith("https://example.com/search?q={0}&lang=en");

    expect(tabOpenLink).toHaveBeenCalledWith(
      `https://example.com/search?q=${encodeURIComponent("hello")}&lang=en`,
    );

    vi.restoreAllMocks();
  });
});

describe("createAPI lmap", () => {
  it("calls normal.addLurkMap with the two keystroke arguments", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.lmap("x", "<Alt-i>");

    expect(ctx.normal.addLurkMap).toHaveBeenCalledWith("x", "<Alt-i>");
  });

  it("does not call normal.addLurkMap when domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.lmap("x", "<Alt-i>", { domain: /this-domain-will-never-match\.example/ });

    expect(ctx.normal.addLurkMap).not.toHaveBeenCalled();
  });
});

describe("createAPI Hints.setCharacters", () => {
  it("calls hints.setCharacters and front.setHintsCharacters with the provided string", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.Hints.setCharacters("asdfghjkl");

    expect(ctx.hints.setCharacters).toHaveBeenCalledWith("asdfghjkl");
    expect(ctx.front.setHintsCharacters).toHaveBeenCalledWith("asdfghjkl");
  });

  it("skips front.setHintsCharacters when front lacks it", () => {
    const ctx = makeCtx();
    ctx.front.setHintsCharacters = undefined;
    const api = createAPI(ctx as any, env);
    api.Hints.setCharacters("qwerty");
    expect(ctx.hints.setCharacters).toHaveBeenCalledWith("qwerty");
  });
});

describe("createAPI mapkey override and precedence", () => {
  it("rebinds a key to the newest code when the same key is mapped twice", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    const first = vi.fn();
    const second = vi.fn();
    api.mapkey("g", first, { annotation: "first" });
    api.mapkey("g", second, { annotation: "second" });

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("g"));
    expect(node?.meta?.code).toBe(second);
    expect(node?.meta?.annotation).toContain("second");
  });

  it("refuses to add a longer key whose prefix is already a leaf mapping", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("a", vi.fn(), { annotation: "leaf" });
    api.mapkey("ab", vi.fn(), { annotation: "longer" });

    let node: any = ctx.normal.mappings;
    for (const ch of "ab") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });

  it("overrides a branch node (no own meta) that has descendant mappings", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("ab", vi.fn(), { annotation: "deep" });
    const aLeaf = vi.fn();
    api.mapkey("a", aLeaf, { annotation: "now-a-leaf" });

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("a"));
    expect(node?.meta?.code).toBe(aLeaf);
  });
});

describe("createAPI map special-key and not-found arms", () => {
  it("registers a new alias for an <Esc> special key and notifies front", () => {
    const ctx = makeCtx();
    const dispatched: unknown[][] = [];
    document.addEventListener("surfingkeys:front", (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    const api = createAPI(ctx as any, env);

    api.map("w", "<Esc>");

    expect(
      dispatched.some(
        (d) => Array.isArray(d) && d[0] === "addMapkey" && d[1] === "Mode" && d[2] === "w",
      ),
    ).toBe(true);
  });

  it("does nothing observable in normal.mappings when the source keystroke is unknown", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.map("w", "totally-unknown-keystroke");

    expect(ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("w"))).toBeUndefined();
  });

  it("uses the supplied annotation for a command-line ':' mapping", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.map("e", ":echo", { annotation: "Echo it", group: "tabs" });

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("e"));
    expect(node?.meta?.annotation).toContain("Echo it");
  });

  it("files a ':' mapping with a plain annotation under Misc", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.map("e", ":echo", { annotation: "plain label" });

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("e"));
    expect(node?.meta?.annotation).toContain("plain label");
    expect(node?.meta?.group).toBe("misc");
  });

  it("does not register the mapping when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.map("e", ":echo", { domain: /this-domain-will-never-match\.example/ });

    expect(ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("e"))).toBeUndefined();
  });
});

describe("createAPI unmap special-key arm", () => {
  it("removes a previously mapped special-key alias from the special-key list", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.map("w", "<Esc>");
    const dispatched: unknown[][] = [];
    document.addEventListener("surfingkeys:front", (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    // The alias is not in normal.mappings, so removal is observable only through
    // the re-map below dispatching addMapkey again.
    api.unmap("w");
    api.map("w", "<Esc>");
    const addCount = dispatched.filter(
      (d) => Array.isArray(d) && d[0] === "addMapkey" && d[2] === "w",
    ).length;
    expect(addCount).toBe(1);
  });
});

describe("createAPI imap / vmap", () => {
  it("imap maps a source insert mapping onto a new insert keystroke", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.imapkey("i", vi.fn(), { annotation: "insert source" });
    api.imap("p", "i");

    expect(ctx.insert.mappings.find(KeyboardUtils.encodeKeystroke("p"))?.meta).not.toBeUndefined();
  });

  it("vmap maps a source visual mapping onto a new visual keystroke", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.vmapkey("v", vi.fn(), { annotation: "visual source" });
    api.vmap("p", "v");

    expect(ctx.visual.mappings.find(KeyboardUtils.encodeKeystroke("p"))?.meta).not.toBeUndefined();
  });

  it("imap does nothing when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);
    api.imapkey("i", vi.fn(), { annotation: "insert source" });
    api.imap("p", "i", { domain: /this-domain-will-never-match\.example/ });
    expect(ctx.insert.mappings.find(KeyboardUtils.encodeKeystroke("p"))).toBeUndefined();
  });

  it("vmap does nothing when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);
    api.vmapkey("v", vi.fn(), { annotation: "visual source" });
    api.vmap("p", "v", { domain: /this-domain-will-never-match\.example/ });
    expect(ctx.visual.mappings.find(KeyboardUtils.encodeKeystroke("p"))).toBeUndefined();
  });
});

describe("createAPI unmapAllExcept domain guard", () => {
  it("keeps all mappings when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);
    api.mapkey("a", vi.fn(), { annotation: "first" });
    api.mapkey("b", vi.fn(), { annotation: "second" });

    api.unmapAllExcept(["a"], { domain: /this-domain-will-never-match\.example/ });

    expect(ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("b"))?.meta).not.toBeUndefined();
  });
});

describe("createAPI unmap-family domain guard (no-op when domain mismatches)", () => {
  const noMatch = /this-domain-will-never-match\.example/;

  it("iunmap keeps the insert mapping when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);
    api.imapkey("j", vi.fn(), { annotation: "insert" });
    api.iunmap("j", { domain: noMatch });
    expect(ctx.insert.mappings.find(KeyboardUtils.encodeKeystroke("j"))?.meta).not.toBeUndefined();
  });

  it("vunmap keeps the visual mapping when the domain does not match", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);
    api.vmapkey("b", vi.fn(), { annotation: "visual" });
    api.vunmap("b", { domain: noMatch });
    expect(ctx.visual.mappings.find(KeyboardUtils.encodeKeystroke("b"))?.meta).not.toBeUndefined();
  });

  it("cmap dispatches nothing when the domain does not match", () => {
    const ctx = makeCtx();
    const dispatched: unknown[][] = [];
    document.addEventListener("surfingkeys:front", (e) => {
      dispatched.push((e as CustomEvent).detail);
    });
    const api = createAPI(ctx as any, env);
    api.cmap("ctrl-n", "ctrl-j", { domain: noMatch });
    const omnibarAdds = dispatched.filter((d) => Array.isArray(d) && d[1] === "Omnibar");
    expect(omnibarAdds).toHaveLength(0);
  });
});

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
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("g", "https://www.google.com/search?q=", { prompt: "Google" });
    let node: any = ctx.normal.mappings;
    for (const ch of "sg") {
      node = node?.find(ch);
    }
    expect(node?.meta).not.toBeUndefined();
  });

  it("removeSearchAlias does not unmap capital variants for an already-uppercase alias", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.addSearchAlias("G", "https://www.google.com/search?q=", { prompt: "Google" });
    api.removeSearchAlias("G");
    let node: any = ctx.normal.mappings;
    for (const ch of "sG") {
      node = node?.find(ch);
    }
    expect(node?.meta).toBeUndefined();
  });
});

describe("createAPI map feature group inheritance", () => {
  it("keeps the source mapping's feature group when aliasing a key", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);
    api.mapkey("p", vi.fn(), { annotation: "Choose a tab", group: "tabs" });

    api.map("f", "p");

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("f"));
    expect(node?.meta?.group).toBe("tabs");
  });

  it("keeps the source mapping's feature group when the alias renames the annotation", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);
    api.mapkey("p", vi.fn(), { annotation: "Choose a tab", group: "tabs" });

    api.map("f", "p", { annotation: "Pick a tab" });

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("f"));
    expect(node?.meta?.annotation).toContain("Pick a tab");
    expect(node?.meta?.group).toBe("tabs");
  });
});

describe("createAPI mapkey default feature group", () => {
  it("files a normal-mode mapping with no annotated group under Misc", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.mapkey("zz", vi.fn(), { annotation: "my plain help text" });

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("zz"));
    expect(node?.meta?.group).toBe("misc");
  });

  it("files an insert-mode mapping with no annotated group under Insert Mode", () => {
    const ctx = makeCtx();
    const api = createAPI(ctx as any, env);

    api.imapkey("<Ctrl-y>", vi.fn(), { annotation: "insert action" });

    const node = ctx.insert.mappings.find(KeyboardUtils.encodeKeystroke("<Ctrl-y>"));
    expect(node?.meta?.group).toBe("insertMode");
  });
});

describe("createAPI mapkey with an unknown group", () => {
  it("warns and lists a normal-mode mapping under Misc", () => {
    const ctx = makeCtx();
    const log = vi.fn();
    const api = createAPI(ctx as any, { ...env, log });

    // A user snippet is plain JavaScript, so the type of `group` proves nothing at runtime.
    api.mapkey("zy", vi.fn(), { annotation: "typo group", group: "tabz" } as any);

    const node = ctx.normal.mappings.find(KeyboardUtils.encodeKeystroke("zy"));
    expect(node?.meta?.group).toBe("misc");
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("listing it under misc"));
  });

  it("keeps a visual-mode mapping in its own section and says so", () => {
    const ctx = makeCtx();
    const log = vi.fn();
    const api = createAPI(ctx as any, { ...env, log });

    api.vmapkey("zy", vi.fn(), { annotation: "typo group", group: "tabz" } as any);

    const node = ctx.visual.mappings.find(KeyboardUtils.encodeKeystroke("zy"));
    expect(node?.meta?.group).toBe("visualMode");
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("listing it under visualMode"),
    );
  });
});
