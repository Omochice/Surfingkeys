import browser from "./browser";
import { runtime } from "./runtime";
import { getBrowserName } from "./utils";

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

export { attachFaviconToImgSrc, initL10n };
