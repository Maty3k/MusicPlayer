import { create } from 'zustand';

// A single track, mirroring the shape stored in the PHP backend's music.json
// (see save-music.php). All fields except `title` are optional.
export interface Song {
  title: string;
  artist?: string;
  album?: string;
  cover?: string;
  youtube_id?: string;
  mp3_url?: string;
  spotify_id?: string;
}

// Transient playback state, driven by messages the WebView posts up from the
// PHP player (WebViewPlayer.tsx maps `stateUpdate` messages onto these setters).
interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  currentSong: Song | null;
  // Bumped every time the WebView reports a song change, so screens can react
  // to "a new song started" without diffing the song object itself.
  songChangeCounter: number;

  setPlaying: (playing: boolean) => void;
  setCurrentTime: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  setCurrentSong: (song: Song | null) => void;
  triggerSongChange: () => void;
}

export const usePlayerStore = create<PlayerState>((set) => ({
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  currentSong: null,
  songChangeCounter: 0,

  setPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentTime: (seconds) => set({ currentTime: seconds }),
  setDuration: (seconds) => set({ duration: seconds }),
  setCurrentSong: (song) => set({ currentSong: song }),
  triggerSongChange: () => set((s) => ({ songChangeCounter: s.songChangeCounter + 1 })),
}));
