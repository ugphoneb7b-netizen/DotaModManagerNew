/* One track card, memoized: the player ticks four times a second and a plain map would repaint
 * every cover and label each time. Only the card whose playing state changed does work.
 */
import { memo } from 'react';
import type { LinerTrack } from '../api/liner.ts';

export interface TrackCardProps {
  track: LinerTrack;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (track: LinerTrack) => void;
  /** playlist detail passes this instead of onAddToPlaylist */
  onRemove?: (track: LinerTrack) => void;
  onAddToPlaylist?: (track: LinerTrack) => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export const TrackCard = memo(function TrackCard({
  track, isCurrent, isPlaying, onPlay, onRemove, onAddToPlaylist,
}: TrackCardProps) {
  return (
    <div
      className={`liner-track-card ${isCurrent ? 'current' : ''}`}
      onClick={() => onPlay(track)}
    >
      <div className="liner-card-cover-wrap">
        {track.coverUrl ? (
          <img src={track.coverUrl} alt="" className="liner-card-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="liner-card-no-cover">♫</div>
        )}
        <div className="liner-card-overlay">
          <span className="ms">{isPlaying ? 'pause' : 'play_arrow'}</span>
        </div>
      </div>
      <div className="liner-card-info">
        <div className="liner-card-title" title={track.title}>{track.title}</div>
        <div className="liner-card-artist" title={track.artist}>{track.artist}</div>
      </div>
      <div className="liner-card-actions" onClick={(e) => e.stopPropagation()}>
        {onRemove ? (
          <button
            className="liner-card-action-btn delete"
            title="Удалить из плейлиста"
            onClick={() => onRemove(track)}
          >
            <span className="ms">close</span>
          </button>
        ) : onAddToPlaylist ? (
          <button
            className="liner-card-action-btn"
            title="Добавить в плейлист"
            onClick={() => onAddToPlaylist(track)}
          >
            <span className="ms">folder_open</span>
          </button>
        ) : null}
        <div className="liner-card-duration">
          {formatTime(track.durationMs / 1000)}
        </div>
      </div>
    </div>
  );
});
