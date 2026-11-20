import {
  classifyScan,
  describeBomLine,
  type BagLabel,
  type BoardDetail,
  type BoardUse,
  type BoxSummary,
  type InventorySnapshot,
  type PartSummary,
} from '@uwat/shared';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiFailure, newRequestId } from './api';
import { BoxPicker } from './BoxPicker';
import { PartSheet } from './PartSheet';
import { Scanner } from './Scanner';
import { colours, fonts } from './theme';

interface BagScan {
  raw: string;
  label: BagLabel;
  /** Already in the inventory, matched on DigiKey's or the maker's part number. */
  part: PartSummary | null;
  /** Boards whose BOM lists this part. */
  uses: BoardUse[];
  /** For a new part, the name its BOM line gives it. */
  bomName: { name: string; board: string } | null;
  /** Sent with every try, so a retry after a dropped connection still adds the bag once. */
  requestId: string;
}

type Stage =
  | { state: 'ready' }
  | { state: 'saving' }
  | { state: 'done'; partId: string; text: string }
  | { state: 'failed'; message: string };

const NOTICE_MS = 4000;

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Matches the way the server decides a scanned bag is a part it already has. */
function findPart(parts: readonly PartSummary[], label: BagLabel): PartSummary | null {
  return (
    parts.find((part) => same(part.partNumber, label.partNumber)) ??
    parts.find((part) => same(part.mfrPartNumber, label.mfrPartNumber)) ??
    null
  );
}

const isUseful = (raw: string) => classifyScan(raw).kind !== 'unknown';

/** Putting bags away: scan a box label to choose the box, then scan each bag that goes in it. */
export function Inventory() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [box, setBox] = useState<BoxSummary | null>(null);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad: boolean } | null>(null);
  const [scan, setScan] = useState<BagScan | null>(null);
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [stage, setStage] = useState<Stage>({ state: 'ready' });
  // The camera goes away while typing, to make room and so a new read can't replace the card.
  const [typing, setTyping] = useState(false);
  const [sheetPartId, setSheetPartId] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boards = useRef(new Map<string, BoardDetail>());
  const current = useRef<string | null>(null);

  const reload = useCallback(async (): Promise<InventorySnapshot | null> => {
    try {
      const next = await api<InventorySnapshot>('/api/inventory');
      setSnapshot(next);
      setLoadProblem(null);
      setBox((chosen) => (chosen ? (next.boxes.find((b) => b.id === chosen.id) ?? null) : null));
      return next;
    } catch (error) {
      setLoadProblem((error as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    void reload();
    // Moving between fields blurs one before focusing the next, so wait for the keyboard to go.
    const hidden = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => {
      hidden.remove();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [reload]);

  const announce = (text: string, bad = false) => {
    setNotice({ text, bad });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };

  const chooseBox = async (code: string) => {
    let found = snapshot?.boxes.find((b) => same(b.code, code));
    // It may have been added on the website since the list was loaded.
    if (!found) found = (await reload())?.boxes.find((b) => same(b.code, code));
    if (found) {
      setBox(found);
      announce(`Putting bags in ${found.code}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      announce(`There's no box ${code} yet. Add it under Boxes on the website.`, true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  };

  /** A bag label has no description, but a board's BOM line for the same part usually does. */
  const lookUpBoards = async (label: BagLabel) => {
    const params = new URLSearchParams();
    if (label.partNumber) params.set('partNumber', label.partNumber);
    if (label.mfrPartNumber) params.set('mfrPartNumber', label.mfrPartNumber);
    if (!params.toString()) return { uses: [], bomName: null };

    const { boards: uses } = await api<{ boards: BoardUse[] }>(`/api/boards/which?${params.toString()}`);
    for (const use of uses) {
      let detail = boards.current.get(use.boardId);
      if (!detail) {
        detail = await api<BoardDetail>(`/api/boards/${use.boardId}`);
        boards.current.set(use.boardId, detail);
      }
      const spot = detail.placements.find((p) => use.refs.includes(p.ref) && (p.value || p.bomDescription));
      const line = spot
        ? describeBomLine({ ref: spot.ref, value: spot.value, description: spot.bomDescription, packageGuess: spot.packageGuess })
        : null;
      if (line) return { uses, bomName: { name: line.description, board: use.boardName } };
    }
    return { uses, bomName: null };
  };

  const startBag = (raw: string, label: BagLabel) => {
    const part = findPart(snapshot?.parts ?? [], label);
    current.current = raw;
    setScan({ raw, label, part, uses: part?.usedOn ?? [], bomName: null, requestId: newRequestId() });
    setName('');
    setQty(label.quantity === null ? '' : String(label.quantity));
    setStage({ state: 'ready' });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (part) return;

    lookUpBoards(label)
      .then(({ uses, bomName }) => {
        if (current.current !== raw) return;
        setScan((now) => (now?.raw === raw ? { ...now, uses, bomName } : now));
        // Only fills an empty field, so it never overwrites what someone has started typing.
        if (bomName) setName((typed) => (typed.trim() ? typed : bomName.name));
      })
      .catch(() => undefined);
  };

  const onScan = (raw: string) => {
    const read = classifyScan(raw);
    if (read.kind === 'box') void chooseBox(read.code);
    // The same bag stays in view after it's read. Only a different one replaces the card.
    else if (read.kind === 'bag' && raw !== current.current) startBag(raw, read.label);
  };

  /** The Boards screen adds every bag it scans, with no box. Here that bag just needs filing. */
  const fileRepeat = async (bagId: string, partId: string, target: BoxSummary | null) => {
    const { part } = await api<{ part: PartSummary }>(`/api/parts/${partId}`);
    const bag = part.bags.find((b) => b.id === bagId);
    const where = bag?.box?.code ?? null;
    const has = bag ? ` It has ${bag.quantity}.` : '';
    if (!target || bag?.box?.id === target.id) {
      return where ? `This bag is already in ${where}.${has}` : `This bag is already in stock, with no box.${has}`;
    }
    await api(`/api/bags/${bagId}`, { method: 'PATCH', body: { boxId: target.id } });
    return `This bag was already in stock${where ? ` in ${where}` : ''}. Moved it to ${target.code}.${has}`;
  };

  const save = async (target: BoxSummary | null) => {
    if (!scan) return;
    const quantity = Number(qty.trim());
    if (!qty.trim() || !Number.isInteger(quantity) || quantity < 0) {
      setStage({ state: 'failed', message: 'Enter how many are in the bag.' });
      return;
    }
    setTyping(false);
    setStage({ state: 'saving' });
    try {
      const { part } = await api<{ part: PartSummary }>('/api/intake', {
        method: 'POST',
        body: {
          partId: scan.part?.id,
          partNumber: scan.label.partNumber,
          mfrPartNumber: scan.label.mfrPartNumber,
          // Left out, the server names a new part from a BOM, or else by its part number.
          description: scan.part ? undefined : name.trim() || undefined,
          quantity,
          boxId: target?.id ?? null,
          project: scan.label.project,
          labelKey: scan.label.labelKey,
          requestId: scan.requestId,
        },
      });
      setStage({ state: 'done', partId: part.id, text: target ? `Added ${quantity} to ${target.code}.` : `Added ${quantity}, with no box.` });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      const { bagId, partId } = error instanceof ApiFailure && error.status === 409 ? error.details : {};
      if (typeof bagId === 'string' && typeof partId === 'string') {
        try {
          setStage({ state: 'done', partId, text: await fileRepeat(bagId, partId, target) });
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (moveError) {
          setStage({ state: 'failed', message: (moveError as Error).message });
        }
      } else {
        setStage({ state: 'failed', message: (error as Error).message });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
    void reload();
  };

  const clear = () => {
    current.current = null;
    setScan(null);
    setTyping(false);
  };

  return (
    <View style={styles.fill}>
      <Pressable
        style={styles.strip}
        onPress={() => setPicking(true)}
        accessibilityRole="button"
        accessibilityLabel={box ? `Putting bags in ${box.code}. Change box.` : 'Pick a box'}
      >
        <View style={styles.fill}>
          <Text style={styles.stripLabel}>Putting bags in</Text>
          {box ? (
            <Text style={styles.boxCode} numberOfLines={1}>
              {box.code}
              {box.label ? <Text style={styles.boxLabel}>  {box.label}</Text> : null}
            </Text>
          ) : (
            <Text style={styles.noBox}>No box yet. Scan a box label, or tap to pick.</Text>
          )}
        </View>
        <Text style={styles.link}>{box ? 'Change' : 'Pick'}</Text>
      </Pressable>
      {notice ? (
        <Text style={[styles.notice, notice.bad && styles.noticeBad]} accessibilityLiveRegion="polite">
          {notice.text}
        </Text>
      ) : null}

      {typing ? null : (
        <Scanner
          style={styles.camera}
          accepts={isUseful}
          onScan={onScan}
          purpose="The camera reads bag labels and box labels."
          wrongCode="Wrong barcode. Aim at the small square code."
        />
      )}

      <ScrollView style={styles.fill} contentContainerStyle={styles.cardArea} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {loadProblem ? <Text style={styles.problem}>{loadProblem}</Text> : null}
        {scan ? (
          <BagCard
            scan={scan}
            box={box}
            name={name}
            qty={qty}
            stage={stage}
            onName={setName}
            onQty={setQty}
            onTyping={() => setTyping(true)}
            onSave={(target) => void save(target)}
            onPickBox={() => setPicking(true)}
            onEditStock={(partId) => setSheetPartId(partId)}
            onClear={clear}
          />
        ) : (
          <Text style={styles.idle}>
            Scan the square code on a bag to add it.{'\n'}Scan the QR label on a box to choose where bags go.
          </Text>
        )}
      </ScrollView>

      <BoxPicker
        visible={picking}
        chosenId={box?.id}
        hint="Or close this and scan the QR label on the box."
        onPick={(next) => {
          setBox(next);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
      <PartSheet partId={sheetPartId} onClose={() => setSheetPartId(null)} onChanged={() => void reload()} />
    </View>
  );
}

interface CardProps {
  scan: BagScan;
  box: BoxSummary | null;
  name: string;
  qty: string;
  stage: Stage;
  onName: (text: string) => void;
  onQty: (text: string) => void;
  onTyping: () => void;
  onSave: (target: BoxSummary | null) => void;
  onPickBox: () => void;
  onEditStock: (partId: string) => void;
  onClear: () => void;
}

function BagCard({ scan, box, name, qty, stage, onName, onQty, onTyping, onSave, onPickBox, onEditStock, onClear }: CardProps) {
  const { part, label, uses, bomName } = scan;
  const numbers = [label.mfrPartNumber, label.partNumber].filter(Boolean).join(' · ');
  const title = part?.description ?? (name.trim() || label.mfrPartNumber || label.partNumber || 'New part');
  const editing = stage.state === 'ready' || stage.state === 'failed';
  const boxes = part ? [...new Set(part.bags.flatMap((bag) => (bag.box ? [bag.box.code] : [])))] : [];

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={[styles.badge, !part && styles.badgeNew]}>
          {part ? `In stock · ${part.total}${boxes.length ? ` in ${boxes.join(', ')}` : ''}` : 'New part'}
        </Text>
        <Pressable onPress={onClear} hitSlop={12} accessibilityRole="button" accessibilityLabel="Clear this scan">
          <Text style={styles.close}>×</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{title}</Text>
      {numbers ? <Text style={styles.numbers}>{numbers}</Text> : null}
      {uses.length > 0 ? (
        <Text style={styles.numbers}>
          Goes on {uses.map((use) => `${use.boardName} (${use.refs.join(', ')})`).join('; ')}
        </Text>
      ) : null}

      {editing ? (
        <>
          {part ? null : (
            <>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={onName}
                onFocus={onTyping}
                placeholder={label.mfrPartNumber ?? 'e.g. 10k resistor 0603'}
                placeholderTextColor={colours.faint}
                autoCorrect={false}
                returnKeyType="done"
              />
              <Text style={styles.help}>
                {bomName && name.trim() === bomName.name
                  ? `From the ${bomName.board} BOM.`
                  : 'Leave it blank to use the part number. You can rename it on the website.'}
              </Text>
            </>
          )}
          <Text style={styles.label}>How many</Text>
          <TextInput
            style={[styles.input, styles.qty]}
            value={qty}
            onChangeText={(text) => onQty(text.replace(/[^0-9]/g, ''))}
            onFocus={onTyping}
            keyboardType="number-pad"
            returnKeyType="done"
            placeholder="0"
            placeholderTextColor={colours.faint}
          />
          {stage.state === 'failed' ? <Text style={styles.problem}>{stage.message}</Text> : null}
          {box ? (
            <Pressable style={styles.button} onPress={() => onSave(box)} accessibilityRole="button">
              <Text style={styles.buttonText}>Put in {box.code}</Text>
            </Pressable>
          ) : (
            <>
              <Pressable style={styles.button} onPress={onPickBox} accessibilityRole="button">
                <Text style={styles.buttonText}>Pick a box</Text>
              </Pressable>
              <Pressable style={styles.secondary} onPress={() => onSave(null)} accessibilityRole="button">
                <Text style={styles.link}>Add without a box</Text>
              </Pressable>
            </>
          )}
        </>
      ) : stage.state === 'saving' ? (
        <Text style={styles.status}>Adding…</Text>
      ) : (
        <>
          <Text style={styles.status}>✓ {stage.text}</Text>
          <View style={styles.after}>
            <Text style={styles.help}>Scan the next bag.</Text>
            <Pressable onPress={() => onEditStock(stage.partId)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.link}>Edit stock</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.raised,
  },
  stripLabel: { color: colours.muted, fontFamily: fonts.medium, fontSize: 13 },
  boxCode: { marginTop: 2, color: colours.gold, fontFamily: fonts.display, fontSize: 24 },
  boxLabel: { color: colours.text, fontFamily: fonts.body, fontStyle: 'normal', fontSize: 15 },
  noBox: { marginTop: 3, color: colours.white, fontFamily: fonts.body, fontSize: 15 },
  link: { color: colours.gold, fontFamily: fonts.bold, fontSize: 15 },
  notice: {
    marginHorizontal: 16,
    marginBottom: 8,
    color: colours.white,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  noticeBad: { color: colours.danger },
  camera: { height: '28%', minHeight: 170 },
  cardArea: { padding: 16, paddingBottom: 40 },
  idle: { color: colours.muted, fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  problem: { marginTop: 10, color: colours.danger, fontFamily: fonts.body, fontSize: 14 },
  card: { padding: 14, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    color: colours.muted,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  badgeNew: { borderColor: colours.gold, color: colours.gold },
  close: { color: colours.muted, fontFamily: fonts.body, fontSize: 26, lineHeight: 26 },
  title: { marginTop: 10, color: colours.white, fontFamily: fonts.display, fontSize: 20 },
  numbers: { marginTop: 4, color: colours.muted, fontFamily: fonts.body, fontSize: 14 },
  label: { marginTop: 14, marginBottom: 5, color: colours.muted, fontFamily: fonts.medium, fontSize: 14 },
  input: {
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.control,
    color: colours.white,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  qty: { width: 120 },
  help: { marginTop: 5, color: colours.faint, fontFamily: fonts.body, fontSize: 13 },
  button: { alignItems: 'center', justifyContent: 'center', height: 48, marginTop: 16, backgroundColor: colours.gold },
  buttonText: { color: colours.ink, fontFamily: fonts.bold, fontSize: 16 },
  secondary: { alignItems: 'center', paddingVertical: 12 },
  status: { marginTop: 14, color: colours.white, fontFamily: fonts.medium, fontSize: 16 },
  after: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
});
