# Zeversolar for Gladys Assistant

Unofficial connector, not affiliated with Zeversolar. It reads your Zeversolar
solar inverter on your home network, through the status page of its Wi-Fi
board, without any cloud and without any account.

**Never tested with a real Zeversolar inverter**: it was built from the
zeversolar library (the one Home Assistant uses) and the examples of its
documentation. Please report what you see (see "Feedback" below).

## What you get

One Gladys device per inverter, named after its serial number:

| Feature                       | What it is                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| Solar production (W)          | the power the inverter produces now; 0 at night                                         |
| Solar energy of the day (kWh) | the counter of the day of the inverter, as it gives it                                  |
| Solar production index (kWh)  | a cumulative index for the Gladys energy monitoring (production per half hour, revenue) |
| Inverter awake                | 1 while the inverter produces or is ready, 0 asleep (the night)                         |
| Inverter fault                | 1 when the inverter reports an error                                                    |
| Link to the Zeversolar cloud  | 1 when the Wi-Fi board is connected to the maker's cloud                                |

Read-only: the integration never sends a command to the inverter (no on/off,
no power limit).

## Setting it up

1. Find the IP address of the inverter in your router (its Wi-Fi board shows
   up as a device of your network). Give it a fixed address if you can.
2. In Gladys, open the integration, enter the address (by day: at night the
   inverter sleeps and does not answer), and save.
3. Open the "Discover" tab and create the device. Its values come at the next
   read (within a minute by day).
4. Optional but recommended: enter the peak power of your panels (kWp, on the
   installer's invoice). It bounds what the energy index may take between two
   reads. Left empty, it is learned from the power the inverter reaches over a
   week (30 kW until then, which lets more odd readings through). Never enter
   less than the real peak power (a long silence at noon could then lose the
   rest of the day): in doubt, leave it empty.

The "Test the connection" button reads the inverter if a read is due, and
otherwise tells the last read: the integration never reads more than once a
minute, whatever asks.

## The night

A Zeversolar inverter is powered by its panels: at sunset it stops, and its
Wi-Fi board either answers without production or goes silent. That is not an
error: after three silent reads (or at once when the board says so), the
inverter is "asleep", its power goes to 0, the status stays green and says so,
and it is read every 5 minutes until it wakes up. The status turns red if the
inverter vanishes (or its board answers without it) while producing 50 W or
more, if another Wi-Fi board answers at the address, if the answer is not its
status page, or if there is no reading for more than a day; after an hour of
silence it is considered asleep anyway.

## The energy index

The inverter only gives a counter of the day (it starts again every morning),
never a lifetime counter, while the Gladys energy monitoring counts the rises
of a cumulative index. So the integration builds one: the index goes on from
its last value and adds what the counter of the day adds. It never goes back
to 0 and never drops: a new day (the counter back to 0 in the morning) leaves
it where it was. When the inverter shows the counter of the day before again
(at sunrise, or after a restart during the day), that value is kept out of the
index and out of the energy of the day. Doubts are settled on the side of
counting less: a reboot of the inverter that really resets its counter during
the day, a counter that jumps (the rest of that day may then be lost), hours
without reads around the change of day, a wall clock set wrong.

Risk left (it would count too much): a value of the day before shown again
more than 0.1 kWh from the last value read, above or below, or any wrong reading that fits
within the peak power of the installation since the last read. Entering the
peak power keeps that margin small. On very small days (snow, a dark winter
day ending at 0.1 kWh or less), the day before shown again while today's
counter is already close to it may be counted: about 0.1 kWh at most.

The index also goes through a guard: a jump of the index itself is held back,
shown in the integration status, and only taken when you click "Accept the
held index" in the configuration (it is then counted at once). A drop of the
index is never accepted: it corrects itself, the index goes on once the
counter is back above it. Saving the configuration never accepts anything.

## Limits

- Only the first inverter is read when the Wi-Fi board reports several.
- The energy of the day comes as the library reads it: one decimal digit is
  a missing zero ("14.9" means 14.09 kWh).
- Production after the local midnight (far north in June, or a Gladys time
  zone east of the house): the reset of the counter falls on the same local
  day and that day is undercounted.
- The integration needs Gladys 5.2.0 or later.

## Privacy

Nothing leaves your network: the integration only talks to the address you
entered, with one small GET a minute (every 5 minutes at night). The registry
key of the Wi-Fi board (its key for the maker's cloud) is never kept, logged
or shown; of its registry id only a short fingerprint is kept (to tell one
board from another).

## Feedback

Issues and pull requests: <https://github.com/LM1LC3N7/gladys-zeversolar>. If
you own a Zeversolar inverter, the text of `http://<address>/home.cgi` (by day
and at night, with the registry key and serial numbers hidden) helps a lot.
