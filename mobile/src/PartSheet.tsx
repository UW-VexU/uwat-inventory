import type { BagSummary, BoxSummary, PartSummary } from '@uwat/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, newRequestId } from './api';
import { colours, fonts } from './theme';

type Mode = 'take' | 'add' | 'count';

const MODES: ReadonlyArray<{ mode: Mode; label: string; hint: string }> = [
  { mode: 'take', label: 'Take', hint: 'How many did you take?' },
  { mode: 'add', label: 'Add', hint: 'How many did you put back?' },
  { mode: 'count', label: 'Count', hint: 'How many are in the bag now?' },
];

interface Props {
  /** The part to show. Null keeps the sheet closed. */
  partId: string | null;
  onClose: () => void;
  /** After any change, so the screen behind can pick up the new numbers. */
  onChanged: () => void;
}

/** A part's bags, and what you can do to them from the phone: take, add, count, move or remove. */
export function PartSheet({ partId, onClose, onChanged }: Props) {
  const [part, setPart] = useState<PartSummary | null>(null);
  const [boxes, setBoxes] = useState<BoxSummary[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!partId) return;
    setPart(null);
    setProblem(null);
    api<{ part: PartSummary }>(`/api/parts/${partId}`)
      .then((result) => setPart(result.part))
      .catch((error: Error) => setProblem(error.message));
    api<{ boxes: BoxSummary[] }>('/api/boxes')
      .then((result) => setBoxes(result.boxes))
      .catch(() => setBoxes([]));
  }, [partId]);

  const saved = (next: PartSummary) => {
    setPart(next);
    onChanged();
  };

  return (
    <Modal visible={partId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.name} numberOfLines={2}>
              {part?.description ?? 'Stock'}
            </Text>
            {part ? <Text style={styles.number}>{part.partNumber ?? part.mfrPartNumber}</Text> : null}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.link}>Done</Text>
          </Pressable>
        </View>

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        {!part && !problem ? <ActivityIndicator color={colours.gold} style={styles.loading} /> : null}

        {part ? (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.total}>
              {part.total}
              <Text style={styles.totalLabel}> in stock</Text>
            </Text>
            {part.bags.length === 0 ? <Text style={styles.note}>No bags left. Scan one to add it.</Text> : null}
            {part.bags.map((bag, index) => (
              <BagEditor key={bag.id} bag={bag} title={part.bags.length > 1 ? `Bag ${index + 1}` : 'Bag'} boxes={boxes} onSaved={saved} />
            ))}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function BagEditor({
  bag,
  title,
  boxes,
  onSaved,
}: {
  bag: BagSummary;
  title: string;
  boxes: readonly BoxSummary[];
  onSaved: (part: PartSummary) => void;
}) {
  const [mode, setMode] = useState<Mode>('take');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pickingBox, setPickingBox] = useState(false);

  const send = async (path: string, method: string, body?: object) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await api<{ part: PartSummary }>(path, { method, body });
      onSaved(result.part);
      return true;
    } catch (error) {
      setProblem((error as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const number = /^\d+$/.test(amount) ? Number(amount) : null;
  const canSave = number !== null && (mode === 'count' || number > 0) && !busy;

  const save = async () => {
    if (number === null) return;
    const body = mode === 'count' ? { counted: number, requestId: newRequestId() } : { amount: number, requestId: newRequestId() };
    if (await send(`/api/bags/${bag.id}/${mode}`, 'POST', body)) setAmount('');
  };

  const move = async (boxId: string | null) => {
    setPickingBox(false);
    if (boxId !== (bag.box?.id ?? null)) await send(`/api/bags/${bag.id}`, 'PATCH', { boxId });
  };

  const remove = () => {
    Alert.alert('Remove this bag?', `All ${bag.quantity} in it come off the stock. You can undo it on the website.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void send(`/api/bags/${bag.id}`, 'DELETE') },
    ]);
  };

  return (
    <View style={styles.bag}>
      <View style={styles.bagHead}>
        <Text style={styles.bagTitle}>
          {title}: <Text style={styles.bagQty}>{bag.quantity}</Text>
        </Text>
        <Pressable onPress={() => setPickingBox((open) => !open)} style={styles.boxButton} accessibilityRole="button">
          <Text style={styles.boxText}>{bag.box ? bag.box.code : 'No box'} ▾</Text>
        </Pressable>
      </View>
      {bag.project ? <Text style={styles.note}>{bag.project}</Text> : null}

      {pickingBox ? (
        <View style={styles.boxes}>
          {[{ id: null, code: 'No box' }, ...boxes].map((box) => (
            <Pressable
              key={box.id ?? 'none'}
              onPress={() => void move(box.id)}
              style={[styles.chip, (bag.box?.id ?? null) === box.id && styles.chipOn]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, (bag.box?.id ?? null) === box.id && styles.chipTextOn]}>{box.code}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.modes}>
        {MODES.map((option) => (
          <Pressable
            key={option.mode}
            onPress={() => setMode(option.mode)}
            style={[styles.mode, mode === option.mode && styles.modeOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: mode === option.mode }}
          >
            <Text style={[styles.modeText, mode === option.mode && styles.modeTextOn]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.entry}>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={(text) => setAmount(text.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder={MODES.find((option) => option.mode === mode)?.hint}
          placeholderTextColor={colours.faint}
          returnKeyType="done"
          onSubmitEditing={() => void (canSave ? save() : undefined)}
        />
        <Pressable onPress={() => void save()} disabled={!canSave} style={[styles.save, !canSave && styles.saveOff]} accessibilityRole="button">
          <Text style={styles.saveText}>{busy ? '…' : 'Save'}</Text>
        </Pressable>
      </View>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}

      <Pressable onPress={remove} style={styles.remove} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.removeText}>Remove bag</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colours.ink },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  headText: { flex: 1 },
  name: { color: colours.white, fontFamily: fonts.display, fontSize: 19 },
  number: { marginTop: 2, color: colours.faint, fontFamily: fonts.body, fontSize: 13 },
  link: { color: colours.gold, fontFamily: fonts.bold, fontSize: 16 },
  loading: { marginTop: 24 },
  body: { padding: 16, gap: 14 },
  total: { color: colours.gold, fontFamily: fonts.display, fontSize: 34 },
  totalLabel: { color: colours.muted, fontFamily: fonts.body, fontSize: 16 },
  note: { color: colours.muted, fontFamily: fonts.body, fontSize: 14 },
  problem: { paddingHorizontal: 16, marginTop: 6, color: colours.danger, fontFamily: fonts.body, fontSize: 14 },
  bag: { gap: 8, padding: 12, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  bagHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bagTitle: { color: colours.muted, fontFamily: fonts.medium, fontSize: 15 },
  bagQty: { color: colours.white, fontFamily: fonts.display, fontSize: 20 },
  boxButton: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colours.lineStrong },
  boxText: { color: colours.white, fontFamily: fonts.medium, fontSize: 14 },
  boxes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colours.line },
  chipOn: { borderColor: colours.gold, backgroundColor: colours.gold },
  chipText: { color: colours.text, fontFamily: fonts.medium, fontSize: 14 },
  chipTextOn: { color: colours.ink },
  modes: { flexDirection: 'row', gap: 6 },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 8, borderWidth: 1, borderColor: colours.line },
  modeOn: { borderColor: colours.gold },
  modeText: { color: colours.muted, fontFamily: fonts.medium, fontSize: 15 },
  modeTextOn: { color: colours.gold },
  entry: { flexDirection: 'row', gap: 6 },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: colours.control,
    color: colours.white,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  save: { justifyContent: 'center', paddingHorizontal: 20, backgroundColor: colours.gold },
  saveOff: { opacity: 0.4 },
  saveText: { color: colours.ink, fontFamily: fonts.bold, fontSize: 15 },
  remove: { alignSelf: 'flex-start', paddingVertical: 4 },
  removeText: { color: colours.danger, fontFamily: fonts.medium, fontSize: 14 },
});
