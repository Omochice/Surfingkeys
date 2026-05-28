// Standalone popup bundle (not part of the module graph beyond this file).
export {};

// Browser-extension global. The typed BrowserAdapter (task #13) will replace
// this narrow declaration once cross-browser API access is centralized.
declare const chrome: {
  runtime: {
    getManifest(): { version: string };
    sendMessage(message: unknown, callback?: (response: any) => void): void;
  };
};

// String.prototype.format is globally declared in content_scripts/common/utils.ts;
// the popup is a standalone bundle, so it carries its own implementation.
String.prototype.format = function (...args: unknown[]): string {
  let formatted = String(this);
  for (let i = 0; i < args.length; i++) {
    const regexp = new RegExp("\\{" + i + "\\}", "gi");
    formatted = formatted.replace(regexp, String(args[i]));
  }
  return formatted;
};

const disableAll = document.getElementById("disableAll")!;
const version = "Surfingkeys " + chrome.runtime.getManifest().version;

function RUNTIME(
  action: string,
  args?: Record<string, unknown>,
  callback?: (response: any) => void,
) {
  const a: Record<string, unknown> = args || {};
  a["action"] = action;
  a["needResponse"] = callback !== undefined;
  chrome.runtime.sendMessage(a, callback);
}

function updateStatus(blocklist: Record<string, unknown>) {
  const disabled = Object.prototype.hasOwnProperty.call(blocklist, ".*");
  disableAll.textContent = (disabled ? "Enable " : "Disable ") + version;
  RUNTIME("setSurfingkeysIcon", {
    status: disabled,
  });
}

RUNTIME(
  "getSettings",
  {
    key: "blocklist",
  },
  (response) => {
    updateStatus(response.settings.blocklist);
  },
);

disableAll.addEventListener("click", () => {
  RUNTIME(
    "toggleBlocklist",
    {
      domain: ".*",
    },
    (response) => {
      updateStatus(response.blocklist);
    },
  );
});

document.getElementById("reportIssue")!.addEventListener("click", () => {
  window.close();
  const description =
    "%23%23+Error+details%0A%0A{0}%0A%0ASurfingKeys%3A+{1}%0A%0ABrowser%3A+{2}%0A%0AURL%3A+{3}%0A%0A%23%23+Context%0A%0A%2A%2APlease+replace+this+with+a+description+of+how+you+were+using+SurfingKeys.%2A%2A".format(
      encodeURIComponent(""),
      chrome.runtime.getManifest().version,
      encodeURIComponent(navigator.userAgent),
      encodeURIComponent("<The_URL_Where_You_Find_The_Issue>"),
    );
  window.open(
    "https://github.com/brookhong/Surfingkeys/issues/new?title={0}&body={1}".format(
      encodeURIComponent(""),
      description,
    ),
  );
});
