import { createElementWithContent } from "../common/utils";
import type { ResultListItem } from "./components/ResultList";

/**
 * A harvested omnibar row: the fields {@link ResultListItem} renders, plus the data the handlers
 * and key bindings read back from the store instead of reaching into the DOM (the legacy code
 * stored these as expandos on each `<li>`).
 */
export type OmnibarResult = {
  data: {
    uid?: string;
    url?: string;
    copy?: string;
    query?: string;
    windowId?: number;
    folderId?: string;
    folder_name?: string;
    cmd?: any;
    folder?: string;
    text: string;
  };
} & ResultListItem;

/**
 * Build an {@link OmnibarResult} from a rendered `<li>` plus an explicit data object.
 *
 * WHY: each handler used to assign its data fields (uid/url/query/...) as expandos on the `<li>`,
 * which `listResults` then harvested back off the DOM node. Passing the data explicitly removes
 * that DOM round-trip while keeping the proven HTML-generation path. The display fields (`html`,
 * `className`, `faviconSrc`, `text`, `folder`) are still derived from the `<li>` because that is
 * where the handlers compose them; the explicit `data` overrides those defaults, which is what the
 * `createItemFromRawHtml` props path relies on (user suggestion handlers may carry such fields).
 */
export function buildOmnibarResult(
  li: HTMLElement,
  data: Partial<OmnibarResult["data"]>,
): OmnibarResult {
  const img = li.querySelector("img.icon");
  const className = li.className || undefined;
  const faviconSrc = img?.getAttribute("src") ?? undefined;
  const folder = li.getAttribute("folder");
  // Each optional field is spread in only when it has a value: exactOptionalPropertyTypes forbids
  // assigning an explicit `undefined` to an optional property.
  return {
    html: li.innerHTML,
    ...(className !== undefined ? { className } : {}),
    ...(faviconSrc !== undefined ? { faviconSrc } : {}),
    data: {
      text: li.textContent ?? "",
      ...(folder !== null ? { folder } : {}),
      ...data,
    },
  };
}

/**
 * Build the omnibar row for a bookmark folder.
 *
 * WHY: `AddBookmark` lists folders from two entry points (initial open and on every keystroke).
 * Sharing one builder keeps both producing an {@link OmnibarResult} (with the folder id read back
 * off the `folder` attribute), so neither path can regress to returning a bare `<li>` that
 * `<ResultList>` cannot render.
 */
export function buildFolderResult(title: string, folderId: string): OmnibarResult {
  return buildOmnibarResult(createElementWithContent("li", `▷ ${title}`, { folder: folderId }), {});
}
