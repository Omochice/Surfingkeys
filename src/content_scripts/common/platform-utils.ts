import { getBrowserName, showPopup } from "@sk/core/utils";

import browser from "./browser";
import { runtime } from "./runtime";

/** Whether the current frame is the Surfingkeys UI iframe (an extension-page child frame). */
function isInUIFrame(): boolean {
  return window !== top && document.location.href.indexOf(browser.runtime.getURL("/")) === 0;
}

function reportIssue(title: string, description: string): void {
  title = encodeURIComponent(title);
  description = `%23%23+Error+details%0A%0A${encodeURIComponent(description)}%0A%0ASurfingKeys%3A+${browser.runtime.getManifest().version}%0A%0AChrome%3A+${encodeURIComponent(navigator.userAgent)}%0A%0AURL%3A+${encodeURIComponent(window.location.href)}%0A%0A%23%23+Context%0A%0A%2A%2APlease+replace+this+with+a+description+of+how+you+were+using+SurfingKeys.%2A%2A`;
  const error = `<h2>Uh-oh! The SurfingKeys extension encountered a bug.</h2> <p>Please click <a href="https://github.com/brookhong/Surfingkeys/issues/new?title=${title}&body=${description}" target=_blank>here</a> to start filing a new issue, append a description of how you were using SurfingKeys before this message appeared, then submit it.  Thanks for your help!</p>`;

  showPopup(error);
}

function initL10n(cb: (translate: (str: string) => string) => void): void {
  const lang = runtime.conf.language || window.navigator.language;
  if (lang === "en-US") {
    cb((str) => str);
  } else {
    fetch(browser.runtime.getURL("pages/l10n.json"))
      .then((res) => res.json())
      .then((l10n) => {
        if (typeof l10n[lang] === "object") {
          const table = l10n[lang];
          cb((str) => table[str] || str);
        } else {
          cb((str) => str);
        }
      });
  }
}

function attachFaviconToImgSrc(
  tab: { url: string; favIconUrl?: string },
  imgEl: HTMLImageElement,
): void {
  const browserName = getBrowserName();
  imgEl.src =
    browserName === "Chrome"
      ? browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(tab.url)}`)
      : (tab.favIconUrl ?? "");
}

export { attachFaviconToImgSrc, initL10n, isInUIFrame, reportIssue };
