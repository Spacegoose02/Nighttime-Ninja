import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IconPicker } from './IconPicker.tsx';

describe('pantry icon picker', () => {
  it('searches, picks an icon, and can go back to automatic', () => {
    const onChange = vi.fn();
    render(<IconPicker value="" guess="🥛" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), { target: { value: 'boba' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bubble tea' }));
    expect(onChange).toHaveBeenLastCalledWith('🧋');

    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search icons' }), { target: { value: '🦄' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use 🦄' }));
    expect(onChange).toHaveBeenLastCalledWith('🦄');
  });
});
