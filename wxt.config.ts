import { resolve } from "node:path";
import { defineConfig } from "wxt";
import { build as viteBuild } from "vite";

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
    imports: false,
    manifestVersion: 3,
    targetBrowsers: ["chrome", "firefox"],
    modules: ["@wxt-dev/module-solid"],
    hooks: {
        // content.css ships as a single shared stylesheet (public/content.css,
        // copied to the root), injected by the content script and referenced by
        // the frontend iframe — mirror the old webpack manifest's css entry.
        "build:manifestGenerated": (_wxt, manifest) => {
            const cs = manifest.content_scripts?.[0];
            if (cs) {
                cs.css = [...(cs.css ?? []), "content.css"];
            }
        },
        // The chrome-only user-scripts api (src/user_scripts/index.ts) is loaded
        // by injected user-script code via `import('./api.js')` expecting a
        // default export — a library module, not a WXT define*() entrypoint
        // (WXT auto-runs an unlisted script's main()). Bundle it ourselves with
        // Vite (which resolves the codebase's .js specifiers to .ts) into the
        // build root as a single ESM file, after WXT has emitted its output.
        "build:done": async (wxt) => {
            if (wxt.config.browser !== "chrome") return;
            await viteBuild({
                configFile: false,
                logLevel: "warn",
                mode: wxt.config.mode,
                build: {
                    outDir: wxt.config.outDir,
                    emptyOutDir: false,
                    minify: wxt.config.mode === "production",
                    lib: {
                        entry: resolve(wxt.config.root, "src/user_scripts/index.ts"),
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
        const manifest: Record<string, any> = {
            name: "Surfingkeys",
            short_name: "Surfingkeys",
            description:
                "Rich shortcuts to click links/switch tabs/scroll, capture pages, use your browser like vim for productivity.",
            icons: {
                "16": "icons/16.png",
                "48": "icons/48.png",
                "128": "icons/128.png",
            },
            commands: {
                restartext: { description: "Restart this extenstion." },
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
        } else {
            permissions.push("downloads.shelf", "favicon", "userScripts");
            webResources.push("_favicon/*", "api.js");
            manifest.incognito = "split";
            if (mode === "development") {
                manifest.key = devKey;
            }
        }

        return manifest;
    },
});
