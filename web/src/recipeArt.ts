// A cover for recipes without a photo: a dish emoji picked from the title and tags, on a soft colour of its own,
// so a recipe book of placeholders still looks like a book of different dishes.

const DISHES: [RegExp, string][] = [
  [/\b(cocktail|martini|margarita|mojito|negroni|old fashioned|spritz)\b/, '🍸'],
  [/\b(smoothie|shake|lemonade|juice)\b/, '🥤'],
  [/\b(sushi|maki|nigiri)\b/, '🍣'],
  [/\b(ramen|pho|noodle|udon|lo mein|pad thai)\b/, '🍜'],
  [/\b(spaghetti|pasta|lasagna|penne|mac(aroni)?|fettuccine|gnocchi|ravioli)\b/, '🍝'],
  [/\b(pizza|flatbread)\b/, '🍕'],
  [/\b(taco|burrito|quesadilla|enchilada|fajita|nacho)s?\b/, '🌮'],
  [/\b(curry|tikka|masala|korma|dal|dahl)\b/, '🍛'],
  [/\b(burger|sliders?)\b/, '🍔'],
  [/\b(sandwich|panini|sub|wrap|blt)\b/, '🥪'],
  [/\b(salad|slaw|bowl)\b/, '🥗'],
  [/\b(soup|stew|chili|chowder|bisque|gumbo|broth)\b/, '🍲'],
  [/\b(pancake|waffle|crepe|french toast)s?\b/, '🥞'],
  [/\b(egg|omelet+e?|frittata|quiche|shakshuka)s?\b/, '🍳'],
  [/\b(cookie|brownie|biscotti)s?\b/, '🍪'],
  [/\b(cake|cupcake|cheesecake)s?\b/, '🍰'],
  [/\b(pie|tart|cobbler|crumble)s?\b/, '🥧'],
  [/\b(ice cream|gelato|sorbet)\b/, '🍨'],
  [/\b(bread|cornbread|loaf|biscuit|roll|focaccia|bagel|muffin|scone)s?\b/, '🍞'],
  [/\b(shrimp|prawn|scampi)s?\b/, '🍤'],
  [/\b(salmon|fish|cod|tuna|tilapia|halibut|trout)\b/, '🐟'],
  [/\b(wing|chicken|drumstick|turkey|thigh)s?\b/, '🍗'],
  [/\b(steak|beef|brisket|roast|ribs?|pork|lamb|meatballs?)\b/, '🥩'],
  [/\b(rice|risotto|paella|pilaf|fried rice)\b/, '🍚'],
  [/\b(potato|fries|hash ?browns?|mash)(es)?\b/, '🥔'],
  [/\b(dumpling|potsticker|gyoza|bao)s?\b/, '🥟'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function recipeEmoji(title: string, tags: string[] = []): string {
  const text = `${title} ${tags.join(' ')}`.toLowerCase();
  return DISHES.find(([re]) => re.test(text))?.[1] ?? '🍽️';
}

/** A gentle two-tone background, the same every time for the same recipe, blended with the theme. */
export function recipeTint(title: string): string {
  const h = hash(title) % 360;
  return `linear-gradient(135deg, color-mix(in srgb, hsl(${h} 70% 70%) 32%, var(--surface-2)), color-mix(in srgb, hsl(${(h + 40) % 360} 70% 60%) 22%, var(--surface-2)))`;
}
