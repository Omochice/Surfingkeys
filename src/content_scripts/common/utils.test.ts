import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import KeyboardUtils from "./keyboardUtils";
import Trie from "./trie";
import {
  attachFaviconToImgSrc,
  constructSearchURL,
  createElementWithContent,
  format,
  generateQuickGuid,
  getAnnotations,
  getBrowserName,
  getColor,
  getNearestWord,
  getRealEdit,
  hintLabel,
  hintLink,
  isEditable,
  isElementClickable,
  listElements,
  mapInMode,
  once,
  parseAnnotation,
  refreshHints,
  regExpReplacer,
  removeAttributes,
  requireElement,
  rotateInput,
  setSanitizedContent,
  toggleQuote,
  tryDecodeURI,
  tryDecodeURIComponent,
} from "./utils";

describe("format", () => {
  it("substitutes positional placeholders", () => {
    expect(format("{0} and {1}", "a", "b")).toBe("a and b");
  });

  it("treats $ sequences in arguments as literal text", () => {
    expect(format("q={0}", "a$&b")).toBe("q=a$&b");
  });
});

describe("getColor", () => {
  it("returns a CSS color string for valid indices", () => {
    expect(typeof getColor(0)).toBe("string");
    expect(getColor(0).startsWith("#")).toBe(true);
  });

  it("returns the same value for the same index", () => {
    expect(getColor(3)).toBe(getColor(3));
  });
});

describe("parseAnnotation", () => {
  it("splits a leading #N from a string annotation into feature_group", () => {
    const result = parseAnnotation({ annotation: "#5Quit chrome" });
    expect(result.feature_group).toBe(5);
    expect(result.annotation).toEqual(["Quit chrome"]);
  });

  it("returns an empty annotation when only the #N marker is present", () => {
    const result = parseAnnotation({ annotation: "#5" });
    expect(result.feature_group).toBe(5);
    expect(result.annotation).toBe("");
  });

  it("leaves a string annotation without #N wrapped in an array", () => {
    const result = parseAnnotation({ annotation: "Plain text" });
    expect(result.feature_group).toBeUndefined();
    expect(result.annotation).toEqual(["Plain text"]);
  });

  it("returns the array form when given an array annotation with a #N marker", () => {
    const result = parseAnnotation({
      annotation: ["#6Search selected with {0}", "Google"],
    });
    expect(result.feature_group).toBe(6);
    expect(result.annotation).toEqual(["Search selected with {0}", "Google"]);
  });
});

// Characterization tests pinning refreshHints before the HintElement WeakMap
// refactor. They record how the function reads `label`/`link` off the elements
// it is handed and how it mutates them; the expected values are whatever the
// current code produces, not a hand-authored spec.
function makeHint(label: string, link: unknown) {
  const el = document.createElement("div");
  hintLabel.set(el, label);
  hintLink.set(el, link);
  return el;
}

describe("refreshHints (characterization)", () => {
  it("returns the matched element's link with zero candidates on exact match", () => {
    const a = makeHint("ab", "LINK_A");
    const b = makeHint("cd", "LINK_B");
    expect(refreshHints([a, b], "ab")).toEqual({ candidates: 0, matched: "LINK_A" });
  });

  it("counts a prefix match, shows it, and highlights the typed prefix in innerHTML", () => {
    const a = makeHint("abc", "LINK_A");
    const result = refreshHints([a], "ab");
    expect(result).toEqual({ candidates: 1 });
    expect(a.style.opacity).toBe("1");
    expect(a.innerHTML).toBe('<span style="opacity: 0.2;">ab</span>c');
  });

  it("hides a non-matching hint via opacity 0", () => {
    const a = makeHint("xyz", "LINK_A");
    refreshHints([a], "ab");
    expect(a.style.opacity).toBe("0");
  });

  it("returns the single hint's link when no keys are pressed", () => {
    const a = makeHint("ab", "LINK_A");
    expect(refreshHints([a], "")).toEqual({ candidates: 0, matched: "LINK_A" });
  });

  it("shows every hint and restores its label when no keys are pressed", () => {
    const a = makeHint("ab", "LINK_A");
    const b = makeHint("cd", "LINK_B");
    const result = refreshHints([a, b], "");
    expect(result).toEqual({ candidates: 2 });
    expect(a.style.opacity).toBe("1");
    expect(a.innerHTML).toBe("ab");
  });
});

// Settings may contain RegExp values (e.g. nextLinkRegex). They are serialized
// to { source, flags } when persisted/cloned and rehydrated via
// `new RegExp(source, flags)` by ensureRegex. These tests pin that round-trip
// through the regExpReplacer used at the JSON.stringify call sites.
describe("RegExp settings serialization", () => {
  it("serializes a RegExp to its source and flags", () => {
    const settings = { pat: /foo\d+/gi, n: 1 };
    expect(JSON.parse(JSON.stringify(settings, regExpReplacer))).toEqual({
      pat: { source: "foo\\d+", flags: "gi" },
      n: 1,
    });
  });

  it("round-trips a serialized RegExp back into an equivalent RegExp", () => {
    const original = /bar/i;
    const clone = JSON.parse(JSON.stringify({ pat: original }, regExpReplacer)).pat;
    const restored = new RegExp(clone.source, clone.flags);
    expect(restored.source).toBe(original.source);
    expect(restored.flags).toBe(original.flags);
  });
});

describe("removeAttributes", () => {
  it("removes every attribute from the element", () => {
    const el = document.createElement("div");
    el.setAttribute("id", "x");
    el.setAttribute("class", "y");
    el.setAttribute("data-z", "1");
    removeAttributes(el);
    expect(el.attributes.length).toBe(0);
  });
});

describe("requireElement", () => {
  it("returns the element matching the selector", () => {
    const el = document.createElement("div");
    el.id = "require-element-target";
    document.body.appendChild(el);
    try {
      expect(requireElement("#require-element-target")).toBe(el);
    } finally {
      el.remove();
    }
  });

  it("throws with the selector when no element matches", () => {
    expect(() => requireElement("#require-element-missing")).toThrow(
      "required element not found: #require-element-missing",
    );
  });
});

describe("getNearestWord", () => {
  it("returns the whole word containing an interior offset", () => {
    const [start, length] = getNearestWord("hello world", 7);
    expect("hello world".substr(start, length)).toBe("world");
  });

  it("returns the leading word when the offset sits on it", () => {
    const [start, length] = getNearestWord("hello world", 2);
    expect("hello world".substr(start, length)).toBe("hello");
  });

  it("jumps to the nearest word when the offset lands on a separator", () => {
    const [start, length] = getNearestWord("ab cd", 2);
    expect("ab cd".substr(start, length)).toBe("ab");
  });

  it("clamps an out-of-range offset to the end of the text", () => {
    const [start, length] = getNearestWord("foo bar", 100);
    expect("foo bar".substr(start, length)).toBe("bar");
  });
});

describe("rotateInput", () => {
  it("advances forward through the full list including the empty slot", () => {
    expect(rotateInput(["x", "y"], false, 0)).toEqual(["y", 1]);
    expect(rotateInput(["x", "y"], false, 1)).toEqual([undefined, 2]);
    expect(rotateInput(["x", "y"], false, 2)).toEqual(["x", 0]);
  });

  it("steps backward and wraps to the empty slot", () => {
    expect(rotateInput(["x", "y"], true, 0)).toEqual([undefined, 2]);
  });

  it("restricts rotation to entries that extend the typed prefix", () => {
    expect(rotateInput(["aa", "ab", "bc"], false, 0, "a")).toEqual(["ab", 1]);
  });

  it("returns the typed prefix itself when rotating onto the empty slot", () => {
    expect(rotateInput(["aa", "ab"], false, 1, "a")).toEqual(["a", 2]);
  });
});

describe("constructSearchURL", () => {
  it("substitutes a {0} placeholder", () => {
    expect(constructSearchURL("https://x/?q={0}", "cat")).toBe("https://x/?q=cat");
  });

  it("substitutes a %s placeholder", () => {
    expect(constructSearchURL("https://x/?q=%s", "cat")).toBe("https://x/?q=cat");
  });

  it("appends the word when the engine has no placeholder", () => {
    expect(constructSearchURL("https://x/?q=", "cat")).toBe("https://x/?q=cat");
  });
});

describe("setSanitizedContent", () => {
  it("strips a script element from the supplied markup", () => {
    const el = document.createElement("div");
    setSanitizedContent(el, "<p>safe</p><script>alert(1)</script>");
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toBe("safe");
  });

  it("drops event-handler attributes", () => {
    const el = document.createElement("div");
    setSanitizedContent(el, '<img src="x" onerror="alert(1)">');
    expect(el.querySelector("img")?.hasAttribute("onerror")).toBe(false);
  });
});

describe("createElementWithContent", () => {
  it("builds an element with the given tag, content and attributes", () => {
    const el = createElementWithContent("a", "label", { href: "#top", id: "a1" });
    expect(el.tagName).toBe("A");
    expect(el.textContent).toBe("label");
    expect(el.getAttribute("href")).toBe("#top");
    expect(el.getAttribute("id")).toBe("a1");
  });
});

describe("isEditable", () => {
  it("treats a textarea as editable", () => {
    expect(isEditable(document.createElement("textarea"))).toBe(true);
  });

  it("treats a text input as editable", () => {
    const input = document.createElement("input");
    input.type = "text";
    expect(isEditable(input)).toBe(true);
  });

  it("rejects a submit input", () => {
    const input = document.createElement("input");
    input.type = "submit";
    expect(isEditable(input)).toBe(false);
  });

  it("rejects a disabled textarea", () => {
    const ta = document.createElement("textarea");
    ta.disabled = true;
    expect(isEditable(ta)).toBe(false);
  });
});

describe("isElementClickable", () => {
  it("recognizes a button as clickable via the built-in selector", () => {
    expect(isElementClickable(document.createElement("button"))).toBe(true);
  });

  it("does not consider a plain div clickable", () => {
    expect(isElementClickable(document.createElement("div"))).toBe(false);
  });
});

describe("tryDecodeURI", () => {
  it("decodes a valid percent-encoded URI", () => {
    const result = tryDecodeURI("a%20b");
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.value).toBe("a b");
    }
  });

  it("fails on a malformed sequence", () => {
    const result = tryDecodeURI("%E0%A4%A");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.error.kind).toBe("decode");
    }
  });
});

describe("tryDecodeURIComponent", () => {
  it("decodes a valid percent-encoded component", () => {
    const result = tryDecodeURIComponent("a%2Fb");
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.value).toBe("a/b");
    }
  });

  it("fails on a malformed sequence", () => {
    const result = tryDecodeURIComponent("%");
    expect(Result.isFailure(result)).toBe(true);
  });
});

// getBrowserName and attachFaviconToImgSrc branch on navigator.userAgent, the
// seam that tells Chrome from Firefox. Override it per-test and restore after.
describe("getBrowserName", () => {
  const original = window.navigator.userAgent;
  const setUserAgent = (value: string) => {
    Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
  };
  afterEach(() => setUserAgent(original));

  it("detects Chrome", () => {
    setUserAgent("Mozilla/5.0 (X11) Chrome/120.0");
    expect(getBrowserName()).toBe("Chrome");
  });

  it("detects Firefox", () => {
    setUserAgent("Mozilla/5.0 (X11; rv:120.0) Gecko/20100101 Firefox/120.0");
    expect(getBrowserName()).toBe("Firefox");
  });

  it("falls back to Chrome for an unknown agent", () => {
    setUserAgent("SomeOtherBrowser/1.0");
    expect(getBrowserName()).toBe("Chrome");
  });
});

describe("attachFaviconToImgSrc", () => {
  const original = window.navigator.userAgent;
  const setUserAgent = (value: string) => {
    Object.defineProperty(window.navigator, "userAgent", { value, configurable: true });
  };
  afterEach(() => setUserAgent(original));

  it("uses the chrome favicon endpoint on Chrome", () => {
    setUserAgent("Chrome/120.0");
    const img = document.createElement("img");
    attachFaviconToImgSrc({ url: "https://example.com/p" }, img);
    expect(img.getAttribute("src")).toBe(
      "/_favicon/?pageUrl=" + encodeURIComponent("https://example.com/p"),
    );
  });

  it("uses the tab favIconUrl on Firefox", () => {
    setUserAgent("Firefox/120.0");
    const img = document.createElement("img");
    attachFaviconToImgSrc(
      { url: "https://example.com/p", favIconUrl: "https://example.com/f.ico" },
      img,
    );
    expect(img.getAttribute("src")).toBe("https://example.com/f.ico");
  });
});

// A real dispatched event carries the element as its target, avoiding a hand-
// built Event object (the codebase forbids type assertions).
function eventFrom(el: EventTarget): Event {
  let captured: Event | undefined;
  el.addEventListener("sk-test", (e) => {
    captured = e;
  });
  el.dispatchEvent(new Event("sk-test"));
  if (captured === undefined) {
    throw new Error("event was not captured");
  }
  return captured;
}

describe("getRealEdit", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("returns the event target when an event is supplied", () => {
    const input = document.createElement("input");
    expect(getRealEdit(eventFrom(input))).toBe(input);
  });

  it("returns the focused element when no event is supplied", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(getRealEdit()).toBe(input);
  });

  it("descends into a shadow root's active element", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const inner = document.createElement("input");
    root.appendChild(inner);
    inner.focus();
    expect(getRealEdit(eventFrom(host))).toBe(inner);
  });
});

describe("toggleQuote", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("wraps the focused input's value in quotes and toggles them back off", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.value = "hello";
    input.focus();

    toggleQuote();
    expect(input.value).toBe('"hello"');

    toggleQuote();
    expect(input.value).toBe("hello");
  });
});

describe("getAnnotations", () => {
  it("collects words with non-empty annotations and their feature groups", () => {
    const trie = new Trie();
    trie.add("x", { annotation: "do x", feature_group: 1 });
    trie.add("y", { annotation: "", feature_group: 2 });
    trie.add("z", { annotation: ["a", "b"], feature_group: 3 });

    const result = getAnnotations(trie);

    expect(result).toContainEqual({ word: "x", feature_group: 1, annotation: "do x" });
    expect(result).toContainEqual({ word: "z", feature_group: 3, annotation: ["a", "b"] });
    // "y" has an empty annotation and is filtered out.
    expect(result.some((m) => m.word === "y")).toBe(false);
  });
});

describe("mapInMode", () => {
  it("rebinds new keys to the meta of an existing mapping", () => {
    const mode = { name: "normal", mappings: new Trie() };
    const code = () => {};
    mode.mappings.add(KeyboardUtils.encodeKeystroke("j"), { annotation: "down", code });

    const old = mapInMode(mode, "x", "j");

    expect(old).toBeDefined();
    const rebound = mode.mappings.find(KeyboardUtils.encodeKeystroke("x"));
    expect(rebound?.meta?.annotation).toBe("down");
    expect(rebound?.meta?.code).toBe(code);
  });

  it("applies a replacement annotation when given one", () => {
    const mode = { name: "normal", mappings: new Trie() };
    mode.mappings.add(KeyboardUtils.encodeKeystroke("j"), { annotation: "down" });

    mapInMode(mode, "x", "j", "#5Custom");

    const rebound = mode.mappings.find(KeyboardUtils.encodeKeystroke("x"));
    expect(rebound?.meta?.feature_group).toBe(5);
    expect(rebound?.meta?.annotation).toEqual(["Custom"]);
  });

  it("returns undefined when the source mapping does not exist", () => {
    const mode = { name: "normal", mappings: new Trie() };
    expect(mapInMode(mode, "x", "nonexistent")).toBeUndefined();
  });
});

describe("listElements", () => {
  afterEach(() => document.body.replaceChildren());

  it("descends into shadow roots while collecting matching elements", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    const inner = document.createElement("span");
    inner.id = "inner";
    shadow.appendChild(inner);

    const found = listElements(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      (n) => (n as HTMLElement).id === "inner",
    );

    expect(found).toContain(inner);
  });
});

describe("once", () => {
  it("invokes the handler only for the first occurrence of the event", () => {
    const el = document.createElement("button");
    const handler = vi.fn();
    once(el, "click", handler);

    el.dispatchEvent(new Event("click"));
    el.dispatchEvent(new Event("click"));

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("generateQuickGuid", () => {
  it("produces a non-empty alphanumeric string that differs between calls", () => {
    const a = generateQuickGuid();
    const b = generateQuickGuid();
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});
