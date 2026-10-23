/* Types and storage helpers for user and community playlists. */
import type { LinerTrack } from '../../src/ipc-liner.ts';

export interface Playlist {
  id: string;
  title: string;
  description?: string;
  author: string;
  isCustom?: boolean;
  coverUrl?: string;
  tracks: LinerTrack[];
  createdAt: number;
}

const STORAGE_KEY = 'liner_user_playlists_v1';

export const FEATURED_PLAYLISTS: Playlist[] = [
  {
    id: 'featured_dota_hype',
    title: 'Dota 2 Rampage Hype',
    description: 'Бодрые треки под хайлайты, фонк и электронику',
    author: 'D2MM Official',
    coverUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300&q=80',
    createdAt: 1729680000000,
    tracks: [
      { id: 'sc:1980838183', title: 'METAMORPHOSIS (Sped Up)', artist: 'INTERWORLD', durationMs: 142000, coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&q=80' },
      { id: 'sc:1289410186', title: 'RAVE', artist: 'Dxrk ダーク', durationMs: 169000, coverUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=200&q=80' },
      { id: 'sc:1738472911', title: 'Automotivo Bibi Fogosa', artist: 'Bibi Babydoll', durationMs: 155000, coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=200&q=80' },
      { id: 'sc:1234987654', title: 'KERAUNOS', artist: 'PlayaPhonk', durationMs: 143000, coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=200&q=80' },
    ],
  },
  {
    id: 'featured_chill_gaming',
    title: 'Chill Vibes & Late Night Farming',
    description: 'Спокойный lo-fi и chillhop для фарма леса и расслабленной игры',
    author: 'Lofi Girl / Community',
    coverUrl: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=300&q=80',
    createdAt: 1729680000000,
    tracks: [
      { id: 'sc:9988776655', title: 'Snowman', artist: 'WYS', durationMs: 184000, coverUrl: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=200&q=80' },
      { id: 'sc:8877665544', title: 'Affection', artist: 'Jinsang', durationMs: 132000, coverUrl: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=200&q=80' },
      { id: 'sc:7766554433', title: 'Controlla', artist: 'Idealism', durationMs: 160000, coverUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=200&q=80' },
    ],
  },
  {
    id: 'featured_cyberpunk_neon',
    title: 'Synthwave & Cyber Night',
    description: 'Неоновые ретро-синтвейв ритмы под ночные катки',
    author: 'Synth Collective',
    coverUrl: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=300&q=80',
    createdAt: 1729680000000,
    tracks: [
      { id: 'sc:6655443322', title: 'Resonance', artist: 'HOME', durationMs: 212000, coverUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=200&q=80' },
      { id: 'sc:5544332211', title: 'Sunset', artist: 'The Midnight', durationMs: 326000, coverUrl: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=200&q=80' },
      { id: 'sc:4433221100', title: 'Tech Noir', artist: 'Gunship', durationMs: 297000, coverUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&q=80' },
    ],
  },
];

export function getStoredPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredPlaylists(playlists: Playlist[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
  } catch (err) {
    console.error('Failed to save playlists:', err);
  }
}

export function createPlaylist(title: string, description = ''): Playlist {
  const newPl: Playlist = {
    id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    title: title.trim() || 'Новый плейлист',
    description: description.trim(),
    author: 'Вы',
    isCustom: true,
    tracks: [],
    createdAt: Date.now(),
  };
  const list = getStoredPlaylists();
  list.unshift(newPl);
  saveStoredPlaylists(list);
  return newPl;
}

export function deletePlaylist(id: string): void {
  const list = getStoredPlaylists().filter((p) => p.id !== id);
  saveStoredPlaylists(list);
}

export function addTrackToPlaylist(playlistId: string, track: LinerTrack): boolean {
  const list = getStoredPlaylists();
  const pl = list.find((p) => p.id === playlistId);
  if (!pl) return false;
  if (!pl.tracks.some((t) => t.id === track.id)) {
    pl.tracks.push(track);
    saveStoredPlaylists(list);
    return true;
  }
  return false;
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string): void {
  const list = getStoredPlaylists();
  const pl = list.find((p) => p.id === playlistId);
  if (!pl) return;
  pl.tracks = pl.tracks.filter((t) => t.id !== trackId);
  saveStoredPlaylists(list);
}
