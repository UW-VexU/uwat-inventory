import {
  boardLines,
  judgeScan,
  type BoardDetail,
  type BoardSide,
  type BoardUse,
  type PlacementView,
} from '@uwat/shared';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../src/api';
import { BoardPreview } from '../../src/BoardPreview';
import { Checklist } from '../../src/Checklist';
import { colours, fonts } from '../../src/theme';
import { useFoundLines } from '../../src/useFoundLines';
import { VerdictCard, type ScanOutcome } from '../../src/VerdictCard';

/** The camera sees the same label many times a second, so hold off before reading it again. */
const REPEAT_HOLD_MS = 2500;
const CLOSE_UP_ZOOM = 0.2;

function logScan(raw: string, result: string) {
  // Only used while testing. It shows what a real label holds, straight from the server log.
  if (__DEV__) void api('/api/debug/scan', { method: 'POST', body: { raw, result } }).catch(() => undefined);
}

export default function CheckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [side, setSide] = useState<BoardSide>('top');
  const [torch, setTorch] = useState(false);
  const [closeUp, setCloseUp] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  // A label also carries an order barcode. The camera reads it alongside the square code,
  // so it only earns a passing hint, never a result that would cover the real one.
  const [otherCodeSeen, setOtherCodeSeen] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef({ code: '', at: 0 });
  // Left uncontrolled on purpose: Bluetooth scanners type faster than React can re-render,
  // and setting the value on each key scrambles the order of the characters.
  const typed = useRef('');
  // clear() doesn't reliably reach a native input here, so each entry gets a fresh one.
  const [entry, setEntry] = useState(0);
  const { found, markFound, reset } = useFoundLines(id);

  useEffect(() => {
    api<BoardDetail>(`/api/boards/${id}`)
      .then(setDetail)
      .catch((error: Error) => setProblem(error.message));
  }, [id]);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const placements = useMemo<readonly PlacementView[]>(() => detail?.placements ?? [], [detail]);
  const lines = useMemo(() => boardLines(placements), [placements]);
  const foundCount = lines.filter((line) => found.has(line.key)).length;
  const done = useMemo(
    () => lines.filter((line) => found.has(line.key)).flatMap((line) => line.refs),
    [found, lines],
  );

  const verdict = outcome?.kind === 'judged' ? outcome.verdict : null;
  const lit = useMemo(() => (verdict && verdict.kind !== 'not-here' ? verdict.line.refs : []), [verdict]);

  const runScan = useCallback(
    (raw: string, fromCamera: boolean) => {
      const judged = judgeScan(raw, placements);
      if (!judged && fromCamera) {
        logScan(raw, 'ignored');
        setOtherCodeSeen(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setOtherCodeSeen(false), REPEAT_HOLD_MS);
        return;
      }
      if (!judged) {
        setOutcome({ kind: 'unreadable', raw });
        logScan(raw, 'unreadable');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      const { bag, code, quantity } = judged;
      logScan(raw, judged.verdict.kind);
      setOutcome({ kind: 'judged', code, quantity, verdict: judged.verdict, otherBoards: null });

      if (judged.verdict.kind === 'not-here') {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const params = new URLSearchParams();
        if (bag.partNumber) params.set('partNumber', bag.partNumber);
        if (bag.mfrPartNumber) params.set('mfrPartNumber', bag.mfrPartNumber);
        api<{ boards: BoardUse[] }>(`/api/boards/which?${params.toString()}`)
          .then(({ boards }) => {
            setOutcome((current) =>
              current?.kind === 'judged' && current.code === code ? { ...current, otherBoards: boards } : current,
            );
          })
          .catch(() => undefined);
        return;
      }

      void Haptics.notificationAsync(
        judged.verdict.kind === 'fits'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
      if (judged.verdict.kind === 'fits') markFound(judged.verdict.line.key);
      const { refs } = judged.verdict.line;
      const onTop = placements.filter((spot) => refs.includes(spot.ref) && spot.side === 'top').length;
      setSide(onTop * 2 >= refs.length ? 'top' : 'bottom');
    },
    [markFound, placements],
  );

  const onBarcode = useCallback(
    ({ data }: BarcodeScanningResult) => {
      const now = Date.now();
      if (data === last.current.code && now - last.current.at < REPEAT_HOLD_MS) return;
      last.current = { code: data, at: now };
      runScan(data, true);
    },
    [runScan],
  );

  const submitTyped = () => {
    const text = typed.current.trim();
    if (!text) return;
    typed.current = '';
    setEntry((count) => count + 1);
    runScan(text, false);
  };

  if (problem) {
    return (
      <SafeAreaView style={styles.screen}>
        <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button">
          <Text style={styles.link}>‹ Boards</Text>
        </Pressable>
        <Text style={styles.problem}>{problem}</Text>
      </SafeAreaView>
    );
  }
  if (!detail) {
    return (
      <SafeAreaView style={[styles.screen, styles.centre]}>
        <ActivityIndicator color={colours.gold} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to boards">
          <Text style={styles.link}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {detail.board.name}
          {detail.board.revision ? <Text style={styles.rev}> rev {detail.board.revision}</Text> : null}
        </Text>
        <Pressable style={styles.progress} onPress={() => setChecklistOpen(true)} accessibilityRole="button">
          <Text style={styles.progressCount}>{foundCount}</Text>
          <Text style={styles.progressText}> of {lines.length}</Text>
        </Pressable>
      </View>

      <View style={styles.camera}>
        {!Device.isDevice ? (
          <View style={styles.centre}>
            <Text style={styles.cameraNote}>The simulator has no camera. Open this on a phone to scan, or type a part number below.</Text>
          </View>
        ) : permission?.granted ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              autofocus="on"
              enableTorch={torch}
              zoom={closeUp ? CLOSE_UP_ZOOM : 0}
              // No 1D codes: DigiKey's two long barcodes hold a shipping tote and a label number, never
              // the part, and the camera finds them before the square code. QR is for box labels.
              barcodeScannerSettings={{ barcodeTypes: ['datamatrix', 'qr'] }}
              onBarcodeScanned={onBarcode}
              onMountError={({ message }) => setCameraProblem(message)}
            />
            <View style={styles.reticle} pointerEvents="none" />
            <View style={styles.cameraTools}>
              <Pressable style={[styles.tool, torch && styles.toolOn]} onPress={() => setTorch((on) => !on)} accessibilityRole="button">
                <Text style={[styles.toolText, torch && styles.toolTextOn]}>Light</Text>
              </Pressable>
              <Pressable style={[styles.tool, closeUp && styles.toolOn]} onPress={() => setCloseUp((on) => !on)} accessibilityRole="button">
                <Text style={[styles.toolText, closeUp && styles.toolTextOn]}>Zoom</Text>
              </Pressable>
            </View>
            {cameraProblem ? <Text style={styles.cameraProblem}>{cameraProblem}</Text> : null}
            {otherCodeSeen ? (
              <Text style={styles.cameraHint} accessibilityLiveRegion="polite">
                Wrong barcode. Aim at the small square code.
              </Text>
            ) : null}
          </>
        ) : (
          <View style={styles.centre}>
            <Text style={styles.cameraNote}>
              {permission && !permission.canAskAgain
                ? 'Camera access is off for this app. Turn it on in Settings.'
                : 'The camera reads the barcode on a bag.'}
            </Text>
            <Pressable
              style={styles.button}
              // iOS only asks once. After a "Don't Allow", Settings is the only way back.
              onPress={() => void (permission && !permission.canAskAgain ? Linking.openSettings() : requestPermission())}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{permission && !permission.canAskAgain ? 'Open Settings' : 'Turn on camera'}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <TextInput
        key={entry}
        autoFocus={entry > 0}
        style={styles.input}
        onChangeText={(text) => {
          typed.current = text;
        }}
        onSubmitEditing={submitTyped}
        returnKeyType="search"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Or type a part number"
        placeholderTextColor={colours.faint}
        accessibilityLabel="Type a part number"
      />

      <VerdictCard outcome={outcome} onClear={() => setOutcome(null)} />

      <View style={styles.board}>
        <BoardPreview
          detail={detail}
          side={side}
          lit={lit}
          done={done}
          warning={verdict?.kind === 'leave-empty'}
        />
      </View>

      <Checklist
        visible={checklistOpen}
        lines={lines}
        found={found}
        onClose={() => setChecklistOpen(false)}
        onReset={reset}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.ink },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  back: { padding: 16 },
  problem: { paddingHorizontal: 16, color: colours.danger, fontFamily: fonts.body, fontSize: 15 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  link: { color: colours.gold, fontFamily: fonts.bold, fontSize: 24 },
  title: { flex: 1, color: colours.white, fontFamily: fonts.display, fontSize: 19 },
  rev: { color: colours.muted, fontSize: 13 },
  progress: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colours.lineStrong,
  },
  progressCount: { color: colours.gold, fontFamily: fonts.display, fontSize: 17 },
  progressText: { color: colours.muted, fontFamily: fonts.body, fontSize: 14 },
  camera: { height: '30%', minHeight: 190, backgroundColor: '#000' },
  reticle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '10%',
    height: '70%',
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: colours.gold,
  },
  cameraTools: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 6 },
  tool: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(0,0,0,0.65)' },
  toolOn: { backgroundColor: colours.gold },
  toolText: { color: colours.white, fontFamily: fonts.medium, fontSize: 14 },
  toolTextOn: { color: colours.ink },
  cameraNote: { paddingHorizontal: 28, color: colours.muted, fontFamily: fonts.body, fontSize: 15, textAlign: 'center' },
  cameraProblem: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    color: colours.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  cameraHint: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '55%',
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.75)',
    color: colours.white,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  button: { paddingHorizontal: 18, paddingVertical: 11, backgroundColor: colours.gold },
  buttonText: { color: colours.ink, fontFamily: fonts.bold, fontSize: 15 },
  input: {
    height: 42,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
    backgroundColor: colours.control,
    color: colours.white,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  board: { flex: 1, minHeight: 120 },
});
