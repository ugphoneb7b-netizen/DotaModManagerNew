/* The Liner screen: music player with rounded interface, slider and navigation arrows. */
import { registerView } from '../core/router.ts';
import { showLiner, type LinerModel, type LinerActions } from '../liner/LinerScreen.tsx';

let key = 0;
let lastModel: LinerModel | null = null;

async function load(): Promise<void> {
  const model: LinerModel = {
    key: ++key,
    currentTrack: {
      title: 'Demo Track',
      artist: 'Demo Artist',
      coverUrl: '',
      duration: 180,
    },
    isPlaying: false,
    progress: 0,
    volume: 0.7,
    queue: [
      {
        title: 'Demo Track',
        artist: 'Demo Artist',
        coverUrl: '',
        duration: 180,
      },
    ],
    currentIndex: 0,
  };
  lastModel = model;
  showLiner(model, actions);
}

const actions: LinerActions = {
  async playPause(): Promise<void> {
    // Toggle play/pause
    if (lastModel) {
      lastModel.isPlaying = !lastModel.isPlaying;
      showLiner(lastModel, actions);
    }
  },
  async nextTrack(): Promise<void> {
    // Play next track
    if (lastModel && lastModel.queue.length > 0) {
      lastModel.currentIndex = (lastModel.currentIndex + 1) % lastModel.queue.length;
      lastModel.currentTrack = lastModel.queue[lastModel.currentIndex];
      lastModel.progress = 0;
      showLiner(lastModel, actions);
    }
  },
  async previousTrack(): Promise<void> {
    // Play previous track
    if (lastModel && lastModel.queue.length > 0) {
      lastModel.currentIndex = lastModel.currentIndex === 0
        ? lastModel.queue.length - 1
        : lastModel.currentIndex - 1;
      lastModel.currentTrack = lastModel.queue[lastModel.currentIndex];
      lastModel.progress = 0;
      showLiner(lastModel, actions);
    }
  },
  async setProgress(value: number): Promise<void> {
    // Set playback progress
    if (lastModel) {
      lastModel.progress = value;
      showLiner(lastModel, actions);
    }
  },
  async setVolume(value: number): Promise<void> {
    // Set volume
    if (lastModel) {
      lastModel.volume = value;
      showLiner(lastModel, actions);
    }
  },
};

registerView('liner', () => load());
