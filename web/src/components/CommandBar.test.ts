import { describe, expect, it } from 'vitest';
import { matchScore } from './CommandBar.tsx';

describe('search matching', () => {
  it('ranks word starts above matches inside words', () => {
    expect(matchScore('Chicken curry', 'cur')).toBeGreaterThan(matchScore('Chicken curry', 'urr'));
    expect(matchScore('Chicken curry', 'chick')).toBeGreaterThan(matchScore('Chicken curry', 'cur'));
  });
  it('needs every word', () => {
    expect(matchScore('Skillet cornbread', 'skillet bread')).toBeGreaterThan(0);
    expect(matchScore('Skillet cornbread', 'skillet pizza')).toBe(0);
    expect(matchScore('Anything', '')).toBe(0);
  });
});
