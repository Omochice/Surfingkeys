import { Result } from "@praha/byethrow";

import { reportOnFail, userCodeError } from "../common/result";
import createAPI from "./common/api";
import browser from "./common/browser";
import createDefaultMappings from "./common/default";
import Mode from "./common/mode";
import createModeGraph, { type ModeContext } from "./common/modeGraph";
import createNormal from "./common/normal";
import startScrollNodeObserver from "./common/observer";
import { reportError } from "./common/report";
import { RUNTIME, dispatchSKEvent, runtime } from "./common/runtime";
import type { StoredSettings } from "./common/runtime";
import {
  applyUserSettings,
  generateQuickGuid,
  getRealEdit,
  isInUIFrame,
  showBanner,
} from "./common/utils";
import createFront from "./front";

// The injected browser adapter (createFront / plugin hook) is untyped JS.
type BrowserAdapter = {
  plugin?: (ctx: { front: unknown }) => void;
  getBackFocusFromFrontend?: () => void;
  focusFrontend?: (ifr: HTMLIFrameElement) => void;
};

let _browser: BrowserAdapter = {};

type Api = ReturnType<typeof createAPI>;
type Normal = ReturnType<typeof createNormal>;
type Modes = { normal: Normal; front: any; api: Api };

/*
 * Apply custom key mappings for basic users, the input is like
 * {"a": "b", "b": "a", "c": "d"}
 */
function applyBasicMappings(api: Api, normal: Normal, mappings: Record<string, string>): void {
  const originKeys = new Set(Object.keys(mappings));
  const originMappings: Record<string, any> = {};
  for (const originKey in mappings) {
    const newKey = mappings[originKey];
    if (newKey === undefined) {
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
    } else if (Object.prototype.hasOwnProperty.call(originMappings, originKey)) {
      const meta = originMappings[originKey];
      if (meta !== undefined) {
        normal.mappings.add(newKey, meta);
      }
    } else {
      api.map(newKey, originKey);
    }
  }
}

function ensureRegex(regexName: string): void {
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
        blocklistPattern: runtime.conf.blocklistPattern ? runtime.conf.blocklistPattern : undefined,
        lurkingPattern: runtime.conf.lurkingPattern ? runtime.conf.lurkingPattern : undefined,
      },
      (resp) => {
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

const userConfPromise = new Promise<typeof runtime.conf>((resolve) => {
  document.addEventListener(
    "surfingkeys:settingsFromSnippetsLoaded",
    () => {
      resolve(runtime.conf);
    },
    { once: true },
  );
});

function applySettings(api: Api, normal: Normal, rs: StoredSettings): void {
  const conf = runtime.conf as Record<string, any>;
  for (const k in rs) {
    if (Object.prototype.hasOwnProperty.call(runtime.conf, k)) {
      conf[k] = rs[k];
    }
  }
  if ("findHistory" in rs) {
    runtime.conf.lastQuery = rs.findHistory!.length ? (rs.findHistory![0] ?? "") : "";
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

function _initModules(): Modes {
  const { clipboard, insert, normal, hints, visual } = createModeGraph();
  // Content owns scroll-node observation; the observer is dormant until an
  // "observer" event turns it on, so its setup order relative to hints/visual
  // does not matter.
  startScrollNodeObserver(normal);
  const front = createFront(insert, normal, hints, visual, _browser);

  const ctx: ModeContext = { clipboard, insert, normal, hints, visual, front };
  const api = createAPI(ctx);
  createDefaultMappings(api, ctx);
  if (typeof _browser.plugin === "function") {
    _browser.plugin({ front });
  }

  dispatchSKEvent("defaultSettingsLoaded", { normal, api });
  reportOnFail(
    RUNTIME("getSettings", null, (response) => {
      const rs = response.settings;
      applySettings(api, normal, rs);
      const disabledSearchAliases = rs.disabledSearchAliases;
      const getUsage = front.getUsage;
      const frontCommand = front.command;
      dispatchSKEvent("userSettingsLoaded", {
        settings: rs,
        disabledSearchAliases,
        getUsage,
        frontCommand,
      });
    }),
    reportError,
  );
  return {
    normal,
    front,
    api,
  };
}

function _initContent(modes: Modes): void {
  window.frameId = generateQuickGuid();
  runtime.on("settingsUpdated", (response) => {
    const rs = response.settings;
    applySettings(modes.api, modes.normal, rs);
  });

  if (
    runtime.conf.stealFocusOnLoad &&
    !isInUIFrame() &&
    document.body &&
    document.body.childElementCount > 1
  ) {
    const elm = getRealEdit();
    elm && elm.blur();
  }
}

window.getFrameId = function () {
  if (
    !window.frameId &&
    window.innerWidth > 16 &&
    window.innerHeight > 16 &&
    document.body &&
    document.body.childElementCount > 0 &&
    runtime.conf.ignoredFrameHosts.indexOf(window.origin) === -1 &&
    (!window.frameElement ||
      (parseInt("0" + getComputedStyle(window.frameElement).zIndex) >= 0 &&
        (window.frameElement as HTMLElement).offsetWidth > 16 &&
        (window.frameElement as HTMLElement).offsetWidth > 16))
  ) {
    _initContent(_initModules());

    // Only used to load user script for iframes in MV3
    setTimeout(() => {
      dispatchSKEvent("user", ["runUserScript"]);
    }, 100);
  }
  return window.frameId;
};
Mode.init(
  window === top
    ? undefined
    : () => {
        window.addEventListener(
          "focus",
          () => {
            window.getFrameId();
          },
          { once: true },
        );
      },
);

function start(adapter?: BrowserAdapter): void {
  _browser = adapter || {};
  if (window === top) {
    new Promise<Modes>((r) => {
      r(_initModules());
    }).then((modes) => {
      _initContent(modes);
      runtime.on("titleChanged", () => {
        Mode.checkEventListener(() => {
          modes.front.detach();
          modes = _initModules();
          _initContent(modes);
          modes.front.attach();
        });
      });
      runtime.on("tabActivated", () => {
        modes.front.attach();
      });
      runtime.on("tabDeactivated", () => {
        modes.front.detach();
      });
      runtime.on("setScrollPos", (msg) => {
        setTimeout(() => {
          document.scrollingElement!.scrollLeft = msg.scrollLeft;
          document.scrollingElement!.scrollTop = msg.scrollTop;
        }, 1000);
      });
      runtime.on("showBanner", (msg) => {
        showBanner(msg.message, 3000);
      });
      document.addEventListener("surfingkeys:ensureFrontEnd", () => {
        modes.front.attach();
      });

      reportOnFail(
        RUNTIME(
          "tabURLAccessed",
          {
            title: document.title,
            url: window.location.href,
          },
          (resp) => {
            if (resp.index > 0) {
              const showTabIndexInTitle = () => {
                skipObserver = true;
                userConfPromise.then((conf) => {
                  document.title = myTabIndex + conf.tabIndicesSeparator + originalTitle;
                });
              };

              let myTabIndex = resp.index;
              let skipObserver = false;
              let originalTitle = document.title;

              new MutationObserver(() => {
                if (skipObserver) {
                  skipObserver = false;
                } else {
                  originalTitle = document.title;
                  showTabIndexInTitle();
                }
              }).observe(document.querySelector("title")!, { childList: true });

              showTabIndexInTitle();

              runtime.on("tabIndexChange", (msg) => {
                if (msg.index !== myTabIndex) {
                  myTabIndex = msg.index;
                  showTabIndexInTitle();
                }
              });
            }
          },
        ),
        reportError,
      );
    });
  } else {
    document.addEventListener(
      "surfingkeys:iframeBoot",
      () => {
        _initContent(_initModules());
      },
      { once: true },
    );
  }
}

export { start };
