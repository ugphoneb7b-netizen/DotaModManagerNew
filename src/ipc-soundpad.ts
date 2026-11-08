/* Liner Soundpad backend: sound effects the user imports once and then fires from the pad.
 *
 * The sounds live in userData/soundpad as plain files, so they survive updates and work offline.
 * The window only ever sees file:// addresses the handler built itself - a name from the page is
 * matched against the folder listing, never joined into a path, so a crafted id cannot read or
 * delete anything outside the pad's own directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { electron } from './electron.ts';
import { t } from './i18n.ts';
import type { AppContext } from './app-context.ts';

export interface SoundpadSound {
  id: string;
  name: string;
  fileUrl: string;
  size: number;
  ext: string;
}

const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'webm']);
const MAX_FILE = 200 * 1024 * 1024; // 200 MB is past any sane soundbite

/** Register the Soundpad channels. */
export function registerSoundpadIpc({ win }: Pick<AppContext, 'win'>): void {
  const { app, dialog, ipcMain, shell } = electron();

  const dir = (): string => path.join(app.getPath('userData'), 'soundpad');

  const listSounds = (): SoundpadSound[] => {
    const d = dir();
    let names: string[] = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      return [];
    }
    const out: SoundpadSound[] = [];
    for (const name of names) {
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!AUDIO_EXT.has(ext)) continue;
      const full = path.join(d, name);
      let size = 0;
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || st.size > MAX_FILE) continue;
        size = st.size;
      } catch {
        continue;
      }
      out.push({
        id: name,
        name: path.basename(name, path.extname(name)),
        fileUrl: pathToFileURL(full).href,
        size,
        ext,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  };

  ipcMain.handle('soundpad:list', () => ({ ok: true, sounds: listSounds() }));

  ipcMain.handle('soundpad:import', async () => {
    const res = await dialog.showOpenDialog(win(), {
      title: t('Выбери звуковые файлы для пэда'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('Звуки'), extensions: [...AUDIO_EXT] }],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    const d = dir();
    fs.mkdirSync(d, { recursive: true });
    const existing = new Set(fs.readdirSync(d));
    let added = 0;
    for (const src of res.filePaths) {
      const ext = path.extname(src).slice(1).toLowerCase();
      if (!AUDIO_EXT.has(ext)) continue;
      try {
        const st = fs.statSync(src);
        if (!st.isFile() || st.size > MAX_FILE) continue;
      } catch {
        continue;
      }
      let base = path.basename(src);
      // two files called "boop.mp3" from different folders still both belong on the pad
      if (existing.has(base)) {
        const stem = path.basename(src, path.extname(src));
        let n = 2;
        while (existing.has(`${stem} (${n})${path.extname(src)}`)) n++;
        base = `${stem} (${n})${path.extname(src)}`;
      }
      try {
        fs.copyFileSync(src, path.join(d, base));
        existing.add(base);
        added++;
      } catch {
        // a locked or vanished source is skipped, not fatal to the rest of the batch
      }
    }
    return { ok: true, added, sounds: listSounds() };
  });

  ipcMain.handle('soundpad:delete', (_e, id: unknown) => {
    if (typeof id !== 'string' || !id || id.length > 255 || id.includes('..') || /[\\/]/.test(id)) {
      return { error: 'bad id' };
    }
    const full = path.join(dir(), id);
    try {
      fs.unlinkSync(full);
    } catch {
      // already gone is still gone
    }
    return { ok: true, sounds: listSounds() };
  });

  ipcMain.handle('soundpad:reveal', () => {
    fs.mkdirSync(dir(), { recursive: true });
    shell.openPath(dir());
    return { ok: true };
  });
}
