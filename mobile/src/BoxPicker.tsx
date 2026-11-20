import type { BoxSummary } from '@uwat/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './api';
import { colours, fonts } from './theme';

interface Props {
  visible: boolean;
  /** Marks the box that's chosen now. */
  chosenId?: string | null;
  /** Under the title, to say what the box is for. */
  hint?: string;
  onPick: (box: BoxSummary) => void;
  onClose: () => void;
}

/**
 * The team's boxes, freshly loaded each time it opens. It has no camera of its own, so it
 * never competes with a camera on the screen behind it.
 */
export function BoxPicker({ visible, chosenId = null, hint, onPick, onClose }: Props) {
  const [boxes, setBoxes] = useState<BoxSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setProblem(null);
    api<{ boxes: BoxSummary[] }>('/api/boxes')
      .then((result) => setBoxes(result.boxes))
      .catch((error: Error) => setProblem(error.message));
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['bottom', 'left', 'right']}>
        <View style={styles.bar}>
          <Text style={styles.title}>Pick a box</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={styles.link}>Close</Text>
          </Pressable>
        </View>
        {hint ? <Text style={[styles.note, styles.padded]}>{hint}</Text> : null}
        {problem ? <Text style={[styles.problem, styles.padded]}>{problem}</Text> : null}
        {!boxes && !problem ? <ActivityIndicator color={colours.gold} style={styles.padded} /> : null}
        {boxes?.length === 0 ? <Text style={[styles.note, styles.padded]}>No boxes yet. Add them under Boxes on the website.</Text> : null}
        <FlatList
          data={boxes ?? []}
          keyExtractor={(box) => box.id}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, item.id === chosenId && styles.rowOn]}
              onPress={() => onPick(item)}
              accessibilityRole="button"
              accessibilityState={{ selected: item.id === chosenId }}
            >
              <Text style={styles.code}>{item.code}</Text>
              <Text style={styles.label} numberOfLines={1}>
                {item.label ?? ''}
              </Text>
              <Text style={styles.count}>
                {item.bagCount} {item.bagCount === 1 ? 'bag' : 'bags'}
              </Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colours.ink },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  title: { color: colours.white, fontFamily: fonts.display, fontSize: 22 },
  link: { color: colours.gold, fontFamily: fonts.bold, fontSize: 15 },
  padded: { paddingHorizontal: 16, marginBottom: 10 },
  note: { color: colours.muted, fontFamily: fonts.body, fontSize: 14 },
  problem: { color: colours.danger, fontFamily: fonts.body, fontSize: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.raised,
  },
  rowOn: { borderColor: colours.gold },
  code: { color: colours.gold, fontFamily: fonts.display, fontSize: 20 },
  label: { flex: 1, color: colours.text, fontFamily: fonts.body, fontSize: 15 },
  count: { color: colours.faint, fontFamily: fonts.body, fontSize: 13 },
});
