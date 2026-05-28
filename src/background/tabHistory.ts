/**
 * Most-recently-used tab navigation ring. Tracks the order tabs were activated in (capped at the
 * last 10) plus a cursor for stepping back and forth through that order, so
 * `historyTab`/`goToLastTab` can walk it. A `programmaticSwitch` flag lets the unit ignore the
 * `onActivated` event that its own navigation triggers, so stepping through history does not itself
 * rewrite the ring.
 *
 * Owns no chrome state and performs no I/O; the background listeners feed it activations/removals
 * and act on the tab id it returns.
 */
export interface TabHistory {
  /** Record an external tab activation (from `chrome.tabs.onActivated`). */
  record(tabId: number): void;
  /** Drop a closed tab (from `chrome.tabs.onRemoved`). */
  remove(tabId: number): void;
  /** The tab activated just before the current one, or undefined if none. */
  previousTab(): number | undefined;
  /**
   * Move the cursor and return the tab to activate: `index` jumps to an absolute (wrapping)
   * position, otherwise step backward/forward clamped to the ends. Returns undefined when the ring
   * is empty.
   */
  navigate(message: { index?: any; backward?: boolean }): number | undefined;
}

export function createTabHistory(): TabHistory {
  let tabHistory: number[] = [];
  let tabHistoryIndex = 0;
  let historyTabAction = false;

  return {
    record(tabId: number): void {
      if (!historyTabAction && tabId != tabHistory[tabHistory.length - 1]) {
        if (tabHistory.length > 10) {
          tabHistory.shift();
        }
        if (tabHistoryIndex != tabHistory.length - 1) {
          tabHistory.splice(tabHistoryIndex + 1, tabHistory.length - 1);
        }
        tabHistory.push(tabId);
        tabHistoryIndex = tabHistory.length - 1;
      }
      historyTabAction = false;
    },
    remove(tabId: number): void {
      tabHistory = tabHistory.filter((e) => {
        return e !== tabId;
      });
    },
    previousTab(): number | undefined {
      if (tabHistory.length > 1) {
        return tabHistory[tabHistory.length - 2];
      }
      return undefined;
    },
    navigate(message: { index?: any; backward?: boolean }): number | undefined {
      if (tabHistory.length > 0) {
        historyTabAction = true;
        if (Object.prototype.hasOwnProperty.call(message, "index")) {
          tabHistoryIndex = (parseInt(message.index) + tabHistory.length) % tabHistory.length;
        } else {
          tabHistoryIndex += message.backward ? -1 : 1;
          if (tabHistoryIndex < 0) {
            tabHistoryIndex = 0;
          } else if (tabHistoryIndex >= tabHistory.length) {
            tabHistoryIndex = tabHistory.length - 1;
          }
        }
        return tabHistory[tabHistoryIndex];
      }
      return undefined;
    },
  };
}
