# gladys-zeversolar

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for
**Zeversolar solar inverters**, not affiliated with Zeversolar. It reads the
local status page of the inverter's Wi-Fi board (`/home.cgi`, no cloud, no
account) once a minute: solar power, energy of the day, and a guarded solar
production index for the Gladys energy monitoring, built from the counter of
the day. The night is handled (the inverter sleeps: power 0, no error).
Read-only.

**Never tested with a real Zeversolar inverter.** Built from the
[zeversolar](https://github.com/kvanzuijlen/zeversolar) library (Apache-2.0,
see `THIRD_PARTY_NOTICES.md`), the one Home Assistant uses.

- User guide: [English](docs/en.md), [français](docs/fr.md)
- Changes: [CHANGELOG.md](CHANGELOG.md)
- What is left to check: [TODO.md](TODO.md)
- Rules for contributors: [CLAUDE.md](CLAUDE.md)

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run audit
npm run cover        # regenerates cover.png (800 x 534, plain Node)
```

Node 22 or later. The only runtime dependency is
`@gladysassistant/integration-sdk`.

## License

Apache-2.0, see `LICENSE` and `THIRD_PARTY_NOTICES.md`.
