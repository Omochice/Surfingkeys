import * as v from "valibot";

import type { SurfingkeysApi } from "./api";
import { type DefaultMappings, parseJsonSafe } from "./default";

// The leading element echoes the query (sometimes null), so only the suggestion list at index 1
// is constrained.
const openSearchSuggestSchema = v.tupleWithRest([v.unknown(), v.array(v.string())], v.unknown());
const duckduckgoSuggestSchema = v.array(v.object({ phrase: v.string() }));
const githubRepoSuggestSchema = v.object({
  items: v.array(v.object({ description: v.nullable(v.string()), html_url: v.string() })),
});
const youtubeSuggestSchema = v.tupleWithRest(
  [v.unknown(), v.array(v.tupleWithRest([v.string()], v.unknown()))],
  v.unknown(),
);

/** Register the data-driven default mappings onto `api`. */
export function applyDefaultMappings(api: SurfingkeysApi, mappings: DefaultMappings): void {
  for (const [keys, def] of Object.entries(mappings.vmap)) {
    api.vmapkey(keys, def.annotation, def.code, { ...def.options, group: def.group });
  }
  for (const [keys, def] of Object.entries(mappings.imap)) {
    api.imapkey(keys, def.annotation, def.code, { ...def.options, group: def.group });
  }
  for (const [keys, def] of Object.entries(mappings.nmap)) {
    api.mapkey(keys, def.annotation, def.code, { ...def.options, group: def.group });
  }
}

function registerGoToFirstTab(api: SurfingkeysApi): void {
  api.map("g0", ":feedkeys 99E", 0, "Go to the first tab", "tabs");
}

function registerGoToLastTab(api: SurfingkeysApi): void {
  api.map("g$", ":feedkeys 99R", 0, "Go to the last tab", "tabs");
}

function registerQuit(api: SurfingkeysApi): void {
  api.map("ZQ", ":quit");
}

function registerScrollFullPageUp(api: SurfingkeysApi): void {
  api.map("u", "e");
}

function registerOpenLinkBackgroundTabAlias(api: SurfingkeysApi): void {
  api.map("C", "gf");
}

function registerOmnibarArrowDown(api: SurfingkeysApi): void {
  api.cmap("<ArrowDown>", "<Ctrl-n>");
}

function registerOmnibarArrowUp(api: SurfingkeysApi): void {
  api.cmap("<ArrowUp>", "<Ctrl-p>");
}

function registerGoogleSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias(
    "g",
    "google",
    "https://www.google.com/search?q=",
    "s",
    "https://www.google.com/complete/search?client=chrome-omni&gs_ri=chrome-ext&oit=1&cp=1&pgcl=7&q=",
    (response: { text: string }) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
}

function registerDuckDuckGoSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias(
    "d",
    "duckduckgo",
    "https://duckduckgo.com/?q=",
    "s",
    "https://duckduckgo.com/ac/?q=",
    (response: { text: string }) => {
      const result = v.safeParse(duckduckgoSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output.map((r) => r.phrase) : [];
    },
  );
}

function registerBaiduSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias(
    "b",
    "baidu",
    "https://www.baidu.com/s?wd=",
    "s",
    "https://suggestion.baidu.com/su?cb=&wd=",
    (response: { text: string }) => {
      const res = response.text.match(/,s:\[("[^\]]+")]}/);
      return res?.[1] ? res[1].replaceAll('"', "").split(",") : [];
    },
  );
}

function registerWikipediaSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias(
    "e",
    "wikipedia",
    "https://en.wikipedia.org/wiki/",
    "s",
    "https://en.wikipedia.org/w/api.php?action=opensearch&format=json&formatversion=2&namespace=0&limit=40&search=",
    (response: { text: string }) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
}

function registerBingSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias(
    "w",
    "bing",
    "https://www.bing.com/search?setmkt=en-us&setlang=en-us&q=",
    "s",
    "https://api.bing.com/osjson.aspx?query=",
    (response: { text: string }) => {
      const result = v.safeParse(openSearchSuggestSchema, parseJsonSafe(response.text));
      return result.success ? result.output[1] : [];
    },
  );
}

function registerStackOverflowSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias("s", "stackoverflow", "https://stackoverflow.com/search?q=");
}

function registerGithubSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias(
    "h",
    "github",
    "https://github.com/search?q=",
    "s",
    "https://api.github.com/search/repositories?order=desc&q=",
    (response: { text: string }) => {
      const result = v.safeParse(githubRepoSuggestSchema, parseJsonSafe(response.text));
      return result.success
        ? result.output.items.map((r) => ({ title: r.description, url: r.html_url }))
        : [];
    },
  );
}

function registerYoutubeSearchAlias(api: SurfingkeysApi): void {
  api.addSearchAlias(
    "y",
    "youtube",
    "https://www.youtube.com/results?search_query=",
    "s",
    "https://clients1.google.com/complete/search?client=youtube&ds=yt&callback=cb&q=",
    (response: { text: string }) => {
      const result = v.safeParse(youtubeSuggestSchema, parseJsonSafe(response.text.slice(9, -1)));
      return result.success ? result.output[1].map((d) => d[0]) : [];
    },
  );
}

/**
 * Register the `map`/`cmap` remaps and built-in search-alias engines, which stay imperative because
 * they delegate to `api` methods with their own side effects.
 */
export function registerDefaultExtras(api: SurfingkeysApi): void {
  registerGoToFirstTab(api);
  registerGoToLastTab(api);
  registerQuit(api);
  registerScrollFullPageUp(api);
  registerOpenLinkBackgroundTabAlias(api);
  registerOmnibarArrowDown(api);
  registerOmnibarArrowUp(api);
  registerGoogleSearchAlias(api);
  registerDuckDuckGoSearchAlias(api);
  registerBaiduSearchAlias(api);
  registerWikipediaSearchAlias(api);
  registerBingSearchAlias(api);
  registerStackOverflowSearchAlias(api);
  registerGithubSearchAlias(api);
  registerYoutubeSearchAlias(api);
}
