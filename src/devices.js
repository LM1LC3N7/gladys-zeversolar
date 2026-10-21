// -----------------------------------------------------------------------------
// The Gladys device of a Zeversolar inverter and its states. Pure.
//
// External id (forever): inverter:<serial>, the serial of the status page.
// Feature keys (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js and the
// energy-monitoring service), as in gladys-apsystems and gladys-imeon:
// - `production_index` is the ONLY energy-production-sensor / index feature:
//   a cumulative index built from the inverter's counter of the day
//   (src/daily.js) and checked by the guard (src/guard.js), never 0. Its
//   `thirty-minutes-production` feature is declared here (the core derives
//   that one for a consumption index only), ids computed (UUID v5) so an
//   "Update" in Discovery keeps the same rows; the integration never
//   publishes it;
// - `energy_today` is the counter of the day as the inverter gives it
//   (energy-production-sensor / daily-production, as gladys-apsystems): never
//   an index, never publishEnergyConsumption;
// - `power` is the only energy-production-sensor / power feature;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): W and kWh for energy-production-sensor,
//   none for unknown.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DAY_ENERGY_MAX, EXTERNAL_ID_TYPE, POWER_MAX } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  POWER: 'power',
  ENERGY_TODAY: 'energy_today',
  PRODUCTION_INDEX: 'production_index',
  /** 30-minute production: fed by the Gladys core from the index, never by the integration. */
  PRODUCTION_30MIN: 'production_index_production',
  AWAKE: 'awake',
  INVERTER_FAULT: 'inverter_fault',
  CLOUD: 'cloud_connection',
};

/** The external ids of the inverter with this serial. */
export const ids = (gladys, serial) => gladys.externalIds(EXTERNAL_ID_TYPE, serial);

/** Namespace of the feature ids of this integration (random, fixed forever). */
const ID_NAMESPACE = Buffer.from('a3f1c7d24e8b4f6a9c0d5e7b1f2a3c4d', 'hex');

/** A deterministic UUID (version 5, RFC 9562) of a name (as gladys-apsystems). */
export function uuidOf(name) {
  const hash = createHash('sha1').update(ID_NAMESPACE).update(String(name), 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: 1_000_000_000,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** A yes/no value shown, never summed (as the Livebox "internet" feature). */
const flag = (external, key, name) =>
  feature(external, key, name, C.UNKNOWN, T.SENSOR.BINARY, { max: 1 });

/**
 * The device of the inverter. `info`: `{ serial, hardware, software }` from
 * its status page (the serial alone when read back from /data). The features
 * are the same for every inverter: fixed when the user creates it.
 */
export function buildDevice(gladys, info, address) {
  const external = ids(gladys, info.serial);
  const productionIndexId = external.feature(FEATURE.PRODUCTION_INDEX);
  return {
    name: `Zeversolar ${info.serial}`,
    external_id: external.device,
    features: [
      feature(
        external,
        FEATURE.POWER,
        'Solar production',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.POWER,
        { unit: U.WATT, max: POWER_MAX },
      ),
      feature(
        external,
        FEATURE.ENERGY_TODAY,
        'Solar energy of the day',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.DAILY_PRODUCTION,
        { unit: U.KILOWATT_HOUR, max: DAY_ENERGY_MAX },
      ),
      feature(
        external,
        FEATURE.PRODUCTION_INDEX,
        'Solar production index',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.INDEX,
        { id: uuidOf(productionIndexId), unit: U.KILOWATT_HOUR },
      ),
      feature(
        external,
        FEATURE.PRODUCTION_30MIN,
        'Solar production index (30-minute production)',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION,
        {
          id: uuidOf(external.feature(FEATURE.PRODUCTION_30MIN)),
          energy_parent_id: uuidOf(productionIndexId),
          unit: U.KILOWATT_HOUR,
        },
      ),
      flag(external, FEATURE.AWAKE, 'Inverter awake (1 = producing or ready, 0 = asleep)'),
      flag(external, FEATURE.INVERTER_FAULT, 'Inverter fault (1 = the inverter reports an error)'),
      flag(external, FEATURE.CLOUD, 'Link to the Zeversolar cloud (1 = connected)'),
    ],
    params: [
      { name: 'address', value: address },
      { name: 'serial', value: info.serial },
      { name: 'hardware', value: info.hardware ?? '' },
      { name: 'software', value: info.software ?? '' },
    ],
  };
}

export const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const state = (external, key, value, digits) =>
  isNumber(value)
    ? [{ device_feature_external_id: external.feature(key), state: round(value, digits) }]
    : [];

const bit = (value) => (typeof value === 'boolean' ? (value ? 1 : 0) : undefined);

/** A value within [0, max], else undefined (a glitch, not sent). */
export const within = (value, max) =>
  isNumber(value) && value >= 0 && value <= max ? value : undefined;

/**
 * The states of a read. `reading`: the parsed page (`kind: 'reading'`).
 * `index`: the value the guard let through (undefined: not published).
 */
export function readingStates(external, reading, index) {
  return [
    ...state(external, FEATURE.POWER, within(reading.power, POWER_MAX), 0),
    ...state(external, FEATURE.ENERGY_TODAY, within(reading.energyToday, DAY_ENERGY_MAX), 2),
    // The index: never 0 (the guard never lets 0 through, checked again here).
    ...(isNumber(index) && index > 0 ? state(external, FEATURE.PRODUCTION_INDEX, index, 3) : []),
    ...state(external, FEATURE.AWAKE, 1, 0),
    ...state(external, FEATURE.INVERTER_FAULT, bit(reading.inverterOk === false), 0),
    ...state(external, FEATURE.CLOUD, bit(reading.cloudOk), 0),
  ];
}

/**
 * The states of an inverter asleep (the night): no production, the counters
 * kept (the index is never published, never 0). `cloudOk` when the Wi-Fi
 * board still answered.
 */
export function asleepStates(external, cloudOk) {
  return [
    ...state(external, FEATURE.POWER, 0, 0),
    ...state(external, FEATURE.AWAKE, 0, 0),
    ...state(external, FEATURE.CLOUD, bit(cloudOk), 0),
  ];
}
