// Every icon the pantry offers in its icon picker, grouped and searchable.
// Icons are standard Unicode emoji, drawn by the device's own emoji font, so no artwork ships with the app.
// Stick to Unicode 15.0 or older so every icon renders on phones and computers that are a few years old.

export interface PantryIcon { emoji: string; name: string; words?: string }

export const ICON_GROUPS: { name: string; icons: PantryIcon[] }[] = [
  { name: 'Fruit', icons: [
    { emoji: '🍎', name: 'Red apple' }, { emoji: '🍏', name: 'Green apple', words: 'granny smith' },
    { emoji: '🍐', name: 'Pear' }, { emoji: '🍊', name: 'Orange', words: 'tangerine clementine mandarin citrus' },
    { emoji: '🍋', name: 'Lemon', words: 'lime citrus' }, { emoji: '🍌', name: 'Banana', words: 'plantain' },
    { emoji: '🍉', name: 'Watermelon' }, { emoji: '🍈', name: 'Melon', words: 'cantaloupe honeydew' },
    { emoji: '🍇', name: 'Grapes', words: 'raisins' }, { emoji: '🍓', name: 'Strawberry', words: 'berries raspberry' },
    { emoji: '🫐', name: 'Blueberries', words: 'berries blackberry' }, { emoji: '🍒', name: 'Cherries' },
    { emoji: '🍑', name: 'Peach', words: 'nectarine apricot' }, { emoji: '🥭', name: 'Mango', words: 'papaya' },
    { emoji: '🍍', name: 'Pineapple' }, { emoji: '🥝', name: 'Kiwi' }, { emoji: '🥥', name: 'Coconut' },
    { emoji: '🍅', name: 'Tomato' }, { emoji: '🫒', name: 'Olive' }, { emoji: '🥑', name: 'Avocado', words: 'guacamole' },
  ] },
  { name: 'Vegetables', icons: [
    { emoji: '🥕', name: 'Carrot' }, { emoji: '🥔', name: 'Potato' }, { emoji: '🍠', name: 'Sweet potato', words: 'yam' },
    { emoji: '🌽', name: 'Corn' }, { emoji: '🫑', name: 'Bell pepper', words: 'capsicum' },
    { emoji: '🌶️', name: 'Hot pepper', words: 'chili jalapeno' }, { emoji: '🥒', name: 'Cucumber', words: 'zucchini pickle' },
    { emoji: '🥬', name: 'Leafy greens', words: 'lettuce spinach kale cabbage bok choy' }, { emoji: '🥦', name: 'Broccoli', words: 'cauliflower' },
    { emoji: '🍆', name: 'Eggplant', words: 'aubergine' }, { emoji: '🧄', name: 'Garlic' }, { emoji: '🧅', name: 'Onion', words: 'shallot' },
    { emoji: '🫚', name: 'Ginger root', words: 'turmeric' }, { emoji: '🫛', name: 'Pea pod', words: 'peas edamame snap green beans' },
    { emoji: '🍄', name: 'Mushroom' }, { emoji: '🌿', name: 'Fresh herbs', words: 'basil cilantro parsley mint' },
    { emoji: '🌱', name: 'Sprouts', words: 'microgreens seedling' }, { emoji: '🥗', name: 'Salad' },
  ] },
  { name: 'Meat & Seafood', icons: [
    { emoji: '🥩', name: 'Steak', words: 'beef pork lamb meat' }, { emoji: '🍖', name: 'Meat on the bone', words: 'ribs roast' },
    { emoji: '🍗', name: 'Poultry leg', words: 'chicken turkey wings drumstick' }, { emoji: '🥓', name: 'Bacon' },
    { emoji: '🌭', name: 'Hot dog', words: 'sausage frank bratwurst' }, { emoji: '🍔', name: 'Burger', words: 'ground beef patty' },
    { emoji: '🐟', name: 'Fish', words: 'salmon cod tilapia' }, { emoji: '🍣', name: 'Sushi', words: 'sashimi tuna' },
    { emoji: '🦐', name: 'Shrimp', words: 'prawns' }, { emoji: '🍤', name: 'Fried shrimp', words: 'tempura' },
    { emoji: '🦀', name: 'Crab' }, { emoji: '🦞', name: 'Lobster', words: 'crawfish crayfish' },
    { emoji: '🦑', name: 'Squid', words: 'calamari' }, { emoji: '🐙', name: 'Octopus' }, { emoji: '🦪', name: 'Oyster', words: 'clams mussels scallops' },
  ] },
  { name: 'Dairy & Eggs', icons: [
    { emoji: '🥛', name: 'Milk', words: 'cream yogurt' }, { emoji: '🧀', name: 'Cheese' }, { emoji: '🧈', name: 'Butter', words: 'margarine' },
    { emoji: '🥚', name: 'Egg' }, { emoji: '🍳', name: 'Fried egg', words: 'breakfast' }, { emoji: '🍼', name: 'Baby bottle', words: 'formula baby' },
  ] },
  { name: 'Bakery', icons: [
    { emoji: '🍞', name: 'Bread', words: 'loaf sandwich bread' }, { emoji: '🥖', name: 'Baguette', words: 'french bread' },
    { emoji: '🥐', name: 'Croissant', words: 'pastry' }, { emoji: '🥯', name: 'Bagel' }, { emoji: '🫓', name: 'Flatbread', words: 'tortilla pita naan' },
    { emoji: '🥨', name: 'Pretzel' }, { emoji: '🥞', name: 'Pancakes' }, { emoji: '🧇', name: 'Waffle' },
    { emoji: '🍩', name: 'Doughnut', words: 'donut' }, { emoji: '🧁', name: 'Cupcake', words: 'muffin' },
    { emoji: '🍰', name: 'Cake slice' }, { emoji: '🎂', name: 'Birthday cake' }, { emoji: '🥧', name: 'Pie' },
  ] },
  { name: 'Pantry', icons: [
    { emoji: '🥫', name: 'Can', words: 'canned soup sauce tin' }, { emoji: '🫙', name: 'Jar', words: 'jam jelly preserves pickles' },
    { emoji: '🍚', name: 'Rice' }, { emoji: '🍝', name: 'Pasta', words: 'spaghetti noodles' }, { emoji: '🍜', name: 'Noodle bowl', words: 'ramen udon pho' },
    { emoji: '🌾', name: 'Grain', words: 'flour wheat oats barley' }, { emoji: '🫘', name: 'Beans', words: 'lentils chickpeas' },
    { emoji: '🥜', name: 'Peanuts', words: 'nuts peanut butter' }, { emoji: '🌰', name: 'Chestnut', words: 'nuts hazelnut acorn' },
    { emoji: '🌻', name: 'Sunflower', words: 'seeds sunflower oil' }, { emoji: '🥣', name: 'Cereal bowl', words: 'oatmeal granola' },
    { emoji: '🍯', name: 'Honey', words: 'syrup molasses' }, { emoji: '🧂', name: 'Salt', words: 'spice seasoning shaker' },
    { emoji: '🫗', name: 'Pouring liquid', words: 'oil vinegar sauce' }, { emoji: '🧊', name: 'Ice' },
  ] },
  { name: 'Meals', icons: [
    { emoji: '🍕', name: 'Pizza' }, { emoji: '🍟', name: 'Fries' }, { emoji: '🥪', name: 'Sandwich' },
    { emoji: '🌮', name: 'Taco' }, { emoji: '🌯', name: 'Burrito', words: 'wrap' }, { emoji: '🫔', name: 'Tamale' },
    { emoji: '🥙', name: 'Stuffed flatbread', words: 'gyro pita kebab' }, { emoji: '🧆', name: 'Falafel' },
    { emoji: '🥘', name: 'Paella', words: 'casserole skillet' }, { emoji: '🍲', name: 'Stew', words: 'soup chili pot' },
    { emoji: '🫕', name: 'Fondue' }, { emoji: '🍛', name: 'Curry' }, { emoji: '🍱', name: 'Bento box', words: 'leftovers meal prep' },
    { emoji: '🥟', name: 'Dumpling', words: 'potsticker pierogi gyoza' }, { emoji: '🥡', name: 'Takeout box', words: 'leftovers' },
    { emoji: '🍙', name: 'Rice ball', words: 'onigiri' }, { emoji: '🍘', name: 'Rice cracker' }, { emoji: '🍢', name: 'Skewer', words: 'kebab oden' },
    { emoji: '🍥', name: 'Fish cake' }, { emoji: '🥠', name: 'Fortune cookie' }, { emoji: '🥮', name: 'Moon cake' },
  ] },
  { name: 'Sweets & Snacks', icons: [
    { emoji: '🍪', name: 'Cookie', words: 'biscuit' }, { emoji: '🍫', name: 'Chocolate' }, { emoji: '🍬', name: 'Candy', words: 'sweets' },
    { emoji: '🍭', name: 'Lollipop' }, { emoji: '🍮', name: 'Custard', words: 'pudding flan' }, { emoji: '🍡', name: 'Dango', words: 'mochi' },
    { emoji: '🍦', name: 'Soft serve' }, { emoji: '🍨', name: 'Ice cream' }, { emoji: '🍧', name: 'Shaved ice', words: 'sorbet popsicle' },
    { emoji: '🍿', name: 'Popcorn' },
  ] },
  { name: 'Drinks', icons: [
    { emoji: '☕', name: 'Coffee', words: 'espresso' }, { emoji: '🍵', name: 'Tea', words: 'matcha green tea' }, { emoji: '🫖', name: 'Teapot' },
    { emoji: '🧃', name: 'Juice box', words: 'juice' }, { emoji: '🥤', name: 'Soda cup', words: 'soda pop smoothie' },
    { emoji: '🧋', name: 'Bubble tea', words: 'boba' }, { emoji: '🧉', name: 'Mate' }, { emoji: '💧', name: 'Water' },
  ] },
  { name: 'Bar', icons: [
    { emoji: '🍷', name: 'Wine' }, { emoji: '🍾', name: 'Champagne', words: 'sparkling wine prosecco' }, { emoji: '🥂', name: 'Clinking glasses' },
    { emoji: '🍺', name: 'Beer' }, { emoji: '🍻', name: 'Beers' }, { emoji: '🥃', name: 'Whiskey', words: 'bourbon scotch tumbler' },
    { emoji: '🍸', name: 'Cocktail', words: 'martini vodka gin' }, { emoji: '🍹', name: 'Tropical drink', words: 'rum tequila' },
    { emoji: '🍶', name: 'Sake' },
  ] },
  { name: 'Household & more', icons: [
    { emoji: '🧻', name: 'Paper towels', words: 'toilet paper tissue' }, { emoji: '🧽', name: 'Sponge', words: 'dish scrubber' },
    { emoji: '🧼', name: 'Soap' }, { emoji: '🧴', name: 'Bottle', words: 'lotion shampoo detergent' }, { emoji: '🫧', name: 'Bubbles', words: 'dish soap' },
    { emoji: '🧹', name: 'Broom' }, { emoji: '🪣', name: 'Bucket', words: 'mop cleaner' }, { emoji: '🧺', name: 'Laundry basket' },
    { emoji: '🛍️', name: 'Bags', words: 'trash bags zip bags' }, { emoji: '🗑️', name: 'Trash can' }, { emoji: '🪥', name: 'Toothbrush', words: 'toothpaste' },
    { emoji: '💊', name: 'Medicine', words: 'vitamins pills' }, { emoji: '🩹', name: 'Bandage' }, { emoji: '🔋', name: 'Batteries' },
    { emoji: '💡', name: 'Light bulb' }, { emoji: '🕯️', name: 'Candle' }, { emoji: '🧤', name: 'Gloves' },
    { emoji: '🍽️', name: 'Plate', words: 'paper plates' }, { emoji: '🥄', name: 'Spoon', words: 'utensils' }, { emoji: '🥢', name: 'Chopsticks' },
    { emoji: '🐶', name: 'Dog food', words: 'pet' }, { emoji: '🐱', name: 'Cat food', words: 'pet litter' }, { emoji: '🦴', name: 'Dog treats', words: 'bone' },
    { emoji: '📦', name: 'Box', words: 'package bulk' },
  ] },
];

export const ALL_ICONS: PantryIcon[] = ICON_GROUPS.flatMap((g) => g.icons);

/** Icons whose name or extra words contain every word of the query. */
export function searchIcons(query: string): PantryIcon[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return ALL_ICONS;
  return ALL_ICONS.filter((i) => {
    const hay = `${i.name} ${i.words ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
