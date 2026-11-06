import type { BoardDetail, BoardSide } from '@uwat/shared';
import { useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import { apiText } from './api';
import { boardHtml } from './boardHtml';
import { colours, fonts } from './theme';

interface WebViewHandle {
  injectJavaScript: (script: string) => void;
}

// The package's types leave out ref, which is the only way to talk to a running page.
const BoardWebView = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewHandle> }>;

interface Props {
  detail: BoardDetail;
  side: BoardSide;
  lit: readonly string[];
  done: readonly string[];
  warning: boolean;
}

export function BoardPreview({ detail, side, lit, done, warning }: Props) {
  const [drawings, setDrawings] = useState<{ top: string; bottom: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const view = useRef<WebViewHandle>(null);
  const boardId = detail.board.id;

  useEffect(() => {
    let live = true;
    Promise.all([apiText(`/api/boards/${boardId}/top.svg`), apiText(`/api/boards/${boardId}/bottom.svg`)])
      .then(([top, bottom]) => {
        if (live) setDrawings({ top, bottom });
      })
      .catch((error: Error) => {
        if (live) setProblem(error.message);
      });
    return () => {
      live = false;
    };
  }, [boardId]);

  const html = useMemo(
    () => (drawings ? boardHtml(detail, drawings.top, drawings.bottom) : null),
    // The drawing only changes with the board. Linking parts shouldn't reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawings, boardId],
  );

  useEffect(() => {
    if (!ready) return;
    view.current?.injectJavaScript(`window.show(${JSON.stringify({ side, lit, done, warning })}); true;`);
  }, [ready, side, lit, done, warning]);

  if (problem) return <Text style={styles.problem}>{problem}</Text>;
  if (!html) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colours.gold} />
      </View>
    );
  }
  return (
    <BoardWebView
      ref={view}
      testID="board-preview"
      originWhitelist={['*']}
      source={{ html }}
      style={styles.web}
      scrollEnabled
      bounces={false}
      onMessage={() => setReady(true)}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#0b0b0b' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0b0b' },
  problem: { padding: 16, color: colours.danger, fontFamily: fonts.body },
});
