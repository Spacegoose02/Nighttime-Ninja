import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A pop-up built on the browser's own <dialog>: it traps focus, closes on Escape or a tap outside,
 * and hands focus back to whatever opened it.
 */
export function Modal({ onClose, label, children, className = '' }: { onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard way out is Escape, handled by onCancel.
    <dialog
      ref={ref} className={`modal ${className}`} aria-label={label}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      // A click on the dialog element itself (not its contents) is a click on the dimmed backdrop.
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-body stack">{children}</div>
    </dialog>
  );
}

interface Ask {
  message: string;
  kind: 'confirm' | 'alert' | 'prompt';
  okLabel: string;
  danger: boolean;
  value: string;
  /** For prompts that guard something big: OK stays off until the typed text matches. */
  mustType: string | null;
  resolve: (v: string | null) => void;
}

interface AskOpts { okLabel?: string; danger?: boolean }

interface Dialogs {
  /** In-app replacement for window.confirm. */
  confirm: (message: string, opts?: AskOpts) => Promise<boolean>;
  /** In-app replacement for window.alert. Text can be selected and copied. */
  alert: (message: string) => Promise<void>;
  /** In-app replacement for window.prompt. Resolves to null on Cancel. */
  prompt: (message: string, value?: string, opts?: AskOpts & { mustType?: string }) => Promise<string | null>;
}

const Ctx = createContext<Dialogs | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<Ask | null>(null);

  const open = useCallback((a: Omit<Ask, 'resolve'>) => new Promise<string | null>((resolve) => {
    setAsk({ ...a, resolve: (v) => { setAsk(null); resolve(v); } });
  }), []);

  const dialogs: Dialogs = {
    confirm: useCallback(async (message, o) => (await open({ message, kind: 'confirm', okLabel: o?.okLabel ?? 'OK', danger: !!o?.danger, value: '', mustType: null })) != null, [open]),
    alert: useCallback(async (message) => { await open({ message, kind: 'alert', okLabel: 'OK', danger: false, value: '', mustType: null }); }, [open]),
    prompt: useCallback((message, value = '', o) => open({ message, kind: 'prompt', okLabel: o?.okLabel ?? 'OK', danger: !!o?.danger, value, mustType: o?.mustType ?? null }), [open]),
  };

  return (
    <Ctx.Provider value={dialogs}>
      {children}
      {ask && <AskDialog key={ask.message} ask={ask} />}
    </Ctx.Provider>
  );
}

function AskDialog({ ask }: { ask: Ask }) {
  const [value, setValue] = useState(ask.value);
  const cancel = () => ask.resolve(null);
  const ok = () => ask.resolve(ask.kind === 'prompt' ? value : '');
  const blocked = ask.mustType != null && value !== ask.mustType;
  return (
    <Modal onClose={ask.kind === 'alert' ? ok : cancel} label={ask.kind === 'alert' ? 'Notice' : 'Confirm'} className="ask">
      <form method="dialog" className="stack" onSubmit={(e) => { e.preventDefault(); if (!blocked) ok(); }}>
        <p className="ask-text" style={{ margin: 0 }}>{ask.message}</p>
        {ask.kind === 'prompt' && <input aria-label={ask.message} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {ask.kind !== 'alert' && <button type="button" className="ghost" onClick={cancel}>Cancel</button>}
          <button className={ask.danger ? 'danger-fill' : 'primary'} disabled={blocked} autoFocus={ask.kind !== 'prompt'}>{ask.okLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function useDialogs(): Dialogs {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDialogs outside DialogProvider');
  return v;
}
