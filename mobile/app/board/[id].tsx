import {
  boardLines,
  classifyScan,
  judgeScan,
  type BagLabel,
  type BoardDetail,
  type BoardLine,
  type BoardSide,
  type BoardUse,
  type PartSummary,
  type PlacementView,
  type StockNote,
  type TypedPart,
} from '@uwat/shared';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canScanPhotos, LabelScannerView, liveScanSupported, scanPhoto, type ScannedCode } from '../../modules/label-scanner';
import { api, ApiFailure, newRequestId } from '../../src/api';
import { BoardPreview } from '../../src/BoardPreview';
import { Checklist } from '../../src/Checklist';
import { PartSheet } from '../../src/PartSheet';
import { colours, fonts } from '../../src/theme';
import { VerdictCard, type ScanOutcome } from '../../src/VerdictCard';

/** The camera sees the same label many times a second, so hold off before reading it again. */
const REPEAT_HOLD_MS = 2500;
const CLOSE_UP_ZOOM = 0.2;

/** Test builds set EXPO_PUBLIC_SCAN_LOG=1 to see what a phone camera reads, without Metro. */
const SCAN_LOG = __DEV__ || process.env.EXPO_PUBLIC_SCAN_LOG === '1';

function logScan(raw: string, result: string) {
  // Only used while testing. It shows what a real label holds, straight from the server log.
  if (SCAN_LOG) void api('/api/debug/scan', { method: 'POST', body: { raw, result } }).catch(() => undefined);
}

/** The phone can't hear the website's live feed, so it checks back this often while the board is open. */
const REFRESH_MS = 15_000;

export default function CheckScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [side, setSide] = useState<BoardSide>('top');
  const [torch, setTorch] = useState(false);
  const [closeUp, setCloseUp] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [sheetPartId, setSheetPartId] = useState<string | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  // Apple's own scanner where the phone has it: it reads small square codes far better.
  const [live, setLive] = useState<boolean | null>(null);
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
  // Bags sent to stock on this visit. The camera keeps seeing a label while it's in view,
  // and each bag should only be added once.
  const sent = useRef(new Map<string, { requestId: string; note: StockNote }>());

  const loaded = useRef(false);
  const load = useCallback(() => {
    api<BoardDetail>(`/api/boards/${id}`)
      .then((next) => {
        loaded.current = true;
        setDetail(next);
      })
      // Once the board is showing, a missed refresh just waits for the next one.
      .catch((error: Error) => (loaded.current ? undefined : setProblem(error.message)));
  }, [id]);

  // Picks up ticks and stock changes made on other phones or the website.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  useEffect(() => {
    liveScanSupported()
      .then(setLive)
      .catch(() => setLive(false));
  }, []);

  const placements = useMemo<readonly PlacementView[]>(() => detail?.placements ?? [], [detail]);
  const lines = useMemo(() => boardLines(placements), [placements]);
  // Progress is what's soldered on. It's shared, so every phone and the website agree.
  const placedCount = lines.filter((line) => line.placed).length;
  const done = useMemo(() => lines.filter((line) => line.placed).flatMap((line) => line.refs), [lines]);

  const verdict = outcome?.kind === 'judged' ? outcome.verdict : null;
  const lit = useMemo(() => (verdict && verdict.kind !== 'not-here' ? verdict.line.refs : []), [verdict]);
  // The line as it is now, since the one judged at scan time doesn't see later ticks.
  const scannedLine = verdict?.kind === 'fits' ? (lines.find((line) => line.key === verdict.line.key) ?? verdict.line) : null;
  const stockNote = outcome?.kind === 'judged' ? outcome.stock : null;
  // Asked again after a failed add, so it can be retried without typing the number again.
  const typedPart =
    outcome?.kind === 'judged' && (!outcome.stock || outcome.stock.state === 'failed') ? outcome.typed : null;
  const awaitingQuantity = typedPart !== null;
  const scannedPartId =
    (stockNote?.state === 'added' || stockNote?.state === 'already' ? stockNote.partId : null) ?? scannedLine?.partId ?? null;

  /** Ticks a part off as soldered, or back. Shows it straight away, then confirms with the server. */
  const togglePlaced = useCallback(
    (line: BoardLine) => {
      const placed = !line.placed;
      setDetail((current) =>
        current && {
          ...current,
          placements: current.placements.map((spot) =>
            line.refs.includes(spot.ref) && !spot.dnp ? { ...spot, placed } : spot,
          ),
        },
      );
      void Haptics.selectionAsync();
      api(`/api/boards/${id}/placed`, { method: 'POST', body: { refs: line.refs, placed } })
        .catch((error: Error) => Alert.alert("Couldn't save that", error.message))
        .finally(load);
    },
    [id, load],
  );

  /** Every real bag label that gets scanned goes into the inventory, whichever board it's for. */
  const addToStock = useCallback((code: string, raw: string, label: BagLabel): StockNote => {
    const key = label.labelKey ?? raw;
    const earlier = sent.current.get(key);
    if (earlier && earlier.note.state !== 'failed') return earlier.note;

    const requestId = earlier?.requestId ?? newRequestId();
    const settle = (note: StockNote) => {
      sent.current.set(key, { requestId, note });
      setOutcome((current) => (current?.kind === 'judged' && current.code === code ? { ...current, stock: note } : current));
    };
    sent.current.set(key, { requestId, note: { state: 'adding' } });
    api<{ part: PartSummary; bagId: string }>('/api/intake', {
      method: 'POST',
      body: {
        partNumber: label.partNumber,
        mfrPartNumber: label.mfrPartNumber,
        quantity: label.quantity ?? 0,
        project: label.project,
        labelKey: label.labelKey,
        requestId,
      },
    })
      .then(({ part, bagId }) => {
        settle({ state: 'added', total: part.total, partId: part.id, bagId });
        // Picks up the new stock on this board's spots and checklist.
        load();
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 409) {
          const { partId, bagId } = error.details;
          settle({
            state: 'already',
            partId: typeof partId === 'string' ? partId : null,
            bagId: typeof bagId === 'string' ? bagId : null,
          });
        }
        else settle({ state: 'failed', message: (error as Error).message });
      });
    return { state: 'adding' };
  }, [load]);

  /** A typed number has no quantity on it, so it's added once someone says how many are in the bag. */
  const addTyped = useCallback(
    (code: string, typed: TypedPart, quantity: number) => {
      const settle = (note: StockNote) =>
        setOutcome((current) => (current?.kind === 'judged' && current.code === code ? { ...current, stock: note } : current));
      settle({ state: 'adding' });
      api<{ part: PartSummary; bagId: string }>('/api/intake', {
        method: 'POST',
        body: { ...typed, quantity, requestId: newRequestId() },
      })
        .then(({ part, bagId }) => {
          settle({ state: 'added', total: part.total, partId: part.id, bagId });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          load();
        })
        .catch((error: Error) => settle({ state: 'failed', message: error.message }));
    },
    [load],
  );

  const runScan = useCallback(
    (raw: string, source: 'camera' | 'photo' | 'typed') => {
      const judged = judgeScan(raw, placements, { typed: source === 'typed' });
      if (!judged && source === 'camera') {
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
      const read = classifyScan(raw);
      // The server answers well after this render, so its result lands on this scan's card.
      const stock = read.kind === 'bag' ? addToStock(code, raw, read.label) : null;
      setOutcome({ kind: 'judged', code, quantity, verdict: judged.verdict, otherBoards: null, stock, typed: judged.typed });

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
      const { refs } = judged.verdict.line;
      const onTop = placements.filter((spot) => refs.includes(spot.ref) && spot.side === 'top').length;
      setSide(onTop * 2 >= refs.length ? 'top' : 'bottom');
    },
    [addToStock, placements],
  );

  const onBarcode = useCallback(
    ({ data, type }: ScannedCode) => {
      const now = Date.now();
      if (data === last.current.code && now - last.current.at < REPEAT_HOLD_MS) return;
      last.current = { code: data, at: now };
      logScan(data, `camera read ${type}`);
      runScan(data, 'camera');
    },
    [runScan],
  );

  const onPhoto = async () => {
    let codes: ScannedCode[] | null;
    try {
      codes = await scanPhoto();
    } catch (error) {
      setOutcome({ kind: 'no-code', reason: (error as Error).message });
      return;
    }
    if (codes === null) return;
    for (const code of codes) logScan(code.data, `photo read ${code.type}`);
    // A label photo can catch a box QR too. Show the code that means something here.
    const best = codes.find((code) => judgeScan(code.data, placements)) ?? codes[0];
    if (!best) {
      setOutcome({ kind: 'no-code', reason: null });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    runScan(best.data, 'photo');
  };

  const submitTyped = () => {
    const text = typed.current.trim();
    if (!text) return;
    typed.current = '';
    setEntry((count) => count + 1);
    runScan(text, 'typed');
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
          <Text style={styles.progressCount}>{placedCount}</Text>
          <Text style={styles.progressText}> of {lines.length} on</Text>
        </Pressable>
      </View>

      <View style={styles.camera}>
        {!Device.isDevice ? (
          <View style={styles.centre}>
            <Text style={styles.cameraNote}>The simulator has no camera. Scan a photo of a label, or type a part number below.</Text>
            {canScanPhotos ? (
              <Pressable style={styles.button} onPress={() => void onPhoto()} accessibilityRole="button">
                <Text style={styles.buttonText}>Scan a photo</Text>
              </Pressable>
            ) : null}
          </View>
        ) : permission?.granted ? (
          <>
            {live === null ? null : live && LabelScannerView ? (
              <LabelScannerView
                style={StyleSheet.absoluteFill}
                torch={torch}
                zoomed={closeUp}
                onCode={({ nativeEvent }) => onBarcode(nativeEvent)}
                onProblem={({ nativeEvent }) => setCameraProblem(nativeEvent.message)}
              />
            ) : (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                autofocus="on"
                enableTorch={torch}
                zoom={closeUp ? CLOSE_UP_ZOOM : 0}
                // No 1D codes: DigiKey's two long barcodes hold a shipping tote and a label number, never
                // the part, and the camera finds them before the square code. QR is for box labels.
                barcodeScannerSettings={{ barcodeTypes: ['datamatrix', 'qr'] }}
                onBarcodeScanned={({ data, type }) => onBarcode({ data, type })}
                onMountError={({ message }) => setCameraProblem(message)}
              />
            )}
            {live ? null : <View style={styles.reticle} pointerEvents="none" />}
            <View style={styles.cameraTools}>
              {canScanPhotos ? (
                <Pressable style={styles.tool} onPress={() => void onPhoto()} accessibilityRole="button" accessibilityLabel="Scan a photo">
                  <Text style={styles.toolText}>Photo</Text>
                </Pressable>
              ) : null}
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
        // Ready for the next code, unless a typed one is waiting for its quantity.
        autoFocus={entry > 0 && !awaitingQuantity}
        style={styles.input}
        onChangeText={(text) => {
          typed.current = text;
        }}
        onSubmitEditing={submitTyped}
        returnKeyType="search"
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="Or type a part number, or a spot like U2"
        placeholderTextColor={colours.faint}
        accessibilityLabel="Type a part number or spot"
      />

      <VerdictCard
        outcome={outcome}
        onClear={() => setOutcome(null)}
        placed={scannedLine ? scannedLine.placed : null}
        onTogglePlaced={scannedLine ? () => togglePlaced(scannedLine) : undefined}
        onEditStock={scannedPartId ? () => setSheetPartId(scannedPartId) : null}
        onStockChanged={load}
        onAddTyped={
          typedPart && outcome?.kind === 'judged'
            ? (quantity) => addTyped(outcome.code, typedPart, quantity)
            : null
        }
      />

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
        onClose={() => setChecklistOpen(false)}
        onTogglePlaced={togglePlaced}
        onStockChanged={load}
      />
      <PartSheet partId={sheetPartId} onClose={() => setSheetPartId(null)} onChanged={load} />
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
    maxWidth: '45%',
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
