import { unzipSync, strFromU8 } from 'fflate';

export interface GerberText {
  name: string;
  text: string;
}

const LAYER_FILE = /\.(gbr|gtl|gbl|gto|gbo|gts|gbs|gtp|gbp|gm\d*|gko|gml|drl|xln|exc)$/i;

/** Accepts loose gerber files, a whole folder, or the zip that goes to the fab house. */
export async function readGerberFiles(files: readonly File[]): Promise<GerberText[]> {
  const read = await Promise.all(
    files.map(async (file): Promise<GerberText[]> => {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
        return Object.entries(entries)
          .filter(([name]) => LAYER_FILE.test(name) && !name.startsWith('__MACOSX'))
          .map(([name, bytes]) => ({ name: name.split('/').at(-1) ?? name, text: strFromU8(bytes) }));
      }
      return LAYER_FILE.test(file.name) ? [{ name: file.name, text: await file.text() }] : [];
    }),
  );
  return read.flat();
}
