import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DialogProvider, useDialogs } from './Dialog.tsx';

let dialogs: ReturnType<typeof useDialogs>;
function Grab() {
  dialogs = useDialogs();
  return null;
}
const mount = () => render(<DialogProvider><Grab /></DialogProvider>);

describe('in-app dialogs', () => {
  it('confirm resolves true on OK and false on Cancel', async () => {
    mount();
    let answer!: Promise<boolean>;
    act(() => { answer = dialogs.confirm('Delete this recipe?', { okLabel: 'Delete', danger: true }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await answer).toBe(true);

    act(() => { answer = dialogs.confirm('Delete this recipe?'); });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await answer).toBe(false);
  });

  it('a guarded prompt only allows OK once the exact text is typed', async () => {
    mount();
    let answer!: Promise<string | null>;
    act(() => { answer = dialogs.prompt('Type the home name: Cabin', '', { okLabel: 'Delete forever', mustType: 'Cabin' }); });
    const ok = await screen.findByRole('button', { name: 'Delete forever' });
    expect(ok).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Cabin' } });
    expect(ok).toHaveProperty('disabled', false);
    fireEvent.click(ok);
    expect(await answer).toBe('Cabin');
  });
});
