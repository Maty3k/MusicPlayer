import { create } from 'zustand';
import { apiPost } from '../api/client';
import type { Song } from './usePlayerStore';

// Loop / shuffle modes mirror the PHP player's own state machine (script.js).
export type LoopMode = 'off' | 'playlist' | 'one';
export type ShuffleMode = 'off' | 'shuffle' | 'smart';

export interface Playlist {
  name: string;
  color?: string;
  songs: Song[];
  currentIndex?: number;
}

interface GetAllResponse {
  success: boolean;
  activePlaylist: string;
  recentlyPlayed: string[];
  playlists: Record<string, Playlist>;
}

interface MusicState {
  playlists: Record<string, Playlist>;
  activePlaylist: string;
  recentlyPlayed: string[];
  loopMode: LoopMode;
  shuffleMode: ShuffleMode;
  loading: boolean;
  error: string | null;

  // Loop/shuffle are pushed up from the WebView (WebViewPlayer.tsx) so the
  // native controls can reflect the player's current mode.
  setLoopMode: (mode: LoopMode) => void;
  setShuffleMode: (mode: ShuffleMode) => void;

  // Fetch the whole library in one call (save-music.php ?action=getAll).
  loadLibrary: () => Promise<void>;
}

export const useMusicStore = create<MusicState>((set) => ({
  playlists: {},
  activePlaylist: 'favorites',
  recentlyPlayed: [],
  loopMode: 'off',
  shuffleMode: 'off',
  loading: false,
  error: null,

  setLoopMode: (mode) => set({ loopMode: mode }),
  setShuffleMode: (mode) => set({ shuffleMode: mode }),

  loadLibrary: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiPost<GetAllResponse>({ action: 'getAll' });
      if (data.success) {
        set({
          playlists: data.playlists ?? {},
          activePlaylist: data.activePlaylist ?? 'favorites',
          recentlyPlayed: data.recentlyPlayed ?? [],
          loading: false,
        });
      } else {
        set({ error: 'Failed to load library', loading: false });
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Network error', loading: false });
    }
  },
}));
