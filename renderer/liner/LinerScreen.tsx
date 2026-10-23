/* The Liner Screen: Real music search, player controls, queue, custom & community playlists, local file imports. */
import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { pane } from '../core/router.ts';
import { musicPlayer, type PlayerState } from './player.ts';
import type { LinerTrack } from '../../src/ipc-liner.ts';
import {
  type Playlist,
  getStoredPlaylists,
  createPlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
} from './playlists.ts';

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
  const [activeTab, setActiveTab] = useState<'tracks' | 'playlists' | 'my_tracks'>('tracks');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [searchResults, setSearchResults] = useState<LinerTrack[]>([]);
  const [totalResults, setTotalResults] = useState<number>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  // Playlists state
  const [userPlaylists, setUserPlaylists] = useState<Playlist[]>(() => getStoredPlaylists());
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlTitle, setNewPlTitle] = useState('');
  const [newPlDesc, setNewPlDesc] = useState('');
  const [showAddToModal, setShowAddToModal] = useState<LinerTrack | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return musicPlayer.subscribe((s) => setPlayerState(s));
  }, []);

  const refreshUserPlaylists = () => {
    const list = getStoredPlaylists();
    setUserPlaylists(list);
    if (selectedPlaylist && selectedPlaylist.isCustom) {
      const updated = list.find((p) => p.id === selectedPlaylist.id) || null;
      setSelectedPlaylist(updated);
    }
  };

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

  useEffect(() => {
    if (activeTab !== 'tracks') return;
    const trimmed = query.trim();
    setPage(1);

    const timer = setTimeout(() => {
      fetchTracks(trimmed, 1);
    }, trimmed.length === 0 ? 0 : 350);

    return () => clearTimeout(timer);
  }, [query, activeTab]);

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

  const handleCreatePlaylistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlTitle.trim()) return;
    const created = createPlaylist(newPlTitle, newPlDesc);
    setNewPlTitle('');
    setNewPlDesc('');
    setShowCreateModal(false);
    refreshUserPlaylists();
    setSelectedPlaylist(created);
  };

  const handleDeletePlaylist = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Удалить этот плейлист?')) {
      deletePlaylist(id);
      if (selectedPlaylist?.id === id) {
        setSelectedPlaylist(null);
      }
      refreshUserPlaylists();
    }
  };

  const handleAddTrackToPl = (plId: string) => {
    if (!showAddToModal) return;
    addTrackToPlaylist(plId, showAddToModal);
    setShowAddToModal(null);
    refreshUserPlaylists();
  };

  const handleImportLocalFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newTracks: LinerTrack[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const blobUrl = URL.createObjectURL(file);
      const nameParts = file.name.replace(/\.[^/.]+$/, '').split(' - ');
      const artist = nameParts.length > 1 ? nameParts[0].trim() : 'Мои треки';
      const title = nameParts.length > 1 ? nameParts.slice(1).join(' - ').trim() : nameParts[0].trim();

      newTracks.push({
        id: `local:${blobUrl}`,
        title,
        artist,
        durationMs: 0,
      });
    }

    if (newTracks.length > 0) {
      let myPl = userPlaylists.find((p) => p.title === 'Моя музыка');
      if (!myPl) {
        myPl = createPlaylist('Моя музыка', 'Локальные импортированные треки');
      }
      for (const t of newTracks) {
        addTrackToPlaylist(myPl.id, t);
      }
      refreshUserPlaylists();
      setSelectedPlaylist(myPl);
      setActiveTab('playlists');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const currentTrack = playerState.currentTrack;
  const isPlaying = playerState.status === 'playing';
  const isLoading = playerState.status === 'loading';
  const hasMore = searchResults.length === PAGE_SIZE || page * PAGE_SIZE < totalResults;

  return (
    <div className="liner-screen">
      {/* Hidden local audio file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
        style={{ display: 'none' }}
        onChange={handleImportLocalFiles}
      />

      {/* Top Header with Navigation Tabs, Search and Overlay Toggle */}
      <div className="liner-header">
        <div className="liner-nav-pills">
          <button
            className={`liner-nav-pill ${activeTab === 'tracks' ? 'active' : ''}`}
            onClick={() => { setActiveTab('tracks'); setSelectedPlaylist(null); }}
          >
            <span className="ms">explore</span>
            <span>Треки и Поиск</span>
          </button>
          <button
            className={`liner-nav-pill ${activeTab === 'playlists' ? 'active' : ''}`}
            onClick={() => setActiveTab('playlists')}
          >
            <span className="ms">queue_music</span>
            <span>Плейлисты ({userPlaylists.length})</span>
          </button>
          <button
            className="liner-nav-pill"
            onClick={() => fileInputRef.current?.click()}
            title="Добавить свои локальные аудиозаписи с диска"
          >
            <span className="ms">upload_file</span>
            <span>Добавить свои треки</span>
          </button>
        </div>

        {activeTab === 'tracks' && (
          <div className="liner-search-box">
            <span className="ms">search</span>
            <input
              type="text"
              placeholder="Поиск треков, жанров, исполнителей..."
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
        )}

        <button
          className={`liner-overlay-btn ${isOverlayOpen ? 'active' : ''}`}
          onClick={handleToggleOverlay}
          title="Включить/выключить плавающий Liner Player поверх всех окон"
        >
          <span className="ms">picture_in_picture_alt</span>
          <span>Liner Player</span>
        </button>
      </div>

      {/* Main View: TRACKS TAB */}
      {activeTab === 'tracks' && (
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
                  <div className="liner-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="liner-card-action-btn"
                      title="Добавить в плейлист"
                      onClick={() => setShowAddToModal(track)}
                    >
                      <span className="ms">folder_open</span>
                    </button>
                    <div className="liner-card-duration">
                      {formatTime(track.durationMs / 1000)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
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
      )}

      {/* PLAYLISTS TAB */}
      {activeTab === 'playlists' && (
        <div className="liner-content">
          {!selectedPlaylist ? (
            <>
              <div className="liner-section-title-row">
                <h2>Ваши плейлисты</h2>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  <span className="ms">add</span>
                  <span>Создать плейлист</span>
                </button>
              </div>

              {userPlaylists.length === 0 ? (
                <div className="liner-empty-search" style={{ height: 160 }}>
                  <span className="ms">library_music</span>
                  <p>У вас пока нет своих плейлистов. Создайте первый или добавьте треки с диска!</p>
                </div>
              ) : (
                <div className="liner-playlist-grid">
                  {userPlaylists.map((pl) => (
                    <div
                      key={pl.id}
                      className="liner-playlist-card"
                      onClick={() => setSelectedPlaylist(pl)}
                    >
                      <div className="liner-pl-cover-box">
                        <span className="ms">queue_music</span>
                      </div>
                      <div className="liner-pl-info">
                        <div className="liner-pl-title">{pl.title}</div>
                        <div className="liner-pl-sub">{pl.tracks.length} треков · {pl.author}</div>
                        {pl.description && <div className="liner-pl-desc">{pl.description}</div>}
                      </div>
                      <button
                        className="liner-pl-delete-btn"
                        onClick={(e) => handleDeletePlaylist(pl.id, e)}
                        title="Удалить плейлист"
                      >
                        <span className="ms">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}


            </>
          ) : (
            /* Selected Playlist Detail View */
            <div className="liner-playlist-detail">
              <div className="liner-pl-detail-header">
                <button
                  className="btn btn-sm"
                  onClick={() => setSelectedPlaylist(null)}
                >
                  <span className="ms">arrow_back</span>
                  <span>Назад к плейлистам</span>
                </button>
                <div className="liner-pl-detail-info">
                  <h1>{selectedPlaylist.title}</h1>
                  <p>{selectedPlaylist.description ? `${selectedPlaylist.description} · ` : ""}{selectedPlaylist.tracks.length} треков</p>
                </div>
                {selectedPlaylist.tracks.length > 0 && (
                  <button
                    className="btn btn-primary"
                    onClick={() => musicPlayer.playTrack(selectedPlaylist.tracks[0], selectedPlaylist.tracks)}
                  >
                    <span className="ms">play_arrow</span>
                    <span>Слушать всё</span>
                  </button>
                )}
              </div>

              {selectedPlaylist.tracks.length === 0 ? (
                <div className="liner-empty-search" style={{ height: 200 }}>
                  <span className="ms">queue_music</span>
                  <p>В этом плейлисте пока нет треков. Найдите треки во вкладке «Треки и Поиск» и добавьте их сюда!</p>
                </div>
              ) : (
                <div className="liner-track-grid">
                  {selectedPlaylist.tracks.map((track) => {
                    const isThisPlaying = currentTrack?.id === track.id && isPlaying;
                    const isThisCurrent = currentTrack?.id === track.id;

                    return (
                      <div
                        key={track.id}
                        className={`liner-track-card ${isThisCurrent ? 'current' : ''}`}
                        onClick={() => musicPlayer.playTrack(track, selectedPlaylist.tracks)}
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
                        <div className="liner-card-actions" onClick={(e) => e.stopPropagation()}>
                          {true && (
                            <button
                              className="liner-card-action-btn delete"
                              title="Удалить из плейлиста"
                              onClick={() => {
                                removeTrackFromPlaylist(selectedPlaylist.id, track.id);
                                refreshUserPlaylists();
                              }}
                            >
                              <span className="ms">close</span>
                            </button>
                          )}
                          <div className="liner-card-duration">
                            {formatTime(track.durationMs / 1000)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal: Create Playlist */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content liner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Создать новый плейлист</h2>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>
                <span className="ms">close</span>
              </button>
            </div>
            <form onSubmit={handleCreatePlaylistSubmit} className="liner-modal-form">
              <label>
                <span>Название плейлиста:</span>
                <input
                  type="text"
                  className="input"
                  placeholder="Например: Мои фавориты для каток"
                  value={newPlTitle}
                  onChange={(e) => setNewPlTitle(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <label>
                <span>Описание (опционально):</span>
                <input
                  type="text"
                  className="input"
                  placeholder="Коротко о плейлисте..."
                  value={newPlDesc}
                  onChange={(e) => setNewPlDesc(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCreateModal(false)}>
                  Отмена
                </button>
                <button type="submit" className="btn btn-primary" disabled={!newPlTitle.trim()}>
                  Создать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add track to playlist */}
      {showAddToModal && (
        <div className="modal-overlay" onClick={() => setShowAddToModal(null)}>
          <div className="modal-content liner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Добавить в плейлист</h2>
              <button className="modal-close" onClick={() => setShowAddToModal(null)}>
                <span className="ms">close</span>
              </button>
            </div>
            <div className="liner-add-to-track-info">
              <b>{showAddToModal.title}</b> — {showAddToModal.artist}
            </div>
            <div className="liner-add-pl-list">
              {userPlaylists.length === 0 ? (
                <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Нет своих плейлистов. Создайте новый!
                </div>
              ) : (
                userPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    className="liner-add-pl-item"
                    onClick={() => handleAddTrackToPl(pl.id)}
                  >
                    <span className="ms">folder_open</span>
                    <span className="liner-add-pl-name">{pl.title}</span>
                    <span className="liner-add-pl-count">({pl.tracks.length} треков)</span>
                  </button>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setShowAddToModal(null);
                  setShowCreateModal(true);
                }}
              >
                + Создать новый плейлист
              </button>
            </div>
          </div>
        </div>
      )}

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
