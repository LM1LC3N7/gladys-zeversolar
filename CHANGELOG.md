# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.7] - 2026-10-29

### Fixed

- The counter guard keeps an accepted jump as a floor: a reading back under
  it is now held (never counted) until the index is back to the value
  accepted.

## [0.1.6] - 2026-10-25

### Fixed

- Reads never started with a real clock on a fresh install.

## [0.1.5] - 2026-10-23

## [0.1.4] - 2026-10-22

### Fixed

- Small days (snow, a dark winter day ending at 0.1 kWh or less) are no
  longer lost one after the other: a fresh counter at sunrise under half of
  the day before is the new day, not "the day before shown again" (the
  status no longer says so every morning). A slow rise of today's counter
  through the level of the day before is never kept out either: small days
  of 0.1 to 0.2 kWh and days ending close to the day before lose nothing
  more than their first value.

## [0.1.3] - 2026-10-22

### Fixed

- An inverter whose midnight comes before the container's (midnight sun with
  its clock ahead, or a house several hours east of Gladys' time zone): the
  counter of the day before shown again the next day is no longer counted
  in the energy index (its mark is dated by the day the reset starts).

## [0.1.2] - 2026-10-22

### Fixed

- Without a peak power typed, an outage that ends in full sun no longer loses
  the rest of the day: the power of that first reading (when plausible)
  widens the margin of the energy index for that reading only, without
  becoming a learned peak.
- An aberrant power (65535 W, or above 25 kW, beyond any Zeversolar model)
  never becomes the learned peak, even seen twice in a row or during the
  first week.

## [0.1.1] - 2026-10-21

### Added

- Local reading of Zeversolar solar inverters through the status page of their
  Wi-Fi board (`/home.cgi`), as the zeversolar library does: no cloud, no
  account, one GET a minute (every 5 minutes at night), never faster whatever
  asks (reconnection, save, test button, Discover tab, restart: the time of
  the last read is kept in `/data`).
- One device per inverter (`inverter:<serial>`): solar power, energy of the
  day, inverter awake, inverter fault, link to the maker's cloud.
- A solar production index for the Gladys energy monitoring, built from the
  counter of the day (a new day never drops it, doubts settled on the side of
  counting less) and checked by the guard of gladys-p1-monitor: never 0, a
  jump or a drop held back, a jump taken only by the "Accept the held index"
  button; its 30-minute
  production declared with stable ids.
- The night: three silent reads (or a Wi-Fi board answering without inverter)
  and the inverter is asleep: power 0, green status, no index; red only for
  an inverter that vanishes while producing, a wrong answer, or a day of
  silence. A stale counter of the day before at sunrise is kept out of the
  index.
- 429 and 5xx: a bounded pause (1 min to 6 h) kept in `/data`. Answers bounded
  to 4 KiB and 10 s, no redirect followed, every field checked.
- Read-only: none of the library's commands (on/off, power limit) is ported.
- Guides in English and French, cover image, third-party notices in the image.
- An optional peak power of the installation (kWp): the margin of the energy
  index, the same for the daily index and the guard; learned from the power
  read over a week when empty (2 to 30 kW).
- The counter of the day before shown again (at sunrise, or after a restart
  during the day, within 0.1 kWh of the last value read, above or below) is kept out of the
  index and of the energy of the day; its marks are kept in `/data`.
- A drop of the built index is never accepted: it corrects itself.
- A Wi-Fi board answering without its inverter right after production, or
  another board at the address, is red and writes nothing into the device.
- A new address of the same inverter reaches the Discovery list at its first
  reading.

[Unreleased]: https://github.com/LM1LC3N7/gladys-zeversolar/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/LM1LC3N7/gladys-zeversolar/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/LM1LC3N7/gladys-zeversolar/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/LM1LC3N7/gladys-zeversolar/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/LM1LC3N7/gladys-zeversolar/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/LM1LC3N7/gladys-zeversolar/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-zeversolar/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-zeversolar/releases/tag/v0.1.1
