// 16x16 layered pixel avatar. Each layer is a 16-row mask where '.' leaves the
// pixel below untouched and any other letter names a palette colour.
import type { AvatarLook } from './types';

export const DEFAULT_LOOK: AvatarLook = {
  skin: 'light',
  hair: 'brown',
  hairStyle: 'short',
  tunic: 'white',
  helmet: 'none',
  cape: 'none',
  shield: 'none',
  shoes: 'none',
  hand: 'none',
  face: 'none',
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

// Hair styles are free; everything else is an item. Each table maps a look value to its layer.
const HAIR: Record<string, string[]> = {
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
  pigtails: rows(5, ['...k........k...', '..khk......khk..', '..khk......khk..', '...k........k...']),
  curly: rows(1, [
    '....kk.kk.kk....',
    '...khhkhhkhhk...',
    '..khhhhhhhhhhk..',
    '..khhhhhhhhhhk..',
    '..khhsssssshhk..',
    '...khsesseshk...',
    '...khsssssshk...',
  ]),
  bob: rows(3, [
    '...khhhhhhhhk...',
    '...khhhhhhhhk...',
    '...khhhhhhhhk...',
    '...khsesseshk...',
    '...khsssssshk...',
    '...khssSSsshk...',
    '....kkkkkkkk....',
  ]),
};

// Patterned tops replace the tunic rows; plain colours (sky, olive) only change the palette.
const TUNIC: Record<string, string[]> = {
  stripe: rows(10, ['...kwwwwwwwwk...', '..ksddddddddsk..', '..kswwwwwwwwsk..', '...kddddddddk...']),
  hoodie: rows(9, ['....kUkkkkUk....', '...kuuWuuWuuk...', '..ksuuuuuuuusk..', '..ksuUUUUUUusk..', '...kuuuuuuuuk...']),
  vest: rows(10, ['...kwvvrrvvwk...', '..ksvvvrrvvvsk..', '..ksvvvrrvvvsk..', '...kvvvvvvvvk...']),
  sequin: rows(10, ['...kqyqqqqyqk...', '..ksqqqyyqqqsk..', '..ksyqqqqqqysk..', '...kqqyqqyqqk...']),
  suit: rows(10, ['...knnWRRWnnk...', '..ksnnnRRnnnsk..', '..ksnnnnnnnnsk..', '...knnnnnnnnk...']),
  robe: rows(10, ['...kuuuuuuuuk...', '..ksuuuyuuuusk..', '..ksuuuuuuyusk..', '...kuyuuuuuuk...', '....kuuuuuuk....']),
  tracksuit: rows(10, ['...kxxxxxxxxk...', '..ksWxxxxxxWsk..', '..ksxxxxxxxxsk..', '...kxxxxxxxxk...', '....kxxkkxxk....']),
  // Armour is worn as the top too; its hem shows a little of the white tunic.
  lorica: rows(10, ['...kaaaaaaaak...', '..ksaAaaaaAask..', '..ksabbbbbbask..', '...kAwAwAwAwk...']),
  gold: rows(10, ['...kyyyyyyyyk...', '..ksyGyyyyGysk..', '..ksyGGGGGGysk..', '...kGwGwGwGwk...']),
};

const HELMET: Record<string, string[]> = {
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
  straw: rows(1, ['.....kkkkkk.....', '....kYrrrrYk....', '.kYYYYYYYYYYYYk.']),
  crown: rows(0, ['.....y.yy.y.....', '.....yyyyyy.....', '....kyryyryk....']),
  cat: rows(0, ['....k......k....', '...khk....khk...', '...kphkkkkhpk...']),
  ribbon: rows(1, ['.........RR.RR..', '.........RRkRR..', '..........R.R...']),
  grad: rows(0, ['.....kkkkkk.....', '..knnnnnnnnnnk..', '....knnnnnnk.y..', '.............y..', '.............y..']),
  wizard: rows(0, ['.......k........', '......kuk.......', '.....kuuuk......', '....kuuyuuk.....', '..kuuuuuuuuuuk..']),
  headset: rows(2, ['....knnnnnnk....', '...n........n...', '...n........n...', '...n........n...', '...n............', '...nnk..........']),
  cap: rows(1, ['.....kkkkkk.....', '....kdddWddk....', '....kddddddddk..']),
  headphones: rows(1, ['....kppppppk....', '...kp......pk...', '...kp......pk...', '...k........k...', '..kpk......kpk..', '..kpk......kpk..', '...k........k...']),
};

// Worn on the face, over the eyes (row 6).
const FACE: Record<string, string[]> = {
  glasses: rows(6, ['....knennenk....']),
  sunglasses: rows(6, ['....kWnnnWnk....']),
  heartglasses: rows(5, ['.....R.RR.R.....', '....kRRnnRRk....']),
};

const SHOES: Record<string, string[]> = {
  sandal: rows(15, ['....kslkkslk....']),
  boots: rows(14, ['....kBBkkBBk....', '....kBBkkBBk....']),
  sneakers: rows(15, ['....kWrkkWrk....']),
  winged: rows(14, ['..W..........W..', '...WkyykkyykW...']),
  skates: rows(14, ['....kWWkkWWk....', '....kyykkyyk....']),
};

// Held in the hand on the left side of the picture (columns 0-3).
const HAND: Record<string, string[]> = {
  sword: rows(3, ['..k.', '.kmk', '.kmk', '.kmk', '.kmk', '.kmk', '.kmk', '.BBB', '..B.', '..B.', '..k.'].map(pad)),
  spear: rows(0, ['..k.', '.kak', '.kak', ...Array.from({ length: 12 }, () => '..B.')].map(pad)),
  wand: rows(4, ['..y.', '.yWy', '..y.', '..n.', '..n.', '..n.', '..n.', '..n.', '..n.'].map(pad)),
  pencil: rows(2, ['.kpk', '.kpk', '.kak', '.kyk', '.kyk', '.kyk', '.kyk', '.kyk', '.kyk', '.kmk', '..m.', '..k.'].map(pad)),
  flag: rows(0, ['..k.', 'rrB.', 'rWB.', 'rrB.', ...Array.from({ length: 10 }, () => '..B.')].map(pad)),
  mic: rows(7, ['.kk.', 'kaak', 'kAak', '.kn.', '..n.', '..n.'].map(pad)),
  lightstick: rows(3, ['.kk.', 'kpWk', 'kppk', '.kk.', '..n.', '..n.', '..n.', '..n.', '..n.'].map(pad)),
  phone: rows(9, ['kkk.', 'kdk.', 'kdk.', 'kkk.'].map(pad)),
  staff: rows(0, ['.kk.', 'kuWk', 'kuuk', '.kk.', ...Array.from({ length: 11 }, () => '..B.')].map(pad)),
  icecream: rows(5, ['.kk.', 'kpWk', 'kppk', 'kYYk', '.kYk', '..Y.', '..k.'].map(pad)),
};

const SHIELD: Record<string, string[]> = {
  round: rows(10, ['............kook', '...........koyok', '...........kyyyk', '...........koyok', '............kook']),
  book: rows(10, ['...........kRRRk', '...........kRyRk', '...........kRRRk', '...........kWWWk', '...........kkkkk']),
  star: rows(10, ['............kaak', '...........kayak', '...........kyyyk', '...........kayak', '............kaak']),
};

const CAPE: Record<string, string[]> = {
  red: rows(10, ['..c..........c..', '.c............c.', '.c............c.', '.cc..........cc.', '.cc..........cc.']),
  blue: rows(10, ['..c..........c..', '.c............c.', '.c............c.', '.cc..........cc.', '.cc..........cc.']),
  star: rows(10, ['..c..........c..', '.c............c.', '.y............y.', '.cc..........cc.', '.cy..........yc.']),
  dragon: rows(6, ['k..............k', 'Rk............kR', 'RRk..........kRR', 'RRk..........kRR', '.Rk..........kR.', '.k............k.']),
  fairy: rows(8, ['.qq..........qq.', 'qWqq........qqWq', 'qqq..........qqq', '.qp..........pq.', '..q..........q..']),
  backpack: rows(10, ['..R..R....R..R..', '.RR..R....R..RR.', '.RR..R....R..RR.', '.RR..........RR.']),
};

function pad(left: string): string {
  return (left + BLANK).slice(0, 16);
}

/** Layer for a look value, ignoring anything that isn't a real entry (such as 'constructor'). */
function layer(table: Record<string, string[]>, value: string): string[] | undefined {
  return Object.hasOwn(table, value) ? table[value] : undefined;
}

const SKINS = { light: ['#F1C9A5', '#D9A47E'], medium: ['#E0AC82', '#C28A62'], tan: ['#B97E56', '#99633F'] };
const HAIRS = { brown: '#5A3B26', black: '#1F1B18', blond: '#C9A15A' };
const TUNICS: Record<string, [string, string]> = { white: ['#EFE9DC', '#CFC6B4'], sky: ['#A9C3DD', '#7E9DBE'], olive: ['#B7C59A', '#8E9E6E'] };
const CAPES: Record<string, string> = { red: '#C2412D', blue: '#2F5DA8', star: '#34446B' };

/** Every layer in drawing order, for checking that each row is exactly 16 pixels. */
export const ALL_LAYERS = { HAIR, TUNIC, HELMET, FACE, SHOES, HAND, SHIELD, CAPE };

/** Shades and heart glasses hide the eyes, so blinking and reaction faces skip the eyes. */
export function eyesCovered(look: AvatarLook): boolean {
  return look.face === 'sunglasses' || look.face === 'heartglasses';
}

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
  // Back to front: hair, top (armour too), shoes, back (cape, wings, bag), hat, face, shield, then the hand.
  for (const [table, value] of [
    [HAIR, look.hairStyle],
    [TUNIC, look.tunic],
    [SHOES, look.shoes],
    [CAPE, look.cape],
    [HELMET, look.helmet],
    [FACE, look.face],
    [SHIELD, look.shield],
    [HAND, look.hand],
  ] as const) {
    // The full helmet replaces curly hair; its bumps would poke out around the crest.
    if (table === HAIR && look.hairStyle === 'curly' && look.helmet === 'galea') continue;
    const l = layer(table, value);
    if (l) apply(l);
  }

  const sk = SKINS[look.skin] ?? SKINS.light;
  const tu = (Object.hasOwn(TUNICS, look.tunic) && TUNICS[look.tunic]) || TUNICS.white;
  const pal: Record<string, string> = {
    k: '#22201C', e: '#1E1A16', s: sk[0], S: sk[1], h: HAIRS[look.hair] ?? HAIRS.brown,
    w: tu[0], t: tu[1], b: '#7A5230', l: '#8A5A33',
    g: '#D7A94B', G: '#9A7330', r: '#E0452B', L: '#4E8A3E', y: '#F5C542',
    a: '#B9C1CA', A: '#7D8792', c: (Object.hasOwn(CAPES, look.cape) && CAPES[look.cape]) || CAPES.red, o: '#9A7330',
    // Colours for the newer items.
    Y: '#E9C46A', p: '#F4A7B9', R: '#D64563', n: '#2B2D42', d: '#5B7DB1', u: '#8E7CC3', U: '#65579E',
    v: '#34446B', W: '#FFFFFF', B: '#6B4226', m: '#D9A066', q: '#DDE3EC', x: '#3E9B6E',
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
