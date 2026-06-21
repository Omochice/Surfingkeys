import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const svgPath = path.join(repoRoot, "sk.svg");
const outDir = path.resolve(scriptDir, "../public/icons");

const normalSizes = [16, 48, 128];
// chrome.action.setIcon swaps the status variants at this size.
const variantSize = 48;

// gradient-1 is the surfer and gradient-3 the front wave; gradient-0/2 are the
// back swooshes. Lurking keeps these two foreground shapes coloured over an
// otherwise greyed icon.
const lurkingForeground = ["#gradient-1", "#gradient-3"];

// Expand the viewBox to restore the ~12% margin the previous icons framed with.
// Applied to both the full and foreground SVGs to keep the lurking overlay
// aligned with its grey base.
const frameScale = 1.13;
const reframe = (svg: string): string => {
  let matched = false;
  const reframed = svg.replace(
    /viewBox="(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/,
    (_, x: string, y: string, w: string, h: string) => {
      matched = true;
      const minX = Number(x);
      const minY = Number(y);
      const width = Number(w);
      const height = Number(h);
      const padX = (width * (frameScale - 1)) / 2;
      const padY = (height * (frameScale - 1)) / 2;
      return `viewBox="${minX - padX} ${minY - padY} ${width * frameScale} ${height * frameScale}"`;
    },
  );
  // Fail loudly rather than silently shipping unframed icons if sk.svg's
  // viewBox ever stops matching the expected shape.
  if (!matched) {
    throw new Error("sk.svg has no recognizable viewBox; cannot reframe icons.");
  }
  return reframed;
};

const render = (svg: string, size: number): ReturnType<typeof sharp> =>
  sharp(Buffer.from(reframe(svg))).resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

const keepGradients = (svg: string, gradients: string[]): string =>
  svg.replaceAll(/<(?:path|ellipse)\b[^>]*?\/>/g, (el) =>
    gradients.some((g) => el.includes(g)) ? el : "",
  );

const mtime = (file: string): Promise<number> =>
  stat(file).then(
    (s) => s.mtimeMs,
    () => -1,
  );

// Skip regeneration unless the source art or this script is newer than every
// output, so dev-mode rebuilds don't re-rasterize on every reload. The sources
// are stat'd directly (not via the error-swallowing mtime) so a missing sk.svg
// fails the build instead of silently keeping stale icons.
const upToDate = async (targets: string[]): Promise<boolean> => {
  const sources = [svgPath, fileURLToPath(import.meta.url)];
  const sourceTimes = await Promise.all(sources.map((f) => stat(f).then((s) => s.mtimeMs)));
  const newest = Math.max(...sourceTimes);
  const times = await Promise.all(targets.map(mtime));
  return times.every((t) => t >= newest);
};

const normalPath = (size: number): string => path.join(outDir, `${size}.png`);

export const generateIcons = async (): Promise<boolean> => {
  const normal = normalSizes.map(normalPath);
  const disabled = path.join(outDir, `${variantSize}-x.png`);
  const lurking = path.join(outDir, `${variantSize}-l.png`);

  if (await upToDate([...normal, disabled, lurking])) return false;

  const svg = await readFile(svgPath, "utf8");
  await mkdir(outDir, { recursive: true });

  await Promise.all(normalSizes.map((size) => render(svg, size).png().toFile(normalPath(size))));

  const grey = await render(svg, variantSize).grayscale().png().toBuffer();
  await writeFile(disabled, grey);

  const foreground = await render(keepGradients(svg, lurkingForeground), variantSize)
    .png()
    .toBuffer();
  await sharp(grey)
    .composite([{ input: foreground }])
    .png()
    .toFile(lurking);

  return true;
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const changed = await generateIcons();
  console.log(changed ? "Generated extension icons." : "Extension icons already up to date.");
}
