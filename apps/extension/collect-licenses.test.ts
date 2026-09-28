import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  packageDirOf,
  readPackageNotice,
  renderLicensesPage,
} from "./collect-licenses.js";

const makePackage = async (files: Record<string, string>): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "sk-licenses-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return dir;
};

describe("escapeHtml", () => {
  it("escapes markup and quote characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });
});

describe("packageDirOf", () => {
  it("returns the package directory under the last node_modules", () => {
    expect(
      packageDirOf("/repo/node_modules/.pnpm/solid-js@1.9.15/node_modules/solid-js/dist/solid.js"),
    ).toBe("/repo/node_modules/.pnpm/solid-js@1.9.15/node_modules/solid-js");
  });

  it("keeps both segments of a scoped package name", () => {
    expect(packageDirOf("/repo/node_modules/@praha/byethrow/dist/index.js")).toBe(
      "/repo/node_modules/@praha/byethrow",
    );
  });

  it("ignores a query suffix", () => {
    expect(packageDirOf("/repo/node_modules/valibot/dist/index.js?commonjs-proxy")).toBe(
      "/repo/node_modules/valibot",
    );
  });

  it("returns null for virtual modules", () => {
    expect(packageDirOf("\0/repo/node_modules/solid-js/dist/solid.js")).toBeNull();
  });

  it("returns null for sources outside node_modules", () => {
    expect(packageDirOf("/repo/packages/core/src/index.ts")).toBeNull();
  });
});

describe("readPackageNotice", () => {
  it("reads the heading, license and license text", async () => {
    const dir = await makePackage({
      "package.json": JSON.stringify({ name: "pkg", version: "1.2.3", license: "MIT" }),
      "LICENSE.md": "MIT text",
    });

    expect(await readPackageNotice(dir)).toEqual({
      heading: "pkg 1.2.3",
      license: "MIT",
      text: "MIT text",
    });
  });

  it("takes the license text from the fallback directory when the package ships none", async () => {
    const dir = await makePackage({
      "package.json": JSON.stringify({ name: "@scope/bare", version: "1.0.0", license: "MIT" }),
    });
    const fallbackDir = await makePackage({});
    await mkdir(path.join(fallbackDir, "@scope/bare"), { recursive: true });
    await writeFile(path.join(fallbackDir, "@scope/bare/LICENSE"), "held text");

    const notice = await readPackageNotice(dir, { fallbackDir });

    expect(notice.text).toBe("held text");
  });

  it("rejects a package without a license file", async () => {
    const dir = await makePackage({
      "package.json": JSON.stringify({ name: "unlicensed", version: "1.0.0", license: "MIT" }),
    });

    await expect(readPackageNotice(dir)).rejects.toThrow(/unlicensed .* ships no LICENSE file/);
  });
});

describe("renderLicensesPage", () => {
  it("lists every notice with its text escaped", () => {
    const html = renderLicensesPage([
      { heading: "a 1.0.0", license: "MIT", text: "<script>alert(1)</script>" },
      { heading: "b 2.0.0", license: "ISC", text: "ISC text" },
    ]);

    expect(html).toContain('<a href="#notice-0">a 1.0.0</a>');
    expect(html).toContain('<section id="notice-1">');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});
