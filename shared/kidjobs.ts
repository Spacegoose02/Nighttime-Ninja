// Jobs kids can help with on a recipe, by age. Picked from the recipe's own ingredients and steps, so a salad
// suggests tearing lettuce and a cake suggests measuring flour. Ages are rough guides; grown-ups know their kids.

export interface KidJob { age: 3 | 5 | 8 | 11; task: string }

interface Rule { age: KidJob['age']; task: string | ((hit: string) => string); ingredients?: RegExp; steps?: RegExp; always?: boolean }

const VEG = /\b(potato|potatoes|carrots?|tomato(es)?|cucumbers?|apples?|peppers?|zucchini|broccoli|lettuce|spinach|kale|berries|strawberr(y|ies)|grapes|celery|mushrooms?|lemons?|limes?)\b/i;

const RULES: Rule[] = [
  { age: 3, task: (w) => `Wash the ${w} in a bowl of water`, ingredients: VEG },
  { age: 3, task: (w) => `Tear the ${w} into pieces`, ingredients: /\b(lettuce|spinach|kale|basil|mint|cilantro|parsley|bread)\b/i },
  { age: 3, task: (w) => `Sprinkle the ${w} on top`, ingredients: /\b(cheese|parmesan|sprinkles|seeds|herbs|chocolate chips|nuts)\b/i },
  { age: 3, task: 'Pour in the ingredients a grown-up has measured, and give it a stir', steps: /\b(stir|combine|mix)\b/i },
  { age: 3, task: 'Set the table and put out napkins', always: true },
  { age: 5, task: (w) => `Measure the ${w} with cups and level it off`, ingredients: /\b(flour|sugar|oats|rice|cocoa|breadcrumbs)\b/i },
  { age: 5, task: 'Crack the eggs into a separate bowl (fish out any shell)', ingredients: /\beggs?\b/i },
  { age: 5, task: (w) => `Mash the ${w}`, ingredients: /\b(potato(es)?|avocados?|bananas?|beans|chickpeas)\b/i },
  { age: 5, task: 'Whisk it together', steps: /\bwhisk\b/i },
  { age: 5, task: 'Knead and shape the dough', steps: /\b(knead|roll (out|into)|shape)\b/i },
  { age: 5, task: (w) => `Spread the ${w}`, ingredients: /\b(butter|sauce|jam|mayo|mayonnaise|mustard|peanut butter|pesto)\b/i },
  { age: 8, task: 'Read the recipe out loud and gather everything on the counter', always: true },
  { age: 8, task: (w) => `Peel the ${w} with a vegetable peeler`, ingredients: /\b(carrots?|potato(es)?|cucumbers?|apples?|zucchini)\b/i },
  { age: 8, task: 'Grate the cheese (watch the knuckles)', ingredients: /\bcheese\b/i },
  { age: 8, task: (w) => `Slice the ${w} with a kid-safe knife`, ingredients: /\b(mushrooms?|bananas?|strawberr(y|ies)|cucumbers?|zucchini|butter)\b/i },
  { age: 8, task: 'Set the timers and call out when they go off', steps: /\b(minutes?|bake|simmer|roast)\b/i },
  { age: 11, task: (w) => `Chop the ${w} with a real knife, with a grown-up nearby`, ingredients: /\b(onions?|peppers?|carrots?|celery|garlic)\b/i },
  { age: 11, task: 'Cook at the stove with a grown-up: stir the pan and watch the heat', steps: /\b(saut[eé]|fry|simmer|boil|brown|skillet|pan)\b/i },
  { age: 11, task: 'Put it in and take it out of the oven, with oven gloves and a grown-up', steps: /\b(bake|roast|oven)\b/i },
];

/** Every different match in the text, as "a", "a and b" or "a, b and c" (at most three). */
function listOf(text: string, re: RegExp): string | null {
  const hits = [...new Set([...text.matchAll(new RegExp(re.source, 'gi'))].map((m) => m[0].toLowerCase()))].slice(0, 3);
  if (!hits.length) return null;
  return hits.length === 1 ? hits[0] : `${hits.slice(0, -1).join(', ')} and ${hits[hits.length - 1]}`;
}

export function kidJobs(recipe: { ingredients: { name: string }[]; instructions: string[] }, maxAge: KidJob['age'] = 11): KidJob[] {
  const names = recipe.ingredients.map((i) => i.name).join(', ');
  const steps = recipe.instructions.join(' ');
  const out: KidJob[] = [];
  for (const r of RULES) {
    if (r.age > maxAge) continue;
    let hit: string | null = null;
    if (r.always) hit = '';
    else if (r.ingredients) hit = listOf(names, r.ingredients);
    else if (r.steps) hit = r.steps.test(steps) ? '' : null;
    if (hit === null) continue;
    out.push({ age: r.age, task: typeof r.task === 'function' ? r.task(hit) : r.task });
  }
  return out;
}
