/* Reading picked files into configs, and the one rule the merge follows.
 *
 * A grid is identified by its config_name. Merging several files keeps every config, and where
 * two share a name - whether both came from the picked files or one was already in the game -
 * only the first survives. Nothing inside a config is rewritten or combined: the earlier file
 * wins the name, which is what the game itself does when it loads the file.
 *
 * Kept beside gridCanvas.ts rather than inside the screen so the rule is testable on its own and
 * is stated once, next to the shape it works on.
 */
import type { GridConfigItem } from './gridCanvas.ts';

export type GridCategory = GridConfigItem['configs'][0]['categories'][number];

/** One config the user added: its name, and the categories exactly as the file had them. */
export interface MergeSource {
  name: string;
  categories: GridCategory[];
  /** Which picked file or local grid it came from, to tell two sources apart in the list. */
  origin: string;
}

/** A file parsed into the sources it holds; a bare config (no `configs` wrapper) counts as one. */
export function readGridFile(json: unknown, fallbackName: string): MergeSource[] {
  const out: MergeSource[] = [];
  const configs: unknown[] = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json.configs)
      ? json.configs
      : isRecord(json) && Array.isArray(json.categories)
        ? [json]
        : [];

  for (const c of configs) {
    if (!isRecord(c)) continue;
    const name = typeof c.config_name === 'string' && c.config_name.trim() ? c.config_name.trim() : fallbackName;
    const categories = Array.isArray(c.categories) ? (c.categories as GridCategory[]) : [];
    if (categories.length > 0) out.push({ name, categories, origin: fallbackName });
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface MergeResult {
  /** The configs the merge leaves behind, in the order their names were first seen. */
  configs: Array<{ config_name: string; categories: GridCategory[] }>;
  /** The names that appeared more than once and were kept only once. */
  duplicates: string[];
}

/**
 * Keep one config per name, the first of each.
 *
 * The first source that claims a name wins it, so a name the game already has is not overwritten
 * by one picked up from a file.
 */
export function mergeSources(sources: MergeSource[]): MergeResult {
  const kept: Array<{ config_name: string; categories: GridCategory[] }> = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const src of sources) {
    const key = src.name.trim().toLowerCase();
    if (seen.has(key)) { duplicates.push(src.name); continue; }
    seen.add(key);
    kept.push({ config_name: src.name, categories: src.categories });
  }
  return { configs: kept, duplicates };
}

/** The whole merged file, shaped for the canvas preview and the merge channel. */
export function buildMergedGrid(sources: MergeSource[]): { grid: GridConfigItem; duplicates: string[] } {
  const { configs, duplicates } = mergeSources(sources);
  return {
    grid: { version: 3, configs: configs.map((c) => ({ config_name: c.config_name, categories: c.categories })) },
    duplicates,
  };
}