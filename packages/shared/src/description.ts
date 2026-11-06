import type { Category } from './types';

/** Checked in order, against the upper-cased description. First match wins. */
const CATEGORY_RULES: ReadonlyArray<readonly [RegExp, Category]> = [
  [/^(PTC|POLYFUSE|FUSE|VARISTOR|MOV|GDT)\b|\bRESET FUSE\b/, 'Protection'],
  [/^(TVS|ESD)\b/, 'Protection'],
  [/^LED\b|\bLED (RED|GREEN|BLUE|WHITE|AMBER|YELLOW|ORANGE|RGB)\b/, 'LEDs'],
  [/^(DIODE|ZENER|SCHOTTKY|BRIDGE RECT|RECT)\b/, 'Diodes'],
  [/^(MOSFET|TRANS|TRANSISTOR|BJT|JFET|IGBT)\b/, 'Transistors'],
  [/^(XTAL|CRYSTAL|OSC|OSCILLATOR|RESONATOR|CER RES)\b/, 'Crystals'],
  [/^(RES|RESISTOR|THERMISTOR|NTC|POT|TRIMMER)\b/, 'Resistors'],
  [/^(CAP|CAPACITOR)\b/, 'Capacitors'],
  [/^(FIXED IND|IND|INDUCTOR|FERRITE|CHOKE|COMMON MODE)\b/, 'Inductors'],
  [/^(CONN|CONNECTOR|TERM|TERMINAL|HEADER|JUMPER|SOCKET|USB|RCPT|PLUG|HOUSING|CABLE)\b/, 'Connectors'],
  [/^(SWITCH|SW|RELAY|BUTTON)\b/, 'Switches'],
  [/^(SENSOR|ACCEL|GYRO|IMU|MAGNETOMETER|HALL|ENCODER|ACCELEROMETER)\b/, 'Sensors'],
  [/^(IC|MCU|MICROCONTROLLER|OPAMP|REG|LDO|EEPROM|FLASH|DRIVER)\b/, 'ICs'],
];

const CHIP_SIZE = /\b(01005|0201|0402|0603|0805|1008|1206|1210|1812|2010|2512)\b/;
const COUNTED_PACKAGE =
  /\b(\d{1,3})?(SOIC|TSSOP|HTSSOP|SSOP|MSOP|VSSOP|QFN|VQFN|WQFN|UQFN|DFN|WDFN|WSON|SON|LQFP|TQFP|QFP|BGA|PDIP|DIP|SIP)\b(?:-(\d{1,3}))?/;
const NAMED_PACKAGE = /\b(SOT-?\d+(?:-\d+)?|SOD-?\d+|SC-?\d+|TO-?\d+[A-Z]*|D2PAK|DPAK|SMA|SMB|SMC)\b/;

export interface ParsedDescription {
  category: Category;
  package: string | null;
}

export function parseDescription(description: string): ParsedDescription {
  const text = description.trim().toUpperCase();
  const category = CATEGORY_RULES.find(([rule]) => rule.test(text))?.[1] ?? 'Other';
  return { category, package: parsePackage(text) };
}

function parsePackage(text: string): string | null {
  const counted = COUNTED_PACKAGE.exec(text);
  if (counted) {
    const pins = counted[1] ?? counted[3];
    return pins ? `${counted[2]}-${Number(pins)}` : (counted[2] ?? null);
  }
  const named = NAMED_PACKAGE.exec(text);
  if (named?.[1]) return normaliseNamedPackage(named[1]);
  return CHIP_SIZE.exec(text)?.[1] ?? null;
}

function normaliseNamedPackage(name: string): string {
  const match = /^(SOT|SOD|SC|TO)-?(.+)$/.exec(name);
  return match ? `${match[1]}-${match[2]}` : name;
}
