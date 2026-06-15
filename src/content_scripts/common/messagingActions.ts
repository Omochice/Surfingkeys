import { dispatchSKEvent } from "./events";
import { RUNTIME } from "./runtime";

/**
 * Open links in new tabs.
 *
 * @example
 *   tabOpenLink("https://github.com/brookhong/Surfingkeys");
 *
 * @param {string} str Links to be opened, the links should be split by `\n` if there are more than
 *   one.
 * @param {number} [simultaneousness=5] How many tabs will be opened simultaneously, the rest will
 *   be queued and opened later whenever a tab is closed. Default is `5`
 */
function tabOpenLink(str: string | string[] | NodeList, simultaneousness: number = 5): void {
  let urls: string[];
  if (Array.isArray(str)) {
    urls = str;
  } else if (str instanceof NodeList) {
    urls = Array.from(str).map((n) => (n as HTMLAnchorElement).href);
  } else {
    urls = str.trim().split("\n");
  }

  urls = urls.map((u) => u.trim()).filter((u) => u.length > 0);

  if (urls.length > simultaneousness) {
    dispatchSKEvent("front", [
      "showDialog",
      `Do you really want to open all these ${urls.length} links?`,
      () => {
        // open the first batch links immediately
        urls.slice(0, simultaneousness).forEach((url) => {
          RUNTIME("openLink", {
            tab: {
              tabbed: true,
            },
            url: url,
          });
        });
        // queue the left for later opening when there is one tab closed.
        RUNTIME("queueURLs", {
          urls: urls.slice(simultaneousness),
        });
      },
    ]);
  } else {
    urls.forEach((url) => {
      RUNTIME("openLink", {
        tab: {
          tabbed: true,
        },
        url: url,
      });
    });
  }
}

function httpRequest<R = unknown>(
  args: Record<string, unknown>,
  onSuccess: (response: R) => void,
): void {
  args["method"] = "get";
  RUNTIME("request", args, onSuccess);
}

export { httpRequest, tabOpenLink };
