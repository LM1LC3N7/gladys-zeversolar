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
      firmware (review 1, M4). README example 4 (`19.70`) says two decimals
      with a trailing zero; a firmware printing `14.9` for 14.90 would be read
      14.09: the morning undone around each X.10, then held drops (a review
      scenario: 47.65 counted 28.88, less). Proper tenths would count a little
      less (47.04), never more.
- [ ] Field 2 of the page (registry id, or serial "if 01 == 0|3" per the
      README) is the same by night and by day (review 2, m3): otherwise the
      board fingerprint changes at night and "another Wi-Fi board" turns red
      every night. README examples 4 and 5 (the same board by day and by
      night) say it is.
- [ ] A peak power typed lower than the real one (review 2, m4) narrows the
      margin: a long silence at noon can lose the rest of the day (less).
      The docs and the manifest say never to type less, and to leave it
      empty in doubt.
- [ ] Production after the local midnight (review 1, M3: far north in June,
      or a Gladys time zone east of the house): the reset at wake-up falls on
      the same local day and is refused (Helsinki scenario 84.08 -> 28.71,
      less). Option to weigh, in src/daily.js and gladys-imeon alike: a new
      day after a sleep of at least an hour on the monotonic clock.
      In the same domain, fixed in 0.1.3 (the gladys-imeon 0.1.2 "early
      midnight" defect): a reset read from 23:00 to 23:59 container time
      (midnight sun with the inverter's clock 20 or 55 min ahead, or a house
      5 to 7 h east of Gladys' time zone) dated the mark of the day before by
      the day that ends, so the day before shown again the next day was
      counted (+15.8 and +9.1 kWh in the first week without kWp). The mark
      is now dated by `daily.window(now).key` (the night it starts) and the
      "again" branch of `keptOut` accepts that key too
      (test/earlyMidnight.*.test.js).
- [ ] Wall clock set wrong (review 1, M5: +1 day at 17:00, -1 day at night,
      +12 h at 13:00): a day lost each time (less), the approved gladys-imeon
      behaviour, for the record.
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
  index (`offset + today`, the day's first value never counted, doubts
  settled on the side of counting less); the result goes through
  `IndexGuard` with `slackKwh` 0.5 and the installation's `maxKw`.
  Zeversolar specifics:
  - review 1, I3: `maxKw`, the SAME for `src/daily.js` and the guard (both
    take it as a parameter, files unchanged): 1.25 x the optional
    `peak_power_kw` of the configuration, else 1.5 x the highest power of the
    last 30 local days (`peaks` in /data, one per day) once 7 days are known,
    else 30 kW; rounded up to 0.5 kW, bounded 2 to 30 kW. When it changes,
    the guard and the daily index are built again from their own state (a
    pending acceptance is then dropped: the user accepts again; to do later
    (review 2): apply it again after the rebuild when `held.to` did not
    change). The peaks are shared by every serial (review 2, m2: a DHCP swap
    to a bigger inverter widens the margin of the first one; to do later:
    keep them per serial). A power above 1.5 x the typed peak power is never
    a peak; above 1.5 x the highest of the last 30 days, only when seen
    twice in a row (review 2, m1: a 65535 W error value); above 25 kW
    (`PLAUSIBLE_POWER_MAX`, the largest model is 20 kW), never, even twice
    or in the first week (0.1.2, n2). Without a typed peak power, a
    plausible power above the margin widens it for THAT read only, never
    recorded (0.1.2, n1: an outage ending in full sun after a dull month,
    97 kWh real were counted 64.6, now 96.9); counting too much then needs a
    wrong counter AND a wrong power in the same answer. Note: after a
    jump, `src/daily.js` takes nothing more that day (the margin then runs
    from each refused read): the rest of the day is lost (less);
  - the counter drops at sunrise, after a night without reads: the "earlier
    local day" rule of `src/daily.js` takes it (a cut across midnight, read on
    the monotonic clock). Every sunrise being a cut, the undo after a gap of
    `src/daily.js` never applies here: review 1, B1;
  - review 1, B1 and I1 (`keptOut` in `src/app.js`, marks per index in
    /data `ref`): (a) at a new day, `dayBefore = { day, value: max(the last
value of the day before, the highest stale value kept out at that
sunrise) }`; (b) a read of that local day within [dayBefore - 0.1 kWh,
    dayBefore + 0.1 kWh] while the counter taken today is under dayBefore -
    0.1 kWh is kept out (a reboot showing the day before again); (c) at
    sunrise (a later local day than the last value taken), a read within
    [last - 0.1 kWh, last + 0.1 kWh] is kept out (`staleSeen`); (d) a read kept
    out moves nothing (not a counter read) and its `energy_today` is not sent
    (M2). A slow pass of the real counter through the band costs nothing (it
    is a rise, taken once above it). Replayed on the review scenarios (Z0 to
    Z9, Z1e, Z3e, Z3s, Z6, Z6b): no excess left. Risk left, documented: a
    day before shown more than 0.1 kWh from the last value read (above or below; review 2, R1: the band below was 5 Wh, a day before 0.05 kWh under our last read counted up to +4.5 kWh), or a wrong
    reading within `maxKw` since the last read;
  - review 1, I2: a DROP of the built index is never accepted (it only
    happens when the daily index takes back values already published, or a
    /data older than Gladys; never a new meter): the status says it corrects
    itself, the button answers that there is nothing to accept. Jumps keep
    their acceptance. The same code is in gladys-imeon (approved): to report;
  - the index is never published at night (asleep), never 0 (the guard and
    `readingStates` both refuse it), never a fallback value;
  - `energy_today` is `energy-production-sensor` / `daily-production` (kWh), as
    gladys-apsystems; `production_index` is `energy-production-sensor` /
    `index`, its `thirty-minutes-production` declared with UUID v5 ids, as
    gladys-apsystems and gladys-imeon. No `publishEnergyConsumption`, no
    `daily-consumption` (tested).
- **The night** (gladys-apsystems rules): its own Wi-Fi board answering 0
  inverter is asleep at once after a power under 50 W; after 50 W or more it
  is red ("the board answers without its inverter") and asleep after an hour
  (review 1, M1). The board is told by a 12-hex fingerprint of its registry
  id (field 2, never the key; kept in /data with the serial): a page without
  inverter from another board writes nothing into the device and is red
  ("another Wi-Fi board"). No answer (timeout, unreachable) three reads in a row
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
  forgets the published states (all sent again at the next read). The first
  reading of a session (a new address) publishes the Discovery list again,
  with the new address (review 1, M6).
- **No custom User-Agent**, no imitation: Node's own fetch, one GET.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

## Ideas

- Scene triggers (production started/stopped, inverter fault) and a "solar"
  widget, with gladys-apsystems' vocabulary.
- Several inverters on one Wi-Fi board, once the layout is confirmed.
- The power limit (M11 `pwrlim.cgi`, M10 `adv.cgi`) behind an option
  disabled by default, once tested on a real inverter.
