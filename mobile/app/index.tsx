import type { BoardSummary } from '@uwat/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../src/api';
import { useSession } from '../src/session';
import { colours, fonts } from '../src/theme';

export default function Home() {
  const { ready, signedIn } = useSession();
  if (!ready) return <View style={styles.screen} />;
  return signedIn ? <Boards /> : <SignIn />;
}

function SignIn() {
  const { server, signIn } = useSession();
  const [address, setAddress] = useState(server);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await signIn(address.trim(), name.trim());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Sign-in failed.');
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.signIn} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Image source={require('../assets/logo-white.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="UWAT" />
        <Text style={styles.team}>VEXU Competitive Robotics</Text>
        <Text style={styles.heading}>Parts inventory</Text>

        <Text style={styles.label}>Server</Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://10.0.0.5:2211"
          placeholderTextColor={colours.faint}
        />
        <Text style={styles.label}>Your name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="connor"
          placeholderTextColor={colours.faint}
        />
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}
        <Pressable
          style={[styles.button, (busy || !name.trim() || !address.trim()) && styles.buttonOff]}
          disabled={busy || !name.trim() || !address.trim()}
          onPress={() => void submit()}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Boards() {
  const { signOut } = useSession();
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    setProblem(null);
    try {
      setBoards((await api<{ boards: BoardSummary[] }>('/api/boards')).boards);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't load boards.");
    }
  }, []);

  // Again on coming back from a board, since scanning there changes what's in stock.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.bar}>
        <Image source={require('../assets/logo-white.png')} style={styles.barLogo} resizeMode="contain" accessibilityLabel="UWAT" />
        <Pressable onPress={() => void signOut()} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.link}>Sign out</Text>
        </Pressable>
      </View>
      <Text style={styles.pick}>Which board are you building?</Text>

      {problem ? (
        <View style={styles.padded}>
          <Text style={styles.problem}>{problem}</Text>
          <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {!boards && !problem ? <ActivityIndicator color={colours.gold} style={styles.padded} /> : null}
      {boards?.length === 0 ? <Text style={[styles.note, styles.padded]}>No boards yet. Upload one from the website.</Text> : null}

      <FlatList
        data={boards ?? []}
        keyExtractor={(board) => board.id}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/board/${item.id}`)} accessibilityRole="button">
            <Text style={styles.cardName}>
              {item.name}
              {item.revision ? <Text style={styles.cardRev}> rev {item.revision}</Text> : null}
            </Text>
            <Text style={styles.note}>
              {item.placedCount} of {item.lineCount} parts on the board · {item.stockedCount} in stock
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colours.ink },
  signIn: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo: { width: 200, height: 47 },
  team: { marginTop: 8, color: colours.muted, fontFamily: fonts.body, fontStyle: 'italic', fontSize: 15 },
  heading: { marginTop: 22, marginBottom: 18, color: colours.white, fontFamily: fonts.display, fontSize: 28 },
  label: { marginTop: 12, marginBottom: 5, color: colours.muted, fontFamily: fonts.medium, fontSize: 14 },
  input: {
    height: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.control,
    color: colours.white,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  problem: { marginTop: 12, color: colours.danger, fontFamily: fonts.body, fontSize: 14 },
  button: { alignItems: 'center', justifyContent: 'center', height: 48, marginTop: 18, backgroundColor: colours.gold },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: colours.ink, fontFamily: fonts.bold, fontSize: 16 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  barLogo: { width: 110, height: 26 },
  link: { color: colours.gold, fontFamily: fonts.bold, fontSize: 15 },
  pick: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, color: colours.white, fontFamily: fonts.display, fontSize: 24 },
  padded: { paddingHorizontal: 16 },
  note: { color: colours.muted, fontFamily: fonts.body, fontSize: 14 },
  card: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.raised,
  },
  cardName: { color: colours.white, fontFamily: fonts.display, fontSize: 20 },
  cardRev: { color: colours.muted, fontSize: 14 },
});
