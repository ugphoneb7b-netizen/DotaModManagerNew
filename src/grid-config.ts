/* The game's hero_grid_config.json: finding it, reading it, and writing it back.
 *
 * A Dota installation can hold the file in more than one place - one per Steam account under
 * userdata, plus the game's own cfg folder - and the game reads whichever belongs to the account
 * that is playing. So the app treats them as one list: it finds every candidate, reads them in
 * order of importance, and writes the same content to all of them, so the grids a user sees are
 * the grids they get in the game.
 *
 * The one rule this module owns is what "two grids" means: a config is identified by its
 * `config_name`, and two configs with the same name (however they differ inside) are one grid.
 * That is what the game itself does, and it is why merging two files never produces a file the
 * game would read twice over. Kept out of src/ipc-grids.ts so the rule can be tested without
 * Electron, and so it cannot drift between reading and writing.
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import type { Settings } from './settings.ts';

/** The shape of the game's file, with each config kept whole and untouched. */
export interface GridConfigFile {
  version?: number;
  configs?: unknown[];
}

/** A config's name, trimmed; the empty string when it has none worth using. */
export function configName(config: unknown): string {
  if (!isRecord(config)) return '';
  return typeof config.config_name === 'string' ? config.config_name.trim() : '';
}

/** The key two configs are the same grid by: their name, case folded. */
export function configKey(config: unknown): string {
  return configName(config).toLowerCase();
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Keep one config per name: the first of each, in the order the names are first seen.
 *
 * This is the whole of the merge. A file that lists "boobs" three times becomes a file that
 * lists it once, and nothing inside the surviving config is rewritten.
 *
 * @returns the kept configs, and how many copies were dropped as duplicates.
 */
export function dedupeConfigsByName(configs: unknown[]): { configs: Record<string, unknown>[]; dropped: number } {
  const kept: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (let i = 0; i < configs.length; i++) {
    const c = configs[i];
    if (!isRecord(c)) continue;
    const name = configName(c) || `Сетка ${i + 1}`;
    const key = name.toLowerCase();
    if (seen.has(key)) { dropped++; continue; }
    seen.add(key);
    kept.push({ ...c, config_name: name });
  }
  return { configs: kept, dropped };
}

/**
 * The configs a set of files would leave behind once merged, and the duplicates that fell out.
 *
 * Each entry is the parsed file (`{ version, configs }`) as the window read it, so this is the
 * same rule the main process applies when it writes, checked against what the user picked before
 * anything touches the game's folder.
 */
export function mergeGridFiles(files: GridConfigFile[]): {
  configs: Record<string, unknown>[];
  dropped: string[];
} {
  const all: unknown[] = [];
  for (const file of files) if (Array.isArray(file.configs)) all.push(...file.configs);

  const kept: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const dropped: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (!isRecord(c)) continue;
    const name = configName(c) || `Сетка ${i + 1}`;
    const key = name.toLowerCase();
    if (seen.has(key)) { dropped.push(name); continue; }
    seen.add(key);
    kept.push({ ...c, config_name: name });
  }
  return { configs: kept, dropped };
}

function getActiveSteamUserId(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam\\ActiveProcess', '/v', 'ActiveUser'], (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const m = stdout.match(/ActiveUser\s+REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)/);
      if (!m) return resolve(null);
      const val = m[1].startsWith('0x') ? parseInt(m[1], 16) : parseInt(m[1], 10);
      if (val > 0) return resolve(String(val));
      resolve(null);
    });
  });
}

function getRecentSteamUserIds(steamRoot: string): string[] {
  try {
    const vdfPath = path.join(steamRoot, 'config', 'loginusers.vdf');
    if (!fsSync.existsSync(vdfPath)) return [];
    const content = fsSync.readFileSync(vdfPath, 'utf8');
    const userBlocks: Array<{ steamId64: string; mostRecent: boolean; timestamp: number }> = [];
    const re = /"(\d{17})"\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const steamId64 = match[1];
      const block = match[2];
      const mostRecent = /"MostRecent"\s*"1"/i.test(block);
      const tsMatch = /"timestamp"\s*"(\d+)"/i.exec(block);
      const timestamp = tsMatch ? parseInt(tsMatch[1], 10) : 0;
      userBlocks.push({ steamId64, mostRecent, timestamp });
    }
    userBlocks.sort((a, b) => {
      if (a.mostRecent && !b.mostRecent) return -1;
      if (!a.mostRecent && b.mostRecent) return 1;
      return b.timestamp - a.timestamp;
    });
    return userBlocks.map((u) => {
      try {
        const id32 = (BigInt(u.steamId64) - 76561197960265728n).toString();
        return id32;
      } catch {
        return '';
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

async function getSteamRoots(settings: Settings): Promise<string[]> {
  const rootsToTry: string[] = [];
  const gamePath = settings.get('dotaGamePath') as string | null;
  if (gamePath) {
    const norm = path.normalize(gamePath);
    const steamIdx = norm.toLowerCase().indexOf('steamapps');
    if (steamIdx > 0) {
      rootsToTry.push(norm.slice(0, steamIdx).replace(/[\\/]+$/, ''));
    }
  }

  if (process.platform === 'win32') {
    const regPath = await new Promise<string | null>((resolve) => {
      execFile('reg', ['query', 'HKCU\\SOFTWARE\\Valve\\Steam', '/v', 'SteamPath'], (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const m = stdout.match(/REG_SZ\s+(.+)/);
        resolve(m ? m[1].trim() : null);
      });
    });
    if (regPath) rootsToTry.push(regPath.replace(/\//g, '\\'));

    for (const drive of ['C', 'D', 'E', 'F', 'G']) {
      rootsToTry.push(
        `${drive}:\\Program Files (x86)\\Steam`,
        `${drive}:\\Program Files\\Steam`,
        `${drive}:\\Steam`
      );
    }
  }

  const seen = new Set<string>();
  const valid: string[] = [];
  for (const r of rootsToTry) {
    const norm = path.normalize(r).toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      if (fsSync.existsSync(r)) valid.push(r);
    }
  }
  return valid;
}

interface CandidateFile {
  path: string;
  exists: boolean;
  mtime: number;
  priority: number;
}

/** Every place a hero_grid_config.json could be, most important first. */
export async function candidateGridConfigPaths(settings: Settings): Promise<string[]> {
  const steamRoots = await getSteamRoots(settings);
  const activeUserId = await getActiveSteamUserId();
  const gamePath = settings.get('dotaGamePath') as string | null;

  const candidates: CandidateFile[] = [];
  const seenPaths = new Set<string>();

  for (const root of steamRoots) {
    const userdata = path.join(root, 'userdata');
    const recentUsers = getRecentSteamUserIds(root);
    if (fsSync.existsSync(userdata)) {
      try {
        const userDirs = fsSync.readdirSync(userdata);
        for (const uid of userDirs) {
          if (uid === '0') continue;
          const p = path.join(userdata, uid, '570', 'remote', 'cfg', 'hero_grid_config.json');
          const normP = path.normalize(p).toLowerCase();
          if (seenPaths.has(normP)) continue;
          seenPaths.add(normP);

          const exists = fsSync.existsSync(p);
          let mtime = 0;
          if (exists) {
            try { mtime = fsSync.statSync(p).mtimeMs; } catch { /* ignore */ }
          }

          let priority = 2;
          if (activeUserId && uid === activeUserId) {
            priority = 0;
          } else if (recentUsers.length > 0 && recentUsers[0] === uid) {
            priority = 1;
          } else if (recentUsers.includes(uid)) {
            priority = 1.5;
          }
          if (!exists) priority = 3;

          candidates.push({ path: p, exists, mtime, priority });
        }
      } catch { /* ignore */ }
    }
  }

  if (gamePath) {
    const gameCfgPaths = [
      path.join(gamePath, 'dota', 'cfg', 'hero_grid_config.json'),
      path.join(gamePath, 'game', 'cfg', 'hero_grid_config.json'),
      path.join(gamePath, 'cfg', 'hero_grid_config.json'),
    ];
    for (const p of gameCfgPaths) {
      const normP = path.normalize(p).toLowerCase();
      if (!seenPaths.has(normP)) {
        seenPaths.add(normP);
        const exists = fsSync.existsSync(p);
        let mtime = 0;
        if (exists) {
          try { mtime = fsSync.statSync(p).mtimeMs; } catch { /* ignore */ }
        }
        candidates.push({ path: p, exists, mtime, priority: exists ? 2.5 : 3.5 });
      }
    }
  }

  candidates.sort((a, b) => {
    if (a.exists && !b.exists) return -1;
    if (!a.exists && b.exists) return 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.mtime - a.mtime;
  });

  return candidates.map((c) => c.path);
}

async function primaryGridConfigPath(settings: Settings): Promise<string> {
  const candidates = await candidateGridConfigPaths(settings);
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  if (candidates.length > 0) return candidates[0];
  const gamePath = settings.get('dotaGamePath') as string | null;
  if (!gamePath) throw new Error('Dota not found: set the path in Settings');
  return path.join(gamePath, 'dota', 'cfg', 'hero_grid_config.json');
}

/** A file's text as a config file: an array of configs, or one bare config. Null when it is neither. */
export function parseGridFileContent(raw: string): GridConfigFile | null {
  try {
    const clean = raw.replace(/^\uFEFF/, '').trim();
    if (!clean) return null;
    const parsed = JSON.parse(clean);
    if (!parsed) return null;

    if (Array.isArray(parsed)) {
      return { version: 3, configs: parsed };
    }
    if (isRecord(parsed)) {
      if (Array.isArray(parsed.configs)) {
        return { version: typeof parsed.version === 'number' ? parsed.version : 3, configs: parsed.configs };
      }
      if (Array.isArray(parsed.categories)) {
        return { version: 3, configs: [parsed] };
      }
      return { version: typeof parsed.version === 'number' ? parsed.version : 3, configs: [] };
    }
    return null;
  } catch {
    return null;
  }
}

/** Every grid the user has, across every copy of the file, one per name. */
export async function readGridConfig(settings: Settings): Promise<GridConfigFile> {
  const candidates = await candidateGridConfigPaths(settings);
  if (!candidates.length) return { version: 3, configs: [] };

  let primaryVersion = 3;
  const mergedConfigs: Record<string, unknown>[] = [];
  const seenConfigNames = new Set<string>();

  // 1. Read primary (active or most recently touched) config
  for (const file of candidates) {
    if (fsSync.existsSync(file)) {
      try {
        const raw = await fs.readFile(file, 'utf8');
        const parsed = parseGridFileContent(raw);
        if (parsed) {
          if (typeof parsed.version === 'number') primaryVersion = parsed.version;
          const configs = Array.isArray(parsed.configs) ? parsed.configs : [];
          for (let i = 0; i < configs.length; i++) {
            const c = configs[i];
            if (isRecord(c)) {
              const name = configName(c) || `Сетка ${i + 1}`;
              const key = name.toLowerCase();
              if (!seenConfigNames.has(key)) {
                seenConfigNames.add(key);
                mergedConfigs.push({ ...c, config_name: name });
              }
            }
          }
          break;
        }
      } catch { /* try next candidate */ }
    }
  }

  // 2. Discover and merge any unique grids from all other candidate files across sessions
  for (const file of candidates) {
    if (fsSync.existsSync(file)) {
      try {
        const raw = await fs.readFile(file, 'utf8');
        const parsed = parseGridFileContent(raw);
        if (parsed && Array.isArray(parsed.configs)) {
          for (let i = 0; i < parsed.configs.length; i++) {
            const c = parsed.configs[i];
            if (isRecord(c)) {
              const name = configName(c) || `Сетка ${i + 1}`;
              const key = name.toLowerCase();
              if (!seenConfigNames.has(key)) {
                seenConfigNames.add(key);
                mergedConfigs.push({ ...c, config_name: name });
              }
            }
          }
        }
      } catch { /* ignore secondary read errors */ }
    }
  }

  return { version: primaryVersion, configs: mergedConfigs };
}

/** Write the configs to every copy of the file that exists, so the accounts stay in step. */
export async function writeGridConfig(settings: Settings, data: GridConfigFile): Promise<void> {
  const version = typeof data.version === 'number' ? data.version : 3;
  const configs = Array.isArray(data.configs) ? data.configs : [];
  const content = JSON.stringify({ version, configs }, null, 2) + '\n';

  const candidates = await candidateGridConfigPaths(settings);
  const target = await primaryGridConfigPath(settings);

  // Write to primary target
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  } catch { /* ignore primary error */ }

  // Mirror write to ALL other userdata configs so grids stay synchronized across accounts
  for (const file of candidates) {
    if (file !== target && fsSync.existsSync(file)) {
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, content, 'utf8');
      } catch { /* ignore mirror failure */ }
    }
  }
}

/**
 * The content a merge leaves behind: the configs the game already has, plus the ones being merged
 * in, with a name that appears more than once kept once (the one already in the file wins, then
 * the first of the incoming ones).
 *
 * @returns the merged config list, and the names that were dropped as duplicates.
 */
export function mergeIntoGridConfig(existing: GridConfigFile, incoming: unknown[]): {
  configs: Record<string, unknown>[];
  dropped: string[];
} {
  const base = Array.isArray(existing.configs) ? existing.configs : [];
  return mergeGridFiles([{ version: existing.version, configs: base }, { version: 3, configs: incoming }]);
}