/* The Grids screen: loads the workshop and the game's own grids, hands them to grids/GridsScreen.tsx. */
import { registerView } from '../core/router.ts';
import { showGrids, type GridsModel, type GridsActions } from '../grids/GridsScreen.tsx';
import { toast } from '../ui/toast.ts';
import type { WorkshopGrid, LocalGrid, WorkshopQueryParams } from '../api/grids.ts';

let key = 0;
let currentQuery: WorkshopQueryParams = { page: 1, sort: 'popular' };

let lastModel: GridsModel | null = null;

async function load(queryUpdate?: Partial<WorkshopQueryParams>): Promise<void> {
  if (queryUpdate) {
    currentQuery = { ...currentQuery, ...queryUpdate };
  }

  const model: GridsModel = {
    key: ++key,
    workshop: lastModel ? lastModel.workshop : ([] as WorkshopGrid[]),
    local: lastModel ? lastModel.local : ([] as LocalGrid[]),
    total: lastModel ? lastModel.total : 0,
    page: currentQuery.page || 1,
    error: null as string | null,
    loading: true,
    query: currentQuery,
  };
  lastModel = model;
  showGrids(model, actions);

  const [workshop, local] = await Promise.all([
    window.api.grids.workshop(currentQuery).catch(() => ({ grids: [] as WorkshopGrid[], total: 0, page: 1, error: 'network' })),
    window.api.grids.local().catch(() => ({ grids: [] as LocalGrid[], error: 'file' })),
  ]);

  model.workshop = workshop.grids || [];
  model.total = workshop.total || 0;
  model.page = workshop.page || 1;
  model.local = local.grids || [];
  model.error = workshop.error || local.error;
  model.loading = false;
  lastModel = model;
  showGrids(model, actions);
}


const actions: GridsActions = {
  async openExternal(url: string): Promise<void> {
    window.api.misc.openExternal(url);
  },
  async onQueryChange(q: Partial<WorkshopQueryParams>): Promise<void> {
    await load(q);
  },
  async reloadLocal(): Promise<void> {
    const res = await window.api.grids.local().catch(() => ({ grids: [] as LocalGrid[], error: 'file' }));
    if (lastModel) {
      lastModel.local = res.grids || [];
      if (res.error) lastModel.error = res.error;
      showGrids(lastModel, actions);
    }
  },
  async reloadAll(): Promise<void> {
    await load();
    toast(L`Сетки обновлены`);
  },
  async installWorkshop(grid: WorkshopGrid): Promise<void> {
    const res = await window.api.grids.installWorkshop(grid.id, grid.revision, grid.name);
    if (res.error) {
      toast(res.error, 'error');
    } else {
      toast(L`Сетка «${grid.name}» сохранена`);
      await load();
    }
  },
  async downloadWorkshop(grid: WorkshopGrid): Promise<void> {
    const res = await window.api.grids.downloadWorkshop(grid.id, grid.revision, grid.name);
    if (res.error) toast(res.error, 'error');
    else if (!res.canceled) toast(L`Сетка сохранена в файл`);
  },
  async downloadLocal(name: string): Promise<void> {
    const res = await window.api.grids.downloadLocal(name);
    if (res.error) toast(res.error, 'error');
    else if (!res.canceled) toast(L`Сетка сохранена в файл`);
  },
  async removeLocal(name: string): Promise<void> {
    const r = await window.api.grids.remove(name);
    if (r.error) toast(r.error, 'error');
    else { toast(L`Сетка удалена`); await load(); }
  },
  async saveLocal(name: string, config: unknown): Promise<void> {
    const r = await window.api.grids.save(name, config);
    if (r.error) toast(r.error, 'error');
    else {
      toast(L`Сетка «${name}» сохранена`);
      await load();
    }
  },
  async mergeGrids(payload: { configs: unknown[]; target?: 'game' | 'file'; name?: string }): Promise<{ dropped: number; total: number; canceled?: boolean }> {
    const r = await window.api.grids.merge(payload);
    if (r.error) {
      toast(r.error, 'error');
      return { dropped: 0, total: 0 };
    }
    const dropped = r.dropped?.length ?? 0;
    const total = r.total ?? 0;
    if (r.canceled) return { dropped, total, canceled: true };
    if (payload.target === 'file') {
      toast(L`Сетка сохранена в файл`);
    } else {
      toast(L`Объединено сеток: ${total}`);
      await load();
    }
    return { dropped, total };
  },
  async importGrid(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      let importedCount = 0;
      let lastError: string | null = null;
      for (const file of files) {
        try {
          const raw = await file.text();
          const clean = raw.replace(/^\uFEFF/, '').trim();
          const parsed = JSON.parse(clean);
          let configs: unknown[] = [];
          if (Array.isArray(parsed)) {
            configs = parsed;
          } else if (typeof parsed === 'object' && parsed !== null) {
            const rec = parsed as Record<string, unknown>;
            if (Array.isArray(rec.configs)) {
              configs = rec.configs;
            } else if (Array.isArray(rec.categories)) {
              configs = [rec];
            }
          }
          if (!configs.length) throw new Error('no valid grid configs');
          for (let i = 0; i < configs.length; i++) {
            const entry = configs[i];
            if (typeof entry !== 'object' || entry === null) continue;
            const rec = entry as Record<string, unknown>;
            let name = typeof rec.config_name === 'string' && rec.config_name.trim()
              ? rec.config_name.trim()
              : file.name.replace(/\.[^/.]+$/, '').trim();
            if (configs.length > 1 && (!rec.config_name || !String(rec.config_name).trim())) {
              name = `${name} (${i + 1})`;
            }
            const r = await window.api.grids.save(name, { ...rec, config_name: name });
            if (r.error) {
              lastError = r.error;
            } else {
              importedCount++;
            }
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (importedCount > 0) {
        toast(L`Импортировано сеток: ${importedCount}`);
        await load();
      } else {
        toast(lastError ? L`Ошибка импорта: ${lastError}` : L`Не удалось прочитать файл: это не сетка`, 'error');
      }
    };
    input.click();
  },
};

registerView('grids', () => load({ page: 1 }));

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    window.api.grids.local().then((res) => {
      if (lastModel && res.grids) {
        const currentNames = lastModel.local.map((g) => g.name).join('||');
        const newNames = res.grids.map((g) => g.name).join('||');
        if (currentNames !== newNames) {
          lastModel.local = res.grids;
          showGrids(lastModel, actions);
        }
      }
    }).catch(() => {});
  });
}