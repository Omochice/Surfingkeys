import Trie from "@sk/core/trie";
import { runtime } from "@sk/messaging/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyBasicMappings,
  applySettings,
  ensureRegex,
  snippetsPendingFor,
} from "./settingsApplication";

// The fakes expose only what the helpers call; `any` keeps the structural surplus of the real
// Api/Normal types from forcing a full implementation.

type FakeApi = any;
type FakeNormal = any;

function makeFakeApi(): FakeApi {
  return {
    map: vi.fn<(a: string, b: string) => void>(),
    removeSearchAlias: vi.fn<(a: string) => void>(),
  };
}

function makeFakeNormal(trie = new Trie()): FakeNormal {
  return {
    mappings: trie,
    disable: vi.fn(),
    enable: vi.fn(),
    startLurk: vi.fn(() => "lurking"),
  };
}

describe("ensureRegex", () => {
  let savedNextLinkRegex: RegExp;
  let savedPrevLinkRegex: RegExp;

  beforeEach(() => {
    savedNextLinkRegex = runtime.conf.nextLinkRegex;
    savedPrevLinkRegex = runtime.conf.prevLinkRegex;
  });

  afterEach(() => {
    runtime.conf.nextLinkRegex = savedNextLinkRegex;
    runtime.conf.prevLinkRegex = savedPrevLinkRegex;
  });

  it("rehydrates a serialized {source, flags} object into a real RegExp", () => {
    // A RegExp that has been through JSON.stringify/parse arrives as exactly this shape.
    (runtime.conf as Record<string, unknown>)["nextLinkRegex"] = {
      source: "next",
      flags: "i",
    };

    ensureRegex("nextLinkRegex");

    expect(runtime.conf.nextLinkRegex).toBeInstanceOf(RegExp);
    expect(runtime.conf.nextLinkRegex.source).toBe("next");
    expect(runtime.conf.nextLinkRegex.flags).toBe("i");
  });

  it("leaves a real RegExp instance untouched", () => {
    const original = /keep-me/gi;
    runtime.conf.nextLinkRegex = original;

    ensureRegex("nextLinkRegex");

    expect(runtime.conf.nextLinkRegex).toBe(original);
  });

  it("does nothing when the field is undefined", () => {
    (runtime.conf as Record<string, unknown>)["prevLinkRegex"] = undefined;

    ensureRegex("prevLinkRegex");

    expect((runtime.conf as Record<string, unknown>)["prevLinkRegex"]).toBeUndefined();
  });
});

describe("applyBasicMappings", () => {
  it("calls api.map for a straightforward key remap", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    applyBasicMappings(api, normal, { j: "k" });

    expect(api.map).toHaveBeenCalledOnce();
    expect(api.map).toHaveBeenCalledWith("k", "j");
  });

  it("removes the original key when the new key is an empty string", () => {
    const trie = new Trie();
    trie.add("j", { annotation: "scroll down" });
    const api = makeFakeApi();
    const normal = makeFakeNormal(trie);

    applyBasicMappings(api, normal, { j: "" });

    expect(trie.find("j")).toBeUndefined();
    expect(api.map).not.toHaveBeenCalled();
  });

  it("handles a swap by preserving the meta of the key that would be overwritten", () => {
    const trie = new Trie();
    const metaA = { annotation: "action-a" };
    const metaB = { annotation: "action-b" };
    trie.add("a", metaA);
    trie.add("b", metaB);

    const api = makeFakeApi();
    const normal = makeFakeNormal(trie);

    applyBasicMappings(api, normal, { a: "b", b: "a" });

    // Slot "a" must end up carrying metaB's annotation, not metaA's: that is what proves the
    // meta of the key about to be overwritten was snapshotted before the swap completed.
    expect(trie.find("a")?.meta?.annotation).toBe(metaB.annotation);
    expect(api.map).toHaveBeenCalledWith("b", "a");
  });

  it("skips entries where the new key is null/undefined", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    // TypeScript typing forbids null here so we cast through unknown.
    applyBasicMappings(api, normal, {
      j: null as unknown as string,
    });

    expect(api.map).not.toHaveBeenCalled();
  });

  it("handles multiple independent remaps in one call", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    applyBasicMappings(api, normal, { a: "b", c: "d" });

    expect(api.map).toHaveBeenCalledTimes(2);
    expect(api.map).toHaveBeenCalledWith("b", "a");
    expect(api.map).toHaveBeenCalledWith("d", "c");
  });
});

describe("applySettings", () => {
  let savedSmartCase: boolean;
  let savedLastQuery: string;
  let savedScrollStepSize: number;

  beforeEach(() => {
    savedSmartCase = runtime.conf.smartCase;
    savedLastQuery = runtime.conf.lastQuery;
    savedScrollStepSize = runtime.conf.scrollStepSize;
  });

  afterEach(() => {
    runtime.conf.smartCase = savedSmartCase;
    runtime.conf.lastQuery = savedLastQuery;
    runtime.conf.scrollStepSize = savedScrollStepSize;
  });

  it("merges known keys from StoredSettings onto runtime.conf", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    applySettings(api, normal, {
      smartCase: false,
      scrollStepSize: 42,
      showAdvanced: false,
    });

    expect(runtime.conf.smartCase).toBe(false);
    expect(runtime.conf.scrollStepSize).toBe(42);
  });

  it("ignores keys not present in runtime.conf", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();
    const before = { ...(runtime.conf as Record<string, unknown>) };

    applySettings(api, normal, {
      unknownSettingXYZ: "should-be-ignored",
      showAdvanced: false,
    });

    expect((runtime.conf as Record<string, unknown>)["unknownSettingXYZ"]).toBeUndefined();
    expect(runtime.conf.smartCase).toBe(before["smartCase"]);
  });

  it("sets lastQuery from the first findHistory entry", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    applySettings(api, normal, {
      findHistory: ["first-search", "second-search"],
      showAdvanced: false,
    });

    expect(runtime.conf.lastQuery).toBe("first-search");
  });

  it("sets lastQuery to empty string when findHistory is empty", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();
    runtime.conf.lastQuery = "old-query";

    applySettings(api, normal, {
      findHistory: [],
      showAdvanced: false,
    });

    expect(runtime.conf.lastQuery).toBe("");
  });

  it("calls api.removeSearchAlias for each entry in disabledSearchAliases (non-advanced)", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    applySettings(api, normal, {
      showAdvanced: false,
      disabledSearchAliases: { g: "Google", d: "DuckDuckGo" },
    });

    expect(api.removeSearchAlias).toHaveBeenCalledWith("g");
    expect(api.removeSearchAlias).toHaveBeenCalledWith("d");
  });

  it("delegates basicMappings to applyBasicMappings when not in advanced mode", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    applySettings(api, normal, {
      showAdvanced: false,
      basicMappings: { a: "b" },
    });

    expect(api.map).toHaveBeenCalledWith("b", "a");
  });

  it("skips basicMappings and disabledSearchAliases in advanced mode", () => {
    const api = makeFakeApi();
    const normal = makeFakeNormal();

    applySettings(api, normal, {
      showAdvanced: true,
      isMV3: true, // prevents snippet execution path
      basicMappings: { a: "b" },
      disabledSearchAliases: { g: "Google" },
    });

    expect(api.map).not.toHaveBeenCalled();
    expect(api.removeSearchAlias).not.toHaveBeenCalled();
  });
});

describe("applySettings userSettingsApplied event", () => {
  let applied: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    applied = vi.fn();
    document.addEventListener("surfingkeys:userSettingsApplied", applied);
  });

  afterEach(() => {
    document.removeEventListener("surfingkeys:userSettingsApplied", applied);
  });

  it("announces completion when no snippet is involved", () => {
    applySettings(makeFakeApi(), makeFakeNormal(), { showAdvanced: false });

    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("announces completion in advanced mode when there are no snippets to run", () => {
    applySettings(makeFakeApi(), makeFakeNormal(), { showAdvanced: true, isMV3: true });

    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("stays silent while the MV3 user script still has snippets to apply", () => {
    applySettings(makeFakeApi(), makeFakeNormal(), {
      showAdvanced: true,
      isMV3: true,
      snippets: "api.map('H', 'S');",
    });

    expect(applied).not.toHaveBeenCalled();
  });
});

describe("snippetsPendingFor", () => {
  it("is pending when advanced mode carries a snippet", () => {
    expect(snippetsPendingFor({ showAdvanced: true, snippets: "api.map('H', 'S');" })).toBe(true);
  });

  it("is not pending when advanced mode is off", () => {
    expect(snippetsPendingFor({ showAdvanced: false, snippets: "api.map('H', 'S');" })).toBe(false);
  });

  it("is not pending when advanced mode carries no snippet", () => {
    expect(snippetsPendingFor({ showAdvanced: true })).toBe(false);
  });
});
