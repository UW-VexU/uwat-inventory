import { formatRefs, type BoardLine } from '@uwat/shared';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colours, fonts } from './theme';

interface Props {
  visible: boolean;
  lines: readonly BoardLine[];
  found: ReadonlySet<string>;
  onClose: () => void;
  onReset: () => void;
}

export function Checklist({ visible, lines, found, onClose, onReset }: Props) {
  const ordered = [...lines.filter((line) => !found.has(line.key)), ...lines.filter((line) => found.has(line.key))];
  const left = lines.length - lines.filter((line) => found.has(line.key)).length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet}>
        <View style={styles.head}>
          <Text style={styles.title}>{left === 0 ? 'Everything found' : `${left} still to find`}</Text>
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.link}>Done</Text>
          </Pressable>
        </View>
        <FlatList
          data={ordered}
          keyExtractor={(line) => line.key}
          renderItem={({ item }) => {
            const done = found.has(item.key);
            return (
              <View style={styles.row}>
                <Text style={styles.tick}>{done ? '✓' : '□'}</Text>
                <View style={styles.rowText}>
                  <Text style={[styles.value, done && styles.faded]}>{item.value ?? item.partNumber}</Text>
                  <Text style={styles.refs}>{formatRefs(item.refs)}</Text>
                </View>
              </View>
            );
          }}
        />
        <Pressable onPress={onReset} style={styles.reset} accessibilityRole="button">
          <Text style={styles.link}>Start over</Text>
        </Pressable>
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
  link: { color: colours.gold, fontFamily: fonts.bold, fontSize: 16 },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colours.line,
  },
  tick: { width: 18, color: colours.gold, fontSize: 16 },
  rowText: { flex: 1 },
  value: { color: colours.white, fontFamily: fonts.medium, fontSize: 15 },
  faded: { color: colours.faint },
  refs: { color: colours.faint, fontFamily: fonts.body, fontSize: 13 },
  reset: { padding: 16, alignItems: 'center' },
});
