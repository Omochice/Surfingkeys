import { LOG } from "../common/utils";
import browser from "./common/browser";
import { runtime } from "./common/runtime";
import { getDocumentOrigin } from "./common/utils";

type BrowserLike = {
  getBackFocusFromFrontend?: () => void;
  focusFrontend?: (ifr: HTMLIFrameElement) => void;
};
type UiHost = HTMLDivElement & { tryDetach(): void };
type ActiveContent = { window: Window; origin: string } | null;

function createUiHost(adapter: BrowserLike, onload: (uiHost: HTMLElement) => void): void {
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

  function _onWindowMessage(event: MessageEvent): void {
    const _message = event.data && event.data.surfingkeys_uihost_data;
    if (_message == null) {
      return;
    }
    if (_message.toFrontend) {
      // forward message to frontend
      ifr.contentWindow!.postMessage({ surfingkeys_frontend_data: _message }, frontEndURL);
      if (
        _message.toFrontend &&
        event.source &&
        ["showStatus", "openOmnibar", "openFinder", "chooseTab"].indexOf(_message.action) !== -1
      ) {
        if (!activeContent || activeContent.window !== event.source) {
          // reset active Content

          if (activeContent) {
            activeContent.window.postMessage(
              {
                surfingkeys_content_data: {
                  action: "deactivated",
                  reason: `${_message.action}@${event.timeStamp}`,
                },
              },
              activeContent.origin,
            );
          }

          activeContent = {
            window: event.source as Window,
            origin: _message.origin,
          };

          activeContent.window.postMessage(
            {
              surfingkeys_content_data: {
                action: "activated",
                reason: `${_message.action}@${event.timeStamp}`,
              },
            },
            activeContent.origin,
          );
        }
      }
    } else if (_message.action && Object.prototype.hasOwnProperty.call(_actions, _message.action)) {
      const action = _actions[_message.action];
      if (action) {
        action(_message);
      }
    } else if (_message.toContent) {
      // forward message to content
      if (activeContent) {
        activeContent.window.postMessage(
          { surfingkeys_content_data: _message },
          activeContent.origin,
        );
      }
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

      window.addEventListener("message", _onWindowMessage, true);
    },
    { once: true },
  );

  let lastStateOfPointerEvents = "none";
  let _origOverflowY: string | undefined;
  const _actions: Record<string, (response: any) => void> = {};
  let activeContent: ActiveContent = null;
  _actions["initFrontendAck"] = () => {
    onload(uiHost);
  };
  _actions["setFrontFrame"] = (response) => {
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
        document.body.style.overflowY = _origOverflowY ?? "";
      }
    } else {
      if (adapter.focusFrontend) {
        adapter.focusFrontend(ifr);
      }
      if (document.body) {
        document.body.style.animationFillMode = "none";
        if (_origOverflowY == null) {
          _origOverflowY = document.body.style.overflowY;
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
  _actions["destroyFrontendAck"] = (response) => {
    if (response.data === true) {
      runtime.postTopMessage({
        surfingkeys_content_data: {
          action: "frontendDestroyed",
        },
      });
      window.removeEventListener("message", _onWindowMessage, true);
      uiHost.remove();
    } else {
      LOG("warn", "frontend in use");
    }
  };
  document.documentElement.appendChild(uiHost);
}

export default createUiHost;
