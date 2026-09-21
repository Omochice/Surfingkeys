import { Result } from "@praha/byethrow";
import { LOG } from "@sk/adapter/log";
import { reportOnFail, userCodeError } from "@sk/common/result";
import type createAPI from "@sk/core/api";
import type { StoredSettings } from "@sk/core/conf";
import { dispatchSKEvent } from "@sk/core/events";
import { showModeStatus } from "@sk/core/mode";
import type createNormal from "@sk/core/normal";
import { reportError } from "@sk/core/report";
import type { TrieMeta } from "@sk/core/trie";
import { applyUserSettings } from "@sk/core/utils";
import { request, RUNTIME, runtime } from "@sk/messaging/runtime";

type Api = ReturnType<typeof createAPI>;
type Normal = ReturnType<typeof createNormal>;

/*
 * Apply custom key mappings for basic users, the input is like
 * {"a": "b", "b": "a", "c": "d"}
 */
export function applyBasicMappings(
  api: Api,
  normal: Normal,
  mappings: Record<string, string>,
): void {
  const originKeys = new Set(Object.keys(mappings));
  const originMappings: Record<string, TrieMeta> = {};
  for (const originKey in mappings) {
    const newKey = mappings[originKey];
    if (newKey == null) {
      continue;
    }
    // The new key is itself an original key that will be overridden later, so its
    // meta must be saved before the current map loses it (the `a` in the example).
    if (originKeys.has(newKey)) {
      const target = normal.mappings.find(newKey);
      if (target?.meta) {
        originMappings[newKey] = target.meta;
      }
    }
    if (newKey === "") {
      normal.mappings.remove(originKey);
    } else if (Object.hasOwn(originMappings, originKey)) {
      const meta = originMappings[originKey];
      if (meta != null) {
        normal.mappings.add(newKey, meta);
      }
    } else {
      api.map(newKey, originKey);
    }
  }
}

export function ensureRegex(regexName: string): void {
  const conf: Record<string, unknown> = runtime.conf;
  const r = conf[regexName];
  if (r != null && typeof r === "object" && !(r instanceof RegExp) && "source" in r) {
    const source = r.source;
    const flags = "flags" in r ? r.flags : undefined;
    if (typeof source === "string") {
      conf[regexName] = new RegExp(source, typeof flags === "string" ? flags : undefined);
    }
  }
}

function applyRuntimeConf(normal: Normal): void {
  ensureRegex("prevLinkRegex");
  ensureRegex("nextLinkRegex");
  ensureRegex("clickablePattern");
  request<{ state: string }>("getState", {
    blocklistPattern: runtime.conf.blocklistPattern || undefined,
    lurkingPattern: runtime.conf.lurkingPattern || undefined,
  }).then((resp) => {
    let state = resp.state;
    if (state === "disabled") {
      normal.disable();
      dispatchSKEvent("front", ["showStatus", [undefined, undefined, ""]]);
    } else if (state === "lurking") {
      state = normal.startLurk();
    } else {
      normal.enable();
      showModeStatus();
    }

    if (window === top) {
      reportOnFail(
        RUNTIME("setSurfingkeysIcon", {
          status: state,
        }),
        reportError,
      );
      dispatchSKEvent("front", ["showStatus", [undefined, undefined, ""]]);
    }
  }, reportError);
}

export function applySettings(api: Api, normal: Normal, stored: StoredSettings): void {
  const conf: Record<string, unknown> = runtime.conf;
  for (const k in stored) {
    if (Object.hasOwn(runtime.conf, k)) {
      conf[k] = stored[k];
    }
  }
  if ("findHistory" in stored) {
    // Guard against a non-array findHistory from malformed stored settings.
    const findHistory = Array.isArray(stored.findHistory) ? stored.findHistory : [];
    runtime.conf.lastQuery = findHistory[0] ?? "";
  }
  // The MV3 user script's match patterns exclude the extension's own pages, and the inline path
  // below skips them too.
  const onExtensionPage = document.location.href.startsWith(chrome.runtime.getURL("/"));
  const snippetsPending = Boolean(stored.showAdvanced && stored.snippets && !onExtensionPage);
  if (snippetsPending) {
    // A snippet can still change the conf the runtime state is derived from, so derive it again
    // once the snippet has been applied.
    document.addEventListener(
      "surfingkeys:userSettingsApplied",
      () => {
        applyRuntimeConf(normal);
      },
      { once: true },
    );
  }
  if (!stored.showAdvanced) {
    if (stored.basicMappings) {
      applyBasicMappings(api, normal, stored.basicMappings);
    }
    if (stored.disabledSearchAliases) {
      for (const key in stored.disabledSearchAliases) {
        api.removeSearchAlias(key);
      }
    }
  } else if (!stored.isMV3 && stored.snippets && !onExtensionPage) {
    const settings = {};
    const snippets = stored.snippets;
    const r = Result.try({
      try: (): void => {
        new Function("settings", "api", snippets)(settings, api);
      },
      catch: (cause) => userCodeError("snippet", cause),
    });
    applyUserSettings(
      {
        settings,
        error: Result.isFailure(r) ? String(r.error.cause) : "",
      },
      LOG,
    );
  }

  applyRuntimeConf(normal);
  if (!snippetsPending) {
    dispatchSKEvent("userSettingsApplied");
  }
}
