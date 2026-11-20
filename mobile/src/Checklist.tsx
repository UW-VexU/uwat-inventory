import { formatRefs, lineStatus, type BoardLine, type LineStatus } from '@uwat/shared';
import { useState } from 'react';
import { Modal, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PartSheet } from './PartSheet';
import { colours, fonts } from './theme';

interface Props {
  visible: boolean;
  lines: readonly BoardLine[];
  onClose: () => void;
  onTogglePlaced: (line: BoardLine) => void;
  /** After stock changes in the part sheet, so the board can reload its numbers. */
  onStockChanged: () => void;
}

const SECTIONS: ReadonlyArray<{ status: LineStatus; title: string }> = [
  { status: 'needed', title: 'Still needed' },
  { status: 'in-stock', title: 'In stock, not on the board yet' },
  { status: 'placed', title: 'On the board' },
];

/**
 * The board's parts, by where they stand. The box on the left ticks a part off as soldered,
 * for every phone and computer. Tapping the rest of a row opens its stock.
 */
export function Checklist({ visible, lines, onClose, onTogglePlaced, onStockChanged }: Props) {
  // Lives inside this modal: iOS won't stack a second sheet from outside it.
  const [partId, setPartId] = useState<string | null>(null);
  const placed = lines.filter((line) => line.placed).length;
  const stocked = lines.filter((line) => lineStatus(line) === 'in-stock').length;
  const needed = lines.length - placed - stocked;
  const sections = SECTIONS.map(({ status, title }) => ({
    title,
    data: lines.filter((line) => lineStatus(line) === status),
  })).filter((section) => section.data.length > 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.head}>
          <View>
            <Text style={styles.title}>
              {placed} of {lines.length} on the board
            </Text>
            <Text style={styles.subtitle}>
              {stocked} in stock to fit · {needed} still needed
            </Text>
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.link}>Done</Text>
          </Pressable>
        </View>
        <SectionList
          sections={sections}
          keyExtractor={(line) => line.key}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Pressable
                onPress={() => onTogglePlaced(item)}
                style={[styles.box, item.placed && styles.boxOn]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.placed }}
                accessibilityLabel={`${item.value ?? item.partNumber} on the board`}
                hitSlop={10}
              >
                <Text style={styles.boxTick}>{item.placed ? '✓' : ''}</Text>
              </Pressable>
              <Pressable
                style={styles.rowText}
                onPress={() => (item.partId ? setPartId(item.partId) : undefined)}
                disabled={!item.partId}
                accessibilityRole="button"
                accessibilityHint={item.partId ? 'Opens its stock' : undefined}
              >
                <Text style={[styles.value, item.placed && styles.faded]}>{item.value ?? item.partNumber}</Text>
                <Text style={styles.refs}>
                  {formatRefs(item.refs)}
                  {item.stock > 0 ? `  ·  ${item.stock} in stock` : '  ·  none in stock'}
                </Text>
              </Pressable>
              {item.partId ? <Text style={styles.chevron}>›</Text> : null}
            </View>
          )}
        />
        <PartSheet partId={partId} onClose={() => setPartId(null)} onChanged={onStockChanged} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colours.ink },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  title: { color: colours.white, fontFamily: fonts.display, fontSize: 20 },
  subtitle: { marginTop: 2, color: colours.muted, fontFamily: fonts.body, fontSize: 14 },
  link: { color: colours.gold, fontFamily: fonts.bold, fontSize: 16 },
  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    color: colours.gold,
    fontFamily: fonts.bold,
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  box: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colours.lineStrong,
  },
  boxOn: { borderColor: colours.gold, backgroundColor: colours.gold },
  boxTick: { color: colours.ink, fontFamily: fonts.bold, fontSize: 16 },
  rowText: { flex: 1 },
  value: { color: colours.white, fontFamily: fonts.medium, fontSize: 15 },
  faded: { color: colours.faint },
  refs: { color: colours.faint, fontFamily: fonts.body, fontSize: 13 },
  chevron: { color: colours.faint, fontFamily: fonts.body, fontSize: 22 },
});
