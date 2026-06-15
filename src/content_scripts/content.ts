import { reportOnFail } from "../common/result";
import createAPI from "./common/api";
import type { StoredSettings } from "./common/conf";
import { createEngineEnv } from "./common/createEngineEnv";
import createDefaultMappings from "./common/default";
import { dispatchSKEvent } from "./common/events";
import { checkEventListener, initModeHub } from "./common/mode";
import createModeGraph, { type ModeContext } from "./common/modeGraph";
import createNormal from "./common/normal";
import startScrollNodeObserver from "./common/observer";
import { isInUIFrame } from "./common/platform-utils";
import { reportError } from "./common/report";
import { RUNTIME, runtime } from "./common/runtime";
import { generateQuickGuid, getRealEdit, showBanner } from "./common/utils";
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
  const api = createAPI(ctx);
  createDefaultMappings(api, ctx);
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
    reportError,
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
        (window.frameElement as HTMLElement).offsetWidth > 16 &&
        (window.frameElement as HTMLElement).offsetWidth > 16))
  ) {
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
        initContent(initModules());
      },
      { once: true },
    );
  }
}

export { start };
