import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, findTimers } from './timers.ts';

test('finds timers in recipe steps', () => {
  assert.deepEqual(findTimers('Bake 25 to 30 minutes, until golden.'), [{ label: '25 to 30 minutes', seconds: 1500 }]);
  assert.deepEqual(findTimers('Simmer 1 hour 15 minutes.').map((t) => t.seconds), [4500]);
  assert.deepEqual(findTimers('Rest for an hour, then sear 2-3 mins per side.').map((t) => t.seconds), [3600, 120]);
  assert.deepEqual(findTimers('Microwave 45 seconds.').map((t) => t.seconds), [45]);
  assert.deepEqual(findTimers('Cook 10m.').map((t) => t.seconds), [600]);
  assert.deepEqual(findTimers('Add 2 cups flour and 1 tsp salt.'), []);
  assert.deepEqual(findTimers('Preheat the oven to 350 F.'), []);
});

test('formats a countdown', () => {
  assert.equal(clock(45), '0:45');
  assert.equal(clock(750), '12:30');
  assert.equal(clock(3900), '1:05:00');
});
