import { describe, expect, it } from 'vitest';
import type { RecipeSummary } from '../api.ts';
import { tonightIdeas } from './Dashboard.tsx';

const r = (title: string, extra: Partial<RecipeSummary> = {}): RecipeSummary => ({
  id: title, title, image: null, servings: 4, tags: [], totalMinutes: 30, ingredientCount: 5, isPublic: false, ready: 'ready', missing: [],
  usesExpiring: [], favorite: false, rating: null, collections: [], dietWarnings: 0, missingTools: [], ...extra,
});

describe("tonight's ideas", () => {
  it('uses up food that is about to expire first, and skips what you cannot make', () => {
    const ideas = tonightIdeas([
      r('Plain pasta'),
      r('Spinach omelette', { usesExpiring: ['spinach'], ready: 'almost', missing: ['chives'] }),
      r('Beef stew', { ready: 'missing', missing: ['beef', 'carrots'] }),
      r('Iced tea', { tags: ['drinks'] }),
      r('Favourite tacos', { favorite: true, rating: 5 }),
    ]);
    expect(ideas.map((i) => i.title)).toEqual(['Spinach omelette', 'Favourite tacos', 'Plain pasta']);
  });

  it('suggests food, never drinks or cocktails', () => {
    const ideas = tonightIdeas([
      r('Strawberry Colada Cooler', { tags: ['cocktail'], favorite: true, rating: 5 }),
      r('Berry Tequila Cooler', { favorite: true }),
      r('Blue Island Punch', { tags: ['Cocktail', 'tropical'] }),
      r('Chicken Tenders'),
    ]);
    expect(ideas.map((i) => i.title)).toEqual(['Chicken Tenders']);
  });
});
