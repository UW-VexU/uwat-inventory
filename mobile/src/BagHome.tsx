import type { BoxRef, PartSummary } from '@uwat/shared';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { BoxPicker } from './BoxPicker';
import { colours, fonts } from './theme';

interface Props {
  partId: string;
  bagId: string;
  /** After the bag is filed, so the screen behind can pick up the change. */
  onChanged?: () => void;
}

type Home = { state: 'loading' } | { state: 'known'; box: BoxRef | null } | { state: 'filing' } | { state: 'failed'; message: string };

/**
 * Where a scanned bag lives. A bag in a box gets a reminder of where it goes back; one
 * without a box gets a button to file it, so bags taken out for a board don't end up homeless.
 */
export function BagHome({ partId, bagId, onChanged }: Props) {
  const [home, setHome] = useState<Home>({ state: 'loading' });
  const [picking, setPicking] = useState(false);
  // Only a box chosen here earns the "Filed" wording. A box it already had is just where it goes back.
  const [filed, setFiled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHome({ state: 'loading' });
    setFiled(false);
    api<{ part: PartSummary }>(`/api/parts/${partId}`)
      .then(({ part }) => {
        if (!cancelled) setHome({ state: 'known', box: part.bags.find((bag) => bag.id === bagId)?.box ?? null });
      })
      .catch((error: Error) => !cancelled && setHome({ state: 'failed', message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [partId, bagId]);

  const file = async (boxId: string, code: string) => {
    setPicking(false);
    setHome({ state: 'filing' });
    try {
      await api(`/api/bags/${bagId}`, { method: 'PATCH', body: { boxId } });
      setHome({ state: 'known', box: { id: boxId, code } });
      setFiled(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onChanged?.();
    } catch (error) {
      setHome({ state: 'failed', message: (error as Error).message });
    }
  };

  const chosenId = home.state === 'known' ? (home.box?.id ?? null) : null;

  return (
    <View style={styles.row}>
      {home.state === 'loading' ? null : home.state === 'filing' ? (
        <Text style={styles.text}>Filing…</Text>
      ) : home.state === 'failed' ? (
        <Text style={[styles.text, styles.problem]}>{home.message}</Text>
      ) : home.box ? (
        <Text style={styles.text}>
          {filed ? 'Filed in ' : 'Goes back in '}
          <Text style={styles.code}>{home.box.code}</Text>
        </Text>
      ) : (
        <Text style={styles.text}>Not in a box yet.</Text>
      )}
      {home.state === 'known' || home.state === 'failed' ? (
        <Pressable style={styles.action} onPress={() => setPicking(true)} hitSlop={6} accessibilityRole="button">
          <Text style={styles.actionText}>{home.state === 'known' && home.box ? 'Move' : 'Put in a box'}</Text>
        </Pressable>
      ) : null}
      <BoxPicker
        visible={picking}
        chosenId={chosenId}
        hint="Where does this bag live?"
        onPick={(box) => void file(box.id, box.code)}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6, minHeight: 30 },
  text: { flex: 1, color: colours.text, fontFamily: fonts.medium, fontSize: 15 },
  code: { color: colours.gold, fontFamily: fonts.bold },
  problem: { color: colours.danger, fontFamily: fonts.body, fontSize: 14 },
  action: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colours.gold },
  actionText: { color: colours.gold, fontFamily: fonts.bold, fontSize: 14 },
});
