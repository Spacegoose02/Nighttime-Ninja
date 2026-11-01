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
  [/juice|punch|lemonade|limeade|nectar|cider\b/, '🧃', 'Beverages'],

  // Things whose name contains another food go before that food: "peanut butter" isn't butter, "chicken broth" isn't chicken.
  [/ice cream|gelato|frozen (yogurt|custard)|ice cream sandwich/, '🍨', 'Frozen'],
  [/popsicle|sorbet|sherbet|ice pop|freezer pop|italian ice/, '🍧', 'Frozen'],
  [/\bice\b/, '🧊', 'Frozen'],
  [/(peanut|almond|cashew|nut|sunflower) butter|nutella/, '🥜', 'Pantry'],
  [/coconut (milk|cream|water)/, '🥥', 'Pantry'],
  [/(almond|oat|soy|rice|cashew) milk/, '🥛', 'Dairy & Eggs'],
  [/broth|\bstock\b|bouillon|\bsoup/, '🥫', 'Pantry'],
  [/hot sauce|sriracha|tabasco|chili (sauce|oil|crisp)|gochujang|sambal/, '🌶️', 'Pantry'],
  [/tomato (sauce|paste|puree)|marinara|pasta sauce|pizza sauce|(diced|crushed|stewed|whole peeled) tomato|\b(canned|tinned)\b|\bcans? of\b/, '🥫', 'Pantry'],
  [/olive oil/, '🫒', 'Pantry'],
  [/\boils?\b|vinegar|cooking spray|shortening|\blard\b|crisco/, '🫗', 'Pantry'],
  [/baking (powder|soda)|cornstarch|corn starch|cornmeal|breadcrumb|bread crumb|panko|yeast/, '🌾', 'Pantry'],
  [/cocoa|chocolate chip|baking chocolate/, '🍫', 'Pantry'],
  [/powder|\bflakes\b|\bdried (basil|oregano|thyme|rosemary|parsley|dill|sage|mint|cilantro|chives|herbs?)|\bground (ginger|cinnamon|cumin|cloves?|nutmeg|mustard|coriander|turmeric|allspice|cardamom|black pepper)|(garlic|onion|celery|seasoned) salt|black pepper|peppercorn|cayenne/, '🧂', 'Spices'],
  [/(hot ?dog|hamburger|burger|slider|sandwich) (buns?|rolls?)/, '🍞', 'Bakery'],
  [/jelly beans?|gummy|gummies|licorice|marshmallow|skittles|starburst|m&m|sour patch|\bcandy|candies/, '🍬', 'Snacks'],
  [/lollipop|sucker|candy cane/, '🍭', 'Snacks'],
  [/\bjam\b|jelly|preserves|marmalade|apple ?butter|\bpickles?\b|relish|sauerkraut|kimchi|salsa|pesto|\bjar\b/, '🫙', 'Pantry'],
  [/apple ?sauce/, '🍎', 'Pantry'], [/raisin|dried fruit|prune|craisin|dried (apricot|mango|cranberr)/, '🍇', 'Snacks'],
  [/\bolives?\b/, '🫒', 'Pantry'],
  [/coffee creamer|\bcreamer\b/, '🥛', 'Dairy & Eggs'], [/coffee cake/, '🍰', 'Bakery'],
  [/coffee|espresso|k-?cups?\b|cold brew/, '☕', 'Beverages'], [/hot chocolate|hot cocoa/, '☕', 'Beverages'],
  [/boba|bubble tea/, '🧋', 'Beverages'], [/\bteas?\b|matcha|chamomile|kombucha/, '🍵', 'Beverages'],
  [/tortilla chips|potato chips|\bchips\b|crisps|doritos|cheetos|fritos|pringles|tostitos|pretzel/, '🥨', 'Snacks'],
  [/popcorn/, '🍿', 'Snacks'], [/rice cake|rice cracker|seaweed snack/, '🍘', 'Snacks'],
  [/cracker|goldfish|cheez-?it|ritz|triscuit|wheat thins/, '🥨', 'Snacks'],
  [/cookie|biscotti|oreo|graham/, '🍪', 'Snacks'], [/brownie|chocolate|candy bar|cacao|snickers|reese/, '🍫', 'Snacks'],
  [/pudding|jell-?o|custard|flan/, '🍮', 'Snacks'], [/granola bar|protein bar|cereal bar|trail mix/, '🥣', 'Snacks'],
  [/frozen (vegetables|veggies)|mixed vegetables/, '🥦', 'Frozen'],
  [/pizza/, '🍕', 'Frozen'], [/fries|tater tots?|hash ?browns?/, '🍟', 'Frozen'],
  [/nuggets|chicken (tenders|strips|fingers)|fish sticks|fish fingers/, '🍗', 'Frozen'],
  [/dumpling|potsticker|gyoza|pierogi|wonton|egg rolls?|spring rolls?/, '🥟', 'Frozen'],
  [/burrito|\bwraps?\b(?! (plastic|foil))/, '🌯', 'Frozen'], [/taco/, '🌮', 'Pantry'], [/tamale/, '🫔', 'Frozen'],
  [/lasagna|casserole|enchilada|pot pie/, '🥘', 'Frozen'], [/curry/, '🍛', 'Pantry'], [/leftover|meal prep/, '🍱', 'Other'],
  [/sandwich|\bsub\b|hoagie/, '🥪', 'Other'], [/falafel/, '🧆', 'Frozen'], [/\bgyros?\b/, '🥙', 'Meat & Seafood'],

  // Produce. The wordier names go first so "grapefruit" isn't grapes and "sweet potato" isn't a potato.
  [/grapefruit/, '🍊', 'Produce'], [/watermelon/, '🍉', 'Produce'], [/cantaloupe|honeydew|melon/, '🍈', 'Produce'],
  [/green apple|granny smith/, '🍏', 'Produce'], [/\bapple|crabapple/, '🍎', 'Produce'], [/banana|plantain/, '🍌', 'Produce'],
  [/\b(lemon|lime)/, '🍋', 'Produce'], [/orange|tangerine|clementine|mandarin|cutie|satsuma|kumquat/, '🍊', 'Produce'],
  [/grape/, '🍇', 'Produce'], [/blueberr|blackberr|huckleberr|boysenberr|elderberr/, '🫐', 'Produce'],
  [/strawberr|raspberr|cranberr|berr/, '🍓', 'Produce'], [/cherr/, '🍒', 'Produce'],
  [/peach|nectarine|apricot|\bplums?\b/, '🍑', 'Produce'], [/\bpears?\b/, '🍐', 'Produce'], [/pineapple/, '🍍', 'Produce'],
  [/mango|papaya|guava|passion ?fruit/, '🥭', 'Produce'], [/kiwi/, '🥝', 'Produce'], [/avocado|guacamole/, '🥑', 'Produce'],
  [/tomato/, '🍅', 'Produce'], [/sweet potato|\byams?\b/, '🍠', 'Produce'], [/potato/, '🥔', 'Produce'],
  [/carrot|parsnip|radish|turnip|\bbeets?\b|beetroot|rutabaga/, '🥕', 'Produce'],
  [/\bcorn\b|corn on the cob/, '🌽', 'Produce'], [/bell pepper|\bpeppers\b|capsicum/, '🫑', 'Produce'],
  [/jalape|poblano|habanero|serrano|anaheim|chipotle|\bchil(e|i|ies|es)\b/, '🌶️', 'Produce'],
  [/cucumber|zucchini|squash|pumpkin/, '🥒', 'Produce'], [/broccoli|cauliflower|broccolini/, '🥦', 'Produce'],
  [/eggplant|aubergine/, '🍆', 'Produce'],
  [/green beans?|string beans?|snap peas|snow peas|\bpeas\b|edamame|pea pods?/, '🫛', 'Produce'],
  [/salad|spring mix|arugula/, '🥗', 'Produce'],
  [/lettuce|spinach|kale|greens|cabbage|bok choy|chard|collard|romaine|celery|asparagus|brussels|artichoke/, '🥬', 'Produce'],
  [/garlic/, '🧄', 'Produce'], [/onion|shallot|scallion|leek|chives/, '🧅', 'Produce'], [/mushroom|portobello|shiitake/, '🍄', 'Produce'],
  [/coconut/, '🥥', 'Produce'], [/ginger|turmeric root/, '🫚', 'Produce'],
  [/sprouts|microgreens/, '🌱', 'Produce'],
  [/herb|basil|cilantro|parsley|\bmint\b|thyme|rosemary|\bdill\b|\bsage\b|tarragon|lemongrass/, '🌿', 'Produce'],
  [/tofu|tempeh/, '🫘', 'Produce'],

  // Meat and seafood
  [/bacon|pancetta/, '🥓', 'Meat & Seafood'],
  [/hot ?dogs?|sausage|bratwurst|\bbrats?\b|kielbasa|chorizo|frank(furter)?s?\b|pepperoni|salami/, '🌭', 'Meat & Seafood'],
  [/ground (beef|chuck|turkey)|hamburger|burger|patties/, '🍔', 'Meat & Seafood'],
  [/\bribs?\b|brisket|roast|\bshank/, '🍖', 'Meat & Seafood'],
  [/chicken|turkey|poultry|\bwings?\b|drumstick|\bthighs?\b|\bduck\b/, '🍗', 'Meat & Seafood'],
  [/beef|steak|pork|\bham\b|lamb|veal|venison|\bchops?\b|tenderloin|sirloin|ribeye|prosciutto|deli meat|lunch ?meat|meatball|\bmeat\b/, '🥩', 'Meat & Seafood'],
  [/sushi|sashimi/, '🍣', 'Meat & Seafood'], [/shrimp|prawn/, '🦐', 'Meat & Seafood'],
  [/squid|calamari/, '🦑', 'Meat & Seafood'], [/octopus/, '🐙', 'Meat & Seafood'],
  [/oyster|clam|mussel|scallop/, '🦪', 'Meat & Seafood'], [/lobster|crawfish|crayfish/, '🦞', 'Meat & Seafood'], [/crab/, '🦀', 'Meat & Seafood'],
  [/fish|salmon|tuna|\bcod\b|tilapia|halibut|trout|catfish|mahi|sardine|anchov|mackerel|haddock|pollock|swordfish|\bbass\b|snapper/, '🐟', 'Meat & Seafood'],

  // Dairy and eggs
  [/\beggs?\b|egg whites/, '🥚', 'Dairy & Eggs'],
  [/cream cheese|cheese|parmesan|cheddar|mozzarella|feta|brie|gouda|ricotta|provolone|havarti|monterey jack|pepper jack|colby|gruyere|camembert|mascarpone|halloumi|paneer/, '🧀', 'Dairy & Eggs'],
  [/milk|cream|half and half|half & half|yogurt|yoghurt|kefir|buttermilk/, '🥛', 'Dairy & Eggs'],
  [/\bbutter\b|margarine|\bghee\b/, '🧈', 'Dairy & Eggs'],
  [/baby formula|\bformula\b|baby food/, '🍼', 'Other'],

  // Bakery
  [/baguette|french bread/, '🥖', 'Bakery'], [/croissant/, '🥐', 'Bakery'], [/bagel/, '🥯', 'Bakery'],
  [/tortilla|\bpitas?\b|naan|flatbread|lavash/, '🫓', 'Bakery'], [/pancake/, '🥞', 'Pantry'], [/waffle/, '🧇', 'Frozen'],
  [/donut|doughnut/, '🍩', 'Bakery'], [/muffin|cupcake/, '🧁', 'Bakery'], [/\bpies?\b|pie crust/, '🥧', 'Bakery'],
  [/birthday cake/, '🎂', 'Bakery'], [/cake/, '🍰', 'Bakery'],
  [/bread|\bbuns?\b|\brolls?\b|loaf|english muffin|brioche|sourdough|biscuit/, '🍞', 'Bakery'],

  // Pantry staples
  [/\bnuts?\b|almond|peanut|cashew|pecan|walnut|pistachio|macadamia/, '🥜', 'Snacks'], [/chestnut|hazelnut|acorn/, '🌰', 'Snacks'],
  [/sunflower|pumpkin seed|pepitas|\bseeds?\b/, '🌻', 'Pantry'],
  [/ramen|\budon\b|\bpho\b|soba|rice noodle|instant noodle|cup noodle/, '🍜', 'Pantry'],
  [/\brice\b|risotto|arborio|basmati|jasmine/, '🍚', 'Pantry'], [/nori|seaweed|onigiri/, '🍙', 'Pantry'],
  [/pasta|spaghetti|noodle|macaroni|penne|fettuccine|linguine|rigatoni|ziti|orzo|lasagna noodle|tortellini|ravioli|gnocchi|couscous/, '🍝', 'Pantry'],
  [/flour|sugar|baking|wheat|barley|quinoa|bulgur|farro|grits|polenta/, '🌾', 'Pantry'],
  [/bean|lentil|chickpea|garbanzo|hummus/, '🫘', 'Pantry'],
  [/honey|syrup|molasses|agave/, '🍯', 'Pantry'],
  [/cereal|\boats?\b|oatmeal|granola|muesli|cheerios|corn flakes/, '🥣', 'Pantry'],
  [/sauce|ketchup|mustard|mayo|dressing|worcestershire|\bsoy\b|teriyaki|bbq|barbecue|hoisin|aioli|ranch|gravy|condiment/, '🫗', 'Pantry'],
  [/salt|pepper|cinnamon|paprika|cumin|oregano|spice|seasoning|nutmeg|vanilla|chili powder|cloves|bay lea|cardamom|coriander|allspice|curry powder|italian seasoning|extract/, '🧂', 'Spices'],
  [/frozen/, '🧊', 'Frozen'],

  // Drinks
  [/water|seltzer|la ?croix|sparkling/, '💧', 'Beverages'], [/soda|\bpop\b|energy drink|red bull|monster|gatorade|powerade|sports drink|smoothie/, '🥤', 'Beverages'],
  [/yerba|mate\b/, '🧉', 'Beverages'],

  // Household and everything else
  [/paper towel|toilet|tissue|kleenex|napkin/, '🧻', 'Household'],
  [/sponge|scrubber|scouring|steel wool/, '🧽', 'Household'], [/dish ?soap|dishwasher|dawn\b|cascade|finish pods/, '🫧', 'Household'],
  [/laundry|fabric softener|dryer sheet|tide\b/, '🧺', 'Household'], [/soap|hand wash|sanitizer/, '🧼', 'Household'],
  [/shampoo|conditioner|lotion|body wash|sunscreen|deodorant|cleaner|bleach|disinfect|windex|lysol|clorox|spray|detergent/, '🧴', 'Household'],
  [/toothpaste|toothbrush|floss|mouthwash/, '🪥', 'Household'], [/mop|bucket/, '🪣', 'Household'], [/broom|dustpan/, '🧹', 'Household'],
  [/trash|garbage/, '🗑️', 'Household'], [/\bbags?\b|ziploc|foil|plastic wrap|cling wrap|parchment|wax paper|saran/, '🛍️', 'Household'],
  [/paper plates?|plates|\bcups?\b|utensils|forks|spoons|straws/, '🍽️', 'Household'],
  [/batter(y|ies)/, '🔋', 'Household'], [/light ?bulb/, '💡', 'Household'], [/candle/, '🕯️', 'Household'], [/gloves/, '🧤', 'Household'],
  [/medicine|vitamin|ibuprofen|tylenol|advil|aspirin|allergy|cough|pills/, '💊', 'Household'], [/band-?aids?|bandage/, '🩹', 'Household'],
  [/dog (food|treats?)|kibble/, '🐶', 'Household'], [/cat (food|treats?)|litter/, '🐱', 'Household'], [/rawhide|chew/, '🦴', 'Household'],
  [/diaper|wipes/, '🍼', 'Household'],
];

export function guessItem(name: string): { icon: string; category: (typeof CATEGORIES)[number] } {
  const n = name.toLowerCase();
  const hit = RULES.find(([re]) => re.test(n));
  // "Frozen peas" gets the pea icon but lives in Frozen; "frozen yogurt" already has its own rule.
  if (hit?.[2] !== 'Frozen' && /\bfrozen\b/.test(n)) {
    const inner = guessItem(n.replace(/\bfrozen\b/, ' ').trim());
    if (inner.category !== 'Other') return { icon: inner.icon, category: 'Frozen' };
  }
  return hit ? { icon: hit[1], category: hit[2] } : { icon: '🛒', category: 'Other' };
}
