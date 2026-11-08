// A list row you can swipe: right to do the main thing (check off), left to remove.
// The row's buttons do the same, so nothing depends on swiping.
import { useRef, useState, type ReactNode } from 'react';

const TRIGGER = 90;

export function SwipeRow({ children, onRight, onLeft, rightLabel, leftLabel, disabled, className = '' }: {
  children: ReactNode;
  onRight?: () => void;
  onLeft?: () => void;
  rightLabel?: string;
  leftLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);

  const reset = () => { start.current = null; setDx(0); };
  return (
    <div
      className={`swipe-row ${className}`.trim()}
      onPointerDown={(e) => {
        if (disabled || e.pointerType === 'mouse') return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        const x = e.clientX - s.x;
        const y = e.clientY - s.y;
        // Decide once whether this is a sideways swipe or a scroll.
        if (s.horizontal == null && Math.abs(x) + Math.abs(y) > 10) s.horizontal = Math.abs(x) > Math.abs(y) * 1.5;
        if (!s.horizontal) return;
        const limited = (!onRight && x > 0) || (!onLeft && x < 0) ? 0 : x;
        setDx(Math.max(-160, Math.min(160, limited)));
      }}
      onPointerUp={() => {
        if (dx >= TRIGGER) onRight?.();
        else if (dx <= -TRIGGER) onLeft?.();
        reset();
      }}
      onPointerCancel={reset}
    >
      {dx !== 0 && (
        <div className={`swipe-behind ${dx > 0 ? 'right' : 'left'}${Math.abs(dx) >= TRIGGER ? ' armed' : ''}`} aria-hidden>
          {dx > 0 ? rightLabel : leftLabel}
        </div>
      )}
      <div className="swipe-front" style={dx ? { transform: `translateX(${dx}px)` } : undefined}>{children}</div>
    </div>
  );
}
