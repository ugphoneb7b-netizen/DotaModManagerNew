/* The Liner screen: React component for music player UI with rounded interface, slider and navigation arrows. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { pane } from '../core/router.ts';

export interface LinerModel {
  key: number;
  currentTrack: { title: string; artist: string; coverUrl?: string; duration?: number };
  isPlaying: boolean;
  progress: number;
  volume: number;
  queue: { title: string; artist: string; coverUrl?: string; duration?: number }[];
  currentIndex: number;
}

export interface LinerActions {
  playPause: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  setProgress: (value: number) => Promise<void>;
  setVolume: (value: number) => Promise<void>;
}

let root: ReturnType<typeof createRoot> | null = null;

export function showLiner(model: LinerModel, actions: LinerActions): void {
  const el = pane('liner');
  if (!root) {
    root = createRoot(el);
  }
  root.render(<LinerScreen model={model} actions={actions} />);
}

function LinerScreen({ model, actions }: { model: LinerModel; actions: LinerActions }) {
  const [isPlaying, setIsPlaying] = useState(model.isPlaying);
  const [progress, setProgress] = useState(model.progress);
  const [volume, setVolume] = useState(model.volume);

  const handlePlayPause = async () => {
    await actions.playPause();
    setIsPlaying(!isPlaying);
  };

  const handleNext = async () => {
    await actions.nextTrack();
  };

  const handlePrevious = async () => {
    await actions.previousTrack();
  };

  const handleProgressChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value) / 100;
    setProgress(value);
    await actions.setProgress(value);
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value) / 100;
    setVolume(value);
    await actions.setVolume(value);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentTime = model.currentTrack?.duration
    ? formatTime(progress * model.currentTrack.duration)
    : '0:00';
  const totalTime = model.currentTrack?.duration
    ? formatTime(model.currentTrack.duration)
    : '0:00';

  return (
    <div className="liner-container">
      <div className="liner-player">
        {/* Rounded player interface */}
        <div className="liner-player-ui">
          {/* Track info */}
          <div className="liner-track-info">
            {model.currentTrack?.coverUrl && (
              <img
                src={model.currentTrack.coverUrl}
                alt=""
                className="liner-cover"
              />
            )}
            <div className="liner-track-details">
              <div className="liner-track-title">{model.currentTrack?.title || 'Нет трека'}</div>
              <div className="liner-track-artist">{model.currentTrack?.artist || 'Неизвестный исполнитель'}</div>
            </div>
          </div>

          {/* Progress slider with time display */}
          <div className="liner-progress-container">
            <span className="liner-time">{currentTime}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={progress * 100}
              onChange={handleProgressChange}
              className="liner-progress-slider"
            />
            <span className="liner-time">{totalTime}</span>
          </div>

          {/* Controls with arrows */}
          <div className="liner-controls">
            <button
              onClick={handlePrevious}
              className="liner-control-btn"
              title="Предыдущий трек"
            >
              <span className="ms">skip_previous</span>
            </button>
            <button
              onClick={handlePlayPause}
              className="liner-control-btn liner-play-btn"
              title={isPlaying ? 'Пауза' : 'Воспроизвести'}
            >
              <span className="ms">{isPlaying ? 'pause' : 'play_arrow'}</span>
            </button>
            <button
              onClick={handleNext}
              className="liner-control-btn"
              title="Следующий трек"
            >
              <span className="ms">skip_next</span>
            </button>
          </div>

          {/* Volume slider */}
          <div className="liner-volume-container">
            <span className="ms liner-volume-icon">
              {volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
            </span>
            <input
              type="range"
              min="0"
              max="100"
              value={volume * 100}
              onChange={handleVolumeChange}
              className="liner-volume-slider"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
