Thank you for willing to contribute on this project.

## Reporting issues

Please use below template to report issue, or you could click menu item from SurfingKeys icon in browser's tool bar.

```text
## Error details

SurfingKeys: 0.9.22

Browser: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:57.0) Gecko/20100101 Firefox/57.0

URL: <The_URL_Where_You_Find_The_Issue>

## Context

**Please replace this with a description of how you were using SurfingKeys.**
```

## Build

This project is a pnpm workspace and is built with [WXT](https://wxt.dev/). Install dependencies once with pnpm, then run a build script from the repository root.

```sh
pnpm install

pnpm build:prod                  # production build for Chromium based browsers
pnpm build:prod:firefox          # production build for Firefox

pnpm build:dev                   # development build for Chromium based browsers
pnpm build:dev:firefox           # development build for Firefox
```

Builds are emitted to `apps/extension/dist/<browser>-<manifest>`, for example `apps/extension/dist/chrome-mv3` or `apps/extension/dist/firefox-mv3`.

To produce a distributable archive instead of an unpacked build, use `pnpm zip` or `pnpm zip:firefox`.

## Develop

For an iterative workflow, run WXT in dev mode. It builds the extension, launches a browser with it loaded, and reloads on source changes.

```sh
pnpm dev                         # Chromium based browsers
pnpm dev:firefox                 # Firefox
```

## Test and check

Run the test suites and static checks from the repository root before opening a pull request.

```sh
pnpm test                        # run unit tests across all packages
pnpm test:browser                # run tests that need a real browser (Chromium, Firefox)
pnpm coverage                    # run the full suite with a merged coverage report

pnpm check                       # run linting, formatting, and type checks
pnpm fmt                         # apply formatting fixes
```

## Load Extension

When you need to load a build manually rather than through `pnpm dev`:

1. Run one of the build scripts above.
2. Open the browser's extension page.

- For Chrome, this can be accessed through "chrome://extensions".

3. Disable any other Surfingkeys install (from a store or a previous unpacked build) to avoid conflicts.
4. Enable "Developer mode" then click "Load unpacked."
5. Navigate to the build output directory, such as `apps/extension/dist/chrome-mv3`.
