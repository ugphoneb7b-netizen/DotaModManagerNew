/* The Liner Screen: Real music search, player controls, queue and Discord-like overlay toggle. */
import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { pane } from '../core/router.ts';
import { musicPlayer, type PlayerState } from './player.ts';
import type { LinerTrack } from '../../src/ipc-liner.ts';

const PAGE_SIZE = 25;
let root: ReturnType<typeof createRoot> | null = null;

export function showLiner(): void {
  const el = pane('liner');
  if (!root) {
    root = createRoot(el);
  }
  root.render(<LinerApp />);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function LinerApp() {
  const [playerState, setPlayerState] = useState<PlayerState>(() => musicPlayer.getState());
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [searchResults, setSearchResults] = useState<LinerTrack[]>([]);
  const [totalResults, setTotalResults] = useState<number>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  useEffect(() => {
    return musicPlayer.subscribe((s) => setPlayerState(s));
  }, []);

  const fetchTracks = async (q: string, targetPage: number) => {
    const trimmed = q.trim();
    setIsSearching(true);
    setSearchError(null);
    const offset = (targetPage - 1) * PAGE_SIZE;

    try {
      const res = await window.api.liner.search(trimmed, offset);
      if (res.error) {
        setSearchError(res.error);
        setSearchResults([]);
        setTotalResults(0);
      } else {
        setSearchResults(res.tracks || []);
        setTotalResults(res.totalResults || (res.tracks ? res.tracks.length : 0));
      }
    } catch (err: any) {
      setSearchError(err.message || 'Ошибка поиска');
    } finally {
      setIsSearching(false);
    }
  };

  // Perform search with debounce when query changes
  useEffect(() => {
    const trimmed = query.trim();
    setPage(1);

    const timer = setTimeout(() => {
      fetchTracks(trimmed, 1);
    }, trimmed.length === 0 ? 0 : 350);

    return () => clearTimeout(timer);
  }, [query]);

  // Handle page change
  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || isSearching) return;
    setPage(newPage);
    fetchTracks(query, newPage);
    const mainEl = document.getElementById('main');
    if (mainEl) mainEl.scrollTop = 0;
  };

  const handleToggleOverlay = async () => {
    const res = await window.api.liner.overlayToggle();
    setIsOverlayOpen(res.open);
    musicPlayer.syncOverlay();
  };

  const currentTrack = playerState.currentTrack;
  const isPlaying = playerState.status === 'playing';
  const isLoading = playerState.status === 'loading';
  const hasMore = searchResults.length === PAGE_SIZE || page * PAGE_SIZE < totalResults;

  return (
    <div className="liner-screen">
      {/* Top Header with Search and Overlay Toggle */}
      <div className="liner-header">
        <div className="liner-search-box">
          <span className="ms">search</span>
          <input
            type="text"
            placeholder="Поиск треков, исполнителей..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="liner-search-input"
          />
          {query && (
            <button className="liner-clear-btn" onClick={() => setQuery('')}>
              <span className="ms">close</span>
            </button>
          )}
        </div>

        <button
          className={`liner-overlay-btn ${isOverlayOpen ? 'active' : ''}`}
          onClick={handleToggleOverlay}
          title="Включить/выключить плавающий Liner Player поверх всех окон"
        >
          <span className="ms">picture_in_picture_alt</span>
          <span>Liner Player</span>
        </button>
      </div>

      {/* Main Content: Search Results list */}
      <div className="liner-content">
        <div className="liner-results-header">
          <h2>
            {query.trim()
              ? `Результаты поиска (стр. ${page})`
              : `Популярное сейчас (стр. ${page})`}
          </h2>
          {isSearching && <span className="liner-spinner">Загрузка...</span>}
        </div>

        {searchError && <div className="liner-error-banner">{searchError}</div>}

        {searchResults.length === 0 && !isSearching && !searchError && (
          <div className="liner-empty-search">
            <span className="ms">music_off</span>
            <p>{query.trim() ? 'Ничего не найдено' : 'Нет доступных треков'}</p>
          </div>
        )}

        <div className="liner-track-grid">
          {searchResults.map((track) => {
            const isThisPlaying = currentTrack?.id === track.id && isPlaying;
            const isThisCurrent = currentTrack?.id === track.id;

            return (
              <div
                key={track.id}
                className={`liner-track-card ${isThisCurrent ? 'current' : ''}`}
                onClick={() => musicPlayer.playTrack(track, searchResults)}
              >
                <div className="liner-card-cover-wrap">
                  {track.coverUrl ? (
                    <img src={track.coverUrl} alt="" className="liner-card-cover" />
                  ) : (
                    <div className="liner-card-no-cover">♫</div>
                  )}
                  <div className="liner-card-overlay">
                    <span className="ms">{isThisPlaying ? 'pause' : 'play_arrow'}</span>
                  </div>
                </div>
                <div className="liner-card-info">
                  <div className="liner-card-title" title={track.title}>{track.title}</div>
                  <div className="liner-card-artist" title={track.artist}>{track.artist}</div>
                </div>
                <div className="liner-card-duration">
                  {formatTime(track.durationMs / 1000)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination controls like in Grids */}
        {searchResults.length > 0 && (
          <div className="grids-pagination">
            <button
              className="btn btn-sm"
              disabled={page <= 1 || isSearching}
              onClick={() => handlePageChange(page - 1)}
            >
              <span className="ms">chevron_left</span>
              <span>Назад</span>
            </button>
            <span className="grids-page-info">Страница {page}</span>
            <button
              className="btn btn-sm"
              disabled={!hasMore || isSearching}
              onClick={() => handlePageChange(page + 1)}
            >
              <span>Вперед</span>
              <span className="ms">chevron_right</span>
            </button>
          </div>
        )}
      </div>

      {/* Bottom Floating Rounded Player */}
      <div className="liner-docked-player">
        {/* Progress bar on top edge of player */}
        <div
          className="liner-docked-progress-bar"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            musicPlayer.seek(ratio);
          }}
        >
          <div
            className="liner-docked-progress-fill"
            style={{ width: `${(playerState.progress || 0) * 100}%` }}
          />
        </div>

        <div className="liner-docked-content">
          {/* Left: Artwork and title */}
          <div className="liner-docked-info">
            {currentTrack?.coverUrl ? (
              <img src={currentTrack.coverUrl} alt="" className="liner-docked-cover" />
            ) : (
              <div className="liner-docked-no-cover">♫</div>
            )}
            <div className="liner-docked-text">
              <span className="liner-docked-title">{currentTrack?.title || 'Выберите трек для воспроизведения'}</span>
              <span className="liner-docked-artist">{currentTrack?.artist || 'Liner Music Player'}</span>
            </div>
          </div>

          {/* Center: Controls and time */}
          <div className="liner-docked-controls">
            <span className="liner-time-badge">{formatTime(playerState.currentTime)}</span>

            <button
              className="liner-ctrl-btn"
              onClick={() => musicPlayer.previous()}
              disabled={playerState.queue.length === 0}
              title="Предыдущий трек"
            >
              <span className="ms">skip_previous</span>
            </button>

            <button
              className="liner-ctrl-btn play"
              onClick={() => musicPlayer.togglePlay()}
              disabled={!currentTrack}
              title={isPlaying ? 'Пауза' : 'Воспроизведение'}
            >
              <span className="ms">{isLoading ? 'hourglass_top' : isPlaying ? 'pause' : 'play_arrow'}</span>
            </button>

            <button
              className="liner-ctrl-btn"
              onClick={() => musicPlayer.next()}
              disabled={playerState.queue.length === 0}
              title="Следующий трек"
            >
              <span className="ms">skip_next</span>
            </button>

            <button
              className={`liner-ctrl-btn ${playerState.loopMode !== 'none' ? 'active' : ''}`}
              onClick={() => musicPlayer.toggleLoop()}
              title={
                playerState.loopMode === 'one'
                  ? 'Повтор текущего трека (бесконечно)'
                  : playerState.loopMode === 'all'
                  ? 'Повтор всего списка'
                  : 'Без повтора'
              }
              style={{
                color: playerState.loopMode !== 'none' ? 'var(--primary)' : undefined,
                position: 'relative',
              }}
            >
              <span className="ms">
                {playerState.loopMode === 'one' ? 'repeat_one' : 'repeat'}
              </span>
            </button>

            <span className="liner-time-badge">{formatTime(playerState.duration)}</span>
          </div>

          {/* Right: Volume slider */}
          <div className="liner-docked-volume">
            <span className="ms">
              {playerState.volume === 0 ? 'volume_off' : playerState.volume < 0.5 ? 'volume_down' : 'volume_up'}
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={playerState.volume}
              onChange={(e) => musicPlayer.setVolume(parseFloat(e.target.value))}
              className="liner-docked-vol-slider"
              title={`Громкость: ${Math.round(playerState.volume * 100)}%`}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
