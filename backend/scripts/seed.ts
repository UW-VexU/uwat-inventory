/**
 * Fills a dev database with about 300 made-up parts, so the UI can be tried at real scale.
 * Run with: npm run db:seed -- --reset
 */
import { parseDescription } from '@uwat/shared';
import { prisma } from '../src/db';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The seed data is fake. Refusing to run in production.');
}

let randomState = 20261105;
function random() {
  randomState = (randomState * 1664525 + 1013904223) % 4294967296;
  return randomState / 4294967296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

const resistorValues = ['0', '10', '22', '33', '47', '100', '220', '330', '470', '680', '1K', '2.2K', '3.3K', '4.7K', '5.1K', '10K', '20K', '47K', '100K', '1M'];
const capacitorValues = ['10PF', '22PF', '100PF', '1000PF', '4700PF', '0.01UF', '0.047UF', '0.1UF', '0.22UF', '0.47UF', '1UF', '2.2UF', '4.7UF', '10UF', '22UF'];

const descriptions: string[] = [
  'IC OPAMP GP 4 CIRCUIT 14SOIC',
  ...resistorValues.flatMap((value) => ['0402', '0603', '0805'].map((size) => `RES ${value} OHM 1% 1/10W ${size}`)),
  ...capacitorValues.flatMap((value) => ['0402', '0603', '0805', '1206'].map((size) => `CAP CER ${value} 50V X7R ${size}`)),
  'CAP ALUM 100UF 20% 25V SMD', 'CAP ALUM 470UF 20% 16V RADIAL', 'CAP TANT 10UF 10% 16V 1206', 'CAP TANT 47UF 20% 10V 1210',
  'IC MCU 32BIT 1MB FLASH 100LQFP', 'IC MCU 32BIT 512KB FLASH 64LQFP', 'IC MCU 32BIT 128KB FLASH 48LQFP', 'IC MCU 32BIT 256KB FLASH 32QFN',
  'IC REG LINEAR 3.3V 1A SOT223', 'IC REG LINEAR 5V 1A SOT223', 'IC REG LINEAR 1.8V 300MA SOT23-5', 'IC REG BUCK ADJ 3A 8SOIC', 'IC REG BUCK 5V 2A 8SOIC', 'IC REG BOOST ADJ 2A 10MSOP',
  'IC OPAMP GP 2 CIRCUIT 8SOIC', 'IC OPAMP ZERO-DRIFT 1 CIRCUIT SOT23-5', 'IC COMPARATOR 2 GEN PUR 8SOIC', 'IC CURRENT SENSE 1 CIRCUIT 8SOIC',
  'IC TRANSCEIVER HALF 1/1 8SOIC', 'IC TRANSCEIVER CAN 1/1 8SOIC', 'IC RS485 TRANSCEIVER 8SOIC', 'IC USB TO UART BRIDGE 28QFN', 'IC USB POWER DELIVERY 24QFN',
  'IC GATE DRIVER HALF BRIDGE 8SOIC', 'IC MOTOR DRIVER 8V-45V 28TSSOP', 'IC BATT MON LI-ION 6-16CELL 64LQFP', 'IC BATT PROT LI-ION 1CELL 6DFN', 'IC BATTERY CHARGER LI-ION 16QFN',
  'IC EEPROM 256KBIT I2C 8SOIC', 'IC FLASH 128MBIT SPI 8SOIC', 'IC LOGIC LEVEL TRANSLATOR 14TSSOP', 'IC BUFFER NON-INVERT 8TSSOP', 'IC ADC 16BIT SIGMA-DELTA 10MSOP', 'IC DAC 12BIT V-OUT 8MSOP', 'IC RTC CLK/CALENDAR I2C 8SOIC', 'IC SUPERVISOR 1 CHANNEL SOT23-3', 'IC ISOLATOR DIGITAL 2CH 8SOIC', 'IC MUX 8:1 16TSSOP',
  'CONN HEADER VERT 2POS 2.54MM', 'CONN HEADER VERT 3POS 2.54MM', 'CONN HEADER VERT 4POS 2.54MM', 'CONN HEADER VERT 6POS 2.54MM', 'CONN HEADER VERT 10POS 2.54MM', 'CONN HEADER R/A 4POS 2.54MM', 'CONN HEADER SMD 10POS 1.27MM', 'CONN HEADER SMD 6POS 1MM',
  'CONN RCPT USB-C 24POS SMD', 'CONN RCPT USB-A 4POS R/A', 'CONN RCPT MICRO USB B 5POS SMD', 'CONN JST PH HDR 2POS 2MM', 'CONN JST PH HDR 3POS 2MM', 'CONN JST PH HDR 4POS 2MM', 'CONN JST GH HDR 4POS 1.25MM', 'CONN JST SH HDR 4POS 1MM', 'CONN MOLEX PICOBLADE HDR 4POS', 'CONN XT30 PCB MALE', 'CONN XT60 PCB FEMALE', 'CONN SMA JACK STR PCB', 'CONN RJ11 JACK 6P4C R/A', 'CONN FFC FPC 10POS 0.5MM SMD', 'CONN CRIMP TERMINAL JST PH 28AWG', 'TERM BLK 2P SIDE ENT 5.08MM PCB', 'TERM BLK 3P SIDE ENT 3.5MM PCB', 'TERM BLK 4P SIDE ENT 3.5MM PCB',
  'LED GREEN CLEAR 0603 SMD', 'LED RED CLEAR 0603 SMD', 'LED BLUE CLEAR 0603 SMD', 'LED AMBER CLEAR 0603 SMD', 'LED WHITE CLEAR 0805 SMD', 'LED RGB CLEAR 1210 SMD', 'LED GREEN DIFFUSED 3MM T/H', 'LED RED DIFFUSED 5MM T/H',
  'DIODE SCHOTTKY 40V 1A SOD123', 'DIODE SCHOTTKY 30V 200MA SOD323', 'DIODE SCHOTTKY 60V 3A SMA', 'DIODE GEN PURP 100V 200MA SOD123', 'DIODE GEN PURP 400V 1A SMA', 'DIODE ZENER 3.3V 500MW SOD123', 'DIODE ZENER 5.1V 500MW SOD123', 'DIODE ZENER 12V 500MW SOD123', 'BRIDGE RECT 1PHASE 100V 1A 4SOIC',
  'TVS DIODE 5VWM 9.2VC SOD323', 'TVS DIODE 12VWM 19.9VC SMA', 'TVS DIODE 24VWM 38.9VC SMB', 'ESD SUPPRESSOR 5V USB 6SOT', 'PTC RESET FUSE 6V 500MA 1206', 'PTC RESET FUSE 16V 1.1A 1812', 'FUSE BOARD MNT 2A 32VAC 63VDC 0603', 'FUSE BOARD MNT 5A 32VAC 1206', 'VARISTOR 18V 250A 0805',
  'MOSFET N-CH 30V 5.8A SOT23-3', 'MOSFET N-CH 60V 300MA SOT23-3', 'MOSFET P-CH 30V 4.2A SOT23-3', 'MOSFET P-CH 20V 2.4A SOT23-3', 'MOSFET N-CH 40V 100A 8SOIC', 'MOSFET N-CH 100V 60A TO220', 'MOSFET 2N-CH 30V 6A 8SOIC', 'TRANS NPN 40V 0.2A SOT-23', 'TRANS PNP 40V 0.2A SOT-23', 'TRANS NPN 45V 0.1A SOT-23', 'TRANS NPN DARL 60V 4A TO220',
  'FIXED IND 10UH 1A 200 MOHM SMD', 'FIXED IND 4.7UH 2.2A 80 MOHM SMD', 'FIXED IND 22UH 800MA 350 MOHM SMD', 'FIXED IND 100UH 300MA 1.5 OHM 1210', 'FIXED IND 2.2UH 3A 40 MOHM SMD', 'FERRITE BEAD 600 OHM 0603 1LN', 'FERRITE BEAD 120 OHM 0805 1LN', 'FERRITE BEAD 1K OHM 0402 1LN', 'COMMON MODE CHOKE 90 OHM 0805',
  'CRYSTAL 16.0000MHZ 18PF SMD', 'CRYSTAL 8.0000MHZ 12PF SMD', 'CRYSTAL 25.0000MHZ 10PF SMD', 'CRYSTAL 32.7680KHZ 7PF SMD', 'XTAL OSC XO 48.0000MHZ CMOS SMD', 'RESONATOR 8MHZ 15PF SMD',
  'SWITCH TACTILE SPST-NO 0.05A 12V', 'SWITCH TACTILE SPST-NO 0.02A 15V', 'SWITCH SLIDE SPDT 300MA 6V', 'SWITCH DIP 4POS SPST 25MA', 'SWITCH PUSHBUTTON SPST-NO 3A 125V', 'RELAY GEN PURPOSE SPDT 5A 5V',
  'SENSOR HALL ANALOG SOT23-3', 'SENSOR HALL DIGITAL SOT23-3', 'SENSOR TEMP I2C 8SOIC', 'SENSOR TOF DISTANCE I2C 12LGA', 'SENSOR ANGLE 12BIT I2C 8SOIC', 'SENSOR CURRENT HALL 20A AC/DC 8SOIC', 'SENSOR OPTICAL QRD REFLECTIVE', 'ACCEL/GYRO 6-AXIS I2C SPI 14LGA', 'ACCEL 3-AXIS I2C SPI 12LGA', 'MAGNETOMETER 3-AXIS I2C 12LGA', 'ENCODER ROTARY 24PPR VERT',
  'WIRE 22AWG STRANDED 100FT', 'HEATSHRINK 3MM BLACK 1M', 'SOLDER PASTE SYRINGE 5CC', 'STANDOFF M3 10MM NYLON',
];

const projects = ['BMS/EMBEDDED', 'BMS/EMBEDDED', 'ODOM BOARD', 'CENTURION', 'LOCALIZATION', 'SPARES', null, null, null];
const prefixes = ['311', '399', '296', '1276', '732', '497', '568', '445', '587', '160'];

async function main() {
  const existing = await prisma.part.count();
  if (existing > 0 && !process.argv.includes('--reset')) {
    throw new Error('The database already has parts. Pass --reset to replace them with sample data.');
  }
  await prisma.$executeRawUnsafe('TRUNCATE "StockEvent", "Bag", "Part", "Box" CASCADE');

  const users = await Promise.all(
    ['connor', 'eason', 'priya'].map((login, index) =>
      prisma.user.upsert({
        where: { githubId: -1000 - index },
        create: { githubId: -1000 - index, login, name: login[0]?.toUpperCase() + login.slice(1) },
        update: {},
      }),
    ),
  );

  const boxes = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      prisma.box.create({ data: { code: `B-${String(index + 1).padStart(2, '0')}` } }),
    ),
  );

  let added = 0;
  for (const [index, description] of descriptions.entries()) {
    const parsed = parseDescription(description);
    const partNumber =
      index === 0 ? 'LM323M-ND' : `${pick(prefixes)}-${1000 + Math.floor(random() * 88999)}-${pick(['1', '2', '6'])}-ND`;
    const passive = parsed.category === 'Resistors' || parsed.category === 'Capacitors';
    const part = await prisma.part.create({
      data: {
        partNumber,
        description,
        category: parsed.category,
        package: parsed.package,
        minQty: random() < 0.25 ? (passive ? 50 : 5) : null,
      },
    });

    const bagCount = random() < 0.12 ? 2 : 1;
    for (let bagIndex = 0; bagIndex < bagCount; bagIndex += 1) {
      const quantity =
        index === 0 ? 5 : random() < 0.05 ? 0 : Math.floor(random() * (passive ? 900 : 40)) + 1;
      const box = random() < 0.03 ? null : pick(boxes);
      const bag = await prisma.bag.create({
        data: { partId: part.id, boxId: box?.id ?? null, quantity, project: index === 0 ? 'BMS/EMBEDDED' : pick(projects) },
      });
      await prisma.stockEvent.create({
        data: {
          type: 'INTAKE',
          bagId: bag.id,
          partId: part.id,
          userId: pick(users).id,
          delta: quantity,
          quantityAfter: quantity,
          boxCode: box?.code ?? null,
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * (72 + Math.floor(random() * 300))),
        },
      });
      added += 1;

      if (quantity > 6 && random() < 0.08) {
        const amount = 1 + Math.floor(random() * 5);
        await prisma.bag.update({ where: { id: bag.id }, data: { quantity: quantity - amount } });
        await prisma.stockEvent.create({
          data: {
            type: 'TAKE',
            bagId: bag.id,
            partId: part.id,
            userId: pick(users).id,
            delta: -amount,
            quantityAfter: quantity - amount,
            boxCode: box?.code ?? null,
            note: pick([null, 'Odom board rev C', 'BMS rework', 'Centurion prototype']),
            createdAt: new Date(Date.now() - 1000 * 60 * (5 + Math.floor(random() * 2800))),
          },
        });
      }
    }
  }
  console.log(`Seeded ${descriptions.length} parts, ${added} bags and ${boxes.length} boxes.`);
}

await main();
await prisma.$disconnect();
