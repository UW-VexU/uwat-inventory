import { describe, expect, it } from 'vitest';
import { describeBomLine, parseDescription } from '../src/description';

describe('parseDescription', () => {
  it.each([
    ['IC OPAMP GP 4 CIRCUIT 14SOIC', 'ICs', 'SOIC-14'],
    ['RES 10K OHM 1% 1/10W 0603', 'Resistors', '0603'],
    ['RES SMD 4.7K OHM 5% 1/8W 0805', 'Resistors', '0805'],
    ['CAP CER 0.1UF 50V X7R 0603', 'Capacitors', '0603'],
    ['CAP ALUM 100UF 20% 25V SMD', 'Capacitors', null],
    ['CONN HEADER VERT 2POS 2.54MM', 'Connectors', null],
    ['CONN RCPT USB-C 24POS SMD', 'Connectors', null],
    ['TERM BLK 2P SIDE ENT 5.08MM PCB', 'Connectors', null],
    ['LED GREEN CLEAR 0603 SMD', 'LEDs', '0603'],
    ['DIODE SCHOTTKY 40V 1A SOD123', 'Diodes', 'SOD-123'],
    ['TVS DIODE 5VWM 9.2VC SOD323', 'Protection', 'SOD-323'],
    ['PTC RESET FUSE 6V 500MA 1206', 'Protection', '1206'],
    ['FUSE BOARD MNT 2A 32VAC 63VDC 0603', 'Protection', '0603'],
    ['MOSFET N-CH 30V 5.8A SOT23-3', 'Transistors', 'SOT-23-3'],
    ['TRANS NPN 40V 0.2A SOT-23', 'Transistors', 'SOT-23'],
    ['FIXED IND 10UH 1A 200 MOHM SMD', 'Inductors', null],
    ['FERRITE BEAD 600 OHM 0603 1LN', 'Inductors', '0603'],
    ['CRYSTAL 16.0000MHZ 18PF SMD', 'Crystals', null],
    ['SWITCH TACTILE SPST-NO 0.05A 12V', 'Switches', null],
    ['SENSOR HALL ANALOG SOT23-3', 'Sensors', 'SOT-23-3'],
    ['IC REG LINEAR 3.3V 1A SOT223', 'ICs', 'SOT-223'],
    ['IC MCU 32BIT 1MB FLASH 100LQFP', 'ICs', 'LQFP-100'],
    ['ACCEL/GYRO 6-AXIS I2C SPI 14LGA', 'Sensors', 'LGA-14'],
    ['Mystery thing from a drawer', 'Other', null],
  ])('%s', (description, category, pkg) => {
    expect(parseDescription(description)).toEqual({ category, package: pkg });
  });

  it("doesn't mistake a resonator for a resistor", () => {
    expect(parseDescription('RESONATOR 8MHZ').category).toBe('Crystals');
  });

  it('ignores case', () => {
    expect(parseDescription('res 10k ohm 0603').category).toBe('Resistors');
  });
});

describe('describeBomLine', () => {
  // Lines from the Stella Nova BOM.
  const line = (ref: string, value: string | null, description: string | null, packageGuess: string | null = null) =>
    describeBomLine({ ref, value, description, packageGuess });

  it('uses the description alone when it already says the value', () => {
    expect(line('C1', '10uF 50V', '10 uF 50 V X7R 1210', '1210')).toEqual({
      description: '10 uF 50 V X7R 1210',
      category: 'Capacitors',
      package: '1210',
    });
    expect(line('R18', '22', '22 ohm 1% 0603', '0603')?.description).toBe('22 ohm 1% 0603');
  });

  it('puts the value in front when the description leaves it out', () => {
    expect(line('R21', '30.1k', 'FB divider bottom, 1% 0603', '0603')).toEqual({
      description: '30.1k, FB divider bottom, 1% 0603',
      category: 'Resistors',
      package: '0603',
    });
    expect(line('U2', 'AP63301WU-7', '3.8 to 32 V buck, adjustable, 3 A, 500 kHz')).toMatchObject({
      description: 'AP63301WU-7, 3.8 to 32 V buck, adjustable, 3 A, 500 kHz',
      category: 'ICs',
    });
  });

  it('tells LEDs and protection parts apart from other diodes', () => {
    expect(line('D7', 'Orange', '0603 orange LED', '0603')?.category).toBe('LEDs');
    expect(line('D1', 'SMAJ18A', '18 V standoff unidirectional TVS, 400 W')?.category).toBe('Protection');
    expect(line('F1', 'PTC 0.5 A 30 V', 'Resettable fuse, 0.5 A hold')?.category).toBe('Protection');
    expect(line('D2', 'PMEG6020ER', '60 V 2 A Schottky', '1206')?.category).toBe('Diodes');
  });

  it('falls back to whichever text there is', () => {
    expect(line('J4', 'Header pins', null)).toMatchObject({ description: 'Header pins', category: 'Connectors' });
    expect(line('TP1', null, null)).toBeNull();
  });
});
