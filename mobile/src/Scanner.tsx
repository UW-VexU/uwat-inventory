import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Device from 'expo-device';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { canScanPhotos, LabelScannerView, liveScanSupported, scanPhoto, type ScannedCode } from '../modules/label-scanner';
import { colours, fonts } from './theme';

/** The camera sees the same label many times a second, so hold off before reading it again. */
const REPEAT_HOLD_MS = 2500;
const CLOSE_UP_ZOOM = 0.2;

interface Props {
  /** Whether a code means anything here. Anything else only earns a passing hint. */
  accepts: (raw: string) => boolean;
  onScan: (raw: string) => void;
  /** Shown when the camera is off, to say what it's for. */
  purpose: string;
  /** Shown briefly when the camera reads a code that `accepts` turns down. */
  wrongCode: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The camera with its tools: Apple's live scanner where the phone has it, expo-camera
 * otherwise, plus reading a photo, the light and a close-up zoom.
 */
export function Scanner({ accepts, onScan, purpose, wrongCode, style }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [live, setLive] = useState<boolean | null>(null);
  const [torch, setTorch] = useState(false);
  const [closeUp, setCloseUp] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef({ code: '', at: 0 });

  useEffect(() => {
    liveScanSupported()
      .then(setLive)
      .catch(() => setLive(false));
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, []);

  const flash = (text: string) => {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), REPEAT_HOLD_MS);
  };

  const onCode = ({ data }: ScannedCode) => {
    const now = Date.now();
    if (data === last.current.code && now - last.current.at < REPEAT_HOLD_MS) return;
    last.current = { code: data, at: now };
    if (accepts(data)) onScan(data);
    else flash(wrongCode);
  };

  const onPhoto = async () => {
    let codes: ScannedCode[] | null;
    try {
      codes = await scanPhoto();
    } catch (error) {
      flash((error as Error).message);
      return;
    }
    if (codes === null) return;
    // A photo of a bag can catch its other barcodes too. Use the one that means something here.
    const best = codes.find((code) => accepts(code.data));
    if (best) onScan(best.data);
    else flash(codes.length > 0 ? wrongCode : 'No label code in that photo.');
  };

  const photoButton = canScanPhotos ? (
    <Pressable style={styles.tool} onPress={() => void onPhoto()} accessibilityRole="button" accessibilityLabel="Scan a photo">
      <Text style={styles.toolText}>Photo</Text>
    </Pressable>
  ) : null;

  if (!Device.isDevice) {
    return (
      <View style={[styles.camera, styles.centre, style]}>
        <Text style={styles.note}>The simulator has no camera. Scan a photo of a label instead.</Text>
        {photoButton}
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    );
  }

  if (!permission?.granted) {
    const blocked = permission !== null && !permission.canAskAgain;
    return (
      <View style={[styles.camera, styles.centre, style]}>
        <Text style={styles.note}>{blocked ? 'Camera access is off for this app. Turn it on in Settings.' : purpose}</Text>
        <Pressable
          style={styles.button}
          // iOS only asks once. After a "Don't Allow", Settings is the only way back.
          onPress={() => void (blocked ? Linking.openSettings() : requestPermission())}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>{blocked ? 'Open Settings' : 'Turn on camera'}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.camera, style]}>
      {live === null ? null : live && LabelScannerView ? (
        <LabelScannerView
          style={StyleSheet.absoluteFill}
          torch={torch}
          zoomed={closeUp}
          onCode={({ nativeEvent }) => onCode(nativeEvent)}
          onProblem={({ nativeEvent }) => setProblem(nativeEvent.message)}
        />
      ) : (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          autofocus="on"
          enableTorch={torch}
          zoom={closeUp ? CLOSE_UP_ZOOM : 0}
          // Square codes only. A bag's two long barcodes never hold the part. Box labels are QR.
          barcodeScannerSettings={{ barcodeTypes: ['datamatrix', 'qr'] }}
          onBarcodeScanned={({ data, type }) => onCode({ data, type })}
          onMountError={({ message }) => setProblem(message)}
        />
      )}
      {live ? null : <View style={styles.reticle} pointerEvents="none" />}
      <View style={styles.tools}>
        {photoButton}
        <Pressable style={[styles.tool, torch && styles.toolOn]} onPress={() => setTorch((on) => !on)} accessibilityRole="button">
          <Text style={[styles.toolText, torch && styles.toolTextOn]}>Light</Text>
        </Pressable>
        <Pressable style={[styles.tool, closeUp && styles.toolOn]} onPress={() => setCloseUp((on) => !on)} accessibilityRole="button">
          <Text style={[styles.toolText, closeUp && styles.toolTextOn]}>Zoom</Text>
        </Pressable>
      </View>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
      {hint ? (
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { backgroundColor: '#000' },
  centre: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  note: { paddingHorizontal: 28, color: colours.muted, fontFamily: fonts.body, fontSize: 15, textAlign: 'center' },
  button: { paddingHorizontal: 18, paddingVertical: 11, backgroundColor: colours.gold },
  buttonText: { color: colours.ink, fontFamily: fonts.bold, fontSize: 15 },
  reticle: {
    position: 'absolute',
    alignSelf: 'center',
    top: '10%',
    height: '70%',
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: colours.gold,
  },
  tools: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 6 },
  tool: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(0,0,0,0.65)' },
  toolOn: { backgroundColor: colours.gold },
  toolText: { color: colours.white, fontFamily: fonts.medium, fontSize: 14 },
  toolTextOn: { color: colours.ink },
  problem: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    color: colours.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  hint: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    maxWidth: '45%',
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.75)',
    color: colours.white,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
});
