import { Result } from "@praha/byethrow";

import { reportOnFail, userCodeError } from "../common/result";
import type createAPI from "./common/api";
import browser from "./common/browser";
import Mode from "./common/mode";
import type createNormal from "./common/normal";
import { reportError } from "./common/report";
import { RUNTIME, dispatchSKEvent, runtime } from "./common/runtime";
import type { StoredSettings } from "./common/runtime";
import { applyUserSettings } from "./common/utils";

// This module owns the single concern of applying stored/user settings onto the
// live extension state: the runtime config, the basic key remaps, search-alias
// removals, user snippets, and the resulting mode/icon state. content.ts boots
// the modes and then delegates to applySettings here.

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
  const originMappings: Record<string, any> = {};
  for (const originKey in mappings) {
    const newKey = mappings[originKey];
    if (newKey == null) {
      continue;
    }
    // current new key is one original key that will be overrode later
    // we need save it some where first, since current map will lose it,
    // such as the `a` in above example.
    if (originKeys.has(newKey)) {
      const target = normal.mappings.find(newKey);
      if (target) {
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
  const conf = runtime.conf as Record<string, any>;
  const r = conf[regexName];
  if (r && r.source && !(r instanceof RegExp)) {
    conf[regexName] = new RegExp(r.source, r.flags);
  }
}

function applyRuntimeConf(normal: Normal): void {
  ensureRegex("prevLinkRegex");
  ensureRegex("nextLinkRegex");
  ensureRegex("clickablePat");
  reportOnFail(
    RUNTIME(
      "getState",
      {
        blocklistPattern: runtime.conf.blocklistPattern || undefined,
        lurkingPattern: runtime.conf.lurkingPattern || undefined,
      },
      (resp: { state: string }) => {
        let state = resp.state;
        if (state === "disabled") {
          normal.disable();
          dispatchSKEvent("front", ["showStatus", [undefined, undefined, ""]]);
        } else if (state === "lurking") {
          state = normal.startLurk();
        } else {
          normal.enable();
          Mode.showStatus();
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
      },
    ),
    reportError,
  );
}

export function applySettings(api: Api, normal: Normal, rs: StoredSettings): void {
  const conf = runtime.conf as Record<string, any>;
  for (const k in rs) {
    if (Object.hasOwn(runtime.conf, k)) {
      conf[k] = rs[k];
    }
  }
  if ("findHistory" in rs) {
    // Guard against a non-array findHistory from malformed stored settings; a real
    // array preserves the previous semantics (lastQuery = first entry, else "").
    const fh = Array.isArray(rs.findHistory) ? rs.findHistory : [];
    runtime.conf.lastQuery = fh[0] ?? "";
  }
  if (!rs.showAdvanced) {
    if (rs.basicMappings) {
      applyBasicMappings(api, normal, rs.basicMappings);
    }
    if (rs.disabledSearchAliases) {
      for (const key in rs.disabledSearchAliases) {
        api.removeSearchAlias(key);
      }
    }
  } else if (
    !rs.isMV3 &&
    rs.snippets &&
    !document.location.href.startsWith(browser.runtime.getURL("/"))
  ) {
    const settings = {};
    const snippets = rs.snippets;
    const r = Result.try({
      try: (): void => {
        new Function("settings", "api", snippets)(settings, api);
      },
      catch: (cause) => userCodeError("snippet", cause),
    });
    applyUserSettings({
      settings,
      error: Result.isFailure(r) ? String(r.error.cause) : "",
    });
  }

  applyRuntimeConf(normal);
  document.addEventListener(
    "surfingkeys:settingsFromSnippetsLoaded",
    () => {
      applyRuntimeConf(normal);
    },
    { once: true },
  );
}
