import { pictureAvatar } from '../avatars.ts';
// The Nighttime Ninja mascot: a masked raccoon chef, drawn in plain SVG so it themes and scales cleanly.

export const AVATARS = ['classic', 'chef', 'bandana', 'glasses', 'baker', 'ninja', 'grill', 'sushi'] as const;
export type Avatar = (typeof AVATARS)[number];

export const AVATAR_LABELS: Record<Avatar, string> = {
  classic: 'Classic', chef: 'Head Chef', bandana: 'Bandit', glasses: 'Professor',
  baker: 'Baker', ninja: 'Ninja', grill: 'Grill Master', sushi: 'Sushi Chef',
};

function Head({ variant }: { variant: Avatar }) {
  return (
    <g>
      {/* ears */}
      <circle cx="30" cy="40" r="13" fill="#868d94" />
      <circle cx="90" cy="40" r="13" fill="#868d94" />
      <circle cx="30" cy="40" r="6.5" fill="#3a3f44" />
      <circle cx="90" cy="40" r="6.5" fill="#3a3f44" />
      {/* head */}
      <ellipse cx="60" cy="66" rx="40" ry="33" fill="#a3aab1" />
      <path d="M60 34 q-6 10 0 22 q6 -12 0 -22z" fill="#6f767d" />
      {/* cheeks */}
      <ellipse cx="60" cy="78" rx="29" ry="19" fill="#f4f4f2" />
      {/* the bandit mask */}
      <path d="M22 60 q38 -24 76 0 q-6 15 -21 12 q-17 -5 -34 0 q-15 3 -21 -12z" fill="#262a2e" />
      {variant === 'ninja' && (
        <g>
          <rect x="18" y="40" width="84" height="9" rx="3" fill="#1d3557" />
          <path d="M100 44 l16 -6 l-3 8 l5 6 l-18 -3z" fill="#1d3557" />
        </g>
      )}
      {variant === 'sushi' && (
        <g>
          <rect x="18" y="40" width="84" height="8" rx="3" fill="#fff" />
          <circle cx="60" cy="44" r="3.4" fill="#d62828" />
        </g>
      )}
      {variant === 'grill' && <rect x="18" y="40" width="84" height="8" rx="3" fill="#f08c00" />}
      {/* eyes */}
      <circle cx="44" cy="62" r="5.5" fill="#fff" />
      <circle cx="76" cy="62" r="5.5" fill="#fff" />
      <circle cx="45" cy="62.5" r="3" fill="#111" />
      <circle cx="77" cy="62.5" r="3" fill="#111" />
      <circle cx="46" cy="61" r="1" fill="#fff" />
      <circle cx="78" cy="61" r="1" fill="#fff" />
      {variant === 'glasses' && (
        <g fill="none" stroke="#c9a227" strokeWidth="2.5">
          <circle cx="44" cy="62" r="10" />
          <circle cx="76" cy="62" r="10" />
          <path d="M54 61 q6 -4 12 0" />
        </g>
      )}
      {/* nose and smile */}
      <ellipse cx="60" cy="79" rx="6" ry="4.2" fill="#222" />
      <path d="M51 87 q9 7 18 0" stroke="#222" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      {variant === 'baker' && (
        <g fill="#fff" opacity="0.9">
          <circle cx="38" cy="82" r="3" /><circle cx="84" cy="80" r="2.4" /><circle cx="80" cy="86" r="1.6" />
        </g>
      )}
      {/* hats */}
      {(variant === 'chef' || variant === 'grill') && (
        <g>
          <rect x="34" y="16" width="52" height="22" rx="4" fill="#fff" stroke="#d9d9d9" />
          <circle cx="40" cy="14" r="11" fill="#fff" />
          <circle cx="60" cy="8" r="13" fill="#fff" />
          <circle cx="80" cy="14" r="11" fill="#fff" />
        </g>
      )}
      {variant === 'baker' && (
        <g>
          <path d="M30 38 q30 -26 60 0 z" fill="#f7c6d0" />
          <rect x="28" y="34" width="64" height="7" rx="3.5" fill="#e98fa3" />
        </g>
      )}
      {variant === 'bandana' && <path d="M38 94 q22 18 44 0 l-22 18z" fill="#d62828" />}
    </g>
  );
}

export function RaccoonAvatar({ variant = 'classic', size = 48, title }: { variant?: string; size?: number; title?: string }) {
  const pic = pictureAvatar(variant);
  if (pic) {
    return <img src={pic.url} alt={title ?? pic.label} width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />;
  }
  const v =(AVATARS as readonly string[]).includes(variant) ? (variant as Avatar) : 'classic';
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={title ?? `${AVATAR_LABELS[v]} raccoon`}>
      <Head variant={v} />
    </svg>
  );
}

/** The raccoon at the stove, for the dashboard. Steam is animated in CSS. */
export function KitchenScene({ variant = 'chef' }: { variant?: string }) {
  const v = (AVATARS as readonly string[]).includes(variant) ? (variant as Avatar) : 'chef';
  return (
    <svg viewBox="0 0 360 220" className="kitchen-scene" role="img" aria-label="A raccoon chef cooking at the stove">
      {/* wall tiles */}
      <defs>
        <pattern id="tiles" width="30" height="30" patternUnits="userSpaceOnUse">
          <rect width="30" height="30" fill="var(--scene-wall)" />
          <path d="M30 0 V30 H0" fill="none" stroke="var(--scene-grout)" strokeWidth="2" />
        </pattern>
      </defs>
      <rect width="360" height="220" fill="url(#tiles)" />
      {/* window with moon, because ninjas cook at night */}
      <rect x="250" y="18" width="88" height="66" rx="6" fill="#1b2a41" stroke="var(--scene-counter)" strokeWidth="5" />
      <circle cx="310" cy="40" r="12" fill="#f6e7a1" />
      <circle cx="304" cy="37" r="11" fill="#1b2a41" />
      <circle cx="268" cy="34" r="1.5" fill="#fff" /><circle cx="286" cy="62" r="1.2" fill="#fff" /><circle cx="324" cy="70" r="1.4" fill="#fff" />
      {/* counter and stove */}
      <rect x="0" y="168" width="360" height="52" fill="var(--scene-counter)" />
      <rect x="150" y="150" width="140" height="20" rx="4" fill="#3d4349" />
      <ellipse cx="220" cy="150" rx="34" ry="5" fill="#ff7b39" opacity="0.8" />
      {/* pan */}
      <rect x="282" y="132" width="58" height="7" rx="3.5" fill="#2b2f33" />
      <ellipse cx="230" cy="138" rx="52" ry="12" fill="#2b2f33" />
      <ellipse cx="230" cy="134" rx="46" ry="8" fill="#4a5056" />
      <circle cx="214" cy="133" r="6" fill="#f2c14e" /><circle cx="236" cy="131" r="5" fill="#e76f51" /><circle cx="250" cy="135" r="5" fill="#8ac926" />
      {/* steam */}
      <g className="steam" stroke="var(--scene-steam)" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d="M212 118 q-8 -12 0 -24 q8 -12 0 -24" />
        <path d="M232 116 q-8 -12 0 -24 q8 -12 0 -24" />
        <path d="M252 118 q-8 -12 0 -24 q8 -12 0 -24" />
      </g>
      {/* raccoon body with apron */}
      <ellipse cx="110" cy="170" rx="52" ry="48" fill="#a3aab1" />
      <path d="M78 140 h64 v60 q-32 14 -64 0z" fill="var(--primary)" />
      <rect x="96" y="158" width="28" height="18" rx="4" fill="rgba(255,255,255,.35)" />
      {/* arm holding a spatula toward the pan */}
      <path d="M146 150 q30 -10 46 -22" stroke="#a3aab1" strokeWidth="16" strokeLinecap="round" fill="none" />
      <rect x="186" y="104" width="6" height="34" rx="3" fill="#7a4e2d" transform="rotate(35 189 121)" />
      <rect x="196" y="112" width="18" height="12" rx="2" fill="#c9ced3" transform="rotate(35 205 118)" />
      {/* striped tail */}
      <g transform="translate(36 150) rotate(-35)">
        <ellipse cx="0" cy="0" rx="14" ry="40" fill="#a3aab1" />
        <rect x="-14" y="-28" width="28" height="9" fill="#3a3f44" />
        <rect x="-14" y="-8" width="28" height="9" fill="#3a3f44" />
        <rect x="-13" y="12" width="26" height="9" fill="#3a3f44" />
      </g>
      <g transform="translate(50 20) scale(1)">
        <Head variant={v} />
      </g>
    </svg>
  );
}
