import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBdPhone, parseAddress, parseQuantity } from '../src/utils/validators.js';

test('parseQuantity: accepts whole numbers from 1 to 100', () => {
  const accepted = [
    [1, 1],
    ['1', 1],
    ['7', 7],
    [' 7 ', 7],
    ['100', 100],
    ['050', 50],
    ['০৫', 5],
    ['৫', 5],
    ['১০০', 100],
    [' 12 ', 12],
  ];
  for (const [input, expected] of accepted) {
    assert.equal(parseQuantity(input), expected, `input: ${JSON.stringify(input)}`);
  }
});

test('parseQuantity: rejects everything else', () => {
  const rejected = [
    '0',
    '00',
    '101',
    '1000',
    '0001',
    '2.5',
    '2,5',
    '-1',
    '+1',
    '1e1',
    'abc',
    'one',
    '5 pcs',
    '5 6',
    '১২৩৪',
    '',
    '   ',
    null,
    undefined,
    {},
    [],
    NaN,
  ];
  for (const input of rejected) {
    assert.equal(parseQuantity(input), null, `input: ${JSON.stringify(input)}`);
  }
});

test('normalizeBdPhone: accepts the three formats and returns the local 11 digits', () => {
  const accepted = [
    ['01712345678', '01712345678'],
    ['+8801712345678', '01712345678'],
    ['8801712345678', '01712345678'],
    ['017 1234 5678', '01712345678'],
    ['017-1234-5678', '01712345678'],
    ['017.1234.5678', '01712345678'],
    ['(017) 1234-5678', '01712345678'],
    ['+88 017 1234 5678', '01712345678'],
    ['+88-017-1234-5678', '01712345678'],
    ['  01712345678  ', '01712345678'],
    ['০১৭১২৩৪৫৬৭৮', '01712345678'],
    ['+৮৮০১৭১২৩৪৫৬৭৮', '01712345678'],
    ['01312345678', '01312345678'],
    ['01912345678', '01912345678'],
  ];
  for (const [input, expected] of accepted) {
    assert.equal(normalizeBdPhone(input), expected, `input: ${JSON.stringify(input)}`);
  }
});

test('normalizeBdPhone: rejects wrong operators, lengths, prefixes and characters', () => {
  const rejected = [
    '01212345678', // 012 is not a mobile operator
    '01012345678',
    '01112345678',
    '0171234567', // too short
    '017123456789', // too long
    '+8801',
    '8801712345678 9',
    '+01712345678', // a plus without the 88 country code
    '+8701712345678',
    '0017123456789',
    '1712345678', // missing the leading 0
    '017123456a8',
    '017x1234567',
    '017+12345678',
    'phone',
    'আমার নম্বর 01712345678',
    '01712345678 or 01812345678',
    '',
    '   ',
    null,
    undefined,
    {},
    '0'.repeat(5000),
  ];
  for (const input of rejected) {
    assert.equal(normalizeBdPhone(input), null, `input: ${JSON.stringify(input)?.slice(0, 40)}`);
  }
});

test('parseAddress: accepts 10 to 200 characters and returns the trimmed text', () => {
  assert.equal(parseAddress('a'.repeat(10)), 'a'.repeat(10));
  assert.equal(parseAddress('a'.repeat(200)), 'a'.repeat(200));
  assert.equal(parseAddress('House 12, Road 3, Tangail'), 'House 12, Road 3, Tangail');
  assert.equal(parseAddress('  House 12, Road 3, Tangail  '), 'House 12, Road 3, Tangail');
});

test('parseAddress: rejects 9 and 201 characters', () => {
  assert.equal(parseAddress('a'.repeat(9)), null);
  assert.equal(parseAddress('a'.repeat(201)), null);
  assert.equal(parseAddress('a'.repeat(5000)), null);
});

test('parseAddress: collapses whitespace before measuring', () => {
  assert.equal(parseAddress('House   12,\n\nRoad\t3,   Tangail'), 'House 12, Road 3, Tangail');
  // 9 letters plus a lot of padding is still only 9 characters.
  assert.equal(parseAddress('   abcd    efgh   '), null);
  assert.equal(parseAddress(`${'a'.repeat(200)}      `), 'a'.repeat(200));
  assert.equal(parseAddress(`${'a'.repeat(100)}     ${'b'.repeat(99)}`), `${'a'.repeat(100)} ${'b'.repeat(99)}`);
});

test('parseAddress: keeps Bangla text and counts characters, not bytes', () => {
  assert.equal(parseAddress('টাঙ্গাইল সদর, বাড়ি ১২'), 'টাঙ্গাইল সদর, বাড়ি ১২');
  assert.equal(parseAddress('😀'.repeat(10)), '😀'.repeat(10));
  assert.equal(parseAddress('😀'.repeat(9)), null);
});

test('parseAddress: rejects empty, whitespace-only and non-string input', () => {
  for (const input of ['', '   ', '\n\t \n', null, undefined, 12345678901, {}, ['House 12, Road 3']]) {
    assert.equal(parseAddress(input), null, `input: ${JSON.stringify(input)}`);
  }
});
