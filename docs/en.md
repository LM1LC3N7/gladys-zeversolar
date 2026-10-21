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

The "Test the connection" button reads the inverter if a read is due, and
otherwise tells the last read: the integration never reads more than once a
minute, whatever asks.

## The night

A Zeversolar inverter is powered by its panels: at sunset it stops, and its
Wi-Fi board either answers without production or goes silent. That is not an
error: after three silent reads (or at once when the board says so), the
inverter is "asleep", its power goes to 0, the status stays green and says so,
and it is read every 5 minutes until it wakes up. The status turns red only if
the inverter vanishes while producing, answers something that is not its
status page, or gives no reading for more than a day.

## The energy index

The inverter only gives a counter of the day (it starts again every morning),
never a lifetime counter, while the Gladys energy monitoring counts the rises
of a cumulative index. So the integration builds one: the index goes on from
its last value and adds what the counter of the day adds. It never goes back
to 0 and never drops: a new day (the counter back to 0 in the morning) leaves
it where it was. Any doubt counts less, never more: a reboot of the inverter
during the day, a counter that jumps, hours without reads around the change of
day.

The index also goes through a guard: a jump or a drop of the index itself is
held back, shown in the integration status, and only taken when you click
"Accept the held index" in the configuration (a jump is then counted at once,
a drop counts nothing). Saving the configuration never accepts it.

## Limits

- Only the first inverter is read when the Wi-Fi board reports several.
- The energy of the day comes as the library reads it: one decimal digit is
  a missing zero ("14.9" means 14.09 kWh).
- The integration needs Gladys 5.2.0 or later.

## Privacy

Nothing leaves your network: the integration only talks to the address you
entered, with one small GET a minute (every 5 minutes at night). The registry
key of the Wi-Fi board (its key for the maker's cloud) is never kept, logged
or shown.

## Feedback

Issues and pull requests: <https://github.com/LM1LC3N7/gladys-zeversolar>. If
you own a Zeversolar inverter, the text of `http://<address>/home.cgi` (by day
and at night, with the registry key and serial numbers hidden) helps a lot.
