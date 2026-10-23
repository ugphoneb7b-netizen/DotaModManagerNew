/* Types for the Liner music player IPC channels. */
import type { LinerTrack, LinerOverlayState } from '../../src/ipc-liner.ts';

export type { LinerTrack, LinerOverlayState };

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
}
