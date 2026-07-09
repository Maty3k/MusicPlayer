import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import YoutubeIframe from 'react-native-youtube-iframe';
import { BASE_URL, API_TOKEN } from '../../api/client';
import { usePlayerStore } from '../../store/usePlayerStore';
import { useMusicStore } from '../../store/useMusicStore';

// No viewport override — the PHP ?app mode now sets a proper mobile viewport.
// Expose the shared API token to the page BEFORE its scripts run so script.js's
// fetch shim can authenticate save-music.php / spotify.php calls over the LAN.
// JSON.stringify keeps the value a safe JS string literal.
const INJECTED_JS_BEFORE_LOAD = API_TOKEN
  ? `window.__MP_API_TOKEN__ = ${JSON.stringify(API_TOKEN)}; true;`
  : 'true;';

export interface WebViewPlayerHandle {
  togglePlay: () => void;
  nextSong: () => void;
  prevSong: () => void;
  seekTo: (seconds: number) => void;
  switchSong: (index: number) => void;
  toggleLoop: () => void;
  toggleShuffle: () => void;
}

interface Props {
  playlistId: string;
  onNavigateBack: () => void;
  hidden?: boolean;
}

export const WebViewPlayer = forwardRef<WebViewPlayerHandle, Props>(
  function WebViewPlayer({ playlistId, onNavigateBack, hidden }, ref) {
    const webViewRef = useRef<WebView>(null);
    const ytPlayerRef = useRef<any>(null);
    const hasInjected = useRef(false);
    const setPlaying = usePlayerStore((s) => s.setPlaying);
    const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);
    const setDuration = usePlayerStore((s) => s.setDuration);
    const setCurrentSong = usePlayerStore((s) => s.setCurrentSong);
    const triggerSongChange = usePlayerStore((s) => s.triggerSongChange);
    const setLoopMode = useMusicStore((s) => s.setLoopMode);
    const setShuffleMode = useMusicStore((s) => s.setShuffleMode);

    // YouTube native player state
    const [ytVideoId, setYtVideoId] = useState('');
    const [ytPlay, setYtPlay] = useState(false);
    const ytReady = useRef(false);
    const pendingPlay = useRef(false);

    // Expose commands to parent via ref
    useImperativeHandle(ref, () => ({
      togglePlay: () => {
        webViewRef.current?.injectJavaScript('toggleMusic(); true;');
      },
      nextSong: () => {
        webViewRef.current?.injectJavaScript('nextSong(); true;');
      },
      prevSong: () => {
        webViewRef.current?.injectJavaScript('prevSong(); true;');
      },
      seekTo: (seconds: number) => {
        webViewRef.current?.injectJavaScript(
          `ytPlayer.seekTo(${seconds}, true); updateSleeveProgress(); true;`
        );
      },
      switchSong: (index: number) => {
        webViewRef.current?.injectJavaScript(
          `switchSong(${index}); true;`
        );
      },
      toggleLoop: () => {
        webViewRef.current?.injectJavaScript('toggleLoopMode(); true;');
      },
      toggleShuffle: () => {
        webViewRef.current?.injectJavaScript('toggleShuffle(); true;');
      },
    }));

    // Send YouTube state update to WebView so the turntable UI reacts
    const sendYtStateToWebView = useCallback(
      (state: number, currentTime = 0, duration = 0) => {
        webViewRef.current?.injectJavaScript(`
        window.dispatchEvent(new MessageEvent('message', {
          data: JSON.stringify({
            type: 'ytStateUpdate',
            state: ${state},
            currentTime: ${currentTime},
            duration: ${duration}
          })
        }));
        true;
      `);
      },
      []
    );

    // Poll YouTube player for current time / duration while playing
    useEffect(() => {
      if (!ytVideoId || !ytPlay) return;
      const interval = setInterval(async () => {
        try {
          const ct = (await ytPlayerRef.current?.getCurrentTime()) ?? 0;
          const dur = (await ytPlayerRef.current?.getDuration()) ?? 0;
          sendYtStateToWebView(1, ct, dur); // 1 = PLAYING
        } catch {
          /* player not ready yet */
        }
      }, 1000);
      return () => clearInterval(interval);
    }, [ytVideoId, ytPlay, sendYtStateToWebView]);

    const handleLoadEnd = useCallback(() => {
      if (!webViewRef.current || hasInjected.current) return;
      hasInjected.current = true;

      // Wait for page JS to initialize, then select playlist.
      // JSON.stringify keeps any quotes/backslashes in playlistId from
      // breaking out of the JS string literal.
      const safeId = JSON.stringify(String(playlistId));
      setTimeout(() => {
        webViewRef.current?.injectJavaScript(`
        if (typeof selectPlaylistFromCrate === 'function') {
          selectPlaylistFromCrate(${safeId});
        }
        true;
      `);
      }, 300);
    }, [playlistId]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        try {
          const raw = JSON.parse(event.nativeEvent.data);
          if (!raw || typeof raw !== 'object') return;
          const msg = raw as Record<string, unknown>;
          const type = typeof msg.type === 'string' ? msg.type : '';

          if (type === 'navigateBack') {
            onNavigateBack();
          } else if (type === 'stateUpdate') {
            setPlaying(Boolean(msg.isPlaying));
            setCurrentTime(typeof msg.currentTime === 'number' ? msg.currentTime : 0);
            setDuration(typeof msg.duration === 'number' ? msg.duration : 0);
            if (msg.song && typeof msg.song === 'object') {
              setCurrentSong(msg.song as any);
              triggerSongChange();
            }
            if (typeof msg.loopMode === 'string') {
              setLoopMode(msg.loopMode as any);
            }
            if (typeof msg.shuffleMode === 'string') {
              setShuffleMode(msg.shuffleMode as any);
            }
          } else if (type === 'ytCommand') {
            const command = typeof msg.command === 'string' ? msg.command : '';
            const youtubeId =
              typeof msg.youtubeId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(msg.youtubeId)
                ? msg.youtubeId
                : '';
            switch (command) {
              case 'loadVideo':
                if (!youtubeId) break;
                setYtVideoId(youtubeId);
                if (ytReady.current) {
                  setYtPlay(true);
                } else {
                  pendingPlay.current = true;
                }
                break;
              case 'cueVideo':
                if (!youtubeId) break;
                setYtVideoId(youtubeId);
                setYtPlay(false);
                break;
              case 'play':
                if (ytReady.current) {
                  setYtPlay(true);
                } else {
                  pendingPlay.current = true;
                }
                break;
              case 'pause':
                setYtPlay(false);
                pendingPlay.current = false;
                break;
              case 'seekTo':
                ytPlayerRef.current?.seekTo(
                  typeof msg.seconds === 'number' ? msg.seconds : 0,
                  true
                );
                break;
            }
          }
        } catch {
          // Ignore malformed messages
        }
      },
      [onNavigateBack, setPlaying, setCurrentTime, setDuration, setCurrentSong, triggerSongChange, setLoopMode, setShuffleMode]
    );

    // Called when YoutubeIframe's internal player is fully loaded
    const handleYtReady = useCallback(() => {
      ytReady.current = true;
      if (pendingPlay.current) {
        pendingPlay.current = false;
        setYtPlay(true);
      }
    }, []);

    // Map react-native-youtube-iframe state strings to YT.PlayerState numbers
    const handleYtStateChange = useCallback(
      (state: string) => {
        const stateMap: Record<string, number> = {
          unstarted: -1,
          ended: 0,
          playing: 1,
          paused: 2,
          buffering: 3,
          'video cued': 5,
        };
        const stateNum = stateMap[state] ?? -1;

        // Only sync ytPlay for definitive states.
        // IMPORTANT: Do NOT set ytPlay=false on 'paused' — YouTube fires
        // intermediate 'paused' states during buffering which would cancel
        // user-initiated play commands. Pause is handled by the 'pause'
        // ytCommand from the WebView instead.
        if (state === 'playing') {
          setYtPlay(true);
        } else if (state === 'ended') {
          setYtPlay(false);
        }

        sendYtStateToWebView(stateNum);
      },
      [sendYtStateToWebView]
    );

    return (
      <View
        style={[styles.container, hidden && styles.hidden]}
        pointerEvents={hidden ? 'none' : 'auto'}
      >
        <WebView
          ref={webViewRef}
          source={{ uri: `${BASE_URL}/index.php?app=1` }}
          style={styles.webview}
          injectedJavaScriptBeforeContentLoaded={INJECTED_JS_BEFORE_LOAD}
          onLoadEnd={handleLoadEnd}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          mixedContentMode="compatibility"
          originWhitelist={[BASE_URL]}
          cacheEnabled={false}
        />

        {/* Native YouTube player — always mounted for fast start */}
        <View style={styles.ytHidden} pointerEvents="none">
          <YoutubeIframe
            ref={ytPlayerRef}
            height={60}
            width={80}
            videoId={ytVideoId || undefined}
            play={ytPlay}
            onReady={handleYtReady}
            onChangeState={handleYtStateChange}
            initialPlayerParams={{
              controls: false,
              preventFullScreen: true,
              modestbranding: true,
            }}
            webViewProps={{
              mediaPlaybackRequiresUserAction: false,
              allowsInlineMediaPlayback: true,
            }}
          />
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  ytHidden: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
});
