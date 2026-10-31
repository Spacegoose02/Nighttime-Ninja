// Diets and allergies: which ingredients in a recipe clash with what someone in the household can eat.
// Word lists, so it works with no AI and no food database. It errs toward warning; people can ignore a warning.

export const DIETS = ['vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'dairy-free'] as const;
export type Diet = (typeof DIETS)[number];

const MEAT = String.raw`beef|steak|pork|bacon|ham|sausage|chorizo|pepperoni|salami|prosciutto|hamburger|chicken|turkey|duck|lamb|veal|venison|ground meat|meatball|hot dog|brisket|rib|lard|gelatin|anchov(?:y|ies)|bone broth|chicken broth|chicken stock|beef broth|beef stock`;
const FISH = String.raw`fish|salmon|tuna|cod|tilapia|halibut|trout|sardine|anchov(?:y|ies)|mackerel|catfish|shrimp|prawn|crab|lobster|scallop|clam|mussel|oyster|squid|calamari|fish sauce`;
const DAIRY = String.raw`milk|butter|cheese|cheddar|mozzarella|parmesan|ricotta|cream|yogurt|yoghurt|ghee|whey|casein|sour cream|half[- ]and[- ]half|buttermilk`;
const NOT_DAIRY = String.raw`coconut milk|almond milk|oat milk|soy milk|rice milk|cashew milk|peanut butter|almond butter|apple butter|cocoa butter|cream of tartar|vegan`;
const GLUTEN = String.raw`flour|wheat|bread|breadcrumb|panko|pasta|spaghetti|macaroni|noodle|tortilla|cracker|couscous|barley|rye|semolina|bulgur|farro|seitan|soy sauce|beer|biscuit|pie crust|croissant|bun|roll`;
const NOT_GLUTEN = String.raw`gluten[- ]free|rice flour|almond flour|coconut flour|corn tortilla|rice noodle|tamari|cornstarch`;

const ALLERGY_WORDS: Record<string, string> = {
  peanut: 'peanut',
  'tree nut': String.raw`almond|walnut|pecan|cashew|pistachio|hazelnut|macadamia|brazil nut|pine nut|praline|marzipan|nutella`,
  nut: String.raw`peanut|almond|walnut|pecan|cashew|pistachio|hazelnut|macadamia|brazil nut|pine nut`,
  shellfish: String.raw`shrimp|prawn|crab|lobster|scallop|clam|mussel|oyster|crawfish|crayfish`,
  fish: FISH,
  egg: String.raw`eggs?\b|mayonnaise|mayo\b|meringue|aioli`,
  milk: DAIRY,
  dairy: DAIRY,
  lactose: DAIRY,
  soy: String.raw`soy|tofu|edamame|miso|tempeh|tamari`,
  wheat: GLUTEN,
  gluten: GLUTEN,
  sesame: String.raw`sesame|tahini`,
};

const has = (pattern: string, text: string, unless?: string) => {
  const t = text.toLowerCase();
  if (unless && new RegExp(unless).test(t)) return false;
  return new RegExp(String.raw`\b(${pattern})(?:e?s)?\b`).test(t);
};

/** Why an ingredient doesn't fit a diet, or null when it's fine. */
function dietClash(diet: Diet, ingredient: string): string | null {
  switch (diet) {
    case 'vegetarian': return has(MEAT, ingredient) || has(FISH, ingredient) ? 'not vegetarian' : null;
    case 'pescatarian': return has(MEAT, ingredient, 'fish') ? 'has meat' : null;
    case 'vegan': return has(MEAT, ingredient) || has(FISH, ingredient) || has(DAIRY, ingredient, NOT_DAIRY) || has(String.raw`eggs?\b|honey|mayonnaise`, ingredient) ? 'not vegan' : null;
    case 'gluten-free': return has(GLUTEN, ingredient, NOT_GLUTEN) ? 'has gluten' : null;
    case 'dairy-free': return has(DAIRY, ingredient, NOT_DAIRY) ? 'has dairy' : null;
  }
}

/** Words for an allergy: a known group ("tree nut", "shellfish") or the allergy's own name ("kiwi"). */
function allergyPattern(allergy: string): string {
  const a = allergy.toLowerCase().trim().replace(/(nut)s$/, '$1').replace(/ies$/, 'y').replace(/s$/, '');
  return ALLERGY_WORDS[a] ?? a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface Eater { name: string; diets: string[]; allergies: string[] }
export interface Clash { ingredient: string; person: string; reason: string }

/** Every ingredient that clashes with someone's diet or allergy. */
export function dietClashes(ingredients: { name: string; optional?: boolean }[], eaters: Eater[]): Clash[] {
  const out: Clash[] = [];
  for (const ing of ingredients) {
    for (const p of eaters) {
      for (const d of p.diets) {
        const why = DIETS.includes(d as Diet) ? dietClash(d as Diet, ing.name) : null;
        if (why) out.push({ ingredient: ing.name, person: p.name, reason: `${why} (${d})` });
      }
      for (const a of p.allergies) {
        if (a.trim() && has(allergyPattern(a), ing.name)) out.push({ ingredient: ing.name, person: p.name, reason: `${a} allergy` });
      }
    }
  }
  return out;
}

/** The household's needs as a few lines for an AI prompt, or null when nobody has any. */
export function dietsForPrompt(eaters: Eater[]): string | null {
  const lines = eaters.filter((e) => e.diets.length || e.allergies.length)
    .map((e) => `- ${e.name}: ${[...e.diets, ...e.allergies.map((a) => `allergic to ${a}`)].join(', ')}`);
  return lines.length ? `Dietary needs in this household (respect these; never include an allergen, and say so when a dish needs a swap):\n${lines.join('\n')}` : null;
}
