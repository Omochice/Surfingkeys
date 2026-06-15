import browser from "@sk/adapter/browser";
import { LOG } from "@sk/adapter/log";
import { getDocumentOrigin } from "@sk/core/utils";
import * as v from "valibot";

import { runtime } from "./common/runtime";

// Any page can postMessage to this window, so the uihost envelope is external
// data; validate its shape before dispatching or forwarding. looseObject keeps
// unknown keys so the message forwarded to the frontend retains all its fields.
const uihostMessageEnvelopeSchema = v.looseObject({
  surfingkeys_uihost_data: v.looseObject({
    action: v.optional(v.string()),
    origin: v.optional(v.string()),
    toFrontend: v.optional(v.unknown()),
    toContent: v.optional(v.unknown()),
  }),
});

type BrowserLike = {
  getBackFocusFromFrontend?: () => void;
  focusFrontend?: (ifr: HTMLIFrameElement) => void;
};
export type UiHost = HTMLDivElement & { tryDetach(): void };
type ActiveContent = { window: Window; origin: string } | null;

function createUiHost(adapter: BrowserLike, onload: (uiHost: UiHost) => void): void {
  const uiHost = document.createElement("div") as UiHost;
  uiHost.style.display = "block";
  uiHost.style.opacity = "1";
  uiHost.style.colorScheme = "light";
  const frontEndURL = browser.runtime.getURL("frontend.html");
  const ifr = document.createElement("iframe");
  ifr.setAttribute("allowtransparency", "true");
  ifr.setAttribute("frameborder", "0");
  ifr.setAttribute("scrolling", "no");
  ifr.setAttribute("class", "sk_ui");
  ifr.setAttribute("src", frontEndURL);
  ifr.setAttribute("title", "Surfingkeys");
  ifr.style.position = "fixed";
  ifr.style.left = "0";
  ifr.style.bottom = "0";
  ifr.style.width = "100%";
  ifr.style.height = "0";
  ifr.style.zIndex = "2147483647";
  uiHost.attachShadow({ mode: "open" });
  uiHost.shadowRoot!.appendChild(ifr);

  function onWindowMessage(event: MessageEvent): void {
    const parsed = v.safeParse(uihostMessageEnvelopeSchema, event.data);
    if (!parsed.success) {
      return;
    }
    const message = parsed.output.surfingkeys_uihost_data;
    if (message.toFrontend) {
      // forward message to frontend
      ifr.contentWindow!.postMessage({ surfingkeys_frontend_data: message }, frontEndURL);
      if (
        message.toFrontend &&
        event.source &&
        message.action != null &&
        // origin becomes activeContent.origin, used as a postMessage targetOrigin;
        // an absent origin (e.g. an untrusted page's message) would make a later
        // postMessage throw a DOMException, so require it before activating.
        message.origin != null &&
        ["showStatus", "openOmnibar", "openFinder", "chooseTab"].includes(message.action) &&
        (!activeContent || activeContent.window !== event.source)
      ) {
        // reset active Content
        if (activeContent) {
          activeContent.window.postMessage(
            {
              surfingkeys_content_data: {
                action: "deactivated",
                reason: `${message.action}@${event.timeStamp}`,
              },
            },
            activeContent.origin,
          );
        }

        activeContent = {
          window: event.source as Window,
          origin: message.origin,
        };

        activeContent.window.postMessage(
          {
            surfingkeys_content_data: {
              action: "activated",
              reason: `${message.action}@${event.timeStamp}`,
            },
          },
          activeContent.origin,
        );
      }
    } else if (message.action && Object.hasOwn(actions, message.action)) {
      const action = actions[message.action];
      if (action) {
        action(message);
      }
    } else if (message.toContent && activeContent) {
      // forward message to content
      activeContent.window.postMessage({ surfingkeys_content_data: message }, activeContent.origin);
    }
    event.stopImmediatePropagation();
  }

  // top -> frontend: origin
  // frontend -> top:
  // top -> top: apply user settings
  ifr.addEventListener(
    "load",
    () => {
      ifr.contentWindow!.postMessage(
        {
          surfingkeys_frontend_data: {
            action: "initFrontend",
            ack: true,
            winSize: [window.innerWidth, window.innerHeight],
            origin: getDocumentOrigin(),
          },
        },
        frontEndURL,
      );

      window.addEventListener("message", onWindowMessage, true);
    },
    { once: true },
  );

  let lastStateOfPointerEvents = "none";
  let origOverflowY: string | undefined;
  // Dispatch registry: handlers are stored with their own response types then invoked with a parsed
  // message; an `unknown` parameter would reject those typed handlers (contravariance).
  // eslint-disable-next-line typescript/no-explicit-any
  const actions: Record<string, (response: any) => void> = {};
  let activeContent: ActiveContent = null;
  actions["initFrontendAck"] = () => {
    onload(uiHost);
  };
  actions["setFrontFrame"] = (response) => {
    ifr.style.height = response.frameHeight;
    if (response.pointerEvents) {
      ifr.style.pointerEvents = response.pointerEvents;
    }
    if (response.pointerEvents === "none") {
      uiHost.blur();
      ifr.blur();
      // test with https://docs.google.com/ and https://web.whatsapp.com/
      if (lastStateOfPointerEvents !== response.pointerEvents && activeContent) {
        if (adapter.getBackFocusFromFrontend) {
          adapter.getBackFocusFromFrontend();
        } else {
          activeContent.window.postMessage(
            {
              surfingkeys_content_data: {
                action: "getBackFocus",
              },
            },
            activeContent.origin,
          );
        }
      }
      if (document.body) {
        document.body.style.animationFillMode = "";
        document.body.style.overflowY = origOverflowY ?? "";
      }
    } else {
      if (adapter.focusFrontend) {
        adapter.focusFrontend(ifr);
      }
      if (document.body) {
        document.body.style.animationFillMode = "none";
        if (origOverflowY == null) {
          origOverflowY = document.body.style.overflowY;
        }
        document.body.style.overflowY = "visible";
      }
    }
    lastStateOfPointerEvents = response.pointerEvents;
  };

  uiHost.tryDetach = () => {
    ifr.contentWindow!.postMessage(
      {
        surfingkeys_frontend_data: {
          action: "destroyFrontend",
          ack: true,
          origin: getDocumentOrigin(),
        },
      },
      frontEndURL,
    );
  };
  actions["destroyFrontendAck"] = (response) => {
    if (response.data === true) {
      runtime.postTopMessage({
        surfingkeys_content_data: {
          action: "frontendDestroyed",
        },
      });
      window.removeEventListener("message", onWindowMessage, true);
      uiHost.remove();
    } else {
      LOG("warn", "frontend in use");
    }
  };
  document.documentElement.appendChild(uiHost);
}

export default createUiHost;
