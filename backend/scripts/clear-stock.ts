/**
 * Empties the inventory: every part, bag and stock change. Boards, boxes and people stay,
 * and board spots go back to waiting for their parts, so they link up again as bags are scanned.
 * Run with: npm run db:clear-stock -- --yes
 */
import { prisma } from '../src/db';

if (!process.argv.includes('--yes')) {
  throw new Error('This deletes every part, bag and stock change. Pass --yes to go ahead.');
}

const [events, bags, parts] = await prisma.$transaction([
  prisma.stockEvent.deleteMany(),
  prisma.bag.deleteMany(),
  prisma.part.deleteMany(),
]);
console.log(`Removed ${parts.count} parts, ${bags.count} bags and ${events.count} stock changes.`);
await prisma.$disconnect();
