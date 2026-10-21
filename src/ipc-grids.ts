/* Hero grids: the workshop at gridstudio.me and the game's own hero_grid_config.json. */
import { electron } from './electron.ts';
import * as fs from 'node:fs/promises';
import type { AppContext } from './app-context.ts';
import { fetchMirrored } from './net-fetch.ts';
import {
  isRecord,
  configName,
  dedupeConfigsByName,
  mergeIntoGridConfig,
  readGridConfig,
  writeGridConfig,
} from './grid-config.ts';

export interface WorkshopGrid {
  id: string;
  name: string;
  author: string | null;
  authorAvatar?: string | null;
  adult: boolean;
  preview: string | null;
  url: string;
  revision?: number;
  stats?: {
    categories?: number;
    heroes?: number;
    symbols?: number;
  };
  tags?: string[];
  likes?: number;
  downloads?: number;
  comments?: number;
}

export interface LocalGrid {
  name: string;
  config: unknown;
}

export interface WorkshopQueryParams {
  page?: number;
  sort?: string;
  tag?: string;
  q?: string;
}


export function registerGridsIpc({
  settings,
}: Pick<AppContext, 'settings'>): void {
  const { ipcMain } = electron();

  ipcMain.handle('grids:workshop', async (_e, params?: WorkshopQueryParams) => {
    try {
      const page = typeof params?.page === 'number' && params.page > 0 ? params.page : 1;
      const sort = typeof params?.sort === 'string' && params.sort ? params.sort : 'popular';
      const q = typeof params?.q === 'string' ? params.q.trim() : '';
      const tag = typeof params?.tag === 'string' ? params.tag.trim() : '';

      const searchParams = new URLSearchParams();
      searchParams.set('page', String(page));
      searchParams.set('sort', sort);
      if (tag && tag !== 'all') searchParams.set('tag', tag);
      if (q) searchParams.set('q', q);

      const url = `https://gridstudio.me/api/catalog/works?${searchParams.toString()}`;
      const res = await fetchMirrored(url, {
        trustedOnly: true,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        return { grids: [] as WorkshopGrid[], total: 0, page, error: `HTTP ${res.status}` };
      }
      const data = await res.json() as { total?: number; page?: number; items?: unknown[] };
      const total = typeof data.total === 'number' ? data.total : 0;
      const items = Array.isArray(data.items) ? data.items : [];

      const grids: WorkshopGrid[] = items.map((raw): WorkshopGrid | null => {
        if (!isRecord(raw)) return null;
        const id = String(raw.id || '');
        const name = String(raw.title || raw.name || '');
        const creator = isRecord(raw.creator) ? raw.creator : null;
        const author = creator && typeof creator.name === 'string' ? creator.name : typeof raw.author === 'string' ? raw.author : null;
        let authorAvatar = creator && typeof creator.avatar === 'string' ? creator.avatar : null;
        if (authorAvatar && authorAvatar.startsWith('/')) {
          authorAvatar = `https://gridstudio.me${authorAvatar}`;
        }
        const tags = Array.isArray(raw.tags) ? raw.tags.map((t) => String(t)) : [];
        const adult = tags.includes('18+') || !!(raw.isAdult || raw.adult || raw.nsfw);
        const stats = isRecord(raw.stats)
          ? {
              categories: typeof raw.stats.categories === 'number' ? raw.stats.categories : undefined,
              heroes: typeof raw.stats.heroes === 'number' ? raw.stats.heroes : undefined,
              symbols: typeof raw.stats.symbols === 'number' ? raw.stats.symbols : undefined,
            }
          : undefined;

        const likes = typeof raw.likes === 'number' ? raw.likes : 0;
        const downloads = typeof raw.downloads === 'number' ? raw.downloads : 0;
        const comments = typeof raw.comments === 'number' ? raw.comments : 0;
        const revision = typeof raw.revision === 'number' ? raw.revision : 0;

        return {
          id,
          name,
          author,
          authorAvatar,
          adult,
          preview: null,
          url: `https://gridstudio.me/workshop?id=${encodeURIComponent(id)}`,
          revision,
          stats,
          tags,
          likes,
          downloads,
          comments,
        };
      }).filter((g): g is WorkshopGrid => g !== null && !!g.id && !!g.name);

      return { grids, total, page, error: null };
    } catch (err) {
      return { grids: [] as WorkshopGrid[], total: 0, page: 1, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const gridDataMemoryCache = new Map<string, unknown>();

  ipcMain.handle('grids:gridData', async (_e, id: string, revision?: number) => {
    if (typeof id !== 'string' || !id.trim()) return null;
    const cleanId = id.trim();
    const cacheKey = `${cleanId}:${revision || 0}`;
    if (gridDataMemoryCache.has(cacheKey)) {
      return gridDataMemoryCache.get(cacheKey);
    }
    try {
      const revParam = typeof revision === 'number' && revision > 0 ? `?revision=${revision}` : '';
      const url = `https://gridstudio.me/api/catalog/works/${encodeURIComponent(cleanId)}/grid${revParam}`;
      const res = await fetchMirrored(url, {
        trustedOnly: true,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = await res.json();
      gridDataMemoryCache.set(cacheKey, json);
      return json;
    } catch {
      return null;
    }
  });

  ipcMain.handle('grids:installWorkshop', async (_e, id: string, revision?: number, name?: string) => {
    if (typeof id !== 'string' || !id.trim()) return { error: 'Grid id cannot be empty' };
    try {
      const revParam = typeof revision === 'number' && revision > 0 ? `?revision=${revision}` : '';
      const url = `https://gridstudio.me/api/catalog/works/${encodeURIComponent(id)}/grid${revParam}`;
      const res = await fetchMirrored(url, {
        trustedOnly: true,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return { error: `HTTP ${res.status} failed to download grid` };

      const json = await res.json() as { version?: number; configs?: unknown[] };
      const incomingConfigs = Array.isArray(json.configs) ? json.configs : [];
      if (!incomingConfigs.length) return { error: 'Grid configuration is empty' };

      const gridEntry = incomingConfigs[0];
      if (!isRecord(gridEntry)) return { error: 'Invalid grid data format' };

      const gridName = (typeof name === 'string' && name.trim())
        ? name.trim()
        : (typeof gridEntry.config_name === 'string' && gridEntry.config_name.trim()
          ? gridEntry.config_name.trim()
          : 'Custom Grid');

      const entry = { ...gridEntry, config_name: gridName };

      const data = await readGridConfig(settings);
      const configs = Array.isArray(data.configs) ? [...data.configs] : [];
      const at = configs.findIndex((c) => isRecord(c) && typeof (c as Record<string, unknown>).config_name === 'string' && ((c as Record<string, unknown>).config_name as string).trim().toLowerCase() === gridName.toLowerCase());
      if (at >= 0) configs[at] = entry; else configs.push(entry);

      await writeGridConfig(settings, { version: typeof data.version === 'number' ? data.version : 3, configs });
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('grids:local', async () => {
    try {
      const data = await readGridConfig(settings);
      const configs = Array.isArray(data.configs) ? data.configs : [];
      const grids: LocalGrid[] = [];
      const seen = new Set<string>();
      for (let i = 0; i < configs.length; i++) {
        const entry = configs[i];
        if (isRecord(entry)) {
          const name = typeof entry.config_name === 'string' && entry.config_name.trim()
            ? entry.config_name.trim()
            : `Сетка ${i + 1}`;
          const key = name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            grids.push({ name, config: { ...entry, config_name: name } });
          }
        }
      }
      return { grids, error: null };
    } catch (err) {
      return { grids: [] as LocalGrid[], error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('grids:downloadWorkshop', async (_e, id: string, revision?: number, name?: string) => {
    if (typeof id !== 'string' || !id.trim()) return { error: 'Grid id cannot be empty' };
    try {
      const revParam = typeof revision === 'number' && revision > 0 ? `?revision=${revision}` : '';
      const url = `https://gridstudio.me/api/catalog/works/${encodeURIComponent(id)}/grid${revParam}`;
      const res = await fetchMirrored(url, {
        trustedOnly: true,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return { error: `HTTP ${res.status} failed to download grid` };

      const json = await res.json() as { version?: number; configs?: unknown[] };
      const incomingConfigs = Array.isArray(json.configs) ? json.configs : [];
      if (!incomingConfigs.length) return { error: 'Grid configuration is empty' };

      const gridEntry = incomingConfigs[0];
      if (!isRecord(gridEntry)) return { error: 'Invalid grid data format' };

      const gridName = (typeof name === 'string' && name.trim())
        ? name.trim()
        : (typeof gridEntry.config_name === 'string' && gridEntry.config_name.trim()
          ? gridEntry.config_name.trim()
          : 'Custom Grid');

      const entry = { ...gridEntry, config_name: gridName };
      const content = JSON.stringify({ version: typeof json.version === 'number' ? json.version : 3, configs: [entry] }, null, 2) + '\n';

      const { dialog, BrowserWindow } = electron();
      const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const safeFileName = `${gridName.replace(/[/\\?%*:|"<>]/g, '_')}.json`;

      const result = await dialog.showSaveDialog(parent, {
        title: 'Скачать сетку (.json)',
        defaultPath: safeFileName,
        filters: [{ name: 'Dota 2 Grid Config (*.json)', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) return { canceled: true };
      await fs.writeFile(result.filePath, content, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('grids:downloadLocal', async (_e, name: string) => {
    if (typeof name !== 'string' || !name.trim()) return { error: 'Grid name cannot be empty' };
    try {
      const data = await readGridConfig(settings);
      const configs = Array.isArray(data.configs) ? data.configs : [];
      const entry = configs.find((c) => isRecord(c) && (c as Record<string, unknown>).config_name === name.trim());
      if (!entry) return { error: 'Grid not found in local config' };

      const content = JSON.stringify({ version: typeof data.version === 'number' ? data.version : 3, configs: [entry] }, null, 2) + '\n';

      const { dialog, BrowserWindow } = electron();
      const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const safeFileName = `${name.trim().replace(/[/\\?%*:|"<>]/g, '_')}.json`;

      const result = await dialog.showSaveDialog(parent, {
        title: 'Скачать сетку (.json)',
        defaultPath: safeFileName,
        filters: [{ name: 'Dota 2 Grid Config (*.json)', extensions: ['json'] }],
      });

      if (result.canceled || !result.filePath) return { canceled: true };
      await fs.writeFile(result.filePath, content, 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('grids:save', async (_e, name: string, config: unknown) => {
    if (typeof name !== 'string' || !name.trim()) return { error: 'Grid name cannot be empty' };
    if (!isRecord(config)) return { error: 'Grid data is invalid' };
    try {
      const data = await readGridConfig(settings);
      const configs = Array.isArray(data.configs) ? [...data.configs] : [];
      const trimmed = name.trim();
      const entry = { ...config, config_name: trimmed };
      const at = configs.findIndex((c) => configName(c).toLowerCase() === trimmed.toLowerCase());
      if (at >= 0) configs[at] = entry; else configs.push(entry);
      await writeGridConfig(settings, { version: typeof data.version === 'number' ? data.version : 3, configs });
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /* Merge: the configs the user picked, brought into the game's file, one per name.
   *
   * This is the whole of the feature. A file that lists the same config_name twice - whether the
   * two copies came from the same picked file or one was already in the game - keeps one of them,
   * and nothing inside the surviving config is rewritten. `target: 'file'` writes the picked
   * configs out as a standalone .json instead of touching the game's own file. */
  ipcMain.handle('grids:merge', async (_e, payload: { configs?: unknown[]; target?: string; name?: string }) => {
    const picked = Array.isArray(payload?.configs) ? payload.configs : [];
    if (!picked.length) return { error: 'Nothing to merge' };
    const target = payload?.target === 'file' ? 'file' : 'game';
    try {
      /* The file target writes exactly what was picked; the game target reads the game's own
       * configs first so a name the game already has is not added a second time. */
      const { configs: merged, dropped } = target === 'file'
        ? dedupeConfigsByName(picked)
        : mergeIntoGridConfig(await readGridConfig(settings), picked);
      if (!merged.length) return { error: 'Nothing to merge' };

      if (target === 'file') {
        const content = JSON.stringify({ version: 3, configs: merged }, null, 2) + '\n';
        const { dialog, BrowserWindow } = electron();
        const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        const base = (typeof payload?.name === 'string' && payload.name.trim() ? payload.name.trim() : 'merged_grids')
          .replace(/[/\\?%*:|"<>]/g, '_');
        const result = await dialog.showSaveDialog(parent, {
          title: 'Сохранить объединённые сетки (.json)',
          defaultPath: `${base}.json`,
          filters: [{ name: 'Dota 2 Grid Config (*.json)', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        await fs.writeFile(result.filePath, content, 'utf8');
        return { error: null, path: result.filePath, total: merged.length, dropped };
      }

      const data = await readGridConfig(settings);
      await writeGridConfig(settings, { version: typeof data.version === 'number' ? data.version : 3, configs: merged });
      return { error: null, total: merged.length, dropped };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('grids:remove', async (_e, name: string) => {
    if (typeof name !== 'string' || !name.trim()) return { error: 'Grid name cannot be empty' };
    try {
      const data = await readGridConfig(settings);
      const targetName = name.trim().toLowerCase();
      const configs = Array.isArray(data.configs)
        ? data.configs.filter((c) => configName(c).toLowerCase() !== targetName)
        : [];
      await writeGridConfig(settings, { version: typeof data.version === 'number' ? data.version : 3, configs });
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
