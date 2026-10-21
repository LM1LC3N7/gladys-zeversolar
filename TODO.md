# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real Zeversolar inverter (an M10 and
      an M11 Wi-Fi board ideally): test button, device creation, the night,
      a sunrise, the production the core derives from the index.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Run the store validator (`npx github:GladysAssistant/integration-store .`):
      the development agent could not run it.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real inverter (built without one)

- [ ] The page `/home.cgi` and its fields as the library's README lists them,
      by day and at night: does the Wi-Fi board answer at night (with 0
      inverter, as README example 5) or go silent?
- [ ] The energy of the day: back to 0 at sunrise (or at midnight)? Does the
      inverter show the counter of the day before when it wakes up (the app
      keeps such a value out of the index)? Is it reset by a reboot during
      the day?
- [ ] The "missing leading zero" of the library (`14.9` = 14.09 kWh) on every
      firmware.
- [ ] The cloud status field (`0`/`OK` = connected) and the inverter status
      (`OK`/`ERROR`).
- [ ] The layout with several inverters on one board (only the first is read).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-zeversolar:0.1.0`),
  as for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: zeversolar (kvanzuijlen, Apache-2.0, 0.4.0, `main` at
  commit d28f158), cloned read-only in `_ref/zeversolar`, ported to
  JavaScript: the page, the fields, the leading zero, the timeout. The SDK
  stays the only runtime dependency. The guard (`src/guard.js`, from
  gladys-p1-monitor), the daily index (`src/daily.js`), the store and the
  address parser are gladys-imeon's (approved), taken as they are. The
  template's demo files were removed with `git rm` (they stay in the history).
- **Read-only (v1)**: no `onSetValue`; the library's `inv_ctrl.cgi`,
  `pwrlim.cgi` and `adv.cgi` are not ported. A power command would cut the
  production of the house; it would need an option disabled by default, a
  read-back and a real inverter to test.
- **External id**: `inverter:<serial>` (the serial of the status page,
  checked `[A-Za-z0-9_-]{4,40}`), one inverter per integration; the address
  is only a param. The serial is in the same answer as the values: every read
  carries its own identity, so a DHCP swap or another inverter at the address
  never writes into the old device (its values go to its own device, offered
  in Discovery). An answer without inverter (the night) or a wrong answer is
  never "another inverter". The serial is kept in `/data` so that the created
  device is offered at a restart by night.
- **Energy index (lot 6 rules, gladys-imeon model)**: the status page gives
  only a counter of the day, no lifetime counter. `src/daily.js` builds the
  index (`offset + today`, the day's first value never counted, any doubt
  counts less); the result goes through `IndexGuard` with `maxKw` 30 kW (the
  largest Zeversolar inverters are 20 kW) and `slackKwh` 0.5. Zeversolar
  specifics:
  - the counter drops at sunrise, after a night without reads: the "earlier
    local day" rule of `src/daily.js` takes it (a cut across midnight, read on
    the monotonic clock);
  - a counter still equal to the last value taken on a later local day (the
    inverter shows the day before) is kept out of the index
    (`staleCounter`): otherwise the day before would be dated today and the
    real drop refused all day. It does not move the time of the last counter
    read either;
  - the index is never published at night (asleep), never 0 (the guard and
    `readingStates` both refuse it), never a fallback value;
  - `energy_today` is `energy-production-sensor` / `daily-production` (kWh), as
    gladys-apsystems; `production_index` is `energy-production-sensor` /
    `index`, its `thirty-minutes-production` declared with UUID v5 ids, as
    gladys-apsystems and gladys-imeon. No `publishEnergyConsumption`, no
    `daily-consumption` (tested).
- **The night** (gladys-apsystems rules): a Wi-Fi board answering 0 inverter
  is asleep at once; no answer (timeout, unreachable) three reads in a row
  with a last power under 50 W, or for an hour whatever the power, is asleep:
  power 0, `awake` 0, green status that says so, one read every 5 minutes.
  Red: an inverter that vanishes producing 50 W or more (retries 1 min
  doubled to 15 min), a wrong answer (not the status page, 404, another HTTP
  error), or no reading of the inverter itself for more than a day (a board
  answering 0 inverter for a day included: a dead inverter, snow).
- **Pace (lot 11 lessons)**: one timer, one read at a time, never two reads
  less than the interval apart (1 min, 5 min asleep) whatever asks: a
  reconnection, a save of an unchanged (or changed) configuration, the
  Discover tab, a device created, the accept button only wait for the next
  read; the test button makes the read only when one is due, otherwise tells
  the last one and when the next comes; the time of the last read is written
  in `/data` before the request (at most once a minute) so a restart of the
  container waits too (a date in the future is brought back to now). A
  reconnection during a read does not start another one.
- **Late answers (lot 11)**: a read belongs to the session of its address; an
  answer arriving after the address changed (or after a stop) publishes
  nothing and sets no status, checked after every await.
- **429 / 5xx**: pause `{ until, count, code, status }` in `/data`, from
  Retry-After or 1 min doubled, bounded 1 min to 6 h; the end read back is
  capped at 6 h from the load; a reconnection or a save keeps it (only another
  address ends it); the test button never reads during it.
- **Hostile answers**: 4 KiB read into one buffer allocated once (no list of
  chunks), 10 s for the whole answer, no redirect followed, 64 fields at most,
  every field against a strict pattern, no object built from the answer's
  keys, nothing read as 0 by default; powers above 100 kW and counters above
  1,000 kWh are glitches (not published, no index).
- **Secrets**: none in the configuration. The registry key of the Wi-Fi board
  (field 3, a key for the maker's cloud) is dropped by the parser: never kept,
  logged, published or shown (tested). Errors and logs use our own codes only.
- **States**: `publishChangedStates` with a 10-minute heartbeat: at most 6
  states a minute, far below the 300 states a minute of Gladys. No scene
  event (`publishSceneEvent` is never called).
- **Every connection** publishes the status and the Discovery list again, and
  forgets the published states (all sent again at the next read).
- **No custom User-Agent**, no imitation: Node's own fetch, one GET.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

## Ideas

- Scene triggers (production started/stopped, inverter fault) and a "solar"
  widget, with gladys-apsystems' vocabulary.
- Several inverters on one Wi-Fi board, once the layout is confirmed.
- The power limit (M11 `pwrlim.cgi`, M10 `adv.cgi`) behind an option
  disabled by default, once tested on a real inverter.
