// Emit the built extension's size (installable zip + uncompressed total, per
// browser) as octocov custom metrics so it is diffed on every pull request:
// https://github.com/k1LoW/octocov#custom-metrics
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(baseDir, "dist");

const browsers = [
  { id: "chrome", outDir: "chrome-mv3" },
  { id: "firefox", outDir: "firefox-mv3" },
];

const directorySize = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const sizes = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? directorySize(full) : stat(full).then((s) => s.size);
    }),
  );
  return sizes.reduce((total, size) => total + size, 0);
};

const exists = async (target) =>
  stat(target).then(
    () => true,
    () => false,
  );

const bytes = { unit: " B" };

const measure = async ({ id, outDir }) => {
  const unpackedDir = path.join(distDir, outDir);
  if (!(await exists(unpackedDir))) return null;

  // Match the browser suffix; the zip file name embeds the version.
  const distEntries = await readdir(distDir);
  const zipName = distEntries.find((name) => name.endsWith(`-${id}.zip`));
  if (zipName === undefined) {
    throw new Error(`No zip for ${id} in ${distDir}; run \`pnpm run zip:${id}\` first.`);
  }

  const [zipSize, rawSize] = await Promise.all([
    stat(path.join(distDir, zipName)).then((s) => s.size),
    directorySize(unpackedDir),
  ]);

  return {
    key: `bundle_size_${id}`,
    name: `Bundle size (${id})`,
    metrics: [
      { key: "zip", name: "Zip", value: zipSize, ...bytes },
      { key: "raw", name: "Uncompressed", value: rawSize, ...bytes },
    ],
  };
};

const measured = await Promise.all(browsers.map(measure));
const metricSets = measured.filter((set) => set !== null);
if (metricSets.length === 0) {
  throw new Error(`No built extension found under ${distDir}; run \`pnpm run build\` first.`);
}

const outPath = path.join(baseDir, "custom_metrics_bundle_size.json");
await writeFile(outPath, `${JSON.stringify(metricSets, null, 2)}\n`);

for (const set of metricSets) {
  const figures = set.metrics.map((m) => `${m.name} ${m.value.toLocaleString()} B`).join(", ");
  console.log(`${set.name}: ${figures}`);
}
console.log(`Wrote ${path.relative(baseDir, outPath)}`);
