/* The hero grid channels (src/ipc-grids.ts): the workshop list and the game's own config. */

/** One grid from the gridstudio.me workshop. */
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

/** One grid in the game's hero_grid_config.json, kept whole so an edit changes nothing else. */
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

export interface GridsApi {
  /** the workshop page from gridstudio.me API */
  workshop: (params?: WorkshopQueryParams) => Promise<{ grids: WorkshopGrid[]; total: number; page: number; error: string | null }>;
  /** get grid data (JSON) for a workshop grid */
  gridData: (id: string, revision?: number) => Promise<unknown>;
  /** install a grid directly from gridstudio into the active hero_grid_config.json */
  installWorkshop: (id: string, revision?: number, name?: string) => Promise<{ error: string | null }>;
  /** download/export a workshop grid to a standalone .json file on disk */
  downloadWorkshop: (id: string, revision?: number, name?: string) => Promise<{ error?: string | null; canceled?: boolean; path?: string }>;
  /** the grids already in the game's config */
  local: () => Promise<{ grids: LocalGrid[]; error: string | null }>;
  /** download/export a local game grid to a standalone .json file on disk */
  downloadLocal: (name: string) => Promise<{ error?: string | null; canceled?: boolean; path?: string }>;
  /** create or update one grid by name; an unknown name is added, a known one is replaced */
  save: (name: string, config: unknown) => Promise<{ error: string | null }>;
  /**
   * Merge configs into the game's file (target 'game') or into a standalone .json (target 'file'),
   * keeping one config per `config_name`; duplicates are dropped, not combined.
   */
  merge: (payload: { configs: unknown[]; target?: 'game' | 'file'; name?: string }) => Promise<{ error: string | null; canceled?: boolean; path?: string; total?: number; dropped?: string[] }>;
  /** delete one grid from the game's config by name */
  remove: (name: string) => Promise<{ error: string | null }>;
}