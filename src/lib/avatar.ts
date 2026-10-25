// 16x16 layered pixel avatar. Each layer is a 16-row mask where '.' leaves the
// pixel below untouched and any other letter names a palette colour.
import type { AvatarLook } from './types';

export const DEFAULT_LOOK: AvatarLook = {
  skin: 'light',
  hair: 'brown',
  hairStyle: 'short',
  tunic: 'white',
  helmet: 'none',
  armor: 'none',
  cape: 'none',
  shield: 'none',
  effect: 'none',
};

const BLANK = '................';

const BASE = [
  BLANK,
  BLANK,
  '.....kkkkkk.....',
  '....khhhhhhk....',
  '....khhhhhhk....',
  '....khsssshk....',
  '....ksessesk....',
  '....kssssssk....',
  '....kssSSssk....',
  '.....kkkkkk.....',
  '...kwwwwwwwwk...',
  '..kswwwwwwwwsk..',
  '..kswbbbbbbwsk..',
  '...kwwttttwwk...',
  '....ksskkssk....',
  '....kllkkllk....',
];

function rows(start: number, lines: string[]): string[] {
  const out = Array.from({ length: 16 }, () => BLANK);
  lines.forEach((line, i) => (out[start + i] = line));
  return out;
}

const LAYERS: Record<string, string[]> = {
  long: rows(3, [
    '...khhhhhhhhk...',
    '...khhhhhhhhk...',
    '...khhsssshhk...',
    '...khsesseshk...',
    '...khsssssshk...',
    '...khssSSsshk...',
    '...khkkkkkkhk...',
    '...khwwwwwwhk...',
  ]),
  ponytail: rows(3, ['............hk..', '............hhk.', '............khk.', '.............k..']),
  cape: rows(10, ['..c..........c..', '.c............c.', '.c............c.', '.cc..........cc.', '.cc..........cc.']),
  lorica: rows(10, ['...kaaaaaaaak...', '..ksaAaaaaAask..', '..ksabbbbbbask..', '...kAwAwAwAwk...']),
  galea: rows(0, [
    '.......rr.......',
    '......rrrr......',
    '....kggggggk....',
    '...kggggggggk...',
    '...kgGGGGGGgk...',
    '...kgssssssgk...',
    '...kgsessesgk...',
    '...kgssssssgk...',
  ]),
  laurel: rows(2, ['....Ly....yL....', '...L........L...', '...L........L...', '....L......L....']),
  round: rows(10, ['............kook', '...........koyok', '...........kyyyk', '...........koyok', '............kook']),
};

const SKINS = { light: ['#F1C9A5', '#D9A47E'], medium: ['#E0AC82', '#C28A62'], tan: ['#B97E56', '#99633F'] };
const HAIRS = { brown: '#5A3B26', black: '#1F1B18', blond: '#C9A15A' };
const TUNICS = { white: ['#EFE9DC', '#CFC6B4'], sky: ['#A9C3DD', '#7E9DBE'], olive: ['#B7C59A', '#8E9E6E'] };
const CAPES = { red: '#C2412D', blue: '#2F5DA8', none: '#C2412D' };

export interface PixelRun {
  x: number;
  y: number;
  w: number;
  color: string;
}

/** Flattens the look into horizontal runs of same-coloured pixels for compact SVG output. */
export function avatarRuns(look: AvatarLook): PixelRun[] {
  const grid = BASE.map((r) => r.split(''));
  const apply = (layer: string[]) =>
    layer.forEach((row, y) =>
      row.split('').forEach((ch, x) => {
        if (ch !== '.') grid[y][x] = ch;
      }),
    );
  if (look.hairStyle === 'long') apply(LAYERS.long);
  if (look.hairStyle === 'ponytail') apply(LAYERS.ponytail);
  if (look.cape !== 'none') apply(LAYERS.cape);
  if (look.armor === 'lorica') apply(LAYERS.lorica);
  if (look.helmet === 'galea') apply(LAYERS.galea);
  if (look.helmet === 'laurel') apply(LAYERS.laurel);
  if (look.shield === 'round') apply(LAYERS.round);

  const sk = SKINS[look.skin] ?? SKINS.light;
  const tu = TUNICS[look.tunic] ?? TUNICS.white;
  const pal: Record<string, string> = {
    k: '#22201C', e: '#1E1A16', s: sk[0], S: sk[1], h: HAIRS[look.hair] ?? HAIRS.brown,
    w: tu[0], t: tu[1], b: '#7A5230', l: '#8A5A33',
    g: '#D7A94B', G: '#9A7330', r: '#E0452B', L: '#4E8A3E', y: '#F5C542',
    a: '#B9C1CA', A: '#7D8792', c: CAPES[look.cape] ?? CAPES.red, o: '#9A7330',
  };

  const runs: PixelRun[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < 16) {
      const color = pal[row[x]];
      if (!color) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < 16 && pal[row[x + w]] === color) w++;
      runs.push({ x, y, w, color });
      x += w;
    }
  });
  return runs;
}

/** Base and shadow skin colours, for drawing face expressions on top of the avatar. */
export function skinTones(look: AvatarLook): [string, string] {
  const sk = SKINS[look.skin] ?? SKINS.light;
  return [sk[0], sk[1]];
}

export function normalizeLook(raw: Partial<AvatarLook> | undefined): AvatarLook {
  return { ...DEFAULT_LOOK, ...(raw ?? {}) };
}
