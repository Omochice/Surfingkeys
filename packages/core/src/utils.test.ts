import { Result } from "@praha/byethrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import { conf } from "./conf";
import KeyboardUtils from "./keyboardUtils";
import Trie from "./trie";
import {
  applyUserSettings,
  constructSearchURL,
  createElementWithContent,
  format,
  generateQuickGuid,
  getAnnotations,
  getBrowserName,
  getColor,
  getDocumentOrigin,
  getNearestWord,
  getRealEdit,
  hintLabel,
  hintLink,
  isEditable,
  isElementClickable,
  listElements,
  mapInMode,
  normalizeAnnotation,
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

function captureFrontEvents(run: () => void): unknown[] {
  const details: unknown[] = [];
  const handler = (e: Event) => details.push((e as CustomEvent).detail);
  document.addEventListener("surfingkeys:front", handler);
  run();
  document.removeEventListener("surfingkeys:front", handler);
  return details;
}

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

describe("normalizeAnnotation", () => {
  it("wraps a string annotation in an array", () => {
    expect(normalizeAnnotation("Quit chrome")).toEqual(["Quit chrome"]);
  });

  it("leaves an array annotation and its format arguments intact", () => {
    expect(normalizeAnnotation(["Search selected with {0}", "Google"])).toEqual([
      "Search selected with {0}",
      "Google",
    ]);
  });

  it("returns an empty annotation when the text is empty", () => {
    expect(normalizeAnnotation("")).toBe("");
  });

  it("returns an empty annotation when the first element is empty", () => {
    expect(normalizeAnnotation(["", "ignored"])).toBe("");
  });

  it("returns an empty annotation when the array is empty", () => {
    expect(normalizeAnnotation([])).toBe("");
  });
});

// The expected values below are whatever the current code produces, not a
// hand-authored spec.
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
    el.dataset["z"] = "1";
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
    expect("hello world".slice(start, start + length)).toBe("world");
  });

  it("returns the leading word when the offset sits on it", () => {
    const [start, length] = getNearestWord("hello world", 2);
    expect("hello world".slice(start, start + length)).toBe("hello");
  });

  it("jumps to the nearest word when the offset lands on a separator", () => {
    const [start, length] = getNearestWord("ab cd", 2);
    expect("ab cd".slice(start, start + length)).toBe("ab");
  });

  it("clamps an out-of-range offset to the end of the text", () => {
    const [start, length] = getNearestWord("foo bar", 100);
    expect("foo bar".slice(start, start + length)).toBe("bar");
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
    trie.add("x", { annotation: "do x", group: "mouseClick" });
    trie.add("y", { annotation: "", group: "scroll" });
    trie.add("z", { annotation: ["a", "b"], group: "tabs" });

    const result = getAnnotations(trie);

    expect(result).toContainEqual({ word: "x", group: "mouseClick", annotation: "do x" });
    expect(result).toContainEqual({ word: "z", group: "tabs", annotation: ["a", "b"] });
    expect(result.some((m) => m.word === "y")).toBe(false);
  });
});

describe("mapInMode", () => {
  it("rebinds new keys to the meta of an existing mapping", () => {
    const mode = { name: "normal", mappings: new Trie() };
    const code = () => {};
    mode.mappings.add(KeyboardUtils.encodeKeystroke("j"), { annotation: "down", code });

    const old = mapInMode(mode, "x", "j", false);

    expect(old).toBeDefined();
    const rebound = mode.mappings.find(KeyboardUtils.encodeKeystroke("x"));
    expect(rebound?.meta?.annotation).toBe("down");
    expect(rebound?.meta?.code).toBe(code);
  });

  it("applies a replacement annotation while keeping the source group", () => {
    const mode = { name: "normal", mappings: new Trie() };
    mode.mappings.add(KeyboardUtils.encodeKeystroke("j"), {
      annotation: "down",
      group: "sessions",
    });

    mapInMode(mode, "x", "j", false, "Custom");

    const rebound = mode.mappings.find(KeyboardUtils.encodeKeystroke("x"));
    expect(rebound?.meta?.group).toBe("sessions");
    expect(rebound?.meta?.annotation).toEqual(["Custom"]);
  });

  it("returns undefined when the source mapping does not exist", () => {
    const mode = { name: "normal", mappings: new Trie() };
    expect(mapInMode(mode, "x", "nonexistent", false)).toBeUndefined();
  });

  it("does not create a mapping from a keystroke that is only a prefix of longer ones", () => {
    const mode = { name: "normal", mappings: new Trie() };
    mode.mappings.add(KeyboardUtils.encodeKeystroke("jk"), { annotation: "down", code: () => {} });

    expect(mapInMode(mode, "x", "j", false)).toBeUndefined();
    expect(mode.mappings.find(KeyboardUtils.encodeKeystroke("x"))).toBeUndefined();
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

describe("generateQuickGuid", () => {
  it("produces a non-empty alphanumeric string that differs between calls", () => {
    const a = generateQuickGuid();
    const b = generateQuickGuid();
    expect(a).toMatch(/^[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe("format — additional branches", () => {
  it("returns the template unchanged when no arguments are supplied", () => {
    expect(format("no placeholders here")).toBe("no placeholders here");
  });

  it("replaces multiple distinct placeholders in a single pass", () => {
    expect(format("{0}/{1}/{2}", "a", "b", "c")).toBe("a/b/c");
  });
});

describe("regExpReplacer — non-RegExp value passthrough", () => {
  it("returns a non-RegExp value unchanged", () => {
    const replacer = regExpReplacer;
    expect(replacer("key", 42)).toBe(42);
    expect(replacer("key", "hello")).toBe("hello");
    expect(replacer("key", null)).toBeNull();
  });
});

describe("isEditable — additional element types", () => {
  it("treats a select element as editable", () => {
    expect(isEditable(document.createElement("select"))).toBe(true);
  });

  it("treats a number input as editable", () => {
    const input = document.createElement("input");
    input.type = "number";
    expect(isEditable(input)).toBe(true);
  });

  it("treats a password input as editable", () => {
    const input = document.createElement("input");
    input.type = "password";
    expect(isEditable(input)).toBe(true);
  });

  it("treats a radio input as non-editable", () => {
    const input = document.createElement("input");
    input.type = "radio";
    expect(isEditable(input)).toBe(false);
  });

  it("treats a checkbox input as non-editable", () => {
    const input = document.createElement("input");
    input.type = "checkbox";
    expect(isEditable(input)).toBe(false);
  });

  it("returns a falsy value for a null element (falsy element guard)", () => {
    expect(isEditable(null)).toBeFalsy();
  });

  it("returns false for a disabled select", () => {
    const sel = document.createElement("select");
    sel.disabled = true;
    expect(isEditable(sel)).toBe(false);
  });

  it("matches an element via editableSelector when it would otherwise fail type checks", () => {
    const previous = conf.editableSelector;
    conf.editableSelector = "div.custom-editor";
    try {
      const div = document.createElement("div");
      div.className = "custom-editor";
      expect(isEditable(div)).toBe(true);
    } finally {
      conf.editableSelector = previous;
    }
  });
});

describe("isElementClickable — additional branches", () => {
  it("considers an element with role=button as clickable", () => {
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    expect(isElementClickable(el)).toBe(true);
  });

  it("considers an anchor element as clickable via the selector", () => {
    const el = document.createElement("a");
    expect(isElementClickable(el)).toBe(true);
  });

  it("considers a child of an anchor clickable via closest()", () => {
    const anchor = document.createElement("a");
    const span = document.createElement("span");
    anchor.appendChild(span);
    document.body.appendChild(anchor);
    try {
      expect(isElementClickable(span)).toBe(true);
    } finally {
      anchor.remove();
    }
  });

  it("appends the custom clickableSelector when non-empty and uses it", () => {
    const previous = conf.clickableSelector;
    conf.clickableSelector = ".my-clickable";
    try {
      const el = document.createElement("div");
      el.className = "my-clickable";
      expect(isElementClickable(el)).toBe(true);
    } finally {
      conf.clickableSelector = previous;
    }
  });
});

describe("constructSearchURL — additional branches", () => {
  it("appends the word when {0} appears at position 0 (not > 0)", () => {
    expect(constructSearchURL("{0}extra", "cat")).toBe("{0}extracat");
  });

  it("appends the word when neither placeholder is present", () => {
    expect(constructSearchURL("https://x/search?q=", "dog")).toBe("https://x/search?q=dog");
  });
});

describe("rotateInput — additional branches", () => {
  it("clamps curr to list.length when it exceeds the filtered list size", () => {
    expect(rotateInput(["aa", "ab", "bc"], false, 5, "a")).toEqual(["aa", 0]);
  });

  it("steps backward through a prefix-filtered list", () => {
    expect(rotateInput(["aa", "ab", "bc"], true, 1, "a")).toEqual(["aa", 0]);
  });

  it("returns str when rotating past the last filtered entry backward", () => {
    expect(rotateInput(["aa", "ab", "bc"], true, 0, "a")).toEqual(["a", 2]);
  });

  it("wraps forward from the last slot back to the first entry", () => {
    expect(rotateInput(["x", "y"], false, 2)).toEqual(["x", 0]);
  });
});

describe("createElementWithContent — optional parameter branches", () => {
  it("builds an element without content when content is omitted", () => {
    const el = createElementWithContent("div");
    expect(el.tagName).toBe("DIV");
    expect(el.innerHTML).toBe("");
  });

  it("builds an element without attributes when attributes is omitted", () => {
    const el = createElementWithContent("span", "hello");
    expect(el.tagName).toBe("SPAN");
    expect(el.textContent).toBe("hello");
    expect(el.attributes.length).toBe(0);
  });
});

describe("getRealEdit — additional shadow-root branches", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("falls through to the host when shadow root has no activeElement and no input", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.attachShadow({ mode: "open" });
    expect(getRealEdit(eventFrom(host))).toBe(host);
  });
});

describe("getNearestWord — negative offset clamping", () => {
  it("clamps a negative offset to 0 and returns the leading word", () => {
    const [start, length] = getNearestWord("hello world", -5);
    expect("hello world".slice(start, start + length)).toBe("hello");
  });
});

describe("refreshHints — additional branches", () => {
  it("accumulates multiple prefix-matched candidates in a single pass", () => {
    const a = makeHint("aa", "LINK_A");
    const b = makeHint("ab", "LINK_B");
    const c = makeHint("bc", "LINK_C");
    const result = refreshHints([a, b, c], "a");
    expect(result.candidates).toBe(2);
    expect(a.style.opacity).toBe("1");
    expect(b.style.opacity).toBe("1");
    expect(c.style.opacity).toBe("0");
  });

  it("stops iterating immediately when an exact match is found", () => {
    const a = makeHint("ab", "LINK_A");
    const b = makeHint("ab", "LINK_B");
    const result = refreshHints([a, b], "ab");
    expect(result.matched).toBe("LINK_A");
    expect(result.candidates).toBe(0);
  });
});

describe("mapInMode — additional branches", () => {
  it("accepts an annotation supplied as a string array", () => {
    const mode = { name: "normal", mappings: new Trie() };
    mode.mappings.add(KeyboardUtils.encodeKeystroke("k"), { annotation: "up" });

    mapInMode(mode, "y", "k", false, ["Custom annotation", "param"]);

    const rebound = mode.mappings.find(KeyboardUtils.encodeKeystroke("y"));
    expect(rebound?.meta?.annotation).toEqual(["Custom annotation", "param"]);
  });
});

describe("getAnnotations — filtering of empty annotations", () => {
  it("excludes entries whose annotation is an empty string", () => {
    const trie = new Trie();
    trie.add("a", { annotation: "", group: "mouseClick" });
    trie.add("b", { annotation: "keep", group: "scroll" });
    const result = getAnnotations(trie);
    expect(result.some((m) => m.word === "a")).toBe(false);
    expect(result.some((m) => m.word === "b")).toBe(true);
  });
});

describe("listElements — filter false branch", () => {
  afterEach(() => document.body.replaceChildren());

  it("excludes elements for which the filter returns false", () => {
    const div = document.createElement("div");
    div.id = "exclude-me";
    document.body.appendChild(div);

    const found = listElements(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      (n) => n.id === "never-matches",
    );

    expect(found).not.toContain(div);
  });
});

describe("toggleQuote — trailing-quote-only arm", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("strips surrounding quotes when the value ends with a quote only", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.value = 'hello"';
    input.focus();
    toggleQuote();
    expect(input.value).toBe("hello");
  });
});

describe("applyUserSettings", () => {
  it("dispatches applySettingsFromSnippets when the settings object is non-empty", () => {
    const details = captureFrontEvents(() => {
      applyUserSettings({ error: "", settings: { foo: 1 } }, vi.fn());
    });
    expect(details).toContainEqual(["applySettingsFromSnippets", { foo: 1 }]);
  });

  it("does not dispatch when the settings object is empty", () => {
    const details = captureFrontEvents(() => {
      applyUserSettings({ error: "", settings: {} }, vi.fn());
    });
    expect(details.some((d) => Array.isArray(d) && d[0] === "applySettingsFromSnippets")).toBe(
      false,
    );
  });

  it("surfaces a settings error via showPopup at the top frame", () => {
    // jsdom runs as the top frame, which is what selects the showPopup arm.
    const details = captureFrontEvents(() => {
      applyUserSettings({ error: "bad config", settings: {} }, vi.fn());
    });
    expect(details).toContainEqual([
      "showPopup",
      "[SurfingKeys] Error found in settings: bad config",
    ]);
  });
});

describe("getDocumentOrigin", () => {
  it("returns the window origin for a normal http(s) page", () => {
    expect(getDocumentOrigin()).toBe(window.location.origin);
  });

  it("replaces a file:// origin with '*'", () => {
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { origin: "file://" },
      configurable: true,
    });
    expect(getDocumentOrigin()).toBe("*");
    Object.defineProperty(window, "location", { value: realLocation, configurable: true });
  });

  it("falls back to '*' when the origin is empty", () => {
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      value: { origin: "" },
      configurable: true,
    });
    expect(getDocumentOrigin()).toBe("*");
    Object.defineProperty(window, "location", { value: realLocation, configurable: true });
  });
});
