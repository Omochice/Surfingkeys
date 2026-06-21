// Rasterize the master sk.svg logo into the extension's PNG icon set at build
// time, so the binary PNGs are derived from a single committed source instead
// of being checked in. The toolbar status icons are colour transforms of the
// same artwork (not separate drawings), so deriving them here keeps sk.svg the
// only thing to maintain.
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const svgPath = path.join(repoRoot, "sk.svg");
const outDir = path.resolve(scriptDir, "../public/icons");

// Manifest/toolbar sizes for the default icon, plus the 48px size that
// chrome.action.setIcon swaps in for the status variants.
const normalSizes = [16, 48, 128];
const variantSize = 48;

// gradient-1 paints the surfer and gradient-3 the front wave; gradient-0 and
// gradient-2 paint the receding back swooshes. The lurking state greys the back
// swooshes while keeping the surfer and front wave coloured, so the whole icon
// is greyed and just those two foreground shapes are composited back on top.
const lurkingForeground = ["#gradient-1", "#gradient-3"];

// sk.svg's artwork nearly fills its viewBox, but the toolbar icons leave a
// margin (~12% per side). Expand the viewBox symmetrically before rasterizing so
// the rendered logo keeps that established framing. Applied to both the full and
// foreground SVGs so the lurking overlay stays aligned with its grey base.
const frameScale = 1.13;
const reframe = (svg: string): string =>
  svg.replace(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/, (_, w: string, h: string) => {
    const width = Number(w);
    const height = Number(h);
    const padX = (width * (frameScale - 1)) / 2;
    const padY = (height * (frameScale - 1)) / 2;
    return `viewBox="${-padX} ${-padY} ${width * frameScale} ${height * frameScale}"`;
  });

const render = (svg: string, size: number): sharp.Sharp =>
  sharp(Buffer.from(reframe(svg))).resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });

// Keep only the shapes painted with the given gradients (preserving their
// document order, hence their draw order), yielding a transparent overlay of
// just the foreground; the back swooshes and the stray dot ellipse drop out.
const keepGradients = (svg: string, gradients: string[]): string =>
  svg.replaceAll(/<(?:path|ellipse)\b[^>]*?\/>/g, (el) =>
    gradients.some((g) => el.includes(g)) ? el : "",
  );

const mtime = (file: string): Promise<number> =>
  stat(file).then(
    (s) => s.mtimeMs,
    () => -1,
  );

// Skip regeneration when every target is at least as new as both the source art
// and this script, so dev-mode rebuilds don't re-rasterize on every reload.
const upToDate = async (targets: string[]): Promise<boolean> => {
  const newest = Math.max(await mtime(svgPath), await mtime(fileURLToPath(import.meta.url)));
  const times = await Promise.all(targets.map(mtime));
  return times.every((t) => t >= newest);
};

export const generateIcons = async (): Promise<boolean> => {
  const normal = normalSizes.map((size) => path.join(outDir, `${size}.png`));
  const disabled = path.join(outDir, `${variantSize}-x.png`);
  const lurking = path.join(outDir, `${variantSize}-l.png`);

  if (await upToDate([...normal, disabled, lurking])) return false;

  const svg = await readFile(svgPath, "utf8");
  await mkdir(outDir, { recursive: true });

  await Promise.all(normalSizes.map((size, i) => render(svg, size).png().toFile(normal[i])));

  await render(svg, variantSize).grayscale().png().toFile(disabled);

  const grey = await render(svg, variantSize).grayscale().png().toBuffer();
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
