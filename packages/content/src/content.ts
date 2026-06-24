import { isInUIFrame } from "@sk/adapter/platform-utils";
import { reportOnFail } from "@sk/common/result";
import createAPI from "@sk/core/api";
import { applyDefaultMappings, registerDefaultExtras } from "@sk/core/applyDefaultMappings";
import type { StoredSettings } from "@sk/core/conf";
import createDefaultMappings from "@sk/core/default";
import { dispatchSKEvent } from "@sk/core/events";
import {
  beginBufferingKeyEvents,
  checkEventListener,
  initModeHub,
  releaseBufferedKeyEvents,
} from "@sk/core/mode";
import createModeGraph, { type ModeContext } from "@sk/core/modeGraph";
import createNormal from "@sk/core/normal";
import startScrollNodeObserver from "@sk/core/observer";
import { reportError } from "@sk/core/report";
import { generateQuickGuid, getRealEdit, showBanner } from "@sk/core/utils";
import { RUNTIME, runtime } from "@sk/messaging/runtime";

import { createEngineEnv } from "./common/createEngineEnv";
import { hasLayoutOffsets } from "./common/dom";
import createFront from "./front";
import { applySettings } from "./settingsApplication";

// The injected browser adapter (createFront / plugin hook) is untyped JS.
type BrowserAdapter = {
  plugin?: (ctx: { front: unknown }) => void;
  getBackFocusFromFrontend?: () => void;
  focusFrontend?: (ifr: HTMLIFrameElement) => void;
};

let adapter: BrowserAdapter = {};

const engineEnv = createEngineEnv();

type Api = ReturnType<typeof createAPI>;
type Normal = ReturnType<typeof createNormal>;
type Front = ReturnType<typeof createFront>;
type Modes = { normal: Normal; front: Front; api: Api };

const userConfPromise = new Promise<typeof runtime.conf>((resolve) => {
  document.addEventListener(
    "surfingkeys:settingsFromSnippetsLoaded",
    () => {
      resolve(runtime.conf);
    },
    { once: true },
  );
});

function initModules(): Modes {
  const { clipboard, insert, normal, hints, visual } = createModeGraph(engineEnv);
  // Content owns scroll-node observation; the observer is dormant until an
  // "observer" event turns it on, so its setup order relative to hints/visual
  // does not matter.
  startScrollNodeObserver(normal);
  const front = createFront(insert, normal, hints, visual, adapter);

  const ctx: ModeContext = { clipboard, insert, normal, hints, visual, front };
  const api = createAPI(ctx, engineEnv);
  applyDefaultMappings(api, createDefaultMappings(ctx, engineEnv, api.searchSelectedWith));
  registerDefaultExtras(api);
  if (typeof adapter.plugin === "function") {
    adapter.plugin({ front });
  }

  dispatchSKEvent("defaultSettingsLoaded", { normal, api });
  reportOnFail(
    RUNTIME("getSettings", null, (response: { settings: StoredSettings }) => {
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
    (error) => {
      // The settings fetch failed, so userSettingsLoaded will never fire; release the buffered
      // keys anyway so input is not held forever.
      releaseBufferedKeyEvents();
      reportError(error);
    },
  );
  return {
    normal,
    front,
    api,
  };
}

function initContent(modes: Modes): void {
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
    !runtime.conf.ignoredFrameHosts.includes(window.origin) &&
    (!window.frameElement ||
      (Number.parseInt("0" + getComputedStyle(window.frameElement).zIndex) >= 0 &&
        hasLayoutOffsets(window.frameElement) &&
        window.frameElement.offsetWidth > 16 &&
        window.frameElement.offsetHeight > 16))
  ) {
    // Focus can boot an iframe before any key is pressed.
    beginBufferingKeyEvents();
    initContent(initModules());

    // Only used to load user script for iframes in MV3
    setTimeout(() => {
      dispatchSKEvent("user", ["runUserScript"]);
    }, 100);
  }
  return window.frameId;
};
initModeHub(
  engineEnv,
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

function start(injectedAdapter?: BrowserAdapter): void {
  adapter = injectedAdapter || {};
  if (window === top) {
    // Start as the fetch begins so the safety timeout is measured from here, not page load.
    beginBufferingKeyEvents();
    new Promise<Modes>((r) => {
      r(initModules());
    }).then((modes) => {
      initContent(modes);
      runtime.on("titleChanged", () => {
        checkEventListener(() => {
          modes.front.detach();
          modes = initModules();
          initContent(modes);
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
          (resp: { index: number }) => {
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
        // Must start synchronously so the keydown that dispatched this event falls through to the buffer.
        beginBufferingKeyEvents();
        initContent(initModules());
      },
      { once: true },
    );
  }
}

export { start };
