// -----------------------------------------------------------------------------
// The integration itself: the status page of the inverter read once a minute
// (every 5 minutes asleep), its device, the production index built from the
// counter of the day and checked by its guard, the night, the pauses kept in
// /data, the test and accept buttons. index.js only wires the SDK handlers to
// it. Read-only: nothing is ever sent to the inverter but one GET of its
// status page.
//
// The pace is global and kept across restarts: never two reads less than an
// interval apart, whatever asks (a reconnection, a save of the form, the test
// button, the Discover tab, a device created, a restart of the container: the
// time of the last read is kept in /data).
//
// A read belongs to its session (the client of one address): when the
// address changes, a late answer of the old one publishes nothing and sets no
// status (checked after every await).
//
// The created devices are read from `gladys.devices`, which the SDK keeps up
// to date: never a copy of our own.
//
// Two clocks: `now` (wall clock) dates the index and what /data keeps;
// `monotonic` paces the reads, so that a wall clock set back never stops them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig } from './config.js';
import {
  ATTEMPT_SAVE_EVERY,
  AWAKE_POWER,
  DAY_ENERGY_MAX,
  DAY_RESET_MAX_KWH,
  DAY_RESET_UNDO_WITHIN,
  DAY_WINDOW_AFTER,
  DAY_WINDOW_BEFORE,
  INDEX_MAX_KW,
  INDEX_SLACK_KWH,
  LONG_SILENCE,
  MISSES_BEFORE_ASLEEP,
  PAUSE_MAX,
  PAUSE_MIN,
  POLL_INTERVAL,
  POWER_MAX,
  RETRY_MAX,
  RETRY_MIN,
  SLEEP_INTERVAL,
  STATE_HEARTBEAT,
  TEST_ANSWER_WITHIN,
  TIME_ZONE,
} from './constants.js';
import { DailyIndex } from './daily.js';
import {
  FEATURE,
  asleepStates,
  buildDevice,
  ids,
  readingStates,
  round,
  within,
} from './devices.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { createFileStore } from './store.js';
import { ZeverClient } from './zeversolar/client.js';

const defaultTimers = { setTimeout, clearTimeout };

const GUARD_LIMITS = { maxKw: INDEX_MAX_KW, slackKwh: INDEX_SLACK_KWH };
const DAILY_LIMITS = {
  resetMaxKwh: DAY_RESET_MAX_KWH,
  undoWithinMs: DAY_RESET_UNDO_WITHIN,
  maxKw: INDEX_MAX_KW,
  slackKwh: INDEX_SLACK_KWH,
  windowBefore: DAY_WINDOW_BEFORE,
  windowAfter: DAY_WINDOW_AFTER,
  gapMs: 3 * POLL_INTERVAL,
  timeZone: TIME_ZONE,
};

/** Silent for this long, even while producing: asleep (night or outage, the status says both). */
const ASLEEP_AFTER = 60 * 60_000;
/** At most this many index states kept in /data (one per inverter serial seen). */
const MAX_KEPT_INDEXES = 8;

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/** A pause read back from /data: `{ until, count, code, status }`, its end capped from now. */
function validPause(pause, now) {
  if (
    !pause ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  return {
    until: Math.min(pause.until, now + PAUSE_MAX),
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** The index states kept in /data: plain objects under string keys only. */
function keptIndexes(indexes) {
  if (!indexes || typeof indexes !== 'object' || Array.isArray(indexes)) {
    return {};
  }
  const kept = {};
  for (const [key, value] of Object.entries(indexes)) {
    if (key !== '__proto__' && value && typeof value === 'object' && !Array.isArray(value)) {
      kept[key] = value;
    }
  }
  return kept;
}

export class ZeverApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'zeversolar' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new ZeverClient(options),
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    /** /data: index, guard, serial, pause, time of the last read and of the last answer. */
    this.store = store;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** `{ client }` of the current address; replaced (never reused) when the address changes. */
    this.session = undefined;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;

    const kept = store.load();
    const at = now();
    this.pause = validPause(kept.pause, at);
    /** `{ serial, hardware, software }` of the inverter; the serial alone when read back. */
    this.info =
      typeof kept.serial === 'string' && SERIAL.test(kept.serial)
        ? { serial: kept.serial }
        : undefined;
    // The last read before a restart: the next one never comes sooner than
    // the interval (a date in the future, a clock set back, is brought to now).
    this.lastAttemptAt = finite(kept.lastAttemptAt) ? Math.min(kept.lastAttemptAt, at) : undefined;
    this.savedAttemptAt = this.lastAttemptAt;
    /** Monotonic time of the last read started. */
    this.lastReadAt =
      this.lastAttemptAt === undefined ? undefined : monotonic() - (at - this.lastAttemptAt);
    /** Wall time of the last reading of the inverter itself (with its values), for LONG_SILENCE. */
    this.lastGoodAt = finite(kept.lastGoodAt) ? Math.min(kept.lastGoodAt, at) : undefined;
    this.startedAt = at;
    this.resetReads();

    /** By index feature external id: IndexGuard, DailyIndex, monotonic time of the last counter read. */
    this.guards = new Map();
    this.dailies = new Map();
    this.counterReadAt = new Map();
  }

  /** What belongs to one address: forgotten when it changes. */
  resetReads() {
    /** The last read: `{ at (monotonic), kind: 'reading' | 'asleep' | 'error', reading?, err? }`. */
    this.outcome = undefined;
    this.asleep = false;
    /** Asleep because the Wi-Fi board answered without inverter (else: no answer at all). */
    this.asleepBoard = false;
    this.misses = 0;
    this.firstMissAt = undefined;
    /** The power of the last reading (W): an inverter that vanishes producing more is not asleep. */
    this.lastPower = undefined;
    /** Wrong answers and vanished inverters: retries doubled, in memory. */
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    this.noIndex = false;
    this.stale = false;
    this.inverters = 1;
    this.otherInverter = undefined;
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the read running are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    this.doStop();
    const config = normalizeConfig(raw);
    const first = this.session === undefined;
    const changed =
      first ||
      config.address !== this.config.address ||
      config.invalidAddress !== this.config.invalidAddress;
    this.config = config;
    if (changed) {
      this.session = {
        client: isComplete(config) ? this.clientFactory({ address: config.address }) : undefined,
      };
      if (!first) {
        // Another address: its own story. A pause asked by the old one ends;
        // the pace does not (never two reads less than an interval apart).
        this.resetReads();
        this.lastGoodAt = undefined;
        this.startedAt = this.now();
        if (this.pause) {
          this.pause = undefined;
          await this.saveState();
        }
      }
    }
    this.running = true;
    // The core keeps the connection status, the Discovery list and the last
    // values in memory: a restarted Gladys has lost them, so they are always
    // sent again (the values at the next read).
    this.lastStatus = undefined;
    this.gladys.forgetPublishedStates?.();
    if (!this.session.client) {
      await this.setStatus(false, config.invalidAddress ? T.badAddress : T.incomplete);
      return;
    }
    if (!changed || first) {
      // Another address may be another inverter: its device is published
      // once its serial is read, never the old one with the new address.
      await this.discover();
    }
    await this.updateStatus();
    this.schedule();
  }

  doStop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  // --- Pace ------------------------------------------------------------------

  /** The monotonic time from which the next read may start. */
  dueAt() {
    const mono = this.monotonic();
    let due =
      this.lastReadAt === undefined
        ? mono
        : this.lastReadAt + (this.asleep ? SLEEP_INTERVAL : POLL_INTERVAL);
    if (this.nextTryAt !== undefined) {
      due = Math.max(due, this.nextTryAt);
    }
    const now = this.now();
    if (this.pause && now < this.pause.until) {
      due = Math.max(due, mono + (this.pause.until - now));
    }
    return due;
  }

  /** One timer: the next read when it is due. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.session?.client) {
      return;
    }
    const wait = Math.max(0, this.dueAt() - this.monotonic());
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop();
      return this.loopRun;
    }, wait);
  }

  async loop() {
    const session = this.session;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`Zeversolar: unexpected error (${err?.name ?? 'Error'})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick() {
    if (this.busy) {
      return this.busy;
    }
    this.busy = this.read().finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read() {
    const session = this.session;
    const client = session?.client;
    if (!client || !this.running) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt()) {
      return;
    }
    /** Another address (or a stop) during an await: this read gives up, silently. */
    const gone = () => session !== this.session || !this.running;
    this.lastReadAt = mono;
    // Kept BEFORE the request: a restart during it never reads again sooner.
    await this.saveAttempt(this.now());
    if (gone()) return;
    let reading;
    try {
      reading = await client.readHome();
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono, gone);
      return;
    }
    if (gone()) return;
    await this.succeeded(reading, mono, gone);
  }

  async saveAttempt(now) {
    this.lastAttemptAt = now;
    if (
      this.savedAttemptAt === undefined ||
      now < this.savedAttemptAt ||
      now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY
    ) {
      this.savedAttemptAt = now;
      await this.saveState();
    }
  }

  // --- Outcomes ----------------------------------------------------------------

  async succeeded(reading, mono, gone) {
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    this.misses = 0;
    this.firstMissAt = undefined;
    this.pause = undefined;
    if (reading.kind === 'asleep') {
      // The Wi-Fi board answers, the inverter gives nothing: the night.
      this.asleep = true;
      this.asleepBoard = true;
      this.lastPower = 0;
      this.outcome = { at: mono, kind: 'asleep' };
      await this.publishAsleep(reading.cloudOk, gone);
      if (gone()) return;
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    this.asleep = false;
    this.asleepBoard = false;
    this.lastGoodAt = this.now();
    const power = within(reading.power, POWER_MAX);
    if (power !== undefined) {
      this.lastPower = power;
    }
    // The identity of this read: the serial in the same answer as its values.
    const info = {
      serial: reading.serial,
      hardware: reading.hardware,
      software: reading.software,
    };
    const previous = this.info?.serial;
    if (previous !== undefined && previous !== info.serial) {
      this.otherInverter = info.serial;
      this.logger.warn('Zeversolar: another inverter answers at this address');
    }
    const infoChanged = JSON.stringify(info) !== JSON.stringify(this.info);
    this.info = info;
    this.inverters = reading.inverters;
    this.outcome = { at: mono, kind: 'reading', reading };
    if (infoChanged) {
      await this.discover();
      if (gone()) return;
    }
    await this.publishReading(reading, gone);
    if (gone()) return;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  async failed(err, mono, gone) {
    const code = err?.code ?? 'error';
    const now = this.now();
    // Our own words only (ZeverError codes): never a text of the inverter.
    this.logger.warn(
      `Zeversolar read failed: ${code}${Number.isInteger(err?.status) ? ` ${err.status}` : ''}`,
    );
    this.outcome = { at: mono, kind: 'error', err };
    if (code === 'rate_limited' || code === 'server') {
      const count = (this.pause?.count ?? 0) + 1;
      const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX);
      this.pause = {
        until: now + wait,
        count: Math.min(count, 32),
        code,
        status: Number.isInteger(err.status) ? err.status : null,
      };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    if (code === 'timeout' || code === 'unreachable') {
      this.misses += 1;
      this.firstMissAt ??= mono;
      if (this.asleep) {
        // Still the night (or the board went to sleep too): no change but the status.
        this.asleepBoard = false;
        await this.updateStatus();
        return;
      }
      const low = this.lastPower === undefined || this.lastPower < AWAKE_POWER;
      if ((low && this.misses >= MISSES_BEFORE_ASLEEP) || mono - this.firstMissAt >= ASLEEP_AFTER) {
        this.asleep = true;
        this.asleepBoard = false;
        this.failures = 0;
        this.nextTryAt = undefined;
        this.lastError = undefined;
        this.logger.info('Zeversolar inverter asleep (no answer)');
        await this.publishAsleep(undefined, gone);
        if (gone()) return;
        await this.updateStatus();
        return;
      }
      if (low) {
        // Falling asleep, probably (the evening): nothing red yet.
        return;
      }
    }
    // A wrong answer, or an inverter that vanished while producing: red,
    // retries doubled (never faster than a poll).
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, RETRY_MAX);
    this.failures += 1;
    this.lastError = err;
    this.nextTryAt = mono + wait;
    await this.updateStatus();
  }

  // --- Status ------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /** The status from what is known now: never a read. */
  currentStatus() {
    const address = this.config.address;
    if (!this.session?.client) {
      return [false, this.config.invalidAddress ? T.badAddress : T.incomplete];
    }
    const notes = this.heldNotes();
    const now = this.now();
    if (this.pause && now < this.pause.until) {
      return [false, T.paused(address, this.pause, this.pause.until - now, notes)];
    }
    if (this.lastError && this.failures > 0) {
      const wait = Math.max(0, (this.nextTryAt ?? 0) - this.monotonic());
      return [false, T.unreachable(address, this.lastError, wait, notes)];
    }
    if (this.asleep) {
      const since = this.lastGoodAt ?? this.startedAt;
      if (now - since > LONG_SILENCE) {
        return [false, T.silent(address, notes)];
      }
      return [true, T.asleep(address, this.asleepBoard, notes)];
    }
    if (this.outcome?.kind === 'reading' && this.info) {
      if (!this.createdDevice()) {
        return [true, T.noDevice(this.info.serial)];
      }
      const extra = [];
      if (this.otherInverter) extra.push(T.notes.otherInverter(this.otherInverter));
      if (this.inverters > 1) extra.push(T.notes.inverters(this.inverters));
      if (this.stale) extra.push(T.notes.stale);
      if (this.noIndex) extra.push(T.notes.noIndex);
      return [true, T.ok(address, [...extra, ...notes])];
    }
    return [false, T.waitingSerial(address)];
  }

  /** The index held back, for every status (the user must see it while waiting). */
  heldNotes() {
    const created = this.createdDevice();
    if (!created) {
      return [];
    }
    const held = this.guardOf(created, this.external().feature(FEATURE.PRODUCTION_INDEX)).held;
    return held ? [T.notes.held(held)] : [];
  }

  // --- /data -------------------------------------------------------------------------

  /** Keeps the serial, the pause, the times and the index in /data when they changed. */
  async saveState() {
    const indexes = {};
    for (const [id, guard] of this.guards) {
      indexes[id] = { guard: guard.state(), daily: this.dailies.get(id)?.state() ?? null };
    }
    const kept = keptIndexes(this.store.load().indexes);
    for (const id of Object.keys(indexes)) delete kept[id];
    const merged = Object.entries({ ...kept, ...indexes }).slice(-MAX_KEPT_INDEXES);
    const state = {
      serial: this.info?.serial ?? null,
      pause: this.pause ?? null,
      lastAttemptAt: this.lastAttemptAt ?? null,
      lastGoodAt: this.lastGoodAt ?? null,
      indexes: Object.fromEntries(merged),
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
    } catch (err) {
      this.logger.warn(`Saving the Zeversolar state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Devices -----------------------------------------------------------------------

  external() {
    return this.info ? ids(this.gladys, this.info.serial) : undefined;
  }

  /** The created Gladys device of the inverter, undefined until the user creates it. */
  createdDevice() {
    const id = this.external()?.device;
    return id ? (this.gladys.devices ?? []).find((d) => d.external_id === id) : undefined;
  }

  async discover() {
    if (!this.info || !this.session?.client) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices([buildDevice(this.gladys, this.info, this.config.address)])
      .catch((err) => this.logger.warn(`Publishing the Zeversolar device failed: ${err.message}`));
  }

  /** The Discover tab asks: the known device, never a read (the next one comes at its time). */
  async scan() {
    await this.discover();
  }

  async onDeviceCreated(device) {
    const external = this.external();
    if (!external || device?.external_id !== external.device) {
      return;
    }
    // A new device: no reference of its index yet (nor a state kept in /data
    // for a deleted device of the same id). Its values come at the next read.
    const id = external.feature(FEATURE.PRODUCTION_INDEX);
    this.guards.delete(id);
    this.dailies.delete(id);
    this.counterReadAt.delete(id);
    const kept = this.store.load();
    const indexes = keptIndexes(kept.indexes);
    delete indexes[id];
    await this.store
      .save({ ...kept, indexes })
      .catch((err) =>
        this.logger.warn(`Clearing the Zeversolar index state failed (${err?.code ?? 'error'})`),
      );
    this.savedKey = undefined;
    // The inverter now answering has its device: the note about it ends.
    this.otherInverter = undefined;
    await this.updateStatus();
  }

  async onDeviceUpdated(device) {
    if (device?.external_id === this.external()?.device) {
      await this.updateStatus();
    }
  }

  // --- Values ------------------------------------------------------------------------

  /** The guard of the index of the created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = keptIndexes(this.store.load().indexes)[id];
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), saved?.guard, this.now(), GUARD_LIMITS),
      );
      this.dailies.set(id, new DailyIndex(saved?.daily, DAILY_LIMITS, this.now()));
    }
    return this.guards.get(id);
  }

  /**
   * At sunrise, a counter still EQUAL to the last value taken, on a later
   * local day: the inverter shows the day before (it has not started its new
   * day). Given to the daily index, it would date the day before as today and
   * the real new day (the drop) would be refused all day. Kept out instead.
   */
  staleCounter(daily, today, now) {
    const s = daily.state();
    return Boolean(
      s &&
      s.readDay &&
      today > 0 &&
      Math.abs(today - s.today) < 0.0005 &&
      daily.local(now).date > s.readDay,
    );
  }

  /** The states of a reading, the index through the daily counter and the guard. */
  async publishReading(reading, gone) {
    this.noIndex = false;
    this.stale = false;
    const created = this.createdDevice();
    if (!created) {
      return;
    }
    const external = this.external();
    const id = external.feature(FEATURE.PRODUCTION_INDEX);
    const guard = this.guardOf(created, id);
    const daily = this.dailies.get(id);
    const now = this.now();
    const today = within(reading.energyToday, DAY_ENERGY_MAX);
    let index;
    if (today !== undefined && this.staleCounter(daily, today, now)) {
      // Not a counter read (its time is not moved): the drop to come is the new day.
      this.stale = true;
    } else if (today !== undefined) {
      // The time since the previous counter read, on the monotonic clock: a
      // wall clock jumping forward never forges a cut across midnight
      // (src/daily.js). Unknown after a restart.
      const mono = this.monotonic();
      const previous = this.counterReadAt.get(id);
      this.counterReadAt.set(id, mono);
      const built = daily.read(today, now, guard.last ?? lastValueOf(created, id), {
        elapsedMs: previous === undefined ? undefined : mono - previous,
      });
      const total = built === undefined ? undefined : round(built, 3);
      this.noIndex = total === undefined;
      const plausible = total !== undefined && guard.accept(total, now);
      if (total !== undefined && !plausible && guard.held) {
        this.logger.warn(
          `Zeversolar production index ${guard.held.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
        );
      }
      // While a value is held, the last accepted one is sent again (no delta for the core).
      index = plausible ? total : guard.held ? guard.last?.value : undefined;
    }
    // The built index and its guard are in /data BEFORE Gladys gets the
    // value: a crash in between never sends an index /data does not know.
    await this.saveState();
    if (gone()) return;
    await this.publishStates(created, readingStates(external, reading, index));
  }

  /** The night: power 0, awake 0; the counters and the index are never sent. */
  async publishAsleep(cloudOk, gone) {
    const created = this.createdDevice();
    if (!created || gone()) {
      return;
    }
    await this.publishStates(created, asleepStates(this.external(), cloudOk));
  }

  async publishStates(created, states) {
    // Only the features the created device has (they are fixed at its creation).
    const features = created.features ? new Set(created.features.map((f) => f.external_id)) : null;
    const allowed = features
      ? states.filter((s) => features.has(s.device_feature_external_id))
      : states;
    if (allowed.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(allowed, { heartbeat: STATE_HEARTBEAT })
      .catch((err) => this.logger.warn(`Publishing the Zeversolar values failed: ${err.message}`));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * The "Accept the held index" button: takes the value held as shown now
   * (plus what may come until the next read, src/guard.js), never anything
   * else. Published at the next read (never a read sooner).
   */
  async acceptHeldIndex() {
    const created = this.createdDevice();
    if (!created) {
      return T.accept.nothing;
    }
    const taken = this.guardOf(
      created,
      this.external().feature(FEATURE.PRODUCTION_INDEX),
    ).acceptHeld();
    if (!taken) {
      return T.accept.nothing;
    }
    this.logger.info(
      `Zeversolar production index ${taken.direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
    );
    return T.accept.done(taken);
  }

  /**
   * The test button: never a read sooner than the pace allows. When a read
   * is due, this click makes it; otherwise it tells the last one.
   */
  async testConnection() {
    if (!this.session?.client) {
      return this.config.invalidAddress ? T.badAddress : T.incomplete;
    }
    if (this.pause && this.now() < this.pause.until) {
      return this.currentStatus()[1];
    }
    if (this.busy || this.dueAt() > this.monotonic()) {
      return this.describeOutcome();
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.tick().then(() => this.describeOutcome()), late]);
    } finally {
      this.timers.clearTimeout(timer);
      if (this.running) this.schedule();
    }
  }

  /** The last read in words, and the time to the next one. */
  describeOutcome() {
    const mono = this.monotonic();
    const next = Math.max(0, this.dueAt() - mono);
    const outcome = this.outcome;
    if (!outcome) {
      return T.test.notYet(next);
    }
    const ago = Math.max(0, mono - outcome.at);
    if (outcome.kind === 'reading') {
      const { serial, hardware } = outcome.reading;
      const power = within(outcome.reading.power, POWER_MAX) ?? '?';
      return T.test.reading({ serial, hardware, power }, ago, next);
    }
    if (outcome.kind === 'asleep') {
      return T.test.asleep(ago, next);
    }
    return T.test.failed(this.config.address, outcome.err, ago, next);
  }
}
