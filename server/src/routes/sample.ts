// A starter kitchen for brand-new homes, so people can see what the app does before typing anything in.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { homeCtx } from '../auth.ts';
import { type Row, tx } from '../db.ts';
import { HttpError, localDate, newId } from '../util.ts';
import { guessItem } from '../../../shared/catalog.ts';
import { parseIngredient, type Recipe } from '../../../shared/recipe.ts';
import { recordHistory } from './inventory.ts';
import { saveRecipe } from './recipes.ts';
import { addShoppingItem } from './shopping.ts';

const recipe = (title: string, servings: number, prep: number, cook: number, tags: string[], ingredients: string[], instructions: string[], description = ''): Recipe => ({
  title, description, servings, prepMinutes: prep, cookMinutes: cook, sourceUrl: null, image: null, tags, instructions,
  ingredients: ingredients.map(parseIngredient),
});

export const SAMPLE_RECIPES: Recipe[] = [
  recipe('Buttermilk Pancakes', 4, 10, 15, ['breakfast', 'sample'],
    ['2 cups all-purpose flour', '2 tbsp sugar', '2 tsp baking powder', '1/2 tsp salt', '2 cups buttermilk', '2 eggs', '3 tbsp butter, melted'],
    ['Whisk the flour, sugar, baking powder and salt in a big bowl.', 'Whisk the buttermilk, eggs and melted butter, then stir into the dry mix until just combined. Let it rest 5 minutes.',
      'Cook 1/4 cup scoops on a buttered griddle over medium heat, about 2 minutes a side.'],
    'Fluffy weekend pancakes. Lumps in the batter are fine.'),
  recipe('Skillet Chicken and Rice', 4, 10, 30, ['dinner', 'weeknight', 'sample'],
    ['1 1/2 lb chicken thighs', '1 cup rice', '2 cups chicken broth', '1 onion, diced', '2 cloves garlic, minced', '1 tbsp olive oil', '1 tsp paprika', '1 cup spinach'],
    ['Season the chicken with paprika and salt. Brown in the oil in a deep skillet, 4 minutes a side, then set aside.',
      'Cook the onion and garlic in the same pan for 3 minutes. Stir in the rice and broth.',
      'Lay the chicken on top, cover and simmer 18 to 20 minutes, until the rice is tender.', 'Stir in the spinach and rest 5 minutes before serving.']),
  recipe('Black Bean Tacos', 4, 10, 10, ['dinner', 'vegetarian', 'weeknight', 'sample'],
    ['2 cans black beans, drained', '1 tsp cumin', '1 tsp chili powder', '8 tortillas', '1 avocado', '1 lime', '1/2 cup shredded cheddar', '1 cup salsa'],
    ['Warm the beans with the cumin, chili powder and a splash of water for 5 minutes, mashing a few.', 'Warm the tortillas in a dry pan.',
      'Fill with beans, sliced avocado, cheese and salsa. Squeeze lime over the top.']),
  recipe('Sweet Iced Tea', 8, 5, 10, ['drinks', 'sample'],
    ['8 cups water', '6 black tea bags', '1 cup sugar', '1 pinch baking soda', '1 lemon'],
    ['Bring 4 cups of water to a boil, take it off the heat and steep the tea bags 6 minutes.', 'Remove the bags and stir in the sugar and baking soda until dissolved.',
      'Add the rest of the water as cold water and chill. Serve over ice with lemon.']),
];

const inDays = (n: number) => localDate(n);

export const SAMPLE_ITEMS: { name: string; quantity: number; unit?: string; location: string; expiresIn?: number; low?: number }[] = [
  { name: 'All-purpose flour', quantity: 5, unit: 'lb', location: 'Pantry' },
  { name: 'Sugar', quantity: 4, unit: 'lb', location: 'Pantry' },
  { name: 'Rice', quantity: 2, unit: 'lb', location: 'Pantry' },
  { name: 'Black beans', quantity: 3, unit: 'can', location: 'Pantry' },
  { name: 'Baking powder', quantity: 1, location: 'Pantry' },
  { name: 'Eggs', quantity: 4, location: 'Fridge', expiresIn: 12, low: 4 },
  { name: 'Buttermilk', quantity: 1, unit: 'quart', location: 'Fridge', expiresIn: 2 },
  { name: 'Butter', quantity: 1, unit: 'lb', location: 'Fridge' },
  { name: 'Spinach', quantity: 1, location: 'Fridge', expiresIn: 1 },
  { name: 'Chicken thighs', quantity: 1.5, unit: 'lb', location: 'Freezer' },
  { name: 'Onion', quantity: 3, location: 'Counter' },
  { name: 'Garlic', quantity: 1, location: 'Counter' },
  { name: 'Black tea bags', quantity: 20, location: 'Cabinet' },
];

export function sampleRoutes(app: FastifyInstance, db: DatabaseSync): void {
  app.post('/api/homes/:homeId/sample-data', async (req) => {
    const ctx = homeCtx(db, req, 'manager');
    const has = db.prepare('SELECT (SELECT COUNT(*) FROM recipes WHERE home_id = ?) + (SELECT COUNT(*) FROM items WHERE home_id = ?) AS n').get(ctx.homeId, ctx.homeId) as Row;
    if (Number(has.n) > 0) throw new HttpError(409, 'Sample data is only for an empty kitchen');
    const userId = ctx.user?.id ?? null;
    for (const r of SAMPLE_RECIPES) saveRecipe(db, ctx.homeId, r, userId);
    tx(db, () => {
      for (const i of SAMPLE_ITEMS) {
        const id = newId();
        const g = guessItem(i.name);
        db.prepare(`INSERT INTO items (id, home_id, name, category, location, icon, quantity, unit, low_threshold, expires_on, frozen_on)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ctx.homeId, i.name, g.category, i.location, g.icon, i.quantity, i.unit ?? null,
          i.low ?? null, i.expiresIn == null ? null : inDays(i.expiresIn), i.location === 'Freezer' ? inDays(-20) : null);
        recordHistory(db, { homeId: ctx.homeId, itemId: id, itemName: i.name, delta: i.quantity, unit: i.unit ?? null, after: i.quantity, reason: 'sample kitchen', userId });
      }
      for (const name of ['avocados', 'limes', 'tortillas', 'salsa']) addShoppingItem(db, ctx.homeId, { name }, userId);
    });
    return { recipes: SAMPLE_RECIPES.length, items: SAMPLE_ITEMS.length };
  });
}
