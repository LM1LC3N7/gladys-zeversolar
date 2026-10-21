// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Zeversolar
// inverter, on a virtual clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ZeverApp } from '../src/app.js';
import {
  ACTIONS,
  LONG_SILENCE,
  PAUSE_MIN,
  POLL_INTERVAL,
  SLEEP_INTERVAL,
} from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { createMemoryStore } from '../src/store.js';
import { ZeverClient } from '../src/zeversolar/client.js';
import { ADDRESS, NOW, REGISTRY_KEY, SERIAL, page, text } from './fixtures/zeversolar.js';
import { createFetch, refusedError, timeoutError } from './helpers/fakeNet.js';
import { createFakeClock } from './helpers/fakeTimers.js';

const SELECTOR = 'zeversolar';
const DEVICE = `ext:${SELECTOR}:inverter:${SERIAL}`;
const F = (key, serial = SERIAL) => `ext:${SELECTOR}:inverter:${serial}:${key}`;
const CONFIG = { address: ADDRESS };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The device as the user created it from the discovered one. */
function created({ index, serial = SERIAL } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const device = buildDevice(gladys, { serial, hardware: 'M10' }, ADDRESS);
  if (index) {
    const feature = device.features.find((f) => f.external_id === F('production_index', serial));
    feature.last_value = index.value;
    feature.last_value_changed = new Date(index.at).toISOString();
  }
  return device;
}

/** The inverter: `inverter.answer` is the next answer (a function of the call). */
function createInverter() {
  const inverter = { answer: () => text(page()) };
  inverter.net = createFetch((call) => inverter.answer(call));
  inverter.set = (options) => {
    inverter.answer = () => text(page(options));
  };
  inverter.down = (error = refusedError) => {
    inverter.answer = () => {
      throw error();
    };
  };
  return inverter;
}

async function setup({
  devices = [],
  store = createMemoryStore(),
  now = NOW,
  inverter = createInverter(),
  config = CONFIG,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const { clock, timers, advance } = createFakeClock(now);
  const logger = createLogger();
  const app = new ZeverApp({
    gladys,
    logger,
    now: () => clock.now,
    monotonic: () => clock.now,
    timers,
    store,
    clientFactory: (options) => new ZeverClient({ ...options, fetchImpl: inverter.net.fetch }),
  });
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());
  /** Starts with this configuration and waits for the read that follows. */
  const start = async (cfg = config) => {
    await app.start(cfg);
    await advance(0);
    await app.idle();
  };
  /** Moves the clock, running the reads due on the way. */
  const wait = async (ms) => {
    await advance(ms);
    await app.idle();
  };
  return { app, gladys, clock, logger, store, inverter, start, wait, advance };
}

const status = (gladys) => gladys.fake.connectionStatus;
const reads = (inverter) => inverter.net.calls.length;
const discoveries = (gladys) => gladys.fake.bodies('POST', '/discovered_device').length;
const last = (gladys, key, serial) => gladys.fake.lastState(F(key, serial));
const indexStates = (gladys) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === F('production_index'));

test('an incomplete or wrong configuration: the status says so, nothing is called', async () => {
  for (const [config, pattern] of [
    [{}, /Saisissez l’adresse/],
    [{ address: 'http://u:p@1.2.3.4' }, /pas valide/],
    [{ address: 'x'.repeat(400) }, /pas valide/],
  ]) {
    const { gladys, inverter, start } = await setup({ config });
    await start(config);
    assert.equal(status(gladys).connected, false);
    assert.match(status(gladys).message.fr, pattern);
    assert.equal(reads(inverter), 0);
    assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), pattern);
  }
});

test('the inverter is discovered by its serial; no value before its device is created', async () => {
  const { gladys, store, start, logger } = await setup();
  await start();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, `Zeversolar ${SERIAL}`);
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Découverte/);
  assert.equal(store.data.serial, SERIAL);
  // The registry key of the Wi-Fi board is nowhere.
  const everything = JSON.stringify([
    logger.lines,
    store.data,
    gladys.fake.connectionStatuses,
    gladys.fake.discoveredDevices,
  ]);
  assert.ok(!everything.includes(REGISTRY_KEY));
});

test('a created device gets its values and its index; read-only, one GET a minute', async () => {
  const { gladys, inverter, start, wait } = await setup({ devices: [created()] });
  inverter.set({ power: 1500, energy: '5.20' });
  await start();
  assert.equal(last(gladys, 'power'), 1500);
  assert.equal(last(gladys, 'energy_today'), 5.2);
  assert.equal(last(gladys, 'production_index'), 5.2, 'a new device starts from the counter');
  assert.equal(last(gladys, 'awake'), 1);
  assert.equal(last(gladys, 'inverter_fault'), 0);
  assert.equal(last(gladys, 'cloud_connection'), 1);
  assert.match(status(gladys).message.en, /Connected to the Zeversolar inverter/);
  inverter.set({ power: 1600, energy: '5.25' });
  await wait(30_000);
  assert.equal(reads(inverter), 1, 'never two reads less than a minute apart');
  await wait(30_000);
  assert.equal(reads(inverter), 2);
  assert.equal(last(gladys, 'production_index'), 5.25);
  assert.ok(inverter.net.calls.every((c) => c.path === '/home.cgi' && c.init.method === 'GET'));
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
});

test('the night: asleep after 3 silent reads, power 0, the index never 0 nor dropped', async () => {
  const device = created({ index: { value: 1000, at: NOW - MINUTE } });
  const { gladys, inverter, start, wait } = await setup({ devices: [device] });
  inverter.set({ power: 20, energy: '12.40' });
  await start();
  assert.equal(last(gladys, 'production_index'), 1000, 'goes on from what Gladys holds');
  inverter.set({ power: 10, energy: '12.50' });
  await wait(MINUTE);
  assert.equal(last(gladys, 'production_index'), 1000.1);
  // Sunset: the Wi-Fi board goes away.
  inverter.down(timeoutError);
  await wait(MINUTE);
  await wait(MINUTE);
  assert.equal(status(gladys).connected, true, 'not red: the evening');
  assert.equal(last(gladys, 'power'), 10);
  await wait(MINUTE);
  assert.equal(last(gladys, 'power'), 0);
  assert.equal(last(gladys, 'awake'), 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /en veille/);
  // Asleep: one try every 5 minutes.
  const before = reads(inverter);
  await wait(SLEEP_INTERVAL - 1);
  assert.equal(reads(inverter), before);
  await wait(1);
  assert.equal(reads(inverter), before + 1);
  // The whole night.
  const indexes = indexStates(gladys).length;
  await wait(18 * HOUR);
  assert.equal(indexStates(gladys).length, indexes, 'no index at night');
  // Sunrise (the next day): the counter starts again from 0.
  inverter.set({ power: 15, energy: '0.0' });
  await wait(SLEEP_INTERVAL);
  assert.equal(last(gladys, 'awake'), 1);
  assert.equal(last(gladys, 'energy_today'), 0);
  assert.equal(last(gladys, 'production_index'), 1000.1, 'never 0, never a drop');
  inverter.set({ power: 300, energy: '0.05' });
  await wait(MINUTE);
  assert.equal(last(gladys, 'production_index'), 1000.15);
  assert.ok(indexStates(gladys).every((s) => s.state > 0));
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
});

test('sunrise with the counter of the day before: no index until the new day starts', async () => {
  const device = created({ index: { value: 500, at: NOW - MINUTE } });
  const { gladys, inverter, start, wait, app } = await setup({ devices: [device] });
  inverter.set({ power: 100, energy: '8.00' });
  await start();
  assert.equal(last(gladys, 'production_index'), 500);
  inverter.set({ count: 0 });
  await wait(MINUTE);
  assert.equal(last(gladys, 'awake'), 0);
  assert.match(status(gladys).message.fr, /carte Wi-Fi répond/);
  await wait(18 * HOUR);
  // The next morning, still yesterday's counter.
  inverter.set({ power: 20, energy: '8.00' });
  await wait(SLEEP_INTERVAL);
  assert.equal(app.stale, true);
  assert.match(status(gladys).message.fr, /compteur de la veille/);
  // Its new day: 0.1, then 1.1 kWh: counted from the new day only.
  inverter.set({ power: 50, energy: '0.10' });
  await wait(MINUTE);
  assert.equal(last(gladys, 'production_index'), 500);
  inverter.set({ power: 900, energy: '1.10' });
  await wait(10 * MINUTE);
  assert.equal(last(gladys, 'production_index'), 501);
});

test('an inverter that vanishes while producing: red at once, then asleep after an hour', async () => {
  const { gladys, inverter, start, wait } = await setup({ devices: [created()] });
  inverter.set({ power: 2500, energy: '10.0' });
  await start();
  inverter.down();
  await wait(MINUTE);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /injoignable.*1 min/);
  const before = reads(inverter);
  await wait(MINUTE);
  assert.equal(reads(inverter), before + 1);
  assert.match(status(gladys).message.fr, /2 min/);
  await wait(HOUR);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /en veille/);
  assert.equal(last(gladys, 'power'), 0);
});

test('no answer for more than a day: red, even at night', async () => {
  const { gladys, inverter, start, wait } = await setup();
  inverter.down();
  await start();
  await wait(5 * MINUTE);
  assert.match(status(gladys).message.fr, /en veille/);
  await wait(LONG_SILENCE);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /aucune lecture depuis plus d’un jour/);
});

test('a Wi-Fi board that answers without inverter for a day: red too', async () => {
  const inverter = createInverter();
  inverter.set({ count: 0 });
  const { gladys, start, wait } = await setup({ inverter });
  await start();
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /carte Wi-Fi répond/);
  await wait(LONG_SILENCE + SLEEP_INTERVAL);
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /aucune lecture/);
  inverter.set({ power: 30 });
  await wait(SLEEP_INTERVAL);
  assert.equal(status(gladys).connected, true);
});

test('429 and 5xx: a bounded pause kept in /data, never a read before its end', async () => {
  const store = createMemoryStore();
  const inverter = createInverter();
  inverter.answer = () => text('busy', { status: 429, headers: { 'retry-after': '1' } });
  const { gladys, start, wait, clock } = await setup({ store, inverter });
  await start();
  assert.match(status(gladys).message.fr, /demande d’attendre/);
  assert.equal(store.data.pause.until, clock.now + PAUSE_MIN, 'never shorter than a poll');
  const before = reads(inverter);
  await wait(30_000);
  assert.equal(reads(inverter), before);
  // A restart keeps the pause; a pause from /data far in the future is capped.
  const far = createMemoryStore({
    pause: { until: clock.now + 1000 * HOUR, count: 3, code: 'server', status: 503 },
  });
  const other = createInverter();
  const again = await setup({ store: far, now: clock.now, inverter: other });
  await again.start();
  assert.equal(reads(other), 0);
  assert.match(status(again.gladys).message.fr, /6 h/);
  assert.equal(
    (await again.gladys.fake.action(ACTIONS.TEST)).data.message.fr.includes('6 h'),
    true,
  );
  assert.equal(reads(other), 0, 'the test button never forces a read during a pause');
  // A 503 doubles the pause; back to normal, it ends.
  inverter.answer = () => text('err', { status: 503 });
  await wait(30_000);
  assert.equal(store.data.pause.count, 2);
  assert.equal(store.data.pause.code, 'server');
  inverter.set({});
  await wait(2 * PAUSE_MIN);
  assert.equal(status(gladys).connected, true);
  assert.equal(store.data.pause, null);
});

test('the pace: a reconnection, a save, a scan, the buttons, a creation never read sooner', async () => {
  const store = createMemoryStore();
  const { app, gladys, inverter, start, wait, clock } = await setup({ store });
  await start();
  assert.equal(reads(inverter), 1);
  await wait(10_000);
  await start(); // a reconnection to Gladys
  await start({ ...CONFIG }); // the same configuration saved
  await app.scan();
  const tested = await gladys.fake.action(ACTIONS.TEST);
  assert.match(tested.data.message.fr, /Dernière lecture il y a 10 s/);
  assert.match(tested.data.message.fr, /Prochaine lecture dans 50 s/);
  await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await app.onDeviceCreated(gladys.fake.discoveredDevices[0]);
  await app.idle();
  assert.equal(reads(inverter), 1);
  assert.equal(status(gladys).connected, true);
  assert.ok(discoveries(gladys) >= 3, 'Discovery sent again each time');
  await wait(50_000);
  assert.equal(reads(inverter), 2);
  // A restart of the container: the time of the last read is in /data.
  assert.equal(store.data.lastAttemptAt, clock.now);
  const other = createInverter();
  const again = await setup({ store, now: clock.now + 20_000, inverter: other });
  await again.start();
  assert.equal(reads(other), 0);
  await again.wait(39_999);
  assert.equal(reads(other), 0);
  await again.wait(1);
  assert.equal(reads(other), 1);
  // A date of /data in the future (a clock set back) waits one interval from now.
  const future = createMemoryStore({ lastAttemptAt: NOW + 10 * HOUR });
  const third = await setup({ store: future, inverter: createInverter() });
  await third.start();
  assert.equal(reads(third.inverter), 0);
  await third.wait(POLL_INTERVAL);
  assert.equal(reads(third.inverter), 1);
});

test('the test button reads when a read is due, and says what it read', async () => {
  const inverter = createInverter();
  inverter.set({ power: 777 });
  const { gladys, start, wait } = await setup({ inverter });
  await start();
  await wait(POLL_INTERVAL);
  assert.equal(reads(inverter), 2);
  // Not due: the last read, no request.
  const recent = await gladys.fake.action(ACTIONS.TEST);
  assert.match(
    recent.data.message.en,
    new RegExp(`Read now: Zeversolar inverter ${SERIAL} \\(board M10\\), 777 W`),
  );
  assert.equal(reads(inverter), 2);
  inverter.down();
  await wait(POLL_INTERVAL);
  const down = await gladys.fake.action(ACTIONS.TEST);
  assert.match(down.data.message.fr, /injoignable|Dernière lecture/);
});

test('a late answer of the old address publishes nothing and sets no status', async () => {
  const inverter = createInverter();
  inverter.set({ power: 4321, energy: '3.0' });
  const { app, gladys, wait, advance } = await setup({ inverter, devices: [created()] });
  inverter.net.hold = true;
  await app.start(CONFIG);
  const running = advance(0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reads(inverter), 1);
  // The user enters another address while the first answer is on its way.
  inverter.net.hold = false;
  await app.start({ address: '192.168.1.61' });
  const statuses = gladys.fake.connectionStatuses.length;
  inverter.net.release();
  await running;
  await app.idle();
  assert.equal(last(gladys, 'power'), undefined, 'not one value of the old answer');
  assert.equal(gladys.fake.connectionStatuses.length, statuses, 'no status from the old answer');
  // The new address reads at its time (never sooner than a minute).
  inverter.set({ power: 100, energy: '3.1' });
  await wait(POLL_INTERVAL);
  assert.equal(reads(inverter), 2);
  assert.equal(inverter.net.calls[1].host, '192.168.1.61');
  assert.equal(last(gladys, 'power'), 100);
});

test('the test button makes the read when one is due', async () => {
  const inverter = createInverter();
  inverter.set({ power: 640 });
  const { app } = await setup({ inverter });
  await app.start(CONFIG);
  // The timer of the first read has not fired yet: the click makes it.
  const answer = await app.testConnection();
  assert.match(answer.en, /Read now: Zeversolar inverter .*640 W\. Next read in 1 min/);
  assert.equal(reads(inverter), 1);
  assert.match((await app.testConnection()).en, /Next read in 1 min/);
  assert.equal(reads(inverter), 1);
});

test('another inverter at the address: its values go to its own device, never the old one', async () => {
  const inverter = createInverter();
  const { gladys, start, wait } = await setup({ inverter, devices: [created()] });
  inverter.set({ power: 1000, energy: '2.0' });
  await start();
  assert.equal(last(gladys, 'power'), 1000);
  inverter.set({ serial: 'ZS15004513777777', power: 50, energy: '9.0' });
  await wait(POLL_INTERVAL);
  assert.equal(last(gladys, 'power'), 1000, 'the old device keeps its value');
  assert.equal(last(gladys, 'power', 'ZS15004513777777'), undefined);
  assert.ok(gladys.fake.discoveredDevices.some((d) => d.external_id.endsWith('ZS15004513777777')));
  assert.match(status(gladys).message.fr, /Découverte/);
  // An answer without inverter (the night) is not another inverter.
  inverter.set({ count: 0 });
  await wait(POLL_INTERVAL);
  assert.match(status(gladys).message.fr, /veille/);
});

test('an index jump is held by the guard, shown, and taken only by the accept button', async () => {
  const store = createMemoryStore({
    serial: SERIAL,
    indexes: {
      [F('production_index')]: {
        guard: null,
        daily: { offset: 1495, today: 5, readAt: NOW - MINUTE, readDay: '2026-10-21' },
      },
    },
  });
  const device = created({ index: { value: 1000, at: NOW - MINUTE } });
  const inverter = createInverter();
  inverter.set({ power: 100, energy: '5.00' });
  const { gladys, start, wait } = await setup({ devices: [device], store, inverter });
  await start();
  assert.equal(last(gladys, 'production_index'), 1000, 'the last accepted value, never the jump');
  assert.match(status(gladys).message.fr, /a sauté de 1000 à 1500 kWh/);
  assert.equal(store.data.indexes[F('production_index')].guard.held.to, 1500);
  // A save of the form accepts nothing.
  await start({ ...CONFIG });
  assert.match(status(gladys).message.fr, /a sauté/);
  const answer = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(answer.data.message.en, /500 kWh/);
  await wait(POLL_INTERVAL);
  assert.equal(last(gladys, 'production_index'), 1500);
  assert.doesNotMatch(status(gladys).message.fr, /retenu/);
  const nothing = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(nothing.data.message.en, /nothing to accept/);
});

test('a wrong answer: red, retries doubled, never "another device"', async () => {
  const inverter = createInverter();
  inverter.answer = () => text('<html>router</html>');
  const { gladys, start, wait } = await setup({ inverter, devices: [created()] });
  await start();
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /page d’état/);
  await wait(MINUTE);
  assert.equal(reads(inverter), 2);
  await wait(MINUTE);
  assert.equal(reads(inverter), 2, 'doubled: 2 min');
  await wait(MINUTE);
  assert.equal(reads(inverter), 3);
  assert.equal(gladys.fake.states.length, 0);
});

test('every connection publishes the status and the device again', async () => {
  const { app, gladys, start } = await setup({ devices: [created()] });
  await start();
  const statuses = gladys.fake.connectionStatuses.length;
  const discovered = discoveries(gladys);
  await app.start(CONFIG);
  await app.idle();
  assert.ok(gladys.fake.connectionStatuses.length > statuses);
  assert.ok(discoveries(gladys) > discovered);
  assert.equal(status(gladys).connected, true);
});
