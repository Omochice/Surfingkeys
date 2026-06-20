import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Features, transform as transformCss } from "lightningcss";
import { visualizer } from "rollup-plugin-visualizer";
import { build as viteBuild } from "vite";
import { defineConfig } from "wxt";

// Permissions shared by both browsers (the base manifest's `permissions`).
const basePermissions = [
  "nativeMessaging",
  "tabs",
  "history",
  "bookmarks",
  "scripting",
  "storage",
  "sessions",
  "downloads",
  "topSites",
  "clipboardRead",
  "clipboardWrite",
];

// The dev-only key pins a stable extension id in development (carried over from
// the webpack manifest transform).
const devKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAneIRqYRqG/0RoYzpWoyeeO8KxxvWZvIabABbeQyHQ2PFOf81j/O5J28HGAEQJ56AptKMTcTeG2qZga9B2u9k98OmRcGp8BDco6fh1vD6/x0fWfehPeub5IcEcQmCd1lBuVa8AtUqV3C+He5rS4g8dB8g8GRlSPPSiDSVNMv+iwKAk7TbM3TKz6DyFO8eCtWXr6wJCcYeJA+Mub7o8DKIHKgv8XH8+GbJGjeeIUBU7mlGlyS7ivdsG1V6D2/Ldx0O1e6sRn7f9jiC4Xy1N+zgZ7BshYbnlbwedomg1d5kuo5m4rS+8BgTchPPkhkvEs62MI4e+fmQd0oGgs7PtMSrTwIDAQAb";

export default defineConfig({
  // The source tree predates WXT; entrypoints/ and public/ live at the root and
  // re-export the existing src/ modules rather than moving them.
  outDir: "dist",
  // The codebase uses explicit imports throughout; WXT auto-imports would only
  // add hidden globals.
  imports: { disabled: true, exclude: [/packages\//] },
  manifestVersion: 3,
  targetBrowsers: ["chrome", "firefox"],
  modules: ["@wxt-dev/module-solid"],
  vite: () => ({
    // Lightning CSS lets the stylesheets be authored with nesting and
    // @custom-media (drafts.customMedia) while compiling them down for the
    // target browsers, and minifies more aggressively than the esbuild default.
    css: {
      transformer: "lightningcss",
      lightningcss: {
        drafts: { customMedia: true },
      },
    },
    build: {
      cssMinify: "lightningcss",
    },
    plugins: [
      visualizer({
        filename: "dist/bundle-stats.html",
        template: "treemap",
        gzipSize: true,
        brotliSize: true,
      }),
    ],
  }),
  hooks: {
    // content.css ships as a single shared stylesheet (public/content.css,
    // copied to the root), injected by the content script and referenced by
    // the frontend iframe — mirror the old webpack manifest's css entry.
    "build:manifestGenerated": (wxt, manifest) => {
      const cs = manifest.content_scripts?.[0];
      if (cs) {
        cs.css = [...(cs.css ?? []), "content.css"];
      }
      // The old Chrome manifest opened the options page in a full tab
      // (options_page); Firefox kept it embedded in about:addons. WXT
      // generates options_ui with open_in_tab:false for both, so restore
      // Chrome's tab behaviour while leaving Firefox embedded.
      if (manifest.options_ui) {
        manifest.options_ui.open_in_tab = wxt.config.browser === "chrome";
      }
    },
    // The chrome-only user-scripts api (src/user_scripts/index.ts) is loaded
    // by injected user-script code via `import('./api.js')` expecting a
    // default export — a library module, not a WXT define*() entrypoint
    // (WXT auto-runs an unlisted script's main()). Bundle it ourselves with
    // Vite (which resolves the codebase's .js specifiers to .ts) into the
    // build root as a single ESM file, after WXT has emitted its output.
    "build:done": async (wxt) => {
      // content.css is served verbatim from public/ (linked as /content.css by
      // the HTML pages and injected as the content-script stylesheet), so it
      // bypasses Vite's CSS pipeline. Run Lightning CSS over the emitted copy in
      // production builds so it ships minified like the bundled stylesheets.
      if (wxt.config.mode === "production") {
        const cssPath = path.resolve(wxt.config.outDir, "content.css");
        const { code } = transformCss({
          filename: "content.css",
          code: await readFile(cssPath),
          minify: true,
          // No targets are passed here, so flatten nesting explicitly to match
          // the Vite-bundled stylesheets rather than emitting native nesting.
          include: Features.Nesting,
          drafts: { customMedia: true },
        });
        await writeFile(cssPath, code);
      }
      if (wxt.config.browser !== "chrome") return;
      await viteBuild({
        configFile: false,
        logLevel: "warn",
        mode: wxt.config.mode,
        // This lib build only emits api.js; without disabling publicDir Vite
        // re-copies public/ into outDir and clobbers the minified content.css
        // written above.
        publicDir: false,
        build: {
          outDir: wxt.config.outDir,
          emptyOutDir: false,
          minify: wxt.config.mode === "production",
          lib: {
            entry: path.resolve(wxt.config.root, "src/user_scripts/index.ts"),
            formats: ["es"],
            fileName: () => "api.js",
          },
        },
      });
    },
  },
  manifest: ({ browser, mode }) => {
    const permissions = [...basePermissions];
    // Resources the content script / injected pages fetch by extension URL:
    // the sandboxed iframe page and the emoji/l10n data. Chrome adds the
    // built-in favicon endpoint and the user-scripts api bundle (emitted by
    // the build:done hook above).
    const webResources = ["frontend.html", "pages/emoji.tsv", "pages/l10n.json"];
    // Build-config manifest builder: heterogeneous manifest JSON fields (strings, nested objects,
    // arrays) assembled and handed back to wxt; constraining the values adds no runtime type safety.
    // eslint-disable-next-line typescript/no-explicit-any
    const manifest: Record<string, any> = {
      name: "Surfingkeys",
      short_name: "Surfingkeys",
      author: "brook hong",
      description:
        "Rich shortcuts to click links/switch tabs/scroll, capture pages, use your browser like vim for productivity.",
      icons: {
        "16": "icons/16.png",
        "48": "icons/48.png",
        "128": "icons/128.png",
      },
      commands: {
        restartext: { description: "Restart this extension." },
        previousTab: { description: "Go to the previous tab." },
        nextTab: { description: "Go to the next tab." },
        closeTab: { description: "Close the current tab." },
      },
      action: {
        default_icon: { "16": "icons/16.png", "48": "icons/48.png" },
        default_title: "Surfingkeys",
      },
      host_permissions: ["<all_urls>"],
      permissions,
      web_accessible_resources: [{ resources: webResources, matches: ["<all_urls>"] }],
    };

    if (browser === "firefox") {
      permissions.push("cookies", "contextualIdentities");
      // The sanitizing Element.setHTML (used in place of DOMPurify) ships in
      // Firefox 148, the binding floor — already past the Firefox 115 that first
      // shipped the ES2023 array methods we also use directly (esbuild neither
      // polyfills nor down-levels built-in methods). defu deep-merges this into
      // WXT's base manifest, preserving any gecko fields WXT adds.
      manifest.browser_specific_settings = { gecko: { strict_min_version: "148.0" } };
    } else {
      permissions.push("downloads.shelf", "favicon", "userScripts");
      webResources.push("_favicon/*", "api.js");
      manifest.incognito = "split";
      // The Chrome counterpart of the Firefox floor above: the sanitizing
      // Element.setHTML ships in Chrome 146 (Chrome 105-118 shipped an earlier,
      // incompatible spec), past the Chrome 110 release that first shipped the
      // non-mutating array methods also in use.
      manifest.minimum_chrome_version = "146";
      if (mode === "development") {
        manifest.key = devKey;
      }
    }

    return manifest;
  },
});
