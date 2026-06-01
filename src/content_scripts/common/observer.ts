import { isSurfingKeysElement, markNewlyCreated } from "./domFlags";
import Mode from "./mode";
import { getVisibleElements, initSKFunctionListener } from "./utils";

function isElementPositionRelative(elm: HTMLElement): boolean {
  let cur: HTMLElement | null = elm;
  while (cur !== null && cur !== document.body) {
    if (getComputedStyle(cur).position === "relative") {
      return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function startScrollNodeObserver(normal: {
  addScrollableElement: (el: HTMLElement) => void;
}): void {
  let pendingUpdater: number | undefined = undefined;
  const DOMObserver = new MutationObserver((mutations) => {
    const addedNodes: Element[] = [];
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          const el = n as Element;
          if (!isSurfingKeysElement(el)) {
            markNewlyCreated(el);
            addedNodes.push(el);
          }
        }
      }
    }

    if (addedNodes.length) {
      if (pendingUpdater) {
        clearTimeout(pendingUpdater);
        pendingUpdater = undefined;
      }
      pendingUpdater = window.setTimeout(() => {
        const possibleModalElements = getVisibleElements((e: HTMLElement, v: HTMLElement[]) => {
          const br = e.getBoundingClientRect();
          if (
            br.width > 300 &&
            br.height > 300 &&
            br.width <= window.innerWidth &&
            br.height <= window.innerHeight &&
            br.top >= 0 &&
            br.left >= 0 &&
            Mode.hasScroll(e, "y", 16) &&
            isElementPositionRelative(e)
          ) {
            v.push(e);
          }
        });

        const firstModal = possibleModalElements[0];
        if (firstModal) {
          normal.addScrollableElement(firstModal);
        }
      }, 200);
    }
  }) as MutationObserver & { isConnected: boolean };
  DOMObserver.isConnected = false;

  initSKFunctionListener("observer", {
    turnOn: () => {
      if (!DOMObserver.isConnected) {
        DOMObserver.observe(document, { childList: true, subtree: true });
        DOMObserver.isConnected = true;
      }
    },
    turnOff: () => {
      if (DOMObserver.isConnected) {
        DOMObserver.disconnect();
        DOMObserver.isConnected = false;
      }
    },
  });
}

export default startScrollNodeObserver;
