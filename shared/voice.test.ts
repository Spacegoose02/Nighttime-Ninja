import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceCommand } from './voice.ts';

test('understands what a cook says to cook mode', () => {
  assert.deepEqual(voiceCommand('Next.'), { kind: 'next' });
  assert.deepEqual(voiceCommand('okay next step'), { kind: 'next' });
  assert.deepEqual(voiceCommand('go back'), { kind: 'back' });
  assert.deepEqual(voiceCommand('repeat that'), { kind: 'repeat' });
  assert.deepEqual(voiceCommand('read the ingredients'), { kind: 'ingredients' });
  assert.deepEqual(voiceCommand('set a timer for 10 minutes'), { kind: 'timer', seconds: 600, label: '10 minutes' });
  assert.deepEqual(voiceCommand('timer five minutes'), { kind: 'timer', seconds: 300, label: '5 minutes' });
  assert.deepEqual(voiceCommand('set a timer for an hour'), { kind: 'timer', seconds: 3600, label: 'an hour' });
  assert.deepEqual(voiceCommand('start the timer'), { kind: 'stepTimer' });
  assert.deepEqual(voiceCommand('how much flour do I need'), { kind: 'howMuch', what: 'flour' });
  assert.deepEqual(voiceCommand('How many of the eggs'), { kind: 'howMuch', what: 'eggs' });
  assert.deepEqual(voiceCommand('stop listening'), { kind: 'stop' });
  assert.equal(voiceCommand('the kids are fighting again over there'.replace('again', 'loudly')), null);
  assert.equal(voiceCommand(''), null);
});
