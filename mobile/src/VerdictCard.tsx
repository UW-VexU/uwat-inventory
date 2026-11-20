import { formatRefs, type BoardUse, type ScanVerdict, type StockNote, type TypedPart } from '@uwat/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BagHome } from './BagHome';
import { colours, fonts } from './theme';

export type ScanOutcome =
  | {
      kind: 'judged';
      code: string;
      quantity: number | null;
      verdict: ScanVerdict;
      otherBoards: BoardUse[] | null;
      stock: StockNote | null;
      /** Typed rather than scanned, so it waits for a quantity before going into stock. */
      typed: TypedPart | null;
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
  onStockChanged,
  prompt = null,
  actions = null,
  children,
}: {
  tone: string;
  title: string;
  stock?: StockNote | null;
  onStockChanged?: () => void;
  prompt?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Which box the bag lives in, or a way to file it, once the inventory knows the bag.
  const bag = stock?.state === 'added' || stock?.state === 'already' ? stock : null;
  return (
    <View style={[styles.card, { borderLeftColor: tone }]} accessibilityLiveRegion="polite">
      <Text style={[styles.title, { color: tone }]}>{title}</Text>
      {children}
      {stock ? <StockLine note={stock} /> : null}
      {prompt}
      {bag?.partId && bag.bagId ? <BagHome partId={bag.partId} bagId={bag.bagId} onChanged={onStockChanged} /> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

/** Stands in for the quantity a label would have carried. */
function QuantityPrompt({ onAdd }: { onAdd: (quantity: number) => void }) {
  const [text, setText] = useState('');
  const quantity = /^\d+$/.test(text) && Number(text) > 0 ? Number(text) : null;
  const add = () => {
    if (quantity !== null) onAdd(quantity);
  };
  return (
    <View style={styles.prompt}>
      <TextInput
        style={styles.promptInput}
        value={text}
        onChangeText={(next) => setText(next.replace(/\D/g, ''))}
        keyboardType="number-pad"
        placeholder="How many in this bag?"
        placeholderTextColor={colours.faint}
        accessibilityLabel="How many in this bag?"
        returnKeyType="done"
        onSubmitEditing={add}
        autoFocus
      />
      <Pressable onPress={add} disabled={quantity === null} style={[styles.promptButton, quantity === null && styles.promptOff]} accessibilityRole="button">
        <Text style={styles.promptButtonText}>Add to stock</Text>
      </Pressable>
    </View>
  );
}

function Action({ label, on = false, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.action, on && styles.actionOn]}
      accessibilityRole="button"
      accessibilityState={{ checked: on }}
      hitSlop={4}
    >
      <Text style={[styles.actionText, on && styles.actionTextOn]}>{label}</Text>
    </Pressable>
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

interface Props {
  outcome: ScanOutcome | null;
  onClear: () => void;
  /** Whether this board's part is ticked off as soldered. Null when the card isn't about one. */
  placed?: boolean | null;
  onTogglePlaced?: () => void;
  /** Opens the part's stock, once the inventory knows which part it is. */
  onEditStock?: (() => void) | null;
  /** After the card files the bag into a box. */
  onStockChanged?: () => void;
  /** For a typed number: adds it to stock once its quantity is in. */
  onAddTyped?: ((quantity: number) => void) | null;
}

export function VerdictCard({
  outcome,
  onClear,
  placed = null,
  onTogglePlaced,
  onEditStock = null,
  onStockChanged,
  onAddTyped = null,
}: Props) {
  if (!outcome) return null;
  const editStock = onEditStock ? <Action label="Edit stock" onPress={onEditStock} /> : null;
  // Keyed by the code, so a new typed number starts with an empty box.
  const prompt = onAddTyped && outcome.kind === 'judged' ? <QuantityPrompt key={outcome.code} onAdd={onAddTyped} /> : null;

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
        <Card tone={colours.danger} title="Not for this board" stock={stock} onStockChanged={onStockChanged} prompt={prompt} actions={editStock}>
          <Text style={styles.spots}>{code}</Text>
          <Text style={styles.note}>{otherBoardText(outcome.otherBoards)}</Text>
        </Card>
      );
    }

    const { line } = verdict;
    if (verdict.kind === 'leave-empty') {
      return (
        <Card tone={colours.white} title="Leave this one off" stock={stock} onStockChanged={onStockChanged} prompt={prompt} actions={editStock}>
          <Text style={styles.value}>{line.value ?? code}</Text>
          <Text style={styles.note}>The BOM says do not populate {formatRefs(line.refs)}.</Text>
        </Card>
      );
    }

    return (
      <Card
        tone={colours.gold}
        title="Goes on this board"
        stock={stock}
        onStockChanged={onStockChanged}
        prompt={prompt}
        actions={
          <>
            {placed !== null && onTogglePlaced ? (
              <Action label={placed ? '✓ On the board' : 'Mark as on the board'} on={placed} onPress={onTogglePlaced} />
            ) : null}
            {editStock}
          </>
        }
      >
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
    // Not one accessibility element, or iOS would hide the card's own buttons inside it.
    <Pressable onPress={onClear} accessible={false}>
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
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  prompt: { flexDirection: 'row', gap: 6, marginTop: 8 },
  promptInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 10,
    backgroundColor: colours.control,
    color: colours.white,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  promptButton: { justifyContent: 'center', paddingHorizontal: 14, backgroundColor: colours.gold },
  promptOff: { opacity: 0.4 },
  promptButtonText: { color: colours.ink, fontFamily: fonts.bold, fontSize: 14 },
  action: { paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: colours.lineStrong },
  actionOn: { borderColor: colours.gold, backgroundColor: colours.gold },
  actionText: { color: colours.white, fontFamily: fonts.medium, fontSize: 14 },
  actionTextOn: { color: colours.ink, fontFamily: fonts.bold },
});
