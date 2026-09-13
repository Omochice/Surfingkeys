import { markAutoFocus } from "./domFlags";
import type { EngineEnv } from "./engineEnv";
import {
  actionWithSelectionPreserved,
  getBrowserName,
  setSanitizedContent,
  showBanner,
} from "./utils";

type Clipboard = {
  read(onReady: (response: { data: string }) => void): void;
  write(text: string): void;
};

function createClipboard(env: EngineEnv): Clipboard {
  const { RUNTIME } = env;
  const holder = document.createElement("textarea");
  holder.contentEditable = "true";
  markAutoFocus(holder);
  holder.id = "sk_clipboard";

  function clipboardActionWithSelectionPreserved(cb: (selection: Selection | null) => void): void {
    actionWithSelectionPreserved((selection: Selection | null) => {
      // avoid editable body
      document.documentElement.appendChild(holder);

      cb(selection);

      holder.remove();
    });
  }

  return {
    /**
     * Read from clipboard.
     *
     * @example
     *   Clipboard.read(function (response) {
     *     console.log(response.data);
     *   });
     *
     * @name Clipboard.read
     */
    read(onReady) {
      if (
        getBrowserName() === "Firefox" &&
        typeof navigator.clipboard === "object" &&
        typeof navigator.clipboard.readText === "function"
      ) {
        navigator.clipboard.readText().then((data) => {
          // call back onReady in a different thread to avoid breaking UI operations
          // such as Front.openOmnibar
          setTimeout(() => {
            onReady({ data });
          }, 0);
        });
        return;
      }
      clipboardActionWithSelectionPreserved(() => {
        holder.value = "";
        setSanitizedContent(holder, "");
        holder.focus();
        document.execCommand("paste");
      });
      let data = holder.value;
      if (data === "") {
        data = holder.innerHTML.replaceAll(/<br>/gi, "\n");
      }
      onReady({ data });
    },

    /**
     * Write text to clipboard.
     *
     * @example
     *   Clipboard.write(window.location.href);
     *
     * @name Clipboard.write
     */
    write(text) {
      const cb = () => {
        showBanner("Copied: " + text);
      };
      // navigator.clipboard.writeText does not work on http site, and in chrome's background script.
      if (getBrowserName() === "Chrome") {
        clipboardActionWithSelectionPreserved(() => {
          holder.value = text;
          holder.select();
          document.execCommand("copy");
          holder.value = "";
        });
        cb();
      } else {
        RUNTIME("writeClipboard", { text });
        cb();
      }
    },
  };
}

export default createClipboard;
