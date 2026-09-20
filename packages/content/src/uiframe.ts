import { LOG } from "@sk/adapter/log";
import { getDocumentOrigin } from "@sk/core/utils";
import { runtime } from "@sk/messaging/runtime";
import * as v from "valibot";

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

// Assigning a non-string to a style property coerces it, and a value such as `{ toString: false }`
// would throw out of the message listener before the message is consumed.
const frontFrameSchema = v.object({
  frameHeight: v.string(),
  pointerEvents: v.string(),
});

/**
 * Whether an origin can be given to `postMessage` as a targetOrigin, which throws for anything but
 * the wildcard or an absolute URL. `getDocumentOrigin` already maps `file://` and `"null"` to
 * `"*"`, so no honest sender is turned away.
 */
const isUsableTargetOrigin = (origin: string | undefined): origin is string =>
  origin === "*" || (origin != null && URL.canParse(origin));

type BrowserLike = {
  getBackFocusFromFrontend?: () => void;
  focusFrontend?: (iframe: HTMLIFrameElement) => void;
};
export type UiHost = HTMLDivElement & { tryDetach(): void };
type ActiveContent = { window: Window; origin: string } | null;

function createUiHost(adapter: BrowserLike, onload: (uiHost: UiHost) => void): void {
  // tryDetach closes over `iframe`, so it is wired up below; the stub keeps the value a UiHost from
  // the start without a cast.
  const uiHost: UiHost = Object.assign(document.createElement("div"), {
    tryDetach: (): void => {},
  });
  uiHost.style.display = "block";
  uiHost.style.opacity = "1";
  uiHost.style.colorScheme = "light";
  const frontEndURL = chrome.runtime.getURL("frontend.html");
  const iframe = document.createElement("iframe");
  iframe.setAttribute("allowtransparency", "true");
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("class", "sk_ui");
  iframe.setAttribute("src", frontEndURL);
  iframe.setAttribute("title", "Surfingkeys");
  iframe.style.position = "fixed";
  iframe.style.left = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "100%";
  iframe.style.height = "0";
  iframe.style.zIndex = "2147483647";
  uiHost.attachShadow({ mode: "open" });
  uiHost.shadowRoot!.appendChild(iframe);

  function onWindowMessage(event: MessageEvent): void {
    const parsed = v.safeParse(uihostMessageEnvelopeSchema, event.data);
    if (!parsed.success) {
      return;
    }
    const message = parsed.output.surfingkeys_uihost_data;
    if (message.toFrontend) {
      iframe.contentWindow!.postMessage({ surfingkeys_frontend_data: message }, frontEndURL);
      if (
        message.toFrontend &&
        event.source &&
        message.action != null &&
        isUsableTargetOrigin(message.origin) &&
        ["showStatus", "openOmnibar", "openFinder", "chooseTab"].includes(message.action) &&
        (!activeContent || activeContent.window !== event.source)
      ) {
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
          // event.source is a (possibly cross-origin) WindowProxy; instanceof Window is unreliable
          // across origins, so the assertion is kept.
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
      activeContent.window.postMessage({ surfingkeys_content_data: message }, activeContent.origin);
    }
    event.stopImmediatePropagation();
  }

  iframe.addEventListener(
    "load",
    () => {
      iframe.contentWindow!.postMessage(
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
  actions["setFrontFrame"] = (message: unknown) => {
    const parsed = v.safeParse(frontFrameSchema, message);
    if (!parsed.success) {
      return;
    }
    const response = parsed.output;
    iframe.style.height = response.frameHeight;
    if (response.pointerEvents) {
      iframe.style.pointerEvents = response.pointerEvents;
    }
    if (response.pointerEvents === "none") {
      uiHost.blur();
      iframe.blur();
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
        adapter.focusFrontend(iframe);
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
    iframe.contentWindow!.postMessage(
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
