# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below, distributed under its own
license, also the Apache License 2.0 (its full text is the `LICENSE` file of
this repository).

## zeversolar (kvanzuijlen/zeversolar)

<https://github.com/kvanzuijlen/zeversolar>, by Koen van Zuijlen, the library
the Zeversolar integration of Home Assistant uses. Version 0.4.0
(`pyproject.toml`), branch `main` at commit d28f158.

Ported to JavaScript in `src/zeversolar/client.js` and
`src/zeversolar/model.js`: the status page read (`GET /home.cgi`, plain text,
fields separated by spaces or new lines), the meaning and order of its fields
(Wi-Fi, registry id and key, hardware and software versions, reported time and
date, cloud communication status, number of inverters, serial number, the
optional inverter version of older firmware, power, energy of the day, status),
the "missing leading zero" of the energy of the day (`14.9` is 14.09 kWh), the
10 s timeout, and the five example pages of its README used as test fixtures.
Changed here: read-only (the library's power commands `inv_ctrl.cgi`,
`pwrlim.cgi` and `adv.cgi` are not ported), a page without inverter (the
night) is a state rather than an error, several inverters do not fail the read
(the first one is read, as the library does), the registry key is never kept,
every field is checked against a strict pattern, and the answer is bounded in
size and time.

Its license notice, reproduced as it appears in its `LICENSE.md` file:

```
Copyright [2022] [kvanzuijlen]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## gladys-imeon and gladys-p1-monitor

The plausibility guard of the energy index (`src/guard.js`, from
gladys-p1-monitor, its margin made a parameter), the cumulative index built
from a counter of the day (`src/daily.js`), the `/data` store
(`src/store.js`) and the address parser (`src/config.js`) come from the
sibling integrations [gladys-imeon](https://github.com/LM1LC3N7/gladys-imeon)
and [gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor), same
project, Apache-2.0.
