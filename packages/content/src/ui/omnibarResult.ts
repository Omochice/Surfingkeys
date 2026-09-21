import { createElementWithContent } from "@sk/core/utils";

import type { ResultListItem } from "./components/ResultList";

/**
 * An omnibar row: the fields {@link ResultListItem} renders, plus the data handlers and key bindings
 * read back from the store instead of reaching into the DOM.
 */
export type OmnibarResult = {
  // Optional fields explicitly admit `undefined` because handlers build the data bag from item
  // shapes whose fields may be absent, and exactOptionalPropertyTypes is on.
  data: {
    uid?: string | undefined;
    url?: string | undefined;
    copy?: string | undefined;
    query?: string | undefined;
    windowId?: number | undefined;
    folderId?: string | undefined;
    folderName?: string | undefined;
    cmd?: string | undefined;
    folder?: string | undefined;
    text: string;
  };
} & ResultListItem;

/**
 * Build an {@link OmnibarResult} from a rendered `<li>` plus an explicit data object.
 *
 * The display fields are derived from the `<li>`, since that is where the handlers compose them;
 * the explicit `data` overrides those defaults.
 */
export function buildOmnibarResult(
  li: HTMLElement,
  data: Partial<OmnibarResult["data"]>,
): OmnibarResult {
  const img = li.querySelector("img.icon");
  const className = li.className || undefined;
  const faviconSrc = img?.getAttribute("src") ?? undefined;
  const folder = li.getAttribute("folder");
  // Spread each optional field only when it has a value: exactOptionalPropertyTypes forbids
  // assigning an explicit `undefined` to an optional property.
  return {
    html: li.innerHTML,
    ...(className != null ? { className } : {}),
    ...(faviconSrc != null ? { faviconSrc } : {}),
    data: {
      text: li.textContent ?? "",
      ...(folder !== null ? { folder } : {}),
      ...data,
    },
  };
}

/**
 * Order the items the omnibar will render: bottom-positioned omnibars list results in reverse so
 * the first match sits next to the input at the screen bottom.
 *
 * Non-destructive on purpose: the items may be a shared cache reused across keystrokes, so
 * `toReversed` builds a new array rather than reordering in place.
 */
export function orderItemsForDisplay<T>(items: readonly T[], bottom: boolean): readonly T[] {
  return bottom ? items.toReversed() : items;
}

/** Build the omnibar row for a bookmark folder, carrying the folder id in the `folder` attribute. */
export function buildFolderResult(title: string, folderId: string): OmnibarResult {
  return buildOmnibarResult(createElementWithContent("li", `▷ ${title}`, { folder: folderId }), {});
}
