// Standalone popup bundle (not part of the module graph beyond this file).
export {};

const disableAll = document.getElementById("disableAll")!;
const version = "Surfingkeys " + chrome.runtime.getManifest().version;

function RUNTIME<R = unknown>(
  action: string,
  args?: Record<string, unknown>,
  callback?: (response: R) => void,
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
  (response: { settings: { blocklist: Record<string, unknown> } }) => {
    updateStatus(response.settings.blocklist);
  },
);

disableAll.addEventListener("click", () => {
  RUNTIME(
    "toggleBlocklist",
    {
      domain: ".*",
    },
    (response: { blocklist: Record<string, unknown> }) => {
      updateStatus(response.blocklist);
    },
  );
});

document.getElementById("reportIssue")!.addEventListener("click", () => {
  window.close();
  const description = `%23%23+Error+details%0A%0A${encodeURIComponent("")}%0A%0ASurfingKeys%3A+${chrome.runtime.getManifest().version}%0A%0ABrowser%3A+${encodeURIComponent(navigator.userAgent)}%0A%0AURL%3A+${encodeURIComponent("<The_URL_Where_You_Find_The_Issue>")}%0A%0A%23%23+Context%0A%0A%2A%2APlease+replace+this+with+a+description+of+how+you+were+using+SurfingKeys.%2A%2A`;
  window.open(
    `https://github.com/brookhong/Surfingkeys/issues/new?title=${encodeURIComponent("")}&body=${description}`,
  );
});
