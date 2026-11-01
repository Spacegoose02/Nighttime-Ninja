// Kitchen tools: the gear a household owns, which recipes need gear they don't have, and how Gordy and Rocco hear about it.
// Word lists, like diets, so it works with no AI. An empty list means "not set up", and then nothing is flagged.

export interface Tool { key: string; label: string; group: ToolGroup; /** Words in a recipe that mean it needs this. */ words?: string }
export type ToolGroup = 'Cooking' | 'Small appliances' | 'Cookware & bakeware' | 'Prep' | 'Bar';
export const TOOL_GROUPS: ToolGroup[] = ['Cooking', 'Small appliances', 'Cookware & bakeware', 'Prep', 'Bar'];

export const TOOLS: Tool[] = [
  { key: 'oven', label: 'Oven', group: 'Cooking', words: 'oven|bake|baked|baking|roast(?:ed|ing)?|broil(?:er|ed|ing)?' },
  { key: 'stovetop', label: 'Stovetop', group: 'Cooking', words: 'stove ?top|stove|burner|(?:low|medium|med|high|medium[- ]low|medium[- ]high) heat|saut[eé](?:ed|ing)?|simmer(?:ing)?|skillet|saucepan|frying pan' },
  { key: 'microwave', label: 'Microwave', group: 'Cooking', words: 'microwave' },
  { key: 'grill', label: 'Outdoor grill', group: 'Cooking', words: 'grill(?:ed|ing)?|grill grates|charcoal|barbecue grill' },
  { key: 'smoker', label: 'Smoker', group: 'Cooking', words: 'smoker|pellet grill|wood chips' },
  { key: 'air-fryer', label: 'Air fryer', group: 'Small appliances', words: 'air[- ]?fry(?:er)?|air[- ]?fried|air[- ]?frying' },
  { key: 'slow-cooker', label: 'Slow cooker', group: 'Small appliances', words: 'slow[- ]cooker|crock[- ]?pot' },
  { key: 'pressure-cooker', label: 'Pressure cooker / Instant Pot', group: 'Small appliances', words: 'pressure[- ]cook(?:er)?|instant ?pot|multi[- ]?cooker' },
  { key: 'rice-cooker', label: 'Rice cooker', group: 'Small appliances', words: 'rice cooker' },
  { key: 'deep-fryer', label: 'Deep fryer', group: 'Small appliances', words: 'deep[- ]fryer' },
  { key: 'toaster-oven', label: 'Toaster oven', group: 'Small appliances', words: 'toaster oven' },
  { key: 'sous-vide', label: 'Sous vide', group: 'Small appliances', words: 'sous[- ]vide|immersion circulator' },
  { key: 'waffle-iron', label: 'Waffle iron', group: 'Small appliances', words: 'waffle (?:iron|maker)' },
  { key: 'bread-machine', label: 'Bread machine', group: 'Small appliances', words: 'bread (?:machine|maker)' },
  { key: 'ice-cream-maker', label: 'Ice cream maker', group: 'Small appliances', words: 'ice[- ]cream (?:maker|machine)|churn' },
  { key: 'blender', label: 'Blender', group: 'Small appliances', words: '(?<!immersion |stick |hand )blender|blend(?:ed|ing)? (?:until|on high|smooth)' },
  { key: 'immersion-blender', label: 'Immersion blender', group: 'Small appliances', words: 'immersion blender|stick blender|hand blender' },
  { key: 'food-processor', label: 'Food processor', group: 'Small appliances', words: 'food processor' },
  { key: 'stand-mixer', label: 'Stand mixer', group: 'Small appliances', words: 'stand mixer|dough hook|paddle attachment|whisk attachment' },
  { key: 'hand-mixer', label: 'Hand mixer', group: 'Small appliances', words: 'hand mixer|electric mixer' },
  { key: 'cast-iron', label: 'Cast iron skillet', group: 'Cookware & bakeware', words: 'cast[- ]iron' },
  { key: 'dutch-oven', label: 'Dutch oven', group: 'Cookware & bakeware', words: 'dutch oven' },
  { key: 'wok', label: 'Wok', group: 'Cookware & bakeware', words: 'wok' },
  { key: 'stockpot', label: 'Stockpot', group: 'Cookware & bakeware', words: 'stock ?pot' },
  { key: 'sheet-pan', label: 'Sheet pan', group: 'Cookware & bakeware', words: 'sheet pan|baking sheet|cookie sheet|rimmed baking sheet' },
  { key: 'baking-dish', label: 'Baking dish (9x13)', group: 'Cookware & bakeware', words: 'baking dish|casserole dish|9 ?x ?13' },
  { key: 'roasting-pan', label: 'Roasting pan', group: 'Cookware & bakeware', words: 'roasting pan' },
  { key: 'muffin-tin', label: 'Muffin tin', group: 'Cookware & bakeware', words: 'muffin (?:tin|pan)|cupcake (?:tin|pan)' },
  { key: 'loaf-pan', label: 'Loaf pan', group: 'Cookware & bakeware', words: 'loaf pan' },
  { key: 'cake-pan', label: 'Round cake pans', group: 'Cookware & bakeware', words: 'cake pans?|round pans?' },
  { key: 'pie-dish', label: 'Pie dish', group: 'Cookware & bakeware', words: 'pie (?:dish|plate|pan)' },
  { key: 'bundt-pan', label: 'Bundt pan', group: 'Cookware & bakeware', words: 'bundt' },
  { key: 'springform-pan', label: 'Springform pan', group: 'Cookware & bakeware', words: 'springform' },
  { key: 'pizza-stone', label: 'Pizza stone or steel', group: 'Cookware & bakeware', words: 'pizza (?:stone|steel)|baking stone' },
  { key: 'thermometer', label: 'Meat thermometer', group: 'Prep', words: 'thermometer|internal temperature' },
  { key: 'kitchen-scale', label: 'Kitchen scale', group: 'Prep', words: 'kitchen scale|weigh (?:out|the)' },
  { key: 'mandoline', label: 'Mandoline', group: 'Prep', words: 'mandoline' },
  { key: 'rolling-pin', label: 'Rolling pin', group: 'Prep', words: 'rolling pin|roll (?:out )?the dough|roll (?:it )?out' },
  { key: 'pasta-maker', label: 'Pasta maker', group: 'Prep', words: 'pasta (?:maker|machine|roller)' },
  { key: 'spiralizer', label: 'Spiralizer', group: 'Prep', words: 'spiralizer|spiralize[ds]?' },
  { key: 'cocktail-shaker', label: 'Cocktail shaker', group: 'Bar', words: 'shaker|shake (?:well|hard|vigorously|until|with ice)' },
  { key: 'muddler', label: 'Muddler', group: 'Bar', words: 'muddler|muddle[ds]?' },
  { key: 'strainer', label: 'Cocktail strainer', group: 'Bar', words: String.raw`hawthorne|julep strainer|double[- ]strain|strain into (?:a |an |the )?(?:chilled |prepared )?(?:\w+ )?(?:glass|coupe|tumbler|flute)` },
  { key: 'jigger', label: 'Jigger', group: 'Bar' },
  { key: 'bar-spoon', label: 'Bar spoon', group: 'Bar', words: 'bar ?spoon' },
  { key: 'mixing-glass', label: 'Mixing glass', group: 'Bar', words: 'mixing glass' },
  { key: 'citrus-press', label: 'Citrus juicer', group: 'Bar', words: 'citrus (?:press|juicer|squeezer)' },
];

const byKey = new Map(TOOLS.map((t) => [t.key, t]));
const norm = (s: string) => s.trim().toLowerCase();

/** The label for a tool key, or the text itself for something the household added on their own. */
export const toolLabel = (key: string): string => byKey.get(key)?.label ?? key;

/** Keeps known keys and the household's own additions (trimmed, deduped, capped). */
export function cleanTools(list: unknown): string[] {
  const out: string[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const s = typeof x === 'string' ? x.trim().slice(0, 60) : '';
    if (s && !out.some((o) => norm(o) === norm(s))) out.push(s);
  }
  return out.slice(0, 150);
}

/** Phrases that mean the step names gear only as an option, like "if you don't have a stand mixer". */
const OPTIONAL = /\b(if you (?:don'?t|do not) have|without an?|no \w+(?: \w+)?\?|optional(?:ly)?|if using|if you have)\b/i;
/** Alternatives in one step: "in a stand mixer or with a hand mixer". */
const ALTERNATIVE = /\bor\b/i;

/**
 * The gear a recipe needs, found from its instructions (and title). Each entry is a set of alternatives:
 * a step that names several pieces of gear with "or" between them is satisfied by any one of them.
 */
export function neededTools(recipe: { title?: string; instructions: string[] }): string[][] {
  const needs: string[][] = [];
  const add = (opts: string[]) => {
    if (!opts.length) return;
    // A single piece of gear already needed outright covers any "this or that" that includes it.
    if (needs.some((n) => n.length === 1 && opts.includes(n[0]))) return;
    if (opts.length === 1) for (let i = needs.length - 1; i >= 0; i--) if (needs[i].includes(opts[0])) needs.splice(i, 1);
    if (!needs.some((n) => n.length === opts.length && n.every((k) => opts.includes(k)))) needs.push(opts);
  };
  for (const step of [recipe.title ?? '', ...recipe.instructions]) {
    if (!step || OPTIONAL.test(step)) continue;
    const t = step.toLowerCase();
    let hits = TOOLS.filter((tool) => tool.words && new RegExp(String.raw`\b(?:${tool.words})\b`, 'i').test(t)).map((tool) => tool.key);
    // "Toaster oven" and "Dutch oven" aren't the oven; a pressure cooker on "sauté" mode isn't the stove.
    if (hits.includes('toaster-oven') || hits.includes('dutch-oven')) {
      const plain = t.replace(/toaster oven|dutch oven/g, '');
      if (!new RegExp(String.raw`\b(?:${byKey.get('oven')!.words})\b`).test(plain)) hits = hits.filter((k) => k !== 'oven');
    }
    if (hits.some((k) => ['pressure-cooker', 'slow-cooker', 'air-fryer', 'rice-cooker', 'microwave'].includes(k))) hits = hits.filter((k) => k !== 'stovetop' && k !== 'oven');
    if (hits.includes('grill') && /\bgrill pan\b/.test(t)) hits = hits.filter((k) => k !== 'grill');
    if (hits.length > 1 && ALTERNATIVE.test(t)) add(hits);
    else for (const h of hits) add([h]);
  }
  return needs;
}

/** What a recipe needs that the household doesn't own. Empty when they haven't set up their tools. */
export function missingTools(recipe: { title?: string; instructions: string[] }, owned: string[]): string[] {
  if (!owned.length) return [];
  const have = new Set(owned.map(norm));
  return neededTools(recipe).filter((opts) => !opts.some((k) => have.has(k))).map((opts) => opts.map(toolLabel).join(' or '));
}

/** The household's gear as lines for an AI prompt, or null when they haven't set it up. */
export function toolsForPrompt(owned: string[]): string | null {
  if (!owned.length) return null;
  const have = new Set(owned.map(norm));
  const mine = owned.map(toolLabel);
  const without = TOOLS.filter((t) => !have.has(t.key)).map((t) => t.label);
  return [
    'Kitchen tools this household owns (respect these: only suggest dishes and drinks they can make with this gear. If something really needs gear they lack, say so plainly and give a workaround with what they have, like the oven instead of an air fryer):',
    `- ${mine.join(', ')}`,
    without.length ? `They do not have: ${without.join(', ')}.` : '',
  ].filter(Boolean).join('\n');
}
