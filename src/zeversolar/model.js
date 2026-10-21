// -----------------------------------------------------------------------------
// The status page of a Zeversolar inverter (`/home.cgi`) -> values. Pure.
//
// Ported from the zeversolar library (kvanzuijlen, Apache-2.0, see
// THIRD_PARTY_NOTICES.md), `ZeverSolarParser.parse`: the page is plain text,
// its fields separated by spaces or new lines (split the same way):
//
//   0  WIFI_ENABLED          0 | 1
//   1  ?                     an integer
//   2  SERIAL_OR_REGISTRY_ID the registry id of the Wi-Fi board (never kept)
//   3  REGISTRY_KEY          its key for the maker's cloud (never kept, never shown)
//   4  HARDWARE_VERSION      M10 | M11 (known values)
//   5  SOFTWARE_VERSION      e.g. 16415-562R+16413-561R
//   6  REPORTED_TIME         HH:MM
//   7  REPORTED_DATE         DD/MM/YYYY
//   8  COMMUNICATION_STATUS  the link to the maker's cloud: OK | ERROR | 0 (OK) | n (error)
//   9  NUM_INVERTERS         inverters giving data, 0 to 4
//   10 SERIAL_NUMBER         the serial of the (first) inverter
//   11 (optional)            an inverter version, given by some older firmware
//   11|12 PAC                W, an integer
//   12|13 ENERGY_TODAY       kWh since the start of the day; "14.9" means 14.09
//   13|14 STATUS             OK | ERROR, the state of the inverter
//
// The library reads the first inverter only (and fails with more than one: it
// expects the meter status right after it); so do we, without failing: the
// number of inverters is returned for the status. NUM_INVERTERS = 0 (the
// inverter has stopped, the Wi-Fi board still answers: the night, or the
// morning before it starts) is not an error here: `asleep`.
//
// Hostile answers: the caller bounds the body (src/zeversolar/client.js), the
// fields are counted before anything else, every field is checked against a
// strict pattern, nothing is ever read as 0 by default, no object is built
// from the answer's own keys.
// -----------------------------------------------------------------------------

import { MAX_FIELDS } from '../constants.js';

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
const HARDWARE = /^[A-Za-z0-9._-]{1,16}$/;
const SOFTWARE = /^[A-Za-z0-9._+-]{1,48}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
const STATUS = /^(ok|error)$/i;
const INTEGER = /^\d{1,7}$/;
const ENERGY = /^(\d{1,6})(?:\.(\d{1,3}))?$/;

/**
 * The counter of the day as the library reads it: one decimal digit is a
 * missing leading zero ("14.9" -> 14.09, "0.89" -> 0.89, "14.20" -> 14.2).
 * Undefined for anything that is not such a number.
 */
export function energyOf(text) {
  const match = ENERGY.exec(text);
  if (!match) {
    return undefined;
  }
  const [, whole, decimals] = match;
  if (decimals === undefined) {
    return Number(whole);
  }
  return Number(`${whole}.${decimals.length === 1 ? `0${decimals}` : decimals}`);
}

/** The cloud link: OK / ERROR, or a number (0 = OK). Undefined when odd. */
function cloudOf(text) {
  if (STATUS.test(text)) {
    return text.toUpperCase() === 'OK';
  }
  return /^\d{1,3}$/.test(text) ? text === '0' : undefined;
}

/**
 * The page parsed: `{ kind: 'reading', serial, hardware, software, power,
 * energyToday, inverterOk, cloudOk, inverters }` or `{ kind: 'asleep',
 * hardware, software, cloudOk }`; undefined when it is not a Zeversolar
 * status page. `power` and `energyToday` are numbers as read (the app checks
 * their ranges).
 */
export function parseHome(text) {
  if (typeof text !== 'string') {
    return undefined;
  }
  const fields = text.trim().split(/\s+/, MAX_FIELDS + 1);
  if (fields.length > MAX_FIELDS || fields.length <= 9) {
    return undefined;
  }
  const [wifi, unknown, , , hardware, software, time, date, cloud, count] = fields;
  if (
    !/^\d$/.test(wifi) ||
    !/^\d{1,3}$/.test(unknown) ||
    !HARDWARE.test(hardware) ||
    !TIME.test(time) ||
    !DATE.test(date) ||
    !/^\d$/.test(count)
  ) {
    return undefined;
  }
  const cloudOk = cloudOf(cloud);
  if (cloudOk === undefined) {
    return undefined;
  }
  const base = {
    hardware,
    software: SOFTWARE.test(software) ? software : null,
    cloudOk,
  };
  const inverters = Number(count);
  if (inverters < 1) {
    return { kind: 'asleep', ...base };
  }
  if (inverters > 4) {
    return undefined;
  }
  let index = 10;
  const serial = fields[index];
  if (!SERIAL.test(serial ?? '')) {
    return undefined;
  }
  index += 1;
  if (!INTEGER.test(fields[index] ?? '')) {
    // An inverter version (some older firmware): the power is the next field.
    index += 1;
    if (!INTEGER.test(fields[index] ?? '')) {
      return undefined;
    }
  }
  const power = Number(fields[index]);
  index += 1;
  const energyToday = energyOf(fields[index] ?? '');
  if (energyToday === undefined) {
    return undefined;
  }
  index += 1;
  const status = fields[index] ?? '';
  if (!STATUS.test(status)) {
    return undefined;
  }
  return {
    kind: 'reading',
    ...base,
    serial,
    power,
    energyToday,
    inverterOk: status.toUpperCase() === 'OK',
    inverters,
  };
}
