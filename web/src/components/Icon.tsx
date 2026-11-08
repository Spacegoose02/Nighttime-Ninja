// One line-icon set (Lucide, ISC licence) for navigation and actions, so buttons look the same on every device.
// Food keeps its emoji: those are content, not controls.
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  ArrowLeftRight, BookOpen, CookingPot, Globe, Link2, Utensils, CalendarDays, Check, ChefHat, Download, Ellipsis, House, Martini, Menu, Package, Pencil, Plus,
  Printer, Search, Settings, ShoppingCart, Store, Tag, Trash2, Tv, Undo2, X,
} from 'lucide-react';

export const ICONS = {
  home: House, pantry: Package, recipes: BookOpen, shopping: ShoppingCart, plan: CalendarDays, chef: ChefHat,
  bar: Martini, deals: Tag, feed: Tv, settings: Settings, more: Menu, edit: Pencil, delete: Trash2, move: ArrowLeftRight,
  print: Printer, add: Plus, close: X, menu: Ellipsis, check: Check, search: Search, undo: Undo2, store: Store, download: Download,
  cook: CookingPot, cooked: Utensils, globe: Globe, share: Link2,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** A line icon that follows the text colour. Hidden from screen readers: the button or link around it carries the words. */
export function Icon({ name, className = '', ...rest }: { name: IconName } & Omit<LucideProps, 'ref'>) {
  const C = ICONS[name];
  return <C aria-hidden className={`i ${className}`.trim()} {...rest} />;
}
