import { formatRefs, type BoardUse, type ScanVerdict, type StockNote } from '@uwat/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colours, fonts } from './theme';

export type ScanOutcome =
  | {
      kind: 'judged';
      code: string;
      quantity: number | null;
      verdict: ScanVerdict;
      otherBoards: BoardUse[] | null;
      stock: StockNote | null;
    }
  | { kind: 'unreadable'; raw: string }
  // A photo with no square code in it, or one the phone couldn't open.
  | { kind: 'no-code'; reason: string | null };

const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`;

function otherBoardText(boards: BoardUse[] | null): string {
  if (boards === null) return 'Checking other boards…';
  if (boards.length === 0) return 'Not on any other board.';
  return boards.map((use) => `Goes on ${use.boardName}: ${formatRefs(use.refs)}`).join('. ');
}

function Card({
  tone,
  title,
  stock = null,
  children,
}: {
  tone: string;
  title: string;
  stock?: StockNote | null;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { borderLeftColor: tone }]} accessibilityLiveRegion="polite">
      <Text style={[styles.title, { color: tone }]}>{title}</Text>
      {children}
      {stock ? <StockLine note={stock} /> : null}
    </View>
  );
}

function StockLine({ note }: { note: StockNote }) {
  const [tone, text] = (() => {
    switch (note.state) {
      case 'adding':
        return [colours.muted, 'Adding to stock…'];
      case 'added':
        return [colours.gold, `Added to stock. ${note.total} in stock now.`];
      case 'already':
        return [colours.muted, 'Already added to stock.'];
      case 'failed':
        return [colours.danger, `Not added to stock. ${note.message}`];
    }
  })();
  return <Text style={[styles.stock, { color: tone }]}>{text}</Text>;
}

export function VerdictCard({ outcome, onClear }: { outcome: ScanOutcome | null; onClear: () => void }) {
  if (!outcome) return null;

  const body = (() => {
    if (outcome.kind === 'no-code') {
      return (
        <Card tone={colours.white} title="No label code in that photo">
          <Text style={styles.note}>
            {outcome.reason ?? 'Take it again with the square code flat, sharp and filling more of the picture.'}
          </Text>
        </Card>
      );
    }
    if (outcome.kind === 'unreadable') {
      return (
        <Card tone={colours.white} title="Not a parts label">
          <Text style={styles.note} numberOfLines={3}>
            {outcome.raw}
          </Text>
        </Card>
      );
    }

    const { verdict, code, quantity, stock } = outcome;
    if (verdict.kind === 'not-here') {
      return (
        <Card tone={colours.danger} title="Not for this board" stock={stock}>
          <Text style={styles.spots}>{code}</Text>
          <Text style={styles.note}>{otherBoardText(outcome.otherBoards)}</Text>
        </Card>
      );
    }

    const { line } = verdict;
    if (verdict.kind === 'leave-empty') {
      return (
        <Card tone={colours.white} title="Leave this one off" stock={stock}>
          <Text style={styles.value}>{line.value ?? code}</Text>
          <Text style={styles.note}>The BOM says do not populate {formatRefs(line.refs)}.</Text>
        </Card>
      );
    }

    return (
      <Card tone={colours.gold} title="Goes on this board" stock={stock}>
        <Text style={styles.value}>{line.value ?? code}</Text>
        {line.description ? (
          <Text style={styles.note} numberOfLines={2}>
            {line.description}
          </Text>
        ) : null}
        <Text style={styles.spots}>
          {count(line.refs.length, 'spot')}: {formatRefs(line.refs)}
        </Text>
        {quantity !== null && quantity < line.refs.length ? (
          <Text style={styles.note}>Only {quantity} in this bag, not enough for one board.</Text>
        ) : null}
      </Card>
    );
  })();

  return (
    <Pressable onPress={onClear} accessibilityHint="Clears this result">
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 14, paddingVertical: 10, borderLeftWidth: 6, backgroundColor: colours.raised },
  title: { fontFamily: fonts.display, fontSize: 22 },
  value: { marginTop: 2, color: colours.white, fontFamily: fonts.display, fontSize: 17 },
  spots: { marginTop: 3, color: colours.white, fontFamily: fonts.bold, fontSize: 15 },
  note: { color: colours.muted, fontFamily: fonts.body, fontSize: 14 },
  stock: { marginTop: 6, fontFamily: fonts.bold, fontSize: 14 },
});
