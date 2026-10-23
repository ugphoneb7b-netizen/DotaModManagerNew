/* Sound playback engine using HTMLAudioElement and Hls.js for HLS streaming. */
import Hls from 'hls.js';
import type { LinerTrack } from '../../src/ipc-liner.ts';

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type LoopMode = 'none' | 'all' | 'one';

export interface PlayerState {
  status: PlaybackStatus;
  currentTrack: LinerTrack | null;
  currentTime: number;
  duration: number;
  progress: number;
  volume: number;
  queue: LinerTrack[];
  currentIndex: number;
  loopMode: LoopMode;
  error?: string;
}

type Listener = (state: PlayerState) => void;

class MusicPlayer {
  private audio: HTMLAudioElement;
  private hls: Hls | null = null;
  private state: PlayerState;
  private listeners: Set<Listener> = new Set();
  private isSeeking = false;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';

    this.state = {
      status: 'idle',
      currentTrack: null,
      currentTime: 0,
      duration: 0,
      progress: 0,
      volume: 0.8,
      queue: [],
      currentIndex: -1,
      loopMode: 'none',
    };

    this.audio.volume = this.state.volume;

    this.audio.addEventListener('timeupdate', () => {
      if (this.isSeeking) return;
      const cur = this.audio.currentTime || 0;
      const dur = this.audio.duration || this.state.duration || 1;
      this.state.currentTime = cur;
      this.state.duration = Number.isFinite(dur) && dur > 0 ? dur : this.state.duration;
      this.state.progress = dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0;
      this.notify();
      this.syncOverlay();
    });

    this.audio.addEventListener('play', () => {
      this.state.status = 'playing';
      this.notify();
      this.syncOverlay();
    });

    this.audio.addEventListener('pause', () => {
      if (this.state.status !== 'error') {
        this.state.status = 'paused';
      }
      this.notify();
      this.syncOverlay();
    });

    this.audio.addEventListener('ended', () => {
      // Loop single track indefinitely if loopMode is 'one'
      if (this.state.loopMode === 'one' && this.state.currentTrack) {
        this.seek(0);
        this.audio.play().catch((err) => console.warn('Replay failed:', err));
        return;
      }
      // Auto-advance to next track in queue on track completion
      this.next();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      // If current track fails to play, automatically advance to next after short delay
      if (this.state.queue.length > 1) {
        setTimeout(() => {
          if (this.state.status === 'error') {
            this.next();
          }
        }, 1500);
      }
      this.state.status = 'error';
      this.state.error = 'Ошибка воспроизведения аудио';
      this.notify();
      this.syncOverlay();
    });

    // Listen to remote actions from floating overlay window
    if (typeof window !== 'undefined' && window.api?.liner?.onOverlayAction) {
      window.api.liner.onOverlayAction((action: string) => {
        if (action === 'togglePlay') this.togglePlay();
        else if (action === 'previousTrack') this.previous();
        else if (action === 'nextTrack') this.next();
        else if (action === 'toggleLoop') this.toggleLoop();
      });
    }
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): PlayerState {
    return { ...this.state };
  }

  private notify(): void {
    const s = this.getState();
    for (const l of this.listeners) l(s);
  }

  public syncOverlay(): void {
    if (typeof window !== 'undefined' && window.api?.liner?.overlayUpdateState) {
      const theme = document.documentElement?.dataset?.theme || 'ursa';
      window.api.liner.overlayUpdateState({
        isPlaying: this.state.status === 'playing',
        track: this.state.currentTrack,
        progress: this.state.progress,
        currentTime: this.state.currentTime,
        duration: this.state.duration,
        volume: this.state.volume,
        loopMode: this.state.loopMode,
        theme,
      });
    }
  }

  public async playTrack(track: LinerTrack, newQueue?: LinerTrack[]): Promise<void> {
    if (newQueue) {
      this.state.queue = newQueue;
      this.state.currentIndex = newQueue.findIndex((t) => t.id === track.id);
    } else if (!this.state.queue.some((t) => t.id === track.id)) {
      this.state.queue = [...this.state.queue, track];
      this.state.currentIndex = this.state.queue.length - 1;
    } else {
      this.state.currentIndex = this.state.queue.findIndex((t) => t.id === track.id);
    }

    this.state.currentTrack = track;
    this.state.duration = track.durationMs ? track.durationMs / 1000 : 0;
    this.state.currentTime = 0;
    this.state.progress = 0;
    this.state.status = 'loading';
    this.state.error = undefined;
    this.notify();
    this.syncOverlay();

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    try {
      const res = await window.api.liner.resolveStream(track.id);
      if (!res.ok || !res.streamUrl) {
        throw new Error(res.error || 'Не удалось получить поток');
      }

      if (res.isHls && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
        });
        this.hls = hls;
        hls.loadSource(res.streamUrl);
        hls.attachMedia(this.audio);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          this.audio.play().catch((err) => {
            console.warn('HLS play blocked or failed:', err);
          });
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.warn('Fatal HLS error:', data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                this.state.status = 'error';
                this.state.error = 'Ошибка HLS потока';
                this.notify();
                this.syncOverlay();
                break;
            }
          }
        });
      } else {
        this.audio.src = res.streamUrl;
        await this.audio.play();
      }

      this.state.status = 'playing';
      this.notify();
      this.syncOverlay();
    } catch (err: any) {
      this.state.status = 'error';
      this.state.error = err.message || 'Ошибка воспроизведения';
      this.notify();
      this.syncOverlay();
    }
  }

  public togglePlay(): void {
    if (this.state.status === 'playing') {
      this.audio.pause();
    } else if (this.state.currentTrack) {
      if (this.audio.src || this.hls) {
        this.audio.play().catch((err) => {
          console.warn('Resume failed:', err);
        });
      } else {
        this.playTrack(this.state.currentTrack);
      }
    }
  }

  public next(): void {
    const nextIdx = this.state.currentIndex + 1;
    if (nextIdx < this.state.queue.length) {
      this.playTrack(this.state.queue[nextIdx]);
    } else if (this.state.queue.length > 0) {
      this.playTrack(this.state.queue[0]); // loop back
    }
  }

  public previous(): void {
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }
    const prevIdx = this.state.currentIndex - 1;
    if (prevIdx >= 0) {
      this.playTrack(this.state.queue[prevIdx]);
    } else if (this.state.queue.length > 0) {
      this.playTrack(this.state.queue[this.state.queue.length - 1]);
    }
  }

  public seek(ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    const target = clamped * (this.state.duration || 1);
    this.isSeeking = true;
    this.state.progress = clamped;
    this.state.currentTime = target;
    this.notify();

    this.audio.currentTime = target;
    setTimeout(() => {
      this.isSeeking = false;
    }, 50);
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    this.audio.volume = clamped;
    this.notify();
    this.syncOverlay();
  }

  public toggleLoop(): LoopMode {
    // Cycles between 'none' -> 'one' (repeat current track indefinitely) -> 'all' (repeat queue) -> 'none'
    const nextMode: LoopMode = this.state.loopMode === 'none' ? 'one' : this.state.loopMode === 'one' ? 'all' : 'none';
    this.state.loopMode = nextMode;
    this.notify();
    this.syncOverlay();
    return nextMode;
  }
}

export const musicPlayer = new MusicPlayer();
