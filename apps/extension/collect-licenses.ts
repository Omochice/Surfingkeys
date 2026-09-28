import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const licensesDir = path.resolve(scriptDir, "licenses");

const nodeModulesSegment = "/node_modules/";
const licenseFilePattern = /^licen[cs]e(\.(md|txt))?$/i;

/** A license notice shown as one section of the licenses page. */
export type Notice = { heading: string; license: string; text: string };

/** Escape text for use in HTML element content and attribute values. */
export const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** The installed package directory a bundled module id belongs to, or null outside node_modules. */
export const packageDirOf = (moduleId: string): string | null => {
  if (moduleId.startsWith("\0")) return null;
  const [file = ""] = moduleId.split("?");
  const start = file.lastIndexOf(nodeModulesSegment);
  if (start === -1) return null;
  const rest = file.slice(start + nodeModulesSegment.length).split("/");
  const nameLength = rest[0]?.startsWith("@") ? 2 : 1;
  if (rest.length <= nameLength) return null;
  return file.slice(0, start + nodeModulesSegment.length) + rest.slice(0, nameLength).join("/");
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const stringField = (manifest: Record<string, unknown>, key: string): string => {
  const value = manifest[key];
  return typeof value === "string" ? value : "";
};

const readFileOrNull = async (file: string): Promise<string | null> => {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") return null;
    throw error;
  }
};

const readLicenseText = async (
  dir: string,
  { name, fallbackDir }: { name: string; fallbackDir: string | undefined },
): Promise<string | null> => {
  const files = await readdir(dir);
  const licenseFile = files.find((file) => licenseFilePattern.test(file));
  if (licenseFile != null) return readFile(path.join(dir, licenseFile), "utf8");
  if (fallbackDir == null) return null;
  return readFileOrNull(path.join(fallbackDir, name, "LICENSE"));
};

/**
 * Read the name, version, license and license text of the package in `dir`, taking the text from
 * `fallbackDir/<name>/LICENSE` when the package ships none; rejects when neither exists.
 */
export const readPackageNotice = async (
  dir: string,
  options: { fallbackDir?: string } = {},
): Promise<Notice> => {
  const manifest: unknown = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
  if (!isRecord(manifest)) {
    throw new Error(`${dir}/package.json is not an object`);
  }
  const name = stringField(manifest, "name");
  const text = await readLicenseText(dir, { name, fallbackDir: options.fallbackDir });
  if (text == null) {
    throw new Error(
      `${name} (${dir}) is bundled but ships no LICENSE file; add its license text as ` +
        `apps/extension/licenses/${name}/LICENSE`,
    );
  }
  return {
    heading: `${name} ${stringField(manifest, "version")}`,
    license: stringField(manifest, "license"),
    text,
  };
};

/** Render the standalone licenses page listing every notice. */
export const renderLicensesPage = (notices: readonly Notice[]): string => {
  const toc = notices
    .map((notice, i) => `<li><a href="#notice-${i}">${escapeHtml(notice.heading)}</a></li>`)
    .join("\n");
  const sections = notices
    .map(
      (notice, i) =>
        `<section id="notice-${i}">\n<h2>${escapeHtml(notice.heading)}</h2>\n` +
        `<p>${escapeHtml(notice.license)}</p>\n<pre>${escapeHtml(notice.text)}</pre>\n</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Surfingkeys Licenses</title>
<style>
body { font-family: sans-serif; max-width: 60em; margin: 0 auto; padding: 1em; }
pre { white-space: pre-wrap; background: #f5f5f5; padding: 1em; }
</style>
</head>
<body>
<h1>Licenses</h1>
<p>Surfingkeys and the third-party software and data it ships with are distributed under the following licenses.</p>
<ul>
${toc}
</ul>
${sections}
</body>
</html>
`;
};

const readFixedNotices = async (): Promise<{ own: Notice; emojiData: Notice[] }> => {
  const emojiJsonDir = path.dirname(require.resolve("unicode-emoji-json/package.json"));
  return {
    own: {
      heading: "Surfingkeys",
      license: "MIT",
      text: await readFile(path.resolve(scriptDir, "../../LICENSE"), "utf8"),
    },
    // The emoji data is read by generate-emoji.ts outside the bundle, so the collector never sees it.
    emojiData: [
      await readPackageNotice(emojiJsonDir),
      {
        heading: "Unicode emoji data",
        license: "Unicode-3.0",
        text: await readFile(path.join(licensesDir, "unicode-license-v3.txt"), "utf8"),
      },
    ],
  };
};

/** Collect the packages rendered into every build and write them to `licenses.html`. */
export const createLicenseCollector = (): {
  plugin: Plugin;
  write: (outDir: string) => Promise<void>;
} => {
  const packageDirs = new Set<string>();
  const plugin: Plugin = {
    name: "sk:collect-licenses",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const [id, rendered] of Object.entries(output.modules)) {
          if (rendered.renderedLength === 0) continue;
          const dir = packageDirOf(id);
          if (dir != null) packageDirs.add(dir);
        }
      }
    },
  };
  const write = async (outDir: string): Promise<void> => {
    const bundled = new Map<string, Notice>();
    for (const dir of packageDirs) {
      const notice = await readPackageNotice(dir, { fallbackDir: licensesDir });
      bundled.set(notice.heading, notice);
    }
    const { own, emojiData } = await readFixedNotices();
    const sorted = [...bundled.values()].toSorted((a, b) => a.heading.localeCompare(b.heading));
    await writeFile(
      path.resolve(outDir, "licenses.html"),
      renderLicensesPage([own, ...sorted, ...emojiData]),
    );
  };
  return { plugin, write };
};
