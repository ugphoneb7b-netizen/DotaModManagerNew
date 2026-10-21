/* Merging: several grid files (or grids already in the game) into one.
 *
 * The merge is a union by name. Every config the user added is kept, and where two configs share
 * a `config_name` only one survives - the first seen, so a name the game already has is not lost
 * to one picked up from a file. Nothing inside a config is combined or rewritten. The list below
 * says how many names were dropped, so the rule is visible rather than silent.
 *
 * Saving goes through one channel: `mergeGrids` with target 'game' writes the game's own
 * hero_grid_config.json, target 'file' writes the picked configs out as a standalone .json.
 */
import { useRef, useState } from 'react';
import { esc } from '../ui/format.ts';
import { GridCanvasPreview } from './GridCanvasPreview.tsx';
import { buildMergedGrid, readGridFile, type MergeSource } from './merge-grids.ts';
import type { GridsActions } from './GridsScreen.tsx';
import type { LocalGrid } from '../api/grids.ts';

export function MergeGridsModal({
  onClose,
  actions,
  localGrids,
}: {
  onClose: () => void;
  actions: GridsActions;
  localGrids: LocalGrid[];
}) {
  const [sources, setSources] = useState<MergeSource[]>([]);
  const [mergedTitle, setMergedTitle] = useState('merged_grids');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFile = async (file: File) => {
    try {
      const fallback = file.name.replace(/\.[^/.]+$/, '').trim() || 'grid';
      const parsed = readGridFile(JSON.parse(await file.text()) as unknown, fallback);
      if (!parsed.length) {
        alert(L`Не удалось прочитать файл: это не сетка`);
        return;
      }
      setSources((prev) => [...prev, ...parsed]);
    } catch {
      alert(L`Не удалось прочитать файл: это не сетка`);
    }
  };

  const handleFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length) {
      for (let i = 0; i < files.length; i++) await addFile(files[i]);
    }
    if (e.target) e.target.value = '';
  };

  const addLocalGrid = (g: LocalGrid) => {
    const cfg = g.config as Record<string, unknown> | null;
    if (!cfg || !Array.isArray(cfg.categories)) return;
    setSources((prev) => [
      ...prev,
      { name: g.name, categories: cfg.categories as MergeSource['categories'], origin: 'game' },
    ]);
  };

  const removeSource = (idx: number) => setSources((prev) => prev.filter((_, i) => i !== idx));

  const { grid: previewGrid, duplicates } = buildMergedGrid(sources);
  const totalConfigs = previewGrid.configs.length;
  const dupeCount = sources.length ? duplicates.length : 0;

  const save = async (target: 'game' | 'file') => {
    if (!previewGrid.configs.length || busy) return;
    setBusy(true);
    const res = await actions.mergeGrids({
      configs: previewGrid.configs,
      target,
      name: mergedTitle.trim() || 'merged_grids',
    });
    setBusy(false);
    if (!res.canceled) onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content merge-grids-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label={L`Закрыть`}>
          <span className="ms">close</span>
        </button>

        <div className="modal-body">
          <div className="modal-title-row" style={{ marginBottom: 12 }}>
            <span className="ms" style={{ color: 'var(--primary)', fontSize: 24 }}>call_merge</span>
            <h2 className="modal-title">{L`Объединить сетки`}</h2>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleFilesPicked}
          />

          {sources.length > 0 && (
            <div className="grid-modal-preview-box" style={{ marginBottom: 14 }}>
              <GridCanvasPreview grid={previewGrid} width={800} />
            </div>
          )}

          <div
            className="image-drop-area"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              const files = e.dataTransfer.files;
              if (files && files.length) {
                for (let i = 0; i < files.length; i++) await addFile(files[i]);
              }
            }}
            style={{ padding: '20px 16px' }}
          >
            <span className="ms">library_add</span>
            <div className="image-drop-title">{L`Выбери или перетащи файлы .json сеток`}</div>
            <div className="image-drop-sub">
              {L`Можно выбрать сразу несколько файлов с диска для объединения в одну общую сетку.`}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 6 }}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <span className="ms">folder_open</span>{L`Выбрать файлы .json`}
            </button>
          </div>

          {localGrids.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                {L`Или добавь из уже установленных сеток:`}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {localGrids.map((lg) => (
                  <button
                    key={lg.name}
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => addLocalGrid(lg)}
                  >
                    <span className="ms">add</span>{esc(lg.name)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sources.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {L`Выбранные конфигурации (${sources.length}):`}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {L`Всего категорий: ${totalConfigs}`}
                </span>
              </div>

              {dupeCount > 0 && (
                <div className="merge-note">
                  <span className="ms">info</span>
                  {L`Дубликатов по имени: ${dupeCount}`}
                </div>
              )}

              <div className="merge-list">
                {sources.map((src, idx) => {
                  const isDupe = duplicates.some((d) => d.toLowerCase() === src.name.trim().toLowerCase())
                    && sources.findIndex((s) => s.name.trim().toLowerCase() === src.name.trim().toLowerCase()) !== idx;
                  return (
                    <div key={idx} className={`merge-item ${isDupe ? 'merge-item-dupe' : ''}`}>
                      <div className="merge-item-icon">
                        <span className="ms">{isDupe ? 'content_copy' : 'grid_view'}</span>
                      </div>
                      <div className="merge-item-info">
                        <div className="merge-item-name">{esc(src.name)}</div>
                        <div className="merge-item-meta">
                          <span>{L`Категорий:`} {src.categories.length}</span>
                          {isDupe && <span className="merge-item-tag">×2</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="merge-item-remove"
                        onClick={() => removeSource(idx)}
                        title={L`Удалить`}
                      >
                        <span className="ms">close</span>
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="image-grid-controls" style={{ marginTop: 12 }}>
                <div className="image-grid-control-item" style={{ flex: 1, minWidth: 200 }}>
                  <span>{L`Название объединённой сетки:`}</span>
                  <input
                    type="text"
                    className="input"
                    value={mergedTitle}
                    onChange={(e) => setMergedTitle(e.target.value)}
                    style={{ height: 28, fontSize: 13, flex: 1 }}
                  />
                </div>
              </div>

              <div className="image-grid-footer-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setSources([])}>
                  <span className="ms">clear_all</span>{L`Очистить`}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => save('file')}
                  title={L`Скачать сетку как отдельный .json файл`}
                >
                  <span className="ms">download</span>{L`Скачать .json`}
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save('game')}>
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