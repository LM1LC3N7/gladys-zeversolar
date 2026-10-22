// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of the device: `inverter:<serial>`, the serial number of the
 * inverter given in its status page: a new IP address of the same inverter
 * keeps its device and history.
 */
export const EXTERNAL_ID_TYPE = 'inverter';

// --- The local status page of the inverter (as the zeversolar library reads it) ----
/** The only page read: plain text, fields separated by spaces or new lines. */
export const HOME_PATH = '/home.cgi';
/** The library waits 10 s for an answer; so do we, the body included. */
export const HTTP_TIMEOUT = 10_000;
/** The page is about 200 bytes: more is not a Zeversolar answer. */
export const MAX_BODY_BYTES = 4096;
/** At most this many fields (one inverter: 15; four inverters and a meter: about 40). */
export const MAX_FIELDS = 64;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** One read a minute (one small GET), never faster, whatever asks for it. */
export const POLL_INTERVAL = MINUTE;
/** An inverter asleep (no sun) is looked at every 5 minutes. */
export const SLEEP_INTERVAL = 5 * MINUTE;
/** Silent reads in a row before an inverter that was producing little is asleep. */
export const MISSES_BEFORE_ASLEEP = 3;
/** Below this power (W) at its last read, an inverter that goes silent is falling asleep. */
export const AWAKE_POWER = 50;
/** No answer at all for this long: the status turns red, even at night. */
export const LONG_SILENCE = 24 * HOUR;
/** A wrong answer (not the status page, an HTTP error): tries after 1 min, doubled up to 15 min. */
export const RETRY_MIN = MINUTE;
export const RETRY_MAX = 15 * MINUTE;
/** HTTP 429 or 5xx: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** The time of the last read is written in /data at most once per this delay. */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay (the manifest gives it 30 s). */
export const TEST_ANSWER_WITHIN = 20 * SECOND;

// --- Energy index (built from the counter of the day, see src/daily.js) -------------
/**
 * The guard of the index (src/guard.js) and of the counter of the day
 * (src/daily.js): a Zeversolar installation never produces more than this on
 * average between two reads (the largest Zeversolar inverters are 20 kW).
 */
export const INDEX_MAX_KW = 30;
/**
 * The margin actually used is the installation's (review 1, I3): 1.25 x the
 * peak power typed in the configuration, else 1.5 x the highest power read
 * over the last 30 days (once 7 days are known), bounded to these (kW).
 * INDEX_MAX_KW until then.
 */
export const MAX_KW_MIN = 2;
export const MAX_KW_MAX = INDEX_MAX_KW;
/** Days of power peaks needed before the learned margin is used, and kept. */
export const PEAK_DAYS_MIN = 7;
export const PEAK_DAYS_KEPT = 30;
/**
 * The counter of the day before (B1, I1): a read within this band of it,
 * above OR below (review 2, R1: an inverter that saves its counter now and
 * then shows a value a little under our last read), at sunrise, or back on it
 * later the same day while today's counter is well below it, is the day
 * before shown again: kept out. Cost: up to 0.1 kWh at the end of a day that
 * ends within 0.1 kWh of the day before.
 */
export const STALE_BAND_KWH = 0.1;
export const STALE_BELOW_KWH = STALE_BAND_KWH;
/** A power above this many times the peak (typed, or of the last 30 days) is a glitch unless seen twice in a row. */
export const PEAK_OUTLIER = 1.5;
/**
 * The largest Zeversolar inverters are 20 kW: a power above this (W), 65535
 * (a common error value) included, is aberrant: never a peak, never in the
 * margin of a read, even seen twice or in the first week (0.1.2, n2).
 */
export const PLAUSIBLE_POWER_MAX = 25_000;
/** kWh always accepted on top of INDEX_MAX_KW x hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;
/** A counter of the day back to at most this (kWh) may be a new day. */
export const DAY_RESET_MAX_KWH = INDEX_MAX_KW;
/** A drop around the local midnight (1 h before to 3 h after) may be a new day. */
export const DAY_WINDOW_BEFORE = HOUR;
export const DAY_WINDOW_AFTER = 3 * HOUR;
/** A new day contradicted within this delay (too fast, or the old value back) is undone. */
export const DAY_RESET_UNDO_WITHIN = 3 * HOUR;
/** The local midnight: the TZ of the container, else Central European time. */
export const TIME_ZONE = process.env.TZ || 'Europe/Paris';

/** A power above this (W) is a glitch: not published. */
export const POWER_MAX = 100_000;
/** A counter of the day above this (kWh) is a glitch: not published, no index. */
export const DAY_ENERGY_MAX = 1_000;
