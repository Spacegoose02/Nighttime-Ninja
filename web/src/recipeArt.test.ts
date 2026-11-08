import { describe, expect, it } from 'vitest';
import { recipeEmoji, recipeTint } from './recipeArt.ts';

describe('recipe covers', () => {
  it('picks a dish from the title', () => {
    expect(recipeEmoji('Crispy air fryer wings')).toBe('🍗');
    expect(recipeEmoji('Skillet cornbread')).toBe('🍞');
    expect(recipeEmoji('Weeknight chicken curry')).toBe('🍛');
    expect(recipeEmoji('Grandma’s secret', ['soup'])).toBe('🍲');
    expect(recipeEmoji('Something new')).toBe('🍽️');
  });
  it('gives the same recipe the same colour', () => {
    expect(recipeTint('Skillet cornbread')).toBe(recipeTint('Skillet cornbread'));
    expect(recipeTint('Skillet cornbread')).not.toBe(recipeTint('Crispy air fryer wings'));
  });
});
