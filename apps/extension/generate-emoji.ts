import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dataByEmoji from "unicode-emoji-json/data-by-emoji.json" with { type: "json" };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(scriptDir, "public/pages/emoji.json");

type EmojiEntry = [emoji: string, slug: string, name: string];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNameAndSlug(value: unknown): value is { name: string; slug: string } {
  return isRecord(value) && typeof value["name"] === "string" && typeof value["slug"] === "string";
}

function toEntries(raw: unknown): EmojiEntry[] {
  if (!isRecord(raw)) {
    throw new Error("unicode-emoji-json's data-by-emoji.json is not an object");
  }
  return Object.entries(raw).map(([emoji, entry]) => {
    if (!isNameAndSlug(entry)) {
      throw new Error(`unicode-emoji-json entry for ${emoji} is missing name/slug`);
    }
    return [emoji, entry.slug, entry.name];
  });
}

/** Write the emoji completion data served as `pages/emoji.json`. */
export const generateEmoji = async (): Promise<void> => {
  const entries = toEntries(dataByEmoji);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(entries));
};

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await generateEmoji();
}
