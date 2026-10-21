# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads a **Zeversolar solar inverter** through the status page of its Wi-Fi
board (`GET http://<address>/home.cgi`, plain text, no login, no cloud). The
page and its fields are ported from
[zeversolar](https://github.com/kvanzuijlen/zeversolar) (kvanzuijlen,
Apache-2.0, see `THIRD_PARTY_NOTICES.md`). Unofficial: not affiliated with
Zeversolar. **Read-only**: never `onSetValue`, never the library's commands.
Siblings: `gladys-imeon` (the daily index, the guard, the store),
`gladys-apsystems` (the night, the production index and its 30-minute
production), `gladys-p1-monitor` (the guard).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run cover                             # cover.png, 800 x 534, plain Node
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        ZeverApp: the pace, the night, the index, pauses, buttons
src/zeversolar/client.js          the only HTTP access (one GET, bounded, our error codes)
src/zeversolar/model.js           the status page -> values (pure)
src/daily.js                      a cumulative index built from a counter of the day (gladys-imeon, pure)
src/guard.js                      plausibility of an energy index (gladys-p1-monitor, pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the device, feature keys, states (pure)
src/config.js                     the address, normalized
src/constants.js                  page, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
scripts/cover.mjs                 the cover image
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys, a fake inverter, a virtual clock
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Energy monitoring**: `production_index` (`energy-production-sensor` /
  `index`, with its `thirty-minutes-production` declared with UUID v5 ids) is
  the only index. It is built from the counter of the day by `src/daily.js`
  (a new day never drops it; doubts are settled on the side of counting
  less) and passes `IndexGuard` (`src/guard.js`): never 0, a drop and a jump
  never confirmed by repetition nor by time; a jump taken only by the
  `accept_held_index` action, bounded to the value shown; a drop NEVER
  accepted (it corrects itself, review 1 I2). The counter of the day before
  shown again is kept out by `keptOut` in `src/app.js` (its marks in /data,
  review 1 B1/I1); both use the installation's `maxKw` (peak power typed,
  else learned, 2 to 30 kW, I3). Risk left, documented: a day before shown
  more than 0.1 kWh from the last value read (above or below), or a wrong reading within
  `maxKw` since the last read. Never published at night. `energy_today` stays
  the inverter's counter (`daily-production`), not sent when kept out: never
  an index, never `publishEnergyConsumption`. Do not change `src/daily.js` or
  `src/guard.js` without the same change in gladys-imeon / gladys-p1-monitor
  and a review.
- **The night is not an error** (see TODO.md "Decisions"): asleep after three
  silent reads with a low power, at once when its own board answers 0
  inverter after a low power, after an hour of silence whatever the power.
  Red for a producing inverter that vanishes (or whose board answers without
  it), another board at the address, a wrong answer, a day without any
  reading.
- **The pace**: never two reads less than the interval apart, whatever asks;
  the time of the last read is in `/data`. Never add a read path that skips
  `dueAt()`.
- **Late answers**: every await in a read is followed by `gone()`; an old
  session never publishes nor sets a status.
- **Pauses**: 429/5xx pause from 1 min to 6 h, kept in `/data` (end capped
  when read back); a reconnection clears neither a pause nor the client.
- **Never a text of the inverter in a message**, never a URL in the logs;
  the registry key (field 3 of the page) never leaves the parser.
- **External ids are forever**: `inverter:<serial>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys and actions. The device has the same
  features for every inverter: a new feature must be added for all, never
  removed.
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/zeversolar-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code.
- **User-facing text** is bilingual (English and French): runtime messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync. Files are
  UTF-8 without BOM nor control bytes (`test/encoding.test.js`, sources
  included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## CI and pushes

- Group the commits and push **at most once a day**, unless the maintainer
  explicitly asks otherwise: the GitHub Actions quota is limited.
- If every CI job fails in under 2 seconds, the quota is exhausted: it is not
  a bug in the code.

## Checking an answer against a real inverter

By day, on the same LAN as the inverter:

```bash
curl -s "http://192.168.1.60/home.cgi"; echo
```

Hide the registry key (the fourth field) and the serial numbers before the
answer becomes a fixture.
