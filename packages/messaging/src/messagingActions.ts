import { dispatchSKEvent } from "@sk/core/events";
import { reportError } from "@sk/core/report";

import { notify, request } from "./runtime";

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
    urls = Array.from(str)
      .filter((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement)
      .map((n) => n.href);
  } else {
    urls = str.trim().split("\n");
  }

  urls = urls.map((u) => u.trim()).filter((u) => u.length > 0);

  if (urls.length > simultaneousness) {
    dispatchSKEvent("front", [
      "showDialog",
      `Do you really want to open all these ${urls.length} links?`,
      () => {
        urls.slice(0, simultaneousness).forEach((url) => {
          notify("openLink", {
            tab: {
              tabbed: true,
            },
            url: url,
          });
        });
        notify("queueURLs", {
          urls: urls.slice(simultaneousness),
        });
      },
    ]);
  } else {
    urls.forEach((url) => {
      notify("openLink", {
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
  request<R>("request", args).then(onSuccess, reportError);
}

export { httpRequest, tabOpenLink };
