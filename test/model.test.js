// -----------------------------------------------------------------------------
// The status page parser (src/zeversolar/model.js), against the examples of
// the zeversolar library and hostile answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { energyOf, parseHome } from '../src/zeversolar/model.js';
import { README_EXAMPLES, REGISTRY_KEY, page } from './fixtures/zeversolar.js';

test('the five examples of the library README', () => {
  const [one, two, three, four, five] = README_EXAMPLES.map(parseHome);
  assert.match(one.board, /^[0-9a-f]{12}$/);
  assert.equal(four.board, five.board, 'the same board, with or without inverter');
  assert.notEqual(one.board, two.board);
  assert.deepEqual(one, {
    kind: 'reading',
    board: one.board,
    hardware: 'M10',
    software: '16415-562R+16413-561R',
    cloudOk: false,
    serial: 'BS15006011999999',
    power: 30,
    energyToday: 0,
    inverterOk: true,
    inverters: 1,
  });
  assert.equal(two.serial, 'ZS15004513777777');
  assert.equal(two.power, 1234);
  assert.equal(two.energyToday, 8.09, 'one decimal digit is a missing leading zero');
  assert.equal(two.cloudOk, false, '1 is an error of the cloud link');
  assert.equal(three.power, 226);
  assert.equal(three.energyToday, 0.89);
  assert.equal(three.cloudOk, true, '0 is OK');
  assert.equal(four.hardware, 'M11');
  assert.equal(four.energyToday, 19.7);
  assert.deepEqual(five, {
    kind: 'asleep',
    board: five.board,
    hardware: 'M11',
    software: '16B21-663R+16B21-658R',
    cloudOk: false,
  });
});

test('the leading zero of the library (_fix_leading_zero)', () => {
  assert.equal(energyOf('14.9'), 14.09);
  assert.equal(energyOf('14.09'), 14.09);
  assert.equal(energyOf('14.20'), 14.2);
  assert.equal(energyOf('0.89'), 0.89);
  assert.equal(energyOf('12'), 12);
  for (const odd of ['', '-1.2', '1e3', '1.', '.5', 'NaN', 'Infinity', '1,5', '0x10']) {
    assert.equal(energyOf(odd), undefined, odd);
  }
});

test('the registry key and the registry id never leave the parser', () => {
  const parsed = parseHome(page());
  assert.ok(!JSON.stringify(parsed).includes(REGISTRY_KEY));
  assert.ok(!JSON.stringify(parsed).includes('EAB961777777'));
});

test('not a status page: undefined, never a value read as 0', () => {
  const cases = [
    undefined,
    '',
    '<html><body>Login</body></html>',
    '1 1 a b',
    page().replace('13:59', '25:00'),
    page().replace('04/02/2023', '2023-02-04'),
    page({ cloud: 'maybe' }),
    page({ count: 5 }),
    page({ serial: '<script>' }),
    page({ power: '-5' }),
    page({ power: '12.5' }),
    page({ energy: 'abc' }),
    page({ status: 'FAULT' }),
    page().split('\n').slice(0, 12).join('\n'),
    `${page()} ${'x '.repeat(80)}`,
    page().replace(/^1/, '__proto__'),
  ];
  for (const body of cases) {
    assert.equal(parseHome(body), undefined, String(body).slice(0, 40));
  }
});

test('an inverter version field (older firmware) is skipped', () => {
  const parsed = parseHome(page({ version: 'V610-01037-04', power: 30 }));
  assert.equal(parsed.power, 30);
  assert.equal(parsed.inverterOk, true);
});

test('several inverters: the first one is read, their number given', () => {
  const body = `${page({ count: 2 })}\nBS20006011999999\n100\n1.5\nOK\nError`;
  const parsed = parseHome(body);
  assert.equal(parsed.serial, 'BS20006011888888');
  assert.equal(parsed.inverters, 2);
});

test('an inverter in error, and spaces as separators', () => {
  const parsed = parseHome(page({ status: 'Error', separator: ' ' }));
  assert.equal(parsed.inverterOk, false);
});
