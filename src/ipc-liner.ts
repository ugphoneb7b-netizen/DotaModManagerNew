/* Liner Music backend IPC handlers: music search, stream resolution, and floating overlay window. */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { electron } from './electron.ts';
import type { AppContext } from './app-context.ts';
import type { BrowserWindow } from 'electron';

export interface LinerTrack {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  coverUrl?: string;
}

export interface LinerOverlayState {
  isPlaying: boolean;
  track: LinerTrack | null;
  progress: number; // 0..1
  currentTime: number;
  duration: number;
  volume: number;
  loopMode?: string;
  theme?: string;
}

let overlayWindow: BrowserWindow | null = null;

export function closeOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try {
      overlayWindow.destroy();
    } catch {
      // ignore if already destroyed
    }
  }
  overlayWindow = null;
}
let lastOverlayState: LinerOverlayState = {
  isPlaying: false,
  track: null,
  progress: 0,
  currentTime: 0,
  duration: 0,
  volume: 0.8,
  theme: 'ursa',
};

let cachedSoundCloudClientId: string | undefined;

async function discoverSoundCloudClientId(signal?: AbortSignal): Promise<string | undefined> {
  try {
    const SOUNDCLOUD_HOME = 'https://soundcloud.com';
    const SCRIPT_URL = /src="((?:https:)?\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
    const CLIENT_ID_PATTERN = /client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/;
    const res = await fetch(SOUNDCLOUD_HOME, { headers: { accept: 'text/html,application/xhtml+xml' }, signal });
    const html = await res.text();
    const matches = [...html.matchAll(SCRIPT_URL)].map((m) => (m[1].startsWith('//') ? `https:${m[1]}` : m[1]));
    for (const scriptUrl of matches.reverse().slice(0, 10)) {
      const sres = await fetch(scriptUrl, { signal });
      const js = await sres.text();
      const found = js.match(CLIENT_ID_PATTERN)?.[1];
      if (found) {
        cachedSoundCloudClientId = found;
        return found;
      }
    }
  } catch {
    // fallback
  }
  return undefined;
}

async function getSoundCloudClientId(signal?: AbortSignal): Promise<string> {
  if (cachedSoundCloudClientId) return cachedSoundCloudClientId;
  const discovered = await discoverSoundCloudClientId(signal);
  if (!discovered) throw new Error('SoundCloud client_id could not be resolved');
  return discovered;
}

/** Register Liner channels. */
export function registerLinerIpc({ win }: Pick<AppContext, 'win'>): void {
  const { ipcMain, BrowserWindow, screen } = electron();

  ipcMain.handle('liner:search', async (event, query: string, offset?: number) => {
    try {
      const q = typeof query === 'string' ? query.trim() : '';
      const off = typeof offset === 'number' && Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0;
      const clientId = await getSoundCloudClientId();

      // If query is empty or special trending request, fetch SoundCloud trending chart
      if (q.length === 0 || q === '__trending__') {
        const trendingUrl = `https://api-v2.soundcloud.com/charts?kind=trending&genre=soundcloud%3Agenres%3Aall-music&limit=25&offset=${off}&client_id=${clientId}`;
        const res = await fetch(trendingUrl);
        if (res.ok) {
          const data = await res.json();
          const items = (data.collection || []).map((entry: any) => entry.track || entry).filter(Boolean);
          return { ok: true, tracks: formatSoundCloudTracks(items), totalResults: data.total_results || 250, offset: off };
        }
      }

      const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=25&offset=${off}&client_id=${clientId}`;
      const res = await fetch(url);
      if (!res.ok) {
        // Retry once with refreshed clientId
        cachedSoundCloudClientId = undefined;
        const freshId = await getSoundCloudClientId();
        const retryRes = await fetch(`https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(q)}&limit=25&offset=${off}&client_id=${freshId}`);
        if (!retryRes.ok) return { error: `SoundCloud search returned ${retryRes.status}` };
        const data = await retryRes.json();
        return { ok: true, tracks: formatSoundCloudTracks(data.collection || []), totalResults: data.total_results || 0, offset: off };
      }
      const data = await res.json();
      return { ok: true, tracks: formatSoundCloudTracks(data.collection || []), totalResults: data.total_results || 0, offset: off };
    } catch (err: any) {
      return { error: err?.message || 'Search failed' };
    }
  });

  ipcMain.handle('liner:resolveStream', async (event, trackId: string) => {
    try {
      const clientId = await getSoundCloudClientId();
      const id = trackId.replace(/^sc:/, '');
      const trackRes = await fetch(`https://api-v2.soundcloud.com/tracks/${encodeURIComponent(id)}?client_id=${clientId}`);
      if (!trackRes.ok) return { error: `Failed to fetch track: HTTP ${trackRes.status}` };
      const trackData = await trackRes.json();
      const transcodings: any[] = trackData.media?.transcodings || [];
      const prog = transcodings.find((t) => t.format?.protocol === 'progressive');
      const hls = transcodings.find((t) => t.format?.protocol === 'hls');
      const chosen = prog || hls || transcodings[0];
      if (!chosen?.url) return { error: 'No playable stream transcoding found' };

      const streamRes = await fetch(`${chosen.url}?client_id=${clientId}`);
      if (!streamRes.ok) return { error: `Failed to resolve stream URL: HTTP ${streamRes.status}` };
      const streamData = await streamRes.json();
      return {
        ok: true,
        streamUrl: streamData.url,
        isHls: chosen.format?.protocol === 'hls',
      };
    } catch (err: any) {
      return { error: err?.message || 'Failed to resolve stream' };
    }
  });

  ipcMain.handle('liner:overlayToggle', async () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
        return { ok: true, open: false };
      }
      overlayWindow.showInactive();
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.webContents.send('liner:overlayState', lastOverlayState);
      return { ok: true, open: true };
    }

    createOverlay();
    return { ok: true, open: true };
  });

  ipcMain.handle('liner:overlayShow', async () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      createOverlay();
    } else {
      overlayWindow.showInactive();
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.webContents.send('liner:overlayState', lastOverlayState);
    }
    return { ok: true };
  });

  ipcMain.handle('liner:overlayHide', async () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.hide();
    }
    return { ok: true };
  });

  ipcMain.handle('liner:overlayUpdateState', (event, state: LinerOverlayState) => {
    lastOverlayState = state;
    if (overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()) {
      overlayWindow.webContents.send('liner:overlayState', state);
    }
    return { ok: true };
  });

  ipcMain.handle('liner:overlayGetState', () => lastOverlayState);

  ipcMain.on('liner:overlayAction', (event, action: string, payload?: any) => {
    try {
      const main = win();
      if (main && !main.isDestroyed()) {
        main.webContents.send('liner:action', action, payload);
      }
    } catch {
      // main window might not be ready
    }
  });

  function createOverlay(): BrowserWindow {
    const primary = screen.getPrimaryDisplay();
    const workArea = primary.workArea;
    const width = 360;
    const height = 64;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + 24);

    overlayWindow = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.resolve(import.meta.dirname, '..', 'preload-overlay.js'),
      },
    });

    const overlayFile = path.resolve(import.meta.dirname, '..', 'renderer', 'overlay.html');
    overlayWindow.loadURL(pathToFileURL(overlayFile).href);
    overlayWindow.once('ready-to-show', () => {
      if (overlayWindow) {
        overlayWindow.showInactive();
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        overlayWindow.webContents.send('liner:overlayState', lastOverlayState);
      }
    });

    overlayWindow.on('closed', () => {
      overlayWindow = null;
    });

    return overlayWindow;
  }
}

function formatSoundCloudTracks(items: any[]): LinerTrack[] {
  const result: LinerTrack[] = [];
  for (const item of items) {
    if (!item || !item.id || !item.title) continue;
    const coverUrl = item.artwork_url
      ? item.artwork_url.replace(/-large\./, '-t500x500.')
      : item.user?.avatar_url || '';
    result.push({
      id: `sc:${item.id}`,
      title: String(item.title).trim(),
      artist: String(item.user?.username || 'Unknown Artist').trim(),
      durationMs: Number(item.duration) || 0,
      coverUrl,
    });
  }
  return result;
}
