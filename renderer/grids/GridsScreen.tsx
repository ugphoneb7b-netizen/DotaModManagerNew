/* The Grids screen: catalog-style workshop and local grids manager. */
import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { pane } from '../core/router.ts';
import { esc } from '../ui/format.ts';
import type { WorkshopGrid, LocalGrid, WorkshopQueryParams } from '../api/grids.ts';
import type { GridConfigItem } from './gridCanvas.ts';
import { GridCanvasPreview } from './GridCanvasPreview.tsx';
import { MergeGridsModal } from './MergeGridsModal.tsx';
import { convertImageToGrid, loadImageFromFile, GRID_PRESETS, type GridMethod } from './ImageToGrid.ts';

type Tab = 'workshop' | 'local';

export interface GridsModel {
  key: number;
  workshop: WorkshopGrid[];
  local: LocalGrid[];
  total: number;
  page: number;
  error: string | null;
  loading: boolean;
  query: WorkshopQueryParams;
}

export interface GridsActions {
  openExternal: (url: string) => void;
  removeLocal: (name: string) => Promise<void>;
  saveLocal: (name: string, config: unknown) => Promise<void>;
  mergeGrids: (payload: { configs: unknown[]; target?: 'game' | 'file'; name?: string }) => Promise<{ dropped: number; total: number; canceled?: boolean }>;
  importGrid: () => Promise<void>;
  installWorkshop: (grid: WorkshopGrid) => Promise<void>;
  downloadWorkshop: (grid: WorkshopGrid) => Promise<void>;
  downloadLocal: (name: string) => Promise<void>;
  onQueryChange: (query: Partial<WorkshopQueryParams>) => Promise<void>;
  reloadLocal?: () => Promise<void>;
  reloadAll?: () => Promise<void>;
}

const TAG_FILTERS = [
  { id: 'all', label: 'Все теги' },
  { id: 'Аниме', label: 'Аниме' },
  { id: 'Милота', label: 'Милота' },
  { id: '18+', label: '18+' },
  { id: 'Рамки', label: 'Рамки' },
  { id: 'С упором на героя', label: 'С упором на героя' },
  { id: 'Мемы', label: 'Мемы' },
  { id: 'Dead inside', label: 'Dead inside' },
];

const SORT_OPTIONS = [
  { id: 'popular', label: 'Популярные' },
  { id: 'week', label: 'За неделю' },
  { id: 'new', label: 'Сначала новые' },
];

const gridDataCache = new Map<string, GridConfigItem>();

function useGridData(item: WorkshopGrid | LocalGrid): GridConfigItem | null {
  const [data, setData] = useState<GridConfigItem | null>(() => {
    if ('config' in item && item.config) {
      return { version: 3, configs: [item.config as GridConfigItem['configs'][0]] };
    }
    if ('id' in item && gridDataCache.has(item.id)) {
      return gridDataCache.get(item.id)!;
    }
    return null;
  });

  useEffect(() => {
    if ('config' in item && item.config) {
      setData({ version: 3, configs: [item.config as GridConfigItem['configs'][0]] });
      return;
    }
    if (!('id' in item)) return;

    if (gridDataCache.has(item.id)) {
      setData(gridDataCache.get(item.id)!);
      return;
    }

    let active = true;
    window.api.grids.gridData(item.id, item.revision)
      .then((res: unknown) => {
        if (!active || !res) return;
        const configItem = res as GridConfigItem;
        if (configItem && configItem.configs) {
          gridDataCache.set(item.id, configItem);
          setData(configItem);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [item]);

  return data;
}

function GridCardMedia({
  item,
  isAdultHidden,
  onReveal,
}: {
  item: WorkshopGrid | LocalGrid;
  isAdultHidden?: boolean;
  onReveal?: () => void;
}) {
  const gridData = useGridData(item);

  return (
    <div className="grid-card-media">
      {isAdultHidden ? (
        <div
          className="grid-card-nsfw-gate"
          onClick={(e) => {
            e.stopPropagation();
            if (onReveal) onReveal();
          }}
        >
          <span className="badge">18+</span>
          <span className="hint">{L`Нажми, чтобы показать`}</span>
        </div>
      ) : null}

      {gridData ? (
        <GridCanvasPreview grid={gridData} width={716} />
      ) : (
        <div className="grid-card-media-placeholder">
          <span className="ms">grid_view</span>
          <span>{item.name}</span>
        </div>
      )}
    </div>
  );
}

function WorkshopCard({
  g,
  showAdult,
  isInstalled,
  actions,
  onOpenDetails,
}: {
  g: WorkshopGrid;
  showAdult: boolean;
  isInstalled: boolean;
  actions: GridsActions;
  onOpenDetails: (g: WorkshopGrid) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const isAdultHidden = g.adult && !showAdult && !revealed;

  return (
    <div
      className={`grid-card ${isInstalled ? 'installed' : ''}`}
      key={g.id}
      onClick={() => onOpenDetails(g)}
    >
      <GridCardMedia
        item={g}
        isAdultHidden={isAdultHidden}
        onReveal={() => setRevealed(true)}
      />

      <div className="grid-card-body">
        <div className="grid-card-title-row">
          <div className="grid-card-title" title={g.name}>{esc(g.name)}</div>
          {g.adult && <span className="grid-badge-18">18+</span>}
        </div>

        <div className="grid-card-author-row">
          {g.authorAvatar ? (
            <img className="grid-card-avatar" src={esc(g.authorAvatar)} alt="" loading="lazy" />
          ) : (
            <div className="grid-card-avatar-dummy"><span className="ms">person</span></div>
          )}
          <span>{g.author ? esc(g.author) : L`воркшоп`}</span>
        </div>

        {g.tags && g.tags.length > 0 && (
          <div className="grid-card-tags">
            {g.tags.map((t) => (
              <span className="mtag" key={t}>{esc(t)}</span>
            ))}
          </div>
        )}

        <div className="grid-card-stats">
          <span className="grid-stat-item" title={L`Лайки`}>
            <span className="ms">favorite</span> {g.likes || 0}
          </span>
          <span className="grid-stat-item" title={L`Скачивания`}>
            <span className="ms">download</span> {g.downloads || 0}
          </span>
          {typeof g.stats?.heroes === 'number' && (
            <span className="grid-stat-item" title={L`Герои`}>
              <span className="ms">person</span> {g.stats.heroes}
            </span>
          )}
          {typeof g.stats?.categories === 'number' && (
            <span className="grid-stat-item" title={L`Категории`}>
              <span className="ms">category</span> {g.stats.categories}
            </span>
          )}
        </div>

        <div className="grid-card-footer" onClick={(e) => e.stopPropagation()}>
          <button
            className={`btn btn-sm ${isInstalled ? 'btn-ghost' : 'btn-primary'}`}
            onClick={() => actions.installWorkshop(g)}
          >
            <span className="ms">{isInstalled ? 'check' : 'add'}</span>
            {isInstalled ? L`Установлена` : L`В игру`}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            title={L`Скачать файл .json`}
            onClick={() => actions.downloadWorkshop(g)}
          >
            <span className="ms">download</span>{L`Скачать`}
          </button>
          <a
            className="btn btn-sm btn-ghost"
            href="#"
            title={L`Открыть на GridStudio`}
            onClick={(e) => {
              e.preventDefault();
              actions.openExternal(g.url);
            }}
          >
            <span className="ms">open_in_new</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function LocalCard({
  g,
  actions,
  onOpenDetails,
}: {
  g: LocalGrid;
  actions: GridsActions;
  onOpenDetails: (local: LocalGrid) => void;
}) {
  const cfg = g.config as Record<string, unknown> | null;
  const cats = Array.isArray(cfg?.categories) ? (cfg.categories as unknown[]).length : 0;
  let heroCount = 0;
  if (Array.isArray(cfg?.categories)) {
    for (const c of cfg.categories as Record<string, unknown>[]) {
      if (Array.isArray(c?.hero_ids)) heroCount += c.hero_ids.length;
    }
  }

  return (
    <div
      className="grid-card installed"
      key={g.name}
      onClick={() => onOpenDetails(g)}
    >
      <GridCardMedia item={g} />

      <div className="grid-card-body">
        <div className="grid-card-title-row">
          <div className="grid-card-title" title={g.name}>{esc(g.name)}</div>
        </div>

        <div className="grid-card-author-row">
          <div className="grid-card-avatar-dummy"><span className="ms">folder</span></div>
          <span>{L`В файле игры`}</span>
        </div>

        <div className="grid-card-stats">
          <span className="grid-stat-item">
            <span className="ms">category</span> {L`категорий: ${cats}`}
          </span>
          <span className="grid-stat-item">
            <span className="ms">person</span> {L`героев: ${heroCount}`}
          </span>
        </div>

        <div className="grid-card-footer" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-sm btn-ghost"
            title={L`Скачать файл .json`}
            onClick={() => actions.downloadLocal(g.name)}
          >
            <span className="ms">download</span>{L`Скачать`}
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => actions.removeLocal(g.name)}>
            <span className="ms">delete</span>{L`Удалить`}
          </button>
        </div>
      </div>
    </div>
  );
}


function GridDetailModal({
  item,
  onClose,
  actions,
  isInstalled,
}: {
  item: WorkshopGrid | LocalGrid | null;
  onClose: () => void;
  actions: GridsActions;
  isInstalled: boolean;
}) {
  const [gridData, setGridData] = useState<GridConfigItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!item) return;
    if ('config' in item) {
      setGridData({ version: 3, configs: [item.config as GridConfigItem['configs'][0]] });
      return;
    }
    // Workshop item: fetch full grid details
    setLoading(true);
    window.api.grids.gridData(item.id, item.revision)
      .then((data: unknown) => {
        setGridData(data as GridConfigItem || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [item]);

  if (!item) return null;
  const isWorkshop = 'id' in item;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label={L`Закрыть`}>
          <span className="ms">close</span>
        </button>

        <div className="grid-modal-preview-box">
          {loading ? (
            <div className="grid-card-media-placeholder">
              <span className="ms">hourglass_empty</span>
              <span>{L`Загрузка сетки…`}</span>
            </div>
          ) : (
            <GridCanvasPreview grid={gridData} width={800} />
          )}
        </div>

        <div className="modal-body">
          <div className="modal-title-row">
            <h2 className="modal-title">{esc(item.name)}</h2>
          </div>

          {isWorkshop && (
            <div className="grid-modal-stats-row">
              {item.author && <div><b>{L`Автор:`}</b> {esc(item.author)}</div>}
              <div><b>{L`Лайков:`}</b> {item.likes || 0}</div>
              <div><b>{L`Скачиваний:`}</b> {item.downloads || 0}</div>
              {item.stats?.heroes !== undefined && <div><b>{L`Героев:`}</b> {item.stats.heroes}</div>}
              {item.stats?.categories !== undefined && <div><b>{L`Категорий:`}</b> {item.stats.categories}</div>}
            </div>
          )}

          <div className="grid-modal-actions">
            {isWorkshop ? (
              <>
                <button
                  className={`btn ${isInstalled ? 'btn-ghost' : 'btn-primary'}`}
                  onClick={() => {
                    actions.installWorkshop(item as WorkshopGrid);
                    onClose();
                  }}
                >
                  <span className="ms">{isInstalled ? 'check' : 'add'}</span>
                  {isInstalled ? L`Установлена в игру` : L`Установить в игру`}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => actions.downloadWorkshop(item as WorkshopGrid)}
                >
                  <span className="ms">download</span>{L`Скачать .json`}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => actions.openExternal((item as WorkshopGrid).url)}
                >
                  <span className="ms">open_in_new</span>{L`Открыть на GridStudio`}
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={() => actions.downloadLocal(item.name)}
                >
                  <span className="ms">download</span>{L`Скачать .json`}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    actions.removeLocal(item.name);
                    onClose();
                  }}
                >
                  <span className="ms">delete</span>{L`Удалить из игры`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageToGridModal({
  initialImage,
  initialName,
  onClose,
  actions,
}: {
  initialImage?: HTMLImageElement | null;
  initialName?: string;
  onClose: () => void;
  actions: GridsActions;
}) {
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(initialImage || null);
  const [gridConfig, setGridConfig] = useState<GridConfigItem | null>(null);
  const [gridTitle, setGridTitle] = useState(initialName || 'My Custom Art');
  const [presetKey, setPresetKey] = useState<string>('photoRealistic');
  const [method, setMethod] = useState<GridMethod>('hybrid');
  const [invert, setInvert] = useState(false);
  const [contrast, setContrast] = useState(25);
  const [brightness, setBrightness] = useState(0);
  const [detail, setDetail] = useState(85);
  const [edgeBoost, setEdgeBoost] = useState(65);
  const [gamma, setGamma] = useState(50);
  const [spacingX, setSpacingX] = useState(6.8);
  const [spacingY, setSpacingY] = useState(10.8);
  const [maxPoints, setMaxPoints] = useState(480);
  const [fill, setFill] = useState(94);
  const [dotCount, setDotCount] = useState(0);
  const [catCount, setCatCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const genTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const regenerate = (
    img: HTMLImageElement,
    name = gridTitle,
    m = method,
    inv = invert,
    cnt = contrast,
    brg = brightness,
    det = detail,
    eb = edgeBoost,
    gam = gamma,
    sx = spacingX,
    sy = spacingY,
    fl = fill,
    mp = maxPoints,
  ) => {
    try {
      const res = convertImageToGrid(img, {
        title: name,
        method: m,
        invert: inv,
        contrast: cnt,
        brightness: brg,
        detail: det,
        edgeBoost: eb,
        gamma: gam,
        spacingX: sx,
        spacingY: sy,
        fill: fl,
        maxPoints: mp,
      });
      setGridConfig(res);
      // Count non-space stroke/dot characters and categories
      const cats = res?.configs?.[0]?.categories ?? [];
      setCatCount(cats.length);
      let dots = 0;
      for (const c of cats) {
        for (const ch of c.category_name) if (ch !== ' ') dots++;
      }
      setDotCount(dots);
    } catch { /* ignore */ }
  };

  // Debounced regeneration for sliders
  const debouncedRegenerate = (...args: Parameters<typeof regenerate>) => {
    if (genTimer.current) clearTimeout(genTimer.current);
    genTimer.current = setTimeout(() => regenerate(...args), 60);
  };

  const applyPreset = (key: string, img = imgElement) => {
    setPresetKey(key);
    const p = GRID_PRESETS[key];
    if (!p) return;
    setMethod(p.method);
    const opts = p.options;
    const newCnt = opts.contrast ?? contrast;
    const newBrg = opts.brightness ?? brightness;
    const newDet = opts.detail ?? detail;
    const newEb = opts.edgeBoost ?? edgeBoost;
    const newGam = opts.gamma ?? gamma;
    const newSx = opts.spacingX ?? spacingX;
    const newSy = opts.spacingY ?? spacingY;
    const newFl = opts.fill ?? fill;
    const newMp = opts.maxPoints ?? maxPoints;
    setContrast(newCnt);
    setBrightness(newBrg);
    setDetail(newDet);
    setEdgeBoost(newEb);
    setGamma(newGam);
    setSpacingX(newSx);
    setSpacingY(newSy);
    setFill(newFl);
    setMaxPoints(newMp);
    if (img) {
      regenerate(img, gridTitle, p.method, invert, newCnt, newBrg, newDet, newEb, newGam, newSx, newSy, newFl, newMp);
    }
  };

  useEffect(() => {
    if (initialImage) {
      setImgElement(initialImage);
      const title = initialName || gridTitle;
      setGridTitle(title);
      regenerate(initialImage, title);
    }
  }, [initialImage, initialName]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      setImgElement(img);
      const name = file.name.replace(/\.[^/.]+$/, '').trim() || 'Custom Art';
      setGridTitle(name);
      regenerate(img, name);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async () => {
    if (!gridConfig || !gridConfig.configs[0]) return;
    await actions.saveLocal(gridTitle, gridConfig.configs[0]);
    onClose();
  };

  const handleDelete = () => {
    setImgElement(null);
    setGridConfig(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content image-to-grid-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label={L`Закрыть`}>
          <span className="ms">close</span>
        </button>

        <div className="modal-body">
          <div className="modal-title-row" style={{ marginBottom: 12 }}>
            <span className="ms" style={{ color: 'var(--primary)', fontSize: 24 }}>auto_fix_high</span>
            <h2 className="modal-title">{L`Image to Grid (Картинка в сетку)`}</h2>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {!imgElement ? (
            <div
              className="image-drop-area"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) {
                  const img = await loadImageFromFile(file);
                  setImgElement(img);
                  const name = file.name.replace(/\.[^/.]+$/, '').trim() || 'Custom Art';
                  setGridTitle(name);
                  regenerate(img, name);
                }
              }}
            >
              <span className="ms">add_photo_alternate</span>
              <div className="image-drop-title">{L`Выбери или перетащи любую картинку`}</div>
              <div className="image-drop-sub">
                {L`Поддерживаются PNG, JPG, WebP, GIF, BMP. Она сразу превратится в сетку для Dota 2.`}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 8 }}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                <span className="ms">folder_open</span>{L`Выбрать файл`}
              </button>
            </div>
          ) : (
            <div className="image-grid-preview-wrap">
              <div className="grid-modal-preview-box">
                <GridCanvasPreview grid={gridConfig} width={800} />
              </div>

              {/* Stats bar */}
              <div style={{ display: 'flex', gap: 16, padding: '6px 0', fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                <span><b>{L`Точек:`}</b> {dotCount.toLocaleString()}</span>
                <span><b>{L`Категорий в Dota 2:`}</b> {catCount.toLocaleString()} <span style={{ color: catCount <= 200 ? 'var(--ok, #4ade80)' : 'var(--warn, #facc15)' }}>({catCount <= 200 ? L`Без лагов` : L`Много категорий`})</span></span>
                <span><b>{L`Метод:`}</b> {method === 'halftone' ? L`Полутон` : method === 'contour' ? L`Контур` : L`Гибрид`}</span>
              </div>

              <div className="image-grid-controls">
                <div className="image-grid-control-item" style={{ flex: 1, minWidth: 180 }}>
                  <span>{L`Название:`}</span>
                  <input
                    type="text"
                    className="input"
                    value={gridTitle}
                    onChange={(e) => {
                      setGridTitle(e.target.value);
                      if (imgElement) debouncedRegenerate(imgElement, e.target.value, method, invert, contrast, brightness, detail, edgeBoost, gamma, spacingX, spacingY, fill, maxPoints);
                    }}
                    style={{ height: 28, fontSize: 13, flex: 1 }}
                  />
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Стиль:`}</span>
                  <select
                    className="input"
                    style={{ height: 28, fontSize: 12.5, padding: '2px 8px' }}
                    value={presetKey}
                    onChange={(e) => applyPreset(e.target.value)}
                  >
                    {Object.entries(GRID_PRESETS).map(([key, p]) => (
                      <option key={key} value={key}>{p.label}</option>
                    ))}
                  </select>
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Лимит точек:`} {maxPoints}</span>
                  <input
                    type="range"
                    min="200"
                    max="800"
                    step="25"
                    value={maxPoints}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setMaxPoints(v);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, invert, contrast, brightness, detail, edgeBoost, gamma, spacingX, spacingY, fill, v);
                    }}
                    title={L`Оптимально для плавной игры без фризов в Dota 2: 350-500 точек`}
                  />
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Детализация:`} {detail}%</span>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={detail}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDetail(v);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, invert, contrast, brightness, v, edgeBoost, gamma, spacingX, spacingY, fill, maxPoints);
                    }}
                    title={L`Количество тональных переходов`}
                  />
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Чёткость краёв:`} {edgeBoost}%</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={edgeBoost}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setEdgeBoost(v);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, invert, contrast, brightness, detail, v, gamma, spacingX, spacingY, fill, maxPoints);
                    }}
                    title={L`Усиление контуров и мелких деталей`}
                  />
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Контраст:`} {contrast}</span>
                  <input
                    type="range"
                    min="-50"
                    max="70"
                    value={contrast}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setContrast(v);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, invert, v, brightness, detail, edgeBoost, gamma, spacingX, spacingY, fill, maxPoints);
                    }}
                  />
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Яркость:`} {brightness}</span>
                  <input
                    type="range"
                    min="-60"
                    max="60"
                    value={brightness}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBrightness(v);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, invert, contrast, v, detail, edgeBoost, gamma, spacingX, spacingY, fill, maxPoints);
                    }}
                  />
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Гамма:`} {gamma}</span>
                  <input
                    type="range"
                    min="20"
                    max="80"
                    value={gamma}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setGamma(v);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, invert, contrast, brightness, detail, edgeBoost, v, spacingX, spacingY, fill, maxPoints);
                    }}
                    title={L`Тоновая кривая: <50 = темнее, >50 = светлее`}
                  />
                </div>

                <div className="image-grid-control-item">
                  <span>{L`Заполнение:`} {fill}%</span>
                  <input
                    type="range"
                    min="30"
                    max="100"
                    value={fill}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setFill(v);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, invert, contrast, brightness, detail, edgeBoost, gamma, spacingX, spacingY, v, maxPoints);
                    }}
                    title={L`Размер изображения на сетке`}
                  />
                </div>

                <label className="image-grid-control-item" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={invert}
                    onChange={(e) => {
                      setInvert(e.target.checked);
                      if (imgElement) debouncedRegenerate(imgElement, gridTitle, method, e.target.checked, contrast, brightness, detail, edgeBoost, gamma, spacingX, spacingY, fill, maxPoints);
                    }}
                  />
                  <span>{L`Инверсия`}</span>
                </label>
              </div>

              <div className="image-grid-footer-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <span className="ms">image</span>{L`Сменить фото`}
                </button>

                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDelete}
                >
                  <span className="ms">delete</span>{L`Удалить`}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    if (!gridConfig || !gridConfig.configs[0]) return;
                    await actions.saveLocal(gridTitle, gridConfig.configs[0]);
                    await actions.downloadLocal(gridTitle);
                  }}
                  title={L`Скачать сетку как отдельный .json файл`}
                >
                  <span className="ms">download</span>{L`Скачать .json`}
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSave}
                >
                  <span className="ms">save</span>{L`Сохранить в игру`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function GridsScreen({ m, actions }: { m: GridsModel; actions: GridsActions }) {
  const [tab, setTab] = useState<Tab>('workshop');
  const [showAdult, setShowAdult] = useState(true);
  const [selectedItem, setSelectedItem] = useState<WorkshopGrid | LocalGrid | null>(null);
  const [showImageToGrid, setShowImageToGrid] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState(m.query.q || '');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync searchQuery when external query changes
  useEffect(() => {
    setSearchQuery(m.query.q || '');
  }, [m.query.q]);

  const [localPage, setLocalPage] = useState(1);
  const LOCAL_PAGE_SIZE = 12;

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setLocalPage(1);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      actions.onQueryChange({ q: val.trim() || undefined, page: 1 });
    }, 450);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setLocalPage(1);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    actions.onQueryChange({ q: undefined, page: 1 });
  };

  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const localNames = new Set(m.local.map((l) => norm(l.name)));

  const currentSort = m.query.sort || 'popular';
  const currentTag = m.query.tag || 'all';

  const totalPages = Math.max(1, Math.ceil(m.total / 12));
  const currentPage = m.page || 1;

  const shownLocal = m.local.filter((l) => {
    if (!searchQuery) return true;
    return l.name.toLowerCase().includes(searchQuery.toLowerCase());
  });
  const localTotalPages = Math.max(1, Math.ceil(shownLocal.length / LOCAL_PAGE_SIZE));
  const safeLocalPage = Math.min(localPage, localTotalPages);
  const pagedLocal = shownLocal.slice((safeLocalPage - 1) * LOCAL_PAGE_SIZE, safeLocalPage * LOCAL_PAGE_SIZE);

  const [imageToGridData, setImageToGridData] = useState<{ img: HTMLImageElement; name: string } | null>(null);
  const toolbarFileInputRef = useRef<HTMLInputElement>(null);

  const handleToolbarFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await loadImageFromFile(file);
      const name = file.name.replace(/\.[^/.]+$/, '').trim() || 'Custom Art';
      setImageToGridData({ img, name });
      setShowImageToGrid(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const openImageToGridPicker = () => {
    if (toolbarFileInputRef.current) {
      toolbarFileInputRef.current.click();
    } else {
      setShowImageToGrid(true);
    }
  };

  return (
    <div className="grids-screen">
      <input
        ref={toolbarFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        style={{ display: 'none' }}
        onChange={handleToolbarFilePicked}
      />
      <div className="grids-header">
        <div>
          <h1 className="view-title">{L`Сетки`}</h1>
          <div className="view-intro">
            {L`Сетки героев из воркшопа gridstudio и твоего hero_grid_config.json. Новую собирают на сайте, здесь её удобно держать и редактировать.`}
          </div>
        </div>
        <div className="grids-header-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (actions.reloadAll) actions.reloadAll();
            }}
            title={L`Обновить сетки и воркшоп`}
          >
            <span className="ms">refresh</span>{L`Обновить`}
          </button>
          <button
            className="btn btn-primary"
            onClick={openImageToGridPicker}
            title={L`Сконвертировать любую картинку в сетку`}
          >
            <span className="ms">auto_fix_high</span>{L`Image to Grid`}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setShowMergeModal(true)}
            title={L`Объединить несколько файлов сеток в одну`}
          >
            <span className="ms">call_merge</span>{L`Объединить сетки`}
          </button>
          <button className="btn btn-ghost" onClick={actions.importGrid}>
            <span className="ms">file_upload</span>{L`Импорт .json`}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => actions.openExternal('https://gridstudio.me')}
          >
            <span className="ms">open_in_new</span>{L`Открыть GridStudio`}
          </button>
        </div>
      </div>

      <div className="grids-toolbar">
        <div className="grids-tb-main">
          <div className="grids-seg">
            <button
              className={`grids-seg-btn ${tab === 'workshop' ? 'active' : ''}`}
              onClick={() => { setTab('workshop'); }}
            >
              <span className="ms">public</span>{L`Воркшоп`}
            </button>
            <button
              className={`grids-seg-btn ${tab === 'local' ? 'active' : ''}`}
              onClick={() => {
                setTab('local');
                setLocalPage(1);
                if (actions.reloadLocal) actions.reloadLocal();
              }}
            >
              <span className="ms">dashboard</span>{L`Мои сетки (${m.local.length})`}
            </button>
          </div>

          {tab === 'workshop' && (
            <div className="select-wrap">
              <span className="ms">sort</span>
              <select
                value={currentSort}
                onChange={(e) => actions.onQueryChange({ sort: e.target.value, page: 1 })}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grids-search-wrap">
            <span className="ms">search</span>
            <input
              className="input grids-search-input"
              type="text"
              placeholder={L`Поиск сеток…`}
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (debounceTimer.current) clearTimeout(debounceTimer.current);
                  actions.onQueryChange({ q: searchQuery.trim() || undefined, page: 1 });
                }
              }}
            />
            {searchQuery && (
              <button
                className="grids-search-clear"
                onClick={handleClearSearch}
              >
                <span className="ms">close</span>
              </button>
            )}
          </div>

          {tab === 'workshop' && (
            <label className="grids-adult-label">
              <input
                type="checkbox"
                checked={showAdult}
                onChange={(e) => setShowAdult(e.target.checked)}
              />
              <span>{L`Показывать 18+`}</span>
            </label>
          )}
        </div>

        {tab === 'workshop' && (
          <div className="grids-tb-tags">
            {TAG_FILTERS.map((tag) => (
              <button
                key={tag.id}
                className={`fchip ${currentTag === tag.id ? 'active' : ''}`}
                onClick={() => actions.onQueryChange({ tag: tag.id === 'all' ? undefined : tag.id, page: 1 })}
              >
                {tag.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {m.error && <div className="grids-error">{esc(m.error)}</div>}

      {m.loading && !m.workshop.length && tab === 'workshop' ? (
        <div className="empty-state">
          <span className="ms">hourglass_empty</span>
          <div className="empty-title">{L`Загружаю воркшоп…`}</div>
        </div>
      ) : (
        <div style={{ position: 'relative', opacity: m.loading ? 0.6 : 1, transition: 'opacity 0.2s ease' }}>
          <div className="grids-card-grid">
            {tab === 'workshop'
              ? m.workshop.map((g) => (
                  <WorkshopCard
                    key={g.id}
                    g={g}
                    showAdult={showAdult}
                    isInstalled={localNames.has(norm(g.name))}
                    actions={actions}
                    onOpenDetails={(item) => setSelectedItem(item)}
                  />
                ))
              : pagedLocal.map((l) => (
                  <LocalCard
                    key={l.name}
                    g={l}
                    actions={actions}
                    onOpenDetails={(item) => setSelectedItem(item)}
                  />
                ))}
          </div>

          {tab === 'workshop' && !m.workshop.length && !m.loading && (
            <div className="empty-state">
              <span className="ms">grid_view</span>
              <div className="empty-title">{L`Ничего не найдено`}</div>
            </div>
          )}

          {tab === 'local' && !shownLocal.length && (
            <div className="empty-state">
              <span className="ms">dashboard</span>
              <div className="empty-title">{L`Сеток не найдено`}</div>
            </div>
          )}
        </div>
      )}

      {tab === 'workshop' && totalPages > 1 && (
        <div className="grids-pagination">
          <button
            className="btn btn-sm"
            disabled={currentPage <= 1}
            onClick={() => actions.onQueryChange({ page: currentPage - 1 })}
          >
            <span className="ms">chevron_left</span>{L`Назад`}
          </button>
          <span className="grids-page-info">
            {L`Страница ${currentPage} из ${totalPages}`}
          </span>
          <button
            className="btn btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() => actions.onQueryChange({ page: currentPage + 1 })}
          >
            {L`Вперёд`}<span className="ms">chevron_right</span>
          </button>
        </div>
      )}

      {tab === 'local' && localTotalPages > 1 && (
        <div className="grids-pagination">
          <button
            className="btn btn-sm"
            disabled={safeLocalPage <= 1}
            onClick={() => setLocalPage((p) => Math.max(1, p - 1))}
          >
            <span className="ms">chevron_left</span>{L`Назад`}
          </button>
          <span className="grids-page-info">
            {L`Страница ${safeLocalPage} из ${localTotalPages}`}
          </span>
          <button
            className="btn btn-sm"
            disabled={safeLocalPage >= localTotalPages}
            onClick={() => setLocalPage((p) => Math.min(localTotalPages, p + 1))}
          >
            {L`Вперёд`}<span className="ms">chevron_right</span>
          </button>
        </div>
      )}

      {selectedItem && (
        <GridDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          actions={actions}
          isInstalled={'name' in selectedItem && localNames.has(norm(selectedItem.name))}
        />
      )}

      {showImageToGrid && (
        <ImageToGridModal
          initialImage={imageToGridData?.img}
          initialName={imageToGridData?.name}
          onClose={() => {
            setShowImageToGrid(false);
            setImageToGridData(null);
          }}
          actions={actions}
        />
      )}

      {showMergeModal && (
        <MergeGridsModal
          onClose={() => setShowMergeModal(false)}
          actions={actions}
          localGrids={m.local}
        />
      )}

    </div>
  );
}

const root = createRoot(pane('grids'));

export function showGrids(model: GridsModel, actions: GridsActions): void {
  flushSync(() => root.render(<GridsScreen m={model} actions={actions} />));
}
