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
    },
    manifest: ({ browser, mode }) => {
        const permissions = [...basePermissions];
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
        };

        if (browser === "firefox") {
            permissions.push("cookies", "contextualIdentities");
        } else {
            permissions.push("downloads.shelf", "favicon", "userScripts");
            manifest.incognito = "split";
            if (mode === "development") {
                manifest.key = devKey;
            }
        }

        return manifest;
    },
});
