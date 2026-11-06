export const CATEGORIES = [
  'Resistors',
  'Capacitors',
  'Inductors',
  'ICs',
  'Diodes',
  'LEDs',
  'Transistors',
  'Connectors',
  'Crystals',
  'Protection',
  'Switches',
  'Sensors',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const EVENT_TYPES = ['TAKE', 'ADD', 'COUNT', 'INTAKE', 'REMOVE', 'MOVE', 'UNDO'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface BoxRef {
  id: string;
  code: string;
}

export interface BagSummary {
  id: string;
  quantity: number;
  box: BoxRef | null;
  project: string | null;
  tagUid: string | null;
  updatedAt: string;
}

export interface PartSummary {
  id: string;
  partNumber: string | null;
  mfrPartNumber: string | null;
  description: string;
  category: string;
  package: string | null;
  minQty: number | null;
  notes: string | null;
  total: number;
  bags: BagSummary[];
  usedOn: BoardUse[];
  updatedAt: string;
}

/** The spots this part fills on one board. */
export interface BoardUse {
  boardId: string;
  boardName: string;
  revision: string;
  refs: string[];
}

export interface BoxSummary {
  id: string;
  code: string;
  label: string | null;
  bagCount: number;
}

export interface InventorySnapshot {
  parts: PartSummary[];
  boxes: BoxSummary[];
  generatedAt: string;
}

export interface CurrentUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface StockEventView {
  id: string;
  type: EventType;
  delta: number;
  quantityAfter: number;
  note: string | null;
  createdAt: string;
  user: { login: string; name: string | null; avatarUrl: string | null };
  part: { id: string; partNumber: string | null; description: string };
  bagId: string;
  boxCode: string | null;
  undoOfId: string | null;
  undone: boolean;
  canUndo: boolean;
}

export type StockStatus = 'ok' | 'low' | 'out';

export function stockStatus(part: Pick<PartSummary, 'total' | 'minQty'>): StockStatus {
  if (part.total <= 0) return 'out';
  if (part.minQty !== null && part.total <= part.minQty) return 'low';
  return 'ok';
}
