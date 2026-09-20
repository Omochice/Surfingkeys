import { isSurfingKeysElement, markNewlyCreated } from "./domFlags";
import { hasScroll } from "./scrollDetection";
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
  const DOMObserver = Object.assign(
    new MutationObserver((mutations) => {
      const addedNodes: Element[] = [];
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (n instanceof Element && !isSurfingKeysElement(n)) {
            markNewlyCreated(n);
            addedNodes.push(n);
          }
        }
      }

      if (addedNodes.length) {
        if (pendingUpdater) {
          clearTimeout(pendingUpdater);
          pendingUpdater = undefined;
        }
        pendingUpdater = window.setTimeout(() => {
          const possibleModalElements = getVisibleElements<HTMLElement>((e, v) => {
            if (!(e instanceof HTMLElement)) {
              return;
            }
            const bounds = e.getBoundingClientRect();
            if (
              bounds.width > 300 &&
              bounds.height > 300 &&
              bounds.width <= window.innerWidth &&
              bounds.height <= window.innerHeight &&
              bounds.top >= 0 &&
              bounds.left >= 0 &&
              hasScroll(e, "y", 16) &&
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
    }),
    { isConnected: false },
  );

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
