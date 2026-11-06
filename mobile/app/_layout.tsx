import { Barlow_400Regular, Barlow_500Medium, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { ChakraPetch_700Bold_Italic } from '@expo-google-fonts/chakra-petch';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SessionProvider } from '../src/session';
import { colours } from '../src/theme';

export default function RootLayout() {
  const [fontsReady] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_700Bold,
    ChakraPetch_700Bold_Italic,
  });

  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: colours.ink }} />;

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colours.ink } }} />
    </SessionProvider>
  );
}
