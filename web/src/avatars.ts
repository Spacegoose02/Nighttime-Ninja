// Picture avatars: drop image files into web/src/avatars/ and they show up in Settings automatically.
// The file name sets the order and the label: "01_executive_chef.png" -> id "executive_chef", label "Executive Chef".

const files = import.meta.glob('./avatars/*.{png,jpg,jpeg,webp,svg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export interface PictureAvatar { id: string; label: string; url: string }

export const PICTURE_AVATARS: PictureAvatar[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
  .map(([path, url]) => {
    const base = path.split('/').pop()!.replace(/\.[^.]+$/, '');
    const id = base.replace(/^\d+[_\- ]*/, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const label = id.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    return { id, label, url };
  });

const byId = new Map(PICTURE_AVATARS.map((a) => [a.id, a]));
export const pictureAvatar = (id: string | null | undefined): PictureAvatar | undefined => (id ? byId.get(id) : undefined);
