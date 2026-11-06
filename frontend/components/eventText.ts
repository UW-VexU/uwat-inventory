import type { StockEventView } from '@uwat/shared';
import { formatNumber } from '@/lib/format';

/** One line in plain words, like "connor took 3 from B-07". */
export function describeEvent(event: StockEventView): string {
  const who = event.user.name ?? event.user.login;
  const amount = formatNumber(Math.abs(event.delta));
  const box = event.boxCode;
  const at = (word: string) => (box ? ` ${word} ${box}` : '');

  switch (event.type) {
    case 'TAKE':
      return `${who} took ${amount}${at('from')}`;
    case 'ADD':
      return `${who} added ${amount}${at('to')}`;
    case 'INTAKE':
      return `${who} added a bag of ${amount}${at('to')}`;
    case 'COUNT':
      if (event.delta === 0) return `${who} counted ${formatNumber(event.quantityAfter)}${at('in')}, no change`;
      return `${who} counted ${formatNumber(event.quantityAfter)}${at('in')} (${event.delta > 0 ? '+' : '−'}${amount})`;
    case 'REMOVE':
      return `${who} removed a bag of ${amount}${at('from')}`;
    case 'MOVE':
      return `${who} moved a bag`;
    case 'UNDO':
      return `${who} undid a change${at('in')}`;
  }
}
