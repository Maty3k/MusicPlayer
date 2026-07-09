import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebViewPlayer, type WebViewPlayerHandle } from './src/components/player/WebViewPlayer';
import { useMusicStore } from './src/store/useMusicStore';
import { usePlayerStore } from './src/store/usePlayerStore';

// Minimal shell: a playlist list that opens the PHP turntable inside a WebView
// (WebViewPlayer) plus native transport controls. The heavy player UI lives in
// the PHP app; this native layer is navigation + a YouTube playback bridge.
export default function App() {
  const playlists = useMusicStore((s) => s.playlists);
  const loading = useMusicStore((s) => s.loading);
  const error = useMusicStore((s) => s.error);
  const loadLibrary = useMusicStore((s) => s.loadLibrary);

  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentSong = usePlayerStore((s) => s.currentSong);

  const [selected, setSelected] = useState<string | null>(null);
  const playerRef = useRef<WebViewPlayerHandle>(null);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  if (selected) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <WebViewPlayer
          ref={playerRef}
          playlistId={selected}
          onNavigateBack={() => setSelected(null)}
        />
        <View style={styles.nowPlaying}>
          <Text style={styles.npText} numberOfLines={1}>
            {currentSong ? `${currentSong.artist ?? ''} — ${currentSong.title}` : '—'}
          </Text>
        </View>
        <View style={styles.controls}>
          <TouchableOpacity onPress={() => playerRef.current?.prevSong()}>
            <Text style={styles.ctl}>⏮</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => playerRef.current?.togglePlay()}>
            <Text style={styles.ctl}>{isPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => playerRef.current?.nextSong()}>
            <Text style={styles.ctl}>⏭</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.backBtn} onPress={() => setSelected(null)}>
          <Text style={styles.backText}>‹ Collection</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const entries = Object.entries(playlists);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>My Collection</Text>
      {loading && <ActivityIndicator color="#d4a574" style={{ marginTop: 32 }} />}
      {error && <Text style={styles.error}>{error}</Text>}
      <FlatList
        contentContainerStyle={styles.list}
        data={entries}
        keyExtractor={([id]) => id}
        onRefresh={loadLibrary}
        refreshing={loading}
        renderItem={({ item: [id, pl] }) => (
          <TouchableOpacity style={styles.row} onPress={() => setSelected(id)}>
            <View style={[styles.dot, { backgroundColor: pl.color || '#d4a574' }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.plName}>{pl.name}</Text>
              <Text style={styles.plMeta}>{(pl.songs ?? []).length} tracks</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1510' },
  title: {
    color: '#f2e8d8',
    fontSize: 28,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  list: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(212,165,116,0.06)',
    borderRadius: 12,
    marginBottom: 10,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  plName: { color: '#f2e8d8', fontSize: 16, fontWeight: '500' },
  plMeta: { color: 'rgba(212,165,116,0.6)', fontSize: 12, marginTop: 2 },
  chevron: { color: 'rgba(212,165,116,0.5)', fontSize: 22 },
  error: { color: '#e85d75', textAlign: 'center', marginTop: 24 },
  nowPlaying: { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: '#14100b' },
  npText: { color: '#f2e8d8', fontSize: 13, textAlign: 'center' },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 36,
    paddingVertical: 16,
    backgroundColor: '#14100b',
  },
  ctl: { color: '#d4a574', fontSize: 30 },
  backBtn: { position: 'absolute', top: 48, left: 16 },
  backText: { color: '#d4a574', fontSize: 16 },
});
