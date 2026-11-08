import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kidJobs } from './kidjobs.ts';

const recipe = (ingredients: string[], instructions: string[]) => ({ ingredients: ingredients.map((name) => ({ name })), instructions });

test('jobs come from the recipe itself', () => {
  const salad = kidJobs(recipe(['romaine lettuce', 'cucumber', 'parmesan cheese'], ['Toss together.']));
  const tasks = salad.map((j) => j.task);
  assert.ok(tasks.includes('Tear the lettuce into pieces'));
  assert.ok(tasks.includes('Wash the lettuce and cucumber in a bowl of water'));
  assert.ok(!tasks.some((t) => /oven/.test(t)));

  const cake = kidJobs(recipe(['flour', 'sugar', 'eggs', 'butter'], ['Whisk the eggs.', 'Bake for 30 minutes.']));
  assert.ok(cake.some((j) => j.task.startsWith('Measure the flour')));
  assert.ok(cake.some((j) => j.task.startsWith('Crack the eggs')));
  assert.ok(cake.some((j) => j.age === 11 && /oven/.test(j.task)));
});

test('younger kids only get the jobs for their age', () => {
  const jobs = kidJobs(recipe(['onion', 'eggs'], ['Fry the onion in a pan.']), 5);
  assert.ok(jobs.every((j) => j.age <= 5));
  assert.ok(!jobs.some((j) => /knife|stove/.test(j.task)));
});
