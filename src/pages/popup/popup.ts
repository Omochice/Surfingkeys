// Standalone popup bundle (not part of the module graph beyond this file).
export {};

// The popup is a standalone bundle outside the content_scripts module graph,
// so it carries its own copy of format() rather than importing from utils.
function format(template: string, ...args: unknown[]): string {
  let formatted = template;
  for (let i = 0; i < args.length; i++) {
    const regexp = new RegExp("\\{" + i + "\\}", "gi");
    formatted = formatted.replace(regexp, String(args[i]));
  }
  return formatted;
}

const disableAll = document.getElementById("disableAll")!;
const version = "Surfingkeys " + chrome.runtime.getManifest().version;

function RUNTIME(
  action: string,
  args?: Record<string, unknown>,
  callback?: (response: any) => void,
) {
  const a: Record<string, unknown> = args || {};
  a["action"] = action;
  a["needResponse"] = callback != null;
  if (callback) {
    chrome.runtime.sendMessage(a, callback);
  } else {
    chrome.runtime.sendMessage(a);
  }
}

function updateStatus(blocklist: Record<string, unknown>) {
  const disabled = Object.hasOwn(blocklist, ".*");
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
  const description = format(
    "%23%23+Error+details%0A%0A{0}%0A%0ASurfingKeys%3A+{1}%0A%0ABrowser%3A+{2}%0A%0AURL%3A+{3}%0A%0A%23%23+Context%0A%0A%2A%2APlease+replace+this+with+a+description+of+how+you+were+using+SurfingKeys.%2A%2A",
    encodeURIComponent(""),
    chrome.runtime.getManifest().version,
    encodeURIComponent(navigator.userAgent),
    encodeURIComponent("<The_URL_Where_You_Find_The_Issue>"),
  );
  window.open(
    format(
      "https://github.com/brookhong/Surfingkeys/issues/new?title={0}&body={1}",
      encodeURIComponent(""),
      description,
    ),
  );
});
