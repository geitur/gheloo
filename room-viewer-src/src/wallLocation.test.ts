import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWallLocation } from './wallLocation.ts';

// Real captures from window.Room.wallItems on a live room, confirmed by the user:
// [':w=3,2 l=6,21 l', ':w=3,4 l=13,23 l', ':w=10,0 l=2,32 r', ':w=5,0 l=10,34 r']

test('parses a left-wall location string from a real capture', () => {
  const result = parseWallLocation(':w=3,2 l=6,21 l');
  assert.deepEqual(result, { width: 3, height: 2, localX: 6, localY: 21, direction: 'l' });
});

test('parses a right-wall location string from a real capture', () => {
  const result = parseWallLocation(':w=10,0 l=2,32 r');
  assert.deepEqual(result, { width: 10, height: 0, localX: 2, localY: 32, direction: 'r' });
});

test('throws on old-format locations (not supported)', () => {
  assert.throws(() => parseWallLocation('rightwall 100,50,0'), /unrecognized wall location/i);
});

test('throws on garbage input instead of silently returning wrong data', () => {
  assert.throws(() => parseWallLocation('garbage'), /unrecognized wall location/i);
});
