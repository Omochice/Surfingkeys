import { RUNTIME } from "./runtime.js";
import {
  actionWithSelectionPreserved,
  getBrowserName,
  setSanitizedContent,
  showBanner,
} from "./utils.js";

interface Clipboard {
  read(onReady: (response: { data: string }) => void): void;
  write(text: string): void;
}

function createClipboard(): Clipboard {
  const self = {} as Clipboard;

  // `enableAutoFocus` is an expando flag read by normal mode to skip auto-focus.
  const holder = document.createElement("textarea") as HTMLTextAreaElement & {
    enableAutoFocus?: boolean;
  };
  holder.contentEditable = "true";
  holder.enableAutoFocus = true;
  holder.id = "sk_clipboard";

  function clipboardActionWithSelectionPreserved(cb: (selection: Selection | null) => void): void {
    actionWithSelectionPreserved((selection: Selection | null) => {
      // avoid editable body
      document.documentElement.appendChild(holder);

      cb(selection);

      holder.remove();
    });
  }

  /**
   * Read from clipboard.
   *
   * @example
   *   Clipboard.read(function (response) {
   *     console.log(response.data);
   *   });
   *
   * @param {function} onReady A callback function to handle text read from clipboard.
   * @name Clipboard.read
   */
  self.read = (onReady) => {
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
      data = holder.innerHTML.replace(/<br>/gi, "\n");
    }
    onReady({ data });
  };

  /**
   * Write text to clipboard.
   *
   * @example
   *   Clipboard.write(window.location.href);
   *
   * @param {string} text The text to be written to clipboard.
   * @name Clipboard.write
   */
  self.write = (text) => {
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
      // works for Firefox and Safari now.
      RUNTIME("writeClipboard", { text });
      cb();
    }
  };

  return self;
}

export default createClipboard;
