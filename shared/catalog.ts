// Guesses an icon and grocery category from an item name, for the tile-style inventory.

export const CATEGORIES = [
  'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Pantry', 'Spices', 'Frozen',
  'Beverages', 'Bar', 'Snacks', 'Household', 'Other',
] as const;

export const LOCATIONS = ['Pantry', 'Fridge', 'Freezer', 'Spice Rack', 'Cabinet', 'Counter', 'Bar'] as const;

// Liquor brands and drinks go first so "Peachtree", "coconut rum" or "pink lemonade Smirnoff" don't land in Produce.
const BRANDS = String.raw`smirnoff|captain morgan|malibu|bacardi|peachtree|de ?kuyper|cruzan|parrot bay|blue chair bay|pinnacle|espol[oò]n|cuervo|patr[oó]n|jack daniel|jameson|tito'?s|absolut|grey goose|fireball|j[aä]germeister|hennessy|crown royal|jim beam|maker'?s mark|svedka|new amsterdam|tanqueray|bombay|hendrick|kahl[uú]a|bailey'?s|cointreau|grand marnier|disaronno|midori|chambord|frangelico|aperol|campari|st[- ]germain`;

const RULES: [RegExp, string, (typeof CATEGORIES)[number]][] = [
  [/\b(whiske?y|bourbon|scotch|rye whiskey|brandy|cognac|armagnac)\b/, '🥃', 'Bar'],
  [/\b(vodka|gin|vermouth)\b/, '🍸', 'Bar'],
  [/\b(rum|tequila|mezcal|cachaca|cachaça)\b/, '🍹', 'Bar'],
  [new RegExp(String.raw`\b(${BRANDS})`), '🍹', 'Bar'],
  [/schnapps|liqueur|liquor|cura[cç]ao|triple sec|amaretto|sambuca|absinthe|ouzo|creme de|crème de|limoncello|bitters|\bsake\b|soju/, '🍸', 'Bar'],
  [/champagne|prosecco|cava\b|sparkling wine/, '🍾', 'Bar'],
  [/\b(sprite|7 ?up|coke|coca[- ]cola|pepsi|ginger ale|mountain dew|dr\.? pepper|fanta)\b/, '🥤', 'Beverages'],
  [/wine(?! vinegar)/, '🍷', 'Bar'], [/beer|\bale\b|lager|\bipa\b|\bstout\b|hard seltzer|hard cider/, '🍺', 'Bar'],
  [/grenadine|simple syrup|sweet ?(n|and|&|'n'?) ?sour|sour mix|margarita mix|daiquiri mix|mojito mix|pi[nñ]a colada mix|bloody mary mix|cream of coconut|tonic|club soda|ginger beer|orgeat|maraschino/, '🍹', 'Bar'],
  [/juice|punch|lemonade|limeade|nectar/, '🧃', 'Beverages'],
  [/\bapple/, '🍎', 'Produce'], [/banana/, '🍌', 'Produce'], [/\b(lemon|lime)/, '🍋', 'Produce'],
  [/orange/, '🍊', 'Produce'], [/grape/, '🍇', 'Produce'], [/strawberr|berr/, '🍓', 'Produce'],
  [/cherr/, '🍒', 'Produce'], [/peach/, '🍑', 'Produce'], [/pear\b|pears/, '🍐', 'Produce'],
  [/pineapple/, '🍍', 'Produce'], [/mango/, '🥭', 'Produce'], [/melon/, '🍉', 'Produce'],
  [/avocado/, '🥑', 'Produce'], [/tomato/, '🍅', 'Produce'], [/potato/, '🥔', 'Produce'],
  [/carrot/, '🥕', 'Produce'], [/\bcorn\b/, '🌽', 'Produce'], [/bell pepper|jalape|poblano|habanero|chil[ei](?! powder)/, '🌶️', 'Produce'],
  [/cucumber|zucchini|pickle/, '🥒', 'Produce'], [/broccoli/, '🥦', 'Produce'], [/lettuce|spinach|kale|greens|cabbage/, '🥬', 'Produce'],
  [/garlic/, '🧄', 'Produce'], [/onion|shallot|scallion|leek/, '🧅', 'Produce'], [/mushroom/, '🍄', 'Produce'],
  [/eggplant/, '🍆', 'Produce'], [/coconut/, '🥥', 'Produce'], [/ginger|herb|basil|cilantro|parsley|mint|thyme|rosemary/, '🌿', 'Produce'],
  [/bacon/, '🥓', 'Meat & Seafood'], [/chicken|turkey|poultry|wing/, '🍗', 'Meat & Seafood'],
  [/beef|steak|pork|ham|lamb|sausage|meat|chop/, '🥩', 'Meat & Seafood'], [/shrimp|prawn/, '🦐', 'Meat & Seafood'],
  [/fish|salmon|tuna|cod|tilapia/, '🐟', 'Meat & Seafood'], [/crab|lobster/, '🦀', 'Meat & Seafood'],
  [/egg/, '🥚', 'Dairy & Eggs'], [/milk|cream(?!er)|half and half/, '🥛', 'Dairy & Eggs'], [/cheese|parmesan|cheddar|mozzarella/, '🧀', 'Dairy & Eggs'],
  [/butter/, '🧈', 'Dairy & Eggs'], [/yogurt|yoghurt/, '🥛', 'Dairy & Eggs'],
  [/bread|bun|roll|loaf/, '🍞', 'Bakery'], [/bagel/, '🥯', 'Bakery'], [/croissant/, '🥐', 'Bakery'], [/tortilla|pita|naan/, '🫓', 'Bakery'],
  [/cake|cupcake/, '🍰', 'Bakery'], [/cookie|biscuit/, '🍪', 'Snacks'], [/chip|cracker|pretzel/, '🥨', 'Snacks'], [/popcorn/, '🍿', 'Snacks'],
  [/chocolate|candy/, '🍫', 'Snacks'], [/\bnuts?\b|almond|peanut|cashew|pecan|walnut/, '🥜', 'Snacks'],
  [/rice/, '🍚', 'Pantry'], [/pasta|spaghetti|noodle|macaroni|penne/, '🍝', 'Pantry'], [/flour|sugar|baking|yeast/, '🌾', 'Pantry'],
  [/bean|lentil|chickpea/, '🫘', 'Pantry'], [/\boil\b|vinegar/, '🫒', 'Pantry'], [/honey|syrup/, '🍯', 'Pantry'], [/cereal|oat|granola/, '🥣', 'Pantry'],
  [/sauce|ketchup|mustard|mayo|salsa|dressing/, '🥫', 'Pantry'], [/can(ned)?\b|soup|broth|stock/, '🥫', 'Pantry'],
  [/salt|pepper|cinnamon|paprika|cumin|oregano|spice|seasoning|nutmeg|vanilla|chili powder/, '🧂', 'Spices'],
  [/ice cream/, '🍨', 'Frozen'], [/frozen|pizza/, '🍕', 'Frozen'], [/fries/, '🍟', 'Frozen'],
  [/coffee/, '☕', 'Beverages'], [/tea\b/, '🍵', 'Beverages'], [/juice/, '🧃', 'Beverages'], [/water|soda|sparkling/, '🥤', 'Beverages'],
  [/paper towel|toilet|tissue|napkin/, '🧻', 'Household'], [/soap|detergent|cleaner|bleach|sponge|dish/, '🧽', 'Household'],
  [/trash|bag|foil|wrap/, '🛍️', 'Household'],
];

export function guessItem(name: string): { icon: string; category: (typeof CATEGORIES)[number] } {
  const n = name.toLowerCase();
  for (const [re, icon, category] of RULES) if (re.test(n)) return { icon, category };
  return { icon: '🥫', category: 'Other' };
}
