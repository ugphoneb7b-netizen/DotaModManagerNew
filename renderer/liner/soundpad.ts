/* Soundpad playback engine: many short clips at once, each with its own element.
 *
 * Unlike the music player there is no single shared element - a pad lets two sounds overlap, so
 * every imported file gets a lazily created HTMLAudioElement cached by id. Elements are only
 * built on first play, and 'ended' frees the element so a big library costs nothing until used.
 */
import type { SoundpadSound } from '../api/liner.ts';

export type PadStatus = 'playing' | 'paused';

export interface OutputDevice {
  id: string;
  label: string;
}

export interface SoundpadState {
  sounds: SoundpadSound[];
  /** id -> what its element is doing right now. Absent means never started or finished. */
  status: Record<string, PadStatus>;
  volume: number;
  /** '' is the system default; anything else is an audiooutput deviceId. */
  outputDeviceId: string;
  outputDevices: OutputDevice[];
  /** true while the import dialog or a file copy is running. */
  busy: boolean;
  loaded: boolean;
}

type Listener = (state: SoundpadState) => void;

class Soundpad {
  private elements = new Map<string, HTMLAudioElement>();
  private state: SoundpadState = {
    sounds: [],
    status: {},
    volume: 0.8,
    outputDeviceId: '',
    outputDevices: [],
    busy: false,
    loaded: false,
  };
  private listeners = new Set<Listener>();

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): SoundpadState {
    return { ...this.state, status: { ...this.state.status } };
  }

  private notify(): void {
    const s = this.getState();
    for (const l of this.listeners) l(s);
  }

  private setStatus(id: string, status: PadStatus | null): void {
    const next = { ...this.state.status };
    if (status) next[id] = status;
    else delete next[id];
    this.state.status = next;
    this.notify();
  }

  private elementFor(sound: SoundpadSound): HTMLAudioElement {
    let el = this.elements.get(sound.id);
    if (el) return el;
    el = new Audio();
    el.preload = 'auto';
    el.volume = this.state.volume;
    // routed once at creation; setOutputDevice re-routes the live elements when it changes
    if (this.state.outputDeviceId && el.setSinkId) {
      el.setSinkId(this.state.outputDeviceId).catch(() => {});
    }
    el.src = sound.fileUrl;
    el.addEventListener('ended', () => {
      // finished sounds drop out of the map so a long session does not pin every element
      this.elements.delete(sound.id);
      this.setStatus(sound.id, null);
    });
    el.addEventListener('error', () => {
      this.elements.delete(sound.id);
      this.setStatus(sound.id, null);
    });
    this.elements.set(sound.id, el);
    return el;
  }

  public async load(): Promise<void> {
    this.state.outputDeviceId = localStorage.getItem('soundpad_output_device') || '';
    try {
      const res = await window.api.liner.soundpad.list();
      this.state.sounds = res.sounds || [];
    } catch {
      this.state.sounds = [];
    }
    this.state.loaded = true;
    this.notify();
    void this.refreshOutputDevices();
  }

  /** What the system can play through: default plus every audiooutput device it reports. */
  public async refreshOutputDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }));
      // the default entry is implicit: '' routes through whatever Windows has selected
      this.state.outputDevices = outs;
      // a saved device that vanished (unplugged cable) falls back to default rather than silence
      if (this.state.outputDeviceId && !outs.some((d) => d.id === this.state.outputDeviceId)) {
        this.state.outputDeviceId = '';
        localStorage.removeItem('soundpad_output_device');
      }
      this.notify();
    } catch {
      // no mediaDevices in this context: the pad just plays to the default output
    }
  }

  /** Route every pad element - playing ones included - to another output device. */
  public async setOutputDevice(deviceId: string): Promise<void> {
    this.state.outputDeviceId = deviceId;
    if (deviceId) localStorage.setItem('soundpad_output_device', deviceId);
    else localStorage.removeItem('soundpad_output_device');
    this.notify();
    await Promise.all(
      [...this.elements.values()].map(async (el) => {
        try {
          await el.setSinkId?.(deviceId || '');
        } catch {
          // a device that vanished mid-switch just keeps the old route
        }
      }),
    );
  }

  public async importSounds(): Promise<void> {
    if (this.state.busy) return;
    this.state.busy = true;
    this.notify();
    try {
      const res = await window.api.liner.soundpad.import();
      if (!res.canceled) {
        this.state.sounds = res.sounds || this.state.sounds;
        this.setStatusSafe();
      }
    } catch (err) {
      console.warn('soundpad import failed:', err);
    } finally {
      this.state.busy = false;
      this.notify();
    }
  }

  private setStatusSafe(): void {
    // statuses of files that were removed no longer mean anything
    const ids = new Set(this.state.sounds.map((s) => s.id));
    const next: Record<string, PadStatus> = {};
    for (const [id, st] of Object.entries(this.state.status)) {
      if (ids.has(id)) next[id] = st;
    }
    this.state.status = next;
  }

  /** Click behaviour: playing pauses, paused resumes, anything else starts from the top. */
  public async toggle(id: string): Promise<void> {
    const sound = this.state.sounds.find((s) => s.id === id);
    if (!sound) return;
    const st = this.state.status[id];
    if (st === 'playing') {
      this.elementFor(sound).pause();
      this.setStatus(id, 'paused');
      return;
    }
    if (st === 'paused') {
      const el = this.elements.get(id);
      if (el) {
        try {
          await el.play();
          this.setStatus(id, 'playing');
        } catch {
          this.setStatus(id, null);
        }
        return;
      }
    }
    const el = this.elementFor(sound);
    el.currentTime = 0;
    try {
      await el.play();
      this.setStatus(id, 'playing');
    } catch (err) {
      console.warn('soundpad play failed:', err);
      this.setStatus(id, null);
    }
  }

  /** Hard stop: pause and rewind, so the next click starts from zero like a fresh trigger. */
  public stop(id: string): void {
    const el = this.elements.get(id);
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    this.setStatus(id, null);
  }

  public stopAll(): void {
    for (const el of this.elements.values()) {
      el.pause();
      el.currentTime = 0;
    }
    this.state.status = {};
    this.notify();
  }

  public async remove(id: string): Promise<void> {
    const el = this.elements.get(id);
    if (el) {
      el.pause();
      el.src = '';
      this.elements.delete(id);
    }
    this.setStatus(id, null);
    try {
      const res = await window.api.liner.soundpad.remove(id);
      this.state.sounds = res.sounds || this.state.sounds.filter((s) => s.id !== id);
    } catch (err) {
      console.warn('soundpad remove failed:', err);
    }
    this.notify();
  }

  public async reveal(): Promise<void> {
    try {
      await window.api.liner.soundpad.reveal();
    } catch (err) {
      console.warn('soundpad reveal failed:', err);
    }
  }

  public setVolume(volume: number): void {
    const clamped = Math.max(0, Math.min(1, volume));
    this.state.volume = clamped;
    for (const el of this.elements.values()) el.volume = clamped;
    this.notify();
  }
}

export const soundpad = new Soundpad();
