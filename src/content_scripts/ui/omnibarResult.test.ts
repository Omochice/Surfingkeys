import { describe, expect, it } from "vitest";

import { buildFolderResult, buildOmnibarResult, orderItemsForDisplay } from "./omnibarResult";

function li(html: string): HTMLElement {
  const el = document.createElement("li");
  el.innerHTML = html;
  return el;
}

describe("buildOmnibarResult", () => {
  it("derives html, className, and text from the li", () => {
    const el = li("<div class='title'>hello</div>");
    el.className = "window";

    const result = buildOmnibarResult(el, {});

    expect(result.html).toBe('<div class="title">hello</div>');
    expect(result.className).toBe("window");
    expect(result.data.text).toBe("hello");
  });

  it("reads faviconSrc from a child img.icon src", () => {
    const el = li("<img class='icon' src='https://example.com/favicon.ico'/>");

    const result = buildOmnibarResult(el, {});

    expect(result.faviconSrc).toBe("https://example.com/favicon.ico");
  });

  it("reads folder from the li's folder attribute", () => {
    const el = li("<div>▷ Bookmarks Bar</div>");
    el.setAttribute("folder", "42");

    const result = buildOmnibarResult(el, {});

    expect(result.data.folder).toBe("42");
  });

  it("merges the explicit data object into data", () => {
    const el = li("<div>example.com</div>");

    const result = buildOmnibarResult(el, {
      uid: "H-https://example.com",
      url: "https://example.com",
    });

    expect(result.data.uid).toBe("H-https://example.com");
    expect(result.data.url).toBe("https://example.com");
  });

  it("lets explicit data override the derived folder and text defaults", () => {
    const el = li("<div>raw html row</div>");
    el.setAttribute("folder", "from-attribute");

    const result = buildOmnibarResult(el, { folder: "from-props", text: "from-props" });

    expect(result.data.folder).toBe("from-props");
    expect(result.data.text).toBe("from-props");
  });
});

describe("orderItemsForDisplay", () => {
  it("returns the items unchanged when not positioned at the bottom", () => {
    const items = ["a", "b", "c"];

    expect(orderItemsForDisplay(items, false)).toEqual(["a", "b", "c"]);
  });

  it("returns the items reversed when positioned at the bottom", () => {
    const items = ["a", "b", "c"];

    expect(orderItemsForDisplay(items, true)).toEqual(["c", "b", "a"]);
  });

  // OpenWindows.onInput hands listResults its cache array by reference on an empty query, and the
  // same array is reused across keystrokes; reordering it in place would corrupt the cache order.
  it("does not mutate the caller's array when positioned at the bottom", () => {
    const items = ["a", "b", "c"];

    orderItemsForDisplay(items, true);

    expect(items).toEqual(["a", "b", "c"]);
  });
});

describe("buildFolderResult", () => {
  // A bookmark-folder row is built in two AddBookmark sites (onOpen and onInput); both must
  // return an OmnibarResult carrying the folder id, never a bare <li>, or <ResultList> can render
  // neither the row HTML nor resolve the folder on selection.
  it("returns an OmnibarResult carrying the folder id and labelled title", () => {
    const result = buildFolderResult("Bookmarks Bar", "42");

    expect(result.data.folder).toBe("42");
    expect(result.html).toContain("▷ Bookmarks Bar");
  });
});
