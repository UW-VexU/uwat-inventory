import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export interface ScannedCode {
  data: string;
  type: string;
}

interface LabelScannerModule {
  isLiveScanSupported(): Promise<boolean>;
  scanPhoto(): Promise<ScannedCode[] | null>;
}

export interface LabelScannerViewProps extends ViewProps {
  torch: boolean;
  zoomed: boolean;
  onCode: (event: NativeSyntheticEvent<ScannedCode>) => void;
  onProblem: (event: NativeSyntheticEvent<{ message: string }>) => void;
}

/** Only built for iOS. Android keeps expo-camera, whose ML Kit reader handles these labels. */
const native = requireOptionalNativeModule<LabelScannerModule>('LabelScanner');

export const LabelScannerView: ComponentType<LabelScannerViewProps> | null = native
  ? requireNativeView<LabelScannerViewProps>('LabelScanner')
  : null;

export const canScanPhotos = native !== null;

/** Apple's live scanner (VisionKit) needs an iPhone XS or newer. */
export async function liveScanSupported(): Promise<boolean> {
  return native ? native.isLiveScanSupported() : false;
}

/** Opens the photo picker and reads every label code in the chosen photo. Null if cancelled. */
export async function scanPhoto(): Promise<ScannedCode[] | null> {
  if (!native) return null;
  return native.scanPhoto();
}
