// -----------------------------------------------------------------------------
// Status pages (`/home.cgi`) shaped after the five examples of the zeversolar
// library's README (already anonymized there) and its unit tests.
// -----------------------------------------------------------------------------

export const ADDRESS = '192.168.1.60';
export const SERIAL = 'BS20006011888888';
/** The registry key of the Wi-Fi board (a cloud pairing key): must never leave the parser. */
export const REGISTRY_KEY = 'WSMQKHTQXXXXXXXX';
/** 2026-10-21 12:00 in Paris (10:00 UTC). */
export const NOW = Date.parse('2026-10-21T10:00:00Z');

/**
 * A status page. `count` 0: the inverter gives nothing (the night).
 * `version`: the optional inverter version of older firmware.
 */
export function page({
  serial = SERIAL,
  power = 226,
  energy = '0.89',
  status = 'OK',
  cloud = '0',
  count = 1,
  version,
  hardware = 'M10',
  separator = '\n',
} = {}) {
  const head = [
    '1',
    '1',
    'EAB961777777',
    REGISTRY_KEY,
    hardware,
    '17717-709R+17511-707R',
    '13:59',
    '04/02/2023',
    cloud,
    String(count),
  ];
  const inverter =
    count > 0
      ? [serial, ...(version ? [version] : []), String(power), String(energy), status, 'Error']
      : ['Error'];
  return [...head, ...inverter].join(separator);
}

/** The five examples of the library's README, as the inverters send them. */
export const README_EXAMPLES = [
  '1 1 EAB961888888 ABWDWHTQXXXXXXXX M10 16415-562R+16413-561R 15:57 02/02/2023 Error 1 BS15006011999999 V610-01037-04 30 0.0 OK Error',
  '1\n1\nEAB241666666\nZYXTBGERXXXXXXXX\nM10\n18625-797R+17829-719R\n16:22 20/02/2022\n1\n1\nZS15004513777777\n1234\n8.9\nOK\nError\n',
  '1 1 EAB961777777 WSMQKHTQXXXXXXXX M10 17717-709R+17511-707R 13:59 04/02/2023 0 1 BS20006011888888 226 0.89 OK Error',
  '1 1 EAB961555555 KS4GLDHNXXXXXXXX M11 16B21-663R+16B21-658R 16:47 03/02/2023 Error 1 SX0004016666666 2425 19.70 OK Error',
  '1 1 EAB961555555 KS4GLDHNXXXXXXXX M11 16B21-663R+16B21-658R 16:41 03/02/2023 Error 0 Error\n\n\n\n',
];

/** A text answer of the inverter. */
export const text = (body, { status = 200, headers = {} } = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
