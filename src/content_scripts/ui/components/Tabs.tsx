import { For, Show } from "solid-js";
import type { Component } from "solid-js";

export interface TabsTab {
  id: number;
  windowId: number;
  title: string;
  active: boolean;
  url: string;
  favIconUrl?: string;
}

export interface TabsProps {
  tabs: TabsTab[];
  /** Hint labels for the non-active tabs, in document order. */
  hintLabels: string[];
  /** Vertical layout (rocket markers) vs horizontal (fixed widths). */
  vertical: boolean;
  /** Per-tab width in px for horizontal layout. */
  unitWidth: number;
  /** Attaches the tab's favicon to its <img>; injected because it is async and extension-bound. */
  attachFavicon: (tab: TabsTab, img: HTMLImageElement) => void;
}

type HintElement = HTMLDivElement & { label?: string; link?: { id: number; windowId: number } };

/**
 * The tab-chooser overlay (#sk_tabs). Renders one .sk_tab per tab with the active one flagged; each
 * non-active tab carries a .sk_tab_hint whose .label/.link expandos the frontend keydown handler
 * and refreshHints read to resolve the pressed hint. Favicon attachment is injected (async,
 * extension-bound). The container's vertical/horizontal/inline class and the post-render
 * height-overflow check stay with the controller.
 */
export const Tabs: Component<TabsProps> = (props) => {
  const hintLabelFor = (index: number): string | undefined => {
    if (props.tabs[index].active) {
      return undefined;
    }
    let nth = 0;
    for (let i = 0; i < index; i++) {
      if (!props.tabs[i].active) {
        nth++;
      }
    }
    return props.hintLabels[nth];
  };

  return (
    <For each={props.tabs}>
      {(tab, i) => (
        <div
          class="sk_tab"
          classList={{ active: tab.active }}
          style={props.vertical ? undefined : { width: `${props.unitWidth}px` }}
        >
          <Show when={hintLabelFor(i())}>
            {(label) => (
              <div
                class="sk_tab_hint"
                ref={(el) => {
                  const hint = el as HintElement;
                  hint.label = label();
                  hint.link = { id: tab.id, windowId: tab.windowId };
                }}
              >
                {label()}
              </div>
            )}
          </Show>
          <div class="sk_tab_wrap">
            <div class="sk_tab_icon">
              <img ref={(img) => props.attachFavicon(tab, img)} />
            </div>
            <div
              class="sk_tab_title"
              style={props.vertical ? undefined : { width: `${props.unitWidth - 24}px` }}
            >
              {tab.title}
            </div>
          </div>
          <Show when={props.vertical}>
            <div class="tab_rocket">🚀</div>
          </Show>
        </div>
      )}
    </For>
  );
};
