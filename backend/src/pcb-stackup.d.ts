declare module 'pcb-stackup' {
  interface StackupLayer {
    filename: string;
    gerber: string;
  }
  interface StackupSide {
    svg: string;
    viewBox: [number, number, number, number];
    units: 'mm' | 'in';
  }
  interface StackupOptions {
    useOutline?: boolean;
    color?: Record<string, string>;
  }
  export default function stackup(
    layers: StackupLayer[],
    options?: StackupOptions,
  ): Promise<{ top: StackupSide; bottom: StackupSide }>;
}
