import { useState } from 'react';
import { ICON_GROUPS, searchIcons } from '../../../shared/icons.ts';

/** True when the text has no letters or digits, so it is probably an emoji the user pasted in. */
const looksLikeEmoji = (s: string) => s.trim() !== '' && !/[\p{L}\p{N}]/u.test(s);

/**
 * Picks a pantry item's icon from a searchable, grouped grid of food emoji.
 * An empty value means "guess from the name", shown as the Automatic choice.
 */
export function IconPicker({ value, guess, onChange }: { value: string; guess: string; onChange: (icon: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const choose = (icon: string) => { onChange(icon); setOpen(false); setQuery(''); };
  const results = query.trim() ? searchIcons(query) : null;

  const cell = (emoji: string, name: string) => (
    <button key={emoji} type="button" className={`icon-cell${value === emoji ? ' on' : ''}`} title={name} aria-label={name} aria-pressed={value === emoji} onClick={() => choose(emoji)}>
      {emoji}
    </button>
  );

  return (
    <div className="field icon-picker">
      <span>Icon</span>
      <button type="button" className="icon-current" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden style={{ fontSize: '1.5rem' }}>{value || guess}</span>
        <span className="small">{value ? 'Change' : 'Automatic · Change'}</span>
      </button>
      {open && (
        <div className="icon-panel stack">
          <div className="row">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons, e.g. cheese, soup, pet" aria-label="Search icons" autoFocus />
            <button type="button" className={`chip${value ? '' : ' on'}`} onClick={() => choose('')}>{guess} Automatic</button>
          </div>
          {results ? (
            <div className="icon-grid">
              {results.map((i) => cell(i.emoji, i.name))}
              {looksLikeEmoji(query) && cell(query.trim(), `Use ${query.trim()}`)}
              {!results.length && !looksLikeEmoji(query) && <p className="small muted">No icons match. You can also paste any emoji here.</p>}
            </div>
          ) : ICON_GROUPS.map((g) => (
            <div key={g.name}>
              <div className="small muted" style={{ fontWeight: 600, margin: '4px 0' }}>{g.name}</div>
              <div className="icon-grid">{g.icons.map((i) => cell(i.emoji, i.name))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
