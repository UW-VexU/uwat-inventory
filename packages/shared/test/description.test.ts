import { describe, expect, it } from 'vitest';
import { parseDescription } from '../src/description';

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
    ['ACCEL/GYRO 6-AXIS I2C SPI 14LGA', 'Sensors', null],
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
