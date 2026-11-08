/* Types for the Liner music player and Soundpad IPC channels.
 *
 * The shapes are declared here rather than imported from src/: the window must not reach into
 * the main process even for types (test/dependency-direction.test.js), so the wire format lives
 * on this side and src/ipc-liner.ts / src/ipc-soundpad.ts carry the same fields.
 */

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

export interface SoundpadSound {
  id: string;
  name: string;
  fileUrl: string;
  size: number;
  ext: string;
}

export interface LinerSearchResult {
  ok?: boolean;
  tracks?: LinerTrack[];
  totalResults?: number;
  offset?: number;
  error?: string;
}

export interface LinerStreamResult {
  ok?: boolean;
  streamUrl?: string;
  isHls?: boolean;
  error?: string;
}

export interface LinerOverlayToggleResult {
  ok: boolean;
  open: boolean;
}

export interface SoundpadListResult {
  ok: boolean;
  sounds: SoundpadSound[];
}

export interface SoundpadImportResult {
  canceled?: boolean;
  ok?: boolean;
  added?: number;
  sounds: SoundpadSound[];
}

export interface SoundpadDeleteResult {
  ok?: boolean;
  error?: string;
  sounds: SoundpadSound[];
}

export interface SoundpadApi {
  list: () => Promise<SoundpadListResult>;
  import: () => Promise<SoundpadImportResult>;
  remove: (id: string) => Promise<SoundpadDeleteResult>;
  reveal: () => Promise<{ ok: boolean }>;
}

export interface LinerApi {
  search: (query: string, offset?: number) => Promise<LinerSearchResult>;
  resolveStream: (trackId: string) => Promise<LinerStreamResult>;
  overlayToggle: () => Promise<LinerOverlayToggleResult>;
  overlayShow: () => Promise<{ ok: boolean }>;
  overlayHide: () => Promise<{ ok: boolean }>;
  overlayUpdateState: (state: LinerOverlayState) => Promise<{ ok: boolean }>;
  overlayGetState: () => Promise<LinerOverlayState>;
  sendOverlayAction: (action: string, payload?: any) => void;
  onOverlayAction: (cb: (action: string, payload?: any) => void) => void;
  soundpad: SoundpadApi;
}
