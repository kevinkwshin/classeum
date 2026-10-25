// 24x24 layered pixel avatar. Each layer is a 24-row mask where '.' leaves the
// pixel below untouched and any other letter names a palette colour (see palette below).
// Head rows 3-15 (outline cols 5 and 18), body rows 16-21, legs 22-23. Eyes sit in boxes at cols 7-9 and 14-16 on rows 10-11.
import type { AvatarLook } from './types';

export const GRID = 24;

export const DEFAULT_LOOK: AvatarLook = {
  skin: 'light',
  hair: 'brown',
  hairStyle: 'short',
  eyes: 'round',
  tunic: 'white',
  helmet: 'none',
  cape: 'none',
  shield: 'none',
  shoes: 'none',
  hand: 'none',
  face: 'none',
  effect: 'none',
};

// Free choices (not items), in the order the character picker shows them.
export const HAIR_STYLES: { id: AvatarLook['hairStyle']; name: string }[] = [
  { id: 'short', name: '짧은 머리' },
  { id: 'long', name: '긴 머리' },
  { id: 'bob', name: '단발' },
  { id: 'ponytail', name: '묶은 머리' },
  { id: 'pigtails', name: '양갈래' },
  { id: 'braid', name: '땋은 머리' },
  { id: 'side', name: '옆 가르마' },
  { id: 'curly', name: '뽀글 머리' },
  { id: 'spiky', name: '삐죽 머리' },
  { id: 'bun', name: '똥머리' },
  { id: 'twinbun', name: '양쪽 똥머리' },
  { id: 'buzz', name: '스포츠 머리' },
];
export const HAIR_COLORS: { id: AvatarLook['hair']; name: string }[] = [
  { id: 'black', name: '검정' },
  { id: 'brown', name: '갈색' },
  { id: 'blond', name: '금발' },
  { id: 'red', name: '빨강' },
  { id: 'pink', name: '분홍' },
  { id: 'blue', name: '파랑' },
  { id: 'silver', name: '은색' },
];
export const SKIN_TONES: { id: AvatarLook['skin']; name: string }[] = [
  { id: 'light', name: '밝은 피부' },
  { id: 'medium', name: '중간 피부' },
  { id: 'tan', name: '구릿빛 피부' },
  { id: 'deep', name: '짙은 피부' },
];
export const EYE_STYLES: { id: AvatarLook['eyes']; name: string }[] = [
  { id: 'round', name: '동글 눈' },
  { id: 'big', name: '큰 눈' },
  { id: 'smile', name: '웃는 눈' },
  { id: 'sharp', name: '또렷한 눈' },
  { id: 'dot', name: '점 눈' },
];

const BLANK = '........................';

function rows(start: number, lines: string[]): string[] {
  const out = Array.from({ length: GRID }, () => BLANK);
  lines.forEach((line, i) => (out[start + i] = line));
  return out;
}

// The default short hair, the face with round eyes and a plain tunic.
const BASE = [
  '........................',
  '........................',
  '........................',
  '........kkkkkkkk........',
  '......kkhhhhhhhhkk......',
  '.....khhhhhhhhhhhhk.....',
  '.....khhhHHhhhhhhhk.....',
  '.....khhhhhhhhhhhhk.....',
  '.....khhhhhhhhhhhhk.....',
  '.....khsssssssssshk.....',
  '.....kssWessssWessk.....',
  '.....ksseesssseessk.....',
  '.....ksPPssssssPPsk.....',
  '.....ksssssMMsssssk.....',
  '......kssssssssssk......',
  '.......kkkkkkkkkk.......',
  '......kwwwwwwwwwwk......',
  '.....kwwwwwwwwwwwtk.....',
  '....kswwwwwwwwwwwtsk....',
  '....kswwwwwwwwwwwtsk....',
  '....kSwbbbbbbbbbbtSk....',
  '......kwwttttttwwk......',
  '........ksskkssk........',
  '........kllkkllk........',
];

// Hair styles only draw hair and outline around the face, never inside the eye boxes.
const HAIR: Record<string, string[]> = {
  long: rows(5, [
    '....khhhhhhhhhhhhhhk....',
    '...khhhhHHhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhhsssssssssshhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhhh........hhhhk...',
    '...khhhh........hhhhk...',
    '...khhh..........hhhk...',
    '....kk............kk....',
  ]),
  bob: rows(5, [
    '....khhhhhhhhhhhhhhk....',
    '...khhhhHHhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '...kkkk..........kkkk...',
  ]),
  ponytail: rows(5, [
    '..................kk....',
    '..................kRhk..',
    '...................khhk.',
    '...................khhk.',
    '...................kHhk.',
    '...................khhk.',
    '....................khk.',
    '....................khk.',
    '.....................k..',
  ]),
  pigtails: rows(8, [
    '...kk..............kk...',
    '..khhR............Rhhk..',
    '..khHk............kHhk..',
    '..khhk............khhk..',
    '..khhk............khhk..',
    '...kk..............kk...',
  ]),
  curly: rows(1, [
    '.......kk..kk..kk.......',
    '......khhkkhhkkhhk......',
    '.....khhhhhhhhhhhhk.....',
    '....khhhhhhhhhhhhhhk....',
    '...khhHHhhhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhhhhhhhhhhhhhhhk...',
    '...khhhhsssssssshhhhk...',
    '...khhh..........hhhk...',
    '...khhh..........hhhk...',
    '....kk............kk....',
  ]),
  spiky: rows(0, [
    '.......k...kk...k.......',
    '......khk.khhk.khk......',
    '.....khhhkhhhhkhhhk.....',
    '.....khhhhhhhhhhhhk.....',
  ]),
  bun: rows(0, [
    '..........kkkk..........',
    '.........khhHhk.........',
    '.........khhhhk.........',
    '........kkhRRhkk........',
  ]),
  twinbun: rows(1, [
    '.....kkk........kkk.....',
    '....khhhk......khhhk....',
    '....khHhk......khHhk....',
    '....khhhk......khhhk....',
    '.....kkk........kkk.....',
  ]),
  braid: rows(10, [
    '..................khhk..',
    '..................kHhk..',
    '..................khHk..',
    '..................kHhk..',
    '..................khHk..',
    '..................kHhk..',
    '..................khHk..',
    '..................kRRk..',
    '..................khhk..',
    '...................kk...',
  ]),
  side: rows(5, [
    '....kh..................',
    '....khh.................',
    '....khh.................',
    '....khh.................',
    '.....khhhhhhhsssshk.....',
    '.....kh.................',
  ]),
  buzz: rows(7, [
    '.....khsssssssssshk.....',
    '.....khsssssssssshk.....',
    '.....kssssssssssssk.....',
  ]),
};

// Eye shapes other than 'round' (which is in BASE), covering both eye boxes.
const EYES: Record<string, string[]> = {
  smile: rows(10, ['.......ses....ses.......', '.......ese....ese.......']),
  big: rows(10, ['.......eWe....eWe.......', '.......eee....eee.......']),
  sharp: rows(10, ['.......see....ees.......', '.......eee....eee.......']),
  dot: rows(10, ['.......ses....ses.......', '.......ses....ses.......']),
};

// 몸: patterned tops and armour replace the tunic rows; plain colours (white, sky, olive) only change the palette.
const TUNIC: Record<string, string[]> = {
  stripe: rows(16, [
    '......kwwwwwwwwwwk......',
    '.....kdddddddddddvk.....',
    '....kswwwwwwwwwwwtsk....',
    '....ksdddddddddddvsk....',
    '....kSwwwwwwwwwwwtSk....',
    '......kddddddddddk......',
  ]),
  hoodie: rows(15, [
    '....kkU..........Ukk....',
    '....kUUUuuWuuWuuUUUk....',
    '.....kuuuuWuuWuuuUk.....',
    '....kuUuuuquuquuuUuk....',
    '....kUUuUUUUUUUUuUUk....',
    '....kSUUuuuuuuuuUUSk....',
    '......kUUUUUUUUUUk......',
  ]),
  vest: rows(16, [
    '......kvvWWrrWWvvk......',
    '.....kwvvWWrrWWvvtk.....',
    '....kswvvvWrrWvvvtsk....',
    '....kswvvvvnnvvvvtsk....',
    '....kSwvvvvvvvvvvtSk....',
    '......kvnvnvnvnvnk......',
  ]),
  sequin: rows(16, [
    '......kgqaqaqaqagk......',
    '.....kAaAyAaAWAaAAk.....',
    '....ksaWaAaAWWWAaAsk....',
    '....ksAaAaAaAWAayAsk....',
    '....kSyggyggyggygGSk....',
    '......kaAaAaAaAaAk......',
  ]),
  suit: rows(16, [
    '......kvnWWRRWWnvk......',
    '.....kvvvnWRRWnvvnk.....',
    '....kvvvvvnRRnvvvnvk....',
    '....kWvvvvvnnvvvvnWk....',
    '....kSvvvvvgvvvvvnSk....',
    '......kvvvvnnvvvvk......',
  ]),
  robe: rows(16, [
    '......kUUUUUUUUUUk......',
    '.....kUUyUUUUyUUUJk.....',
    '....kUUyWyUUUUUUUJUk....',
    '....kgUUyUUUUUyUUJgk....',
    '....kSUUUUUUUyWyUJSk....',
    '.....kUUUyUUUUyUUJk.....',
    '......kkggggggggkk......',
  ]),
  tracksuit: rows(16, [
    '......kWxxxxaxxxWk......',
    '.....kWxxxxxWxxxxWk.....',
    '....kWXxxxxxaxxxxXWk....',
    '....kWXxxxxxaxxxxXWk....',
    '....kSXxxxxxaxxxxXSk....',
    '......kXXXXXaXXXXk......',
  ]),
  lorica: rows(16, [
    '.....kkaaAAAAAAaakk.....',
    '....kaAaWWaaaaaaaAAk....',
    '....ksAAAAAAAAAAAAsk....',
    '....ksaWaaaaaaaaaAsk....',
    '....kSbbbbbggbbbbbSk....',
    '.....kmBmBmBmBmBmBk.....',
  ]),
  gold: rows(16, [
    '.....kkggGGGGGGggkk.....',
    '....kgGgWWgggggggGGk....',
    '....ksGGGGGGGGGGGGsk....',
    '....ksgygggggggggGsk....',
    '....kSbbbbbrrbbbbbSk....',
    '.....kyGyGyGyGyGyGk.....',
  ]),
};

// 머리: hats, ears, headphones and crowns.
const HELMET: Record<string, string[]> = {
  galea: rows(0, [
    '...........kk...........',
    '..........kOOk..........',
    '.........kODrrk.........',
    '......kkkkrDrDkkkk......',
    '.....kgyykrDrDkggGk.....',
    '....kgyggkGGGGkgggGk....',
    '....kgygggggggggggGk....',
    '....kgggggggggggggGk....',
    '....kGGGGGGGGGGGGGGk....',
    '....kgy..........gGk....',
    '....kgg..........gGk....',
    '....kGG..........GGk....',
    '.....kk..........kk.....',
  ]),
  laurel: rows(1, [
    '.......k.kk..kk.k.......',
    '......kjkjLkkLjkjk......',
    '.....kjLLkkkkkkLLjk.....',
    '....kjLkk......kkLjk....',
    '...kjLk..........kLjk...',
    '...kLLk..........kLLk...',
    '..kjLk............kLjk..',
    '...kLLk..........kLLk...',
    '..kjLk............kLjk..',
    '...kk..............kk...',
  ]),
  grad: rows(0, [
    '..........kkkk..........',
    '......kkkkNNNNkkkk......',
    '..kkkkNNNnnnnnnnnnkkkk..',
    '.kNNnnnnnnnyggggggggggk.',
    '..kkkknnnnnnnnnnnnkkkkgk',
    '......kkkknnnnkkkk...kgk',
    '......knnkkkkkknnk...kgk',
    '......knnnnnnnnnnk...kgk',
    '....................kyyk',
    '....................kggk',
    '....................kGGk',
    '.....................kk.',
  ]),
  ribbon: rows(1, [
    '.............kkk...kkk..',
    '............kpRRk.kRRpk.',
    '............kpRRRkRRREk.',
    '............kRRRkpkRREk.',
    '............kREEkRkEEEk.',
    '.............kkkkRkkkk..',
    '...............kRkkRk...',
    '................k..kEk..',
    '....................k...',
  ]),
  headset: rows(2, [
    '........kkkkkkkk........',
    '......kkAAAAAAAAkk......',
    '.....kAkk......kkAk.....',
    '....kAk..........kAk....',
    '....kAk..........kAk....',
    '....kAk..........kAk....',
    '...kkkk..........kkkk...',
    '...kaAk..........kaAk...',
    '...kAnk..........kAnk...',
    '....kkA...........kk....',
    '......A.................',
    '.......Ann..............',
  ]),
  crown: rows(0, [
    '.......k...kk...k.......',
    '......kyk.kWyk.kyk......',
    '......kgkkgyygkkgk......',
    '......kygggWrgggGk......',
    '......kgrggrrggrGk......',
    '......kGGGGGGGGGGk......',
    '.......kkkkkkkkkk.......',
  ]),
  wizard: rows(0, [
    '.............kk.........',
    '............kIUk........',
    '..........kkIuUk........',
    '........kkIuyuUk........',
    '.......kIuuyWyuUk.......',
    '......kIuuuuyuuuUk......',
    '.....kIuuuuuuuuuuUk.....',
    '..kkkggggggggggggggkkk..',
    '.kIIuuuuuuuuuuuuuuuuUUk.',
    '..kkk..............kkk..',
  ]),
  cap: rows(0, [
    '...........kk...........',
    '........kkkkkkkk........',
    '......kkdZddddddkk......',
    '.....kdZddddWWddddk.....',
    '.....kdddddWddWdddzk....',
    '.....kddddddddddddzkkk..',
    '.....kzzzzzzzzzzzzdddddk',
    '.....kkkkkkkkkkkkkkkkkk.',
  ]),
  headphones: rows(1, [
    '.......kkkkkkkkkk.......',
    '.....kkpWWppppppFkk.....',
    '....kpWkkkkkkkkkkpFk....',
    '....kpk..........kFk....',
    '...kpk............kFk...',
    '...kpk............kFk...',
    '..kkkkk..........kkkkk..',
    '..kpWpk..........kppFk..',
    '..kpppk..........kppFk..',
    '..kpppk..........kppFk..',
    '..kFFFk..........kFFFk..',
    '...kkk............kkk...',
  ]),
  cat: rows(0, [
    '.....k............k.....',
    '.....kk..........kk.....',
    '.....khk........khk.....',
    '.....kphk......khpk.....',
    '.....kpph......hppk.....',
    '.....khhhh....hhhhk.....',
  ]),
  straw: rows(2, [
    '........kkkkkkkk........',
    '.......kYiiYYYYmk.......',
    '.......kYiYYYmYmk.......',
    '.......krrrrrrrDk.......',
    '..kkkkkkrrrrrrrDkkkkkk..',
    '.kYiiYYmYYmYYmYYmYYmYmk.',
    'kYYmYYmYYmYYmYYmYYmYYmmk',
    '.kmmk..............kmmk.',
  ]),
};

// 얼굴: worn over the eye boxes.
const FACE: Record<string, string[]> = {
  glasses: rows(9, [
    '.......nnn....nnn.......',
    '......n...nnnn...n......',
    '......n...n..n...n......',
    '.......nnn....nnn.......',
  ]),
  sunglasses: rows(9, [
    '......kkkkk..kkkkk......',
    '......knWnnkknWnnk......',
    '......knnWnkknnWnk......',
    '.......kkkk..kkkk.......',
  ]),
  heartglasses: rows(9, [
    '......RR.RR..RR.RR......',
    '......RWpRRkkRWpRR......',
    '.......RpR....RpR.......',
    '........R......R........',
  ]),
};

// 발
const SHOES: Record<string, string[]> = {
  sandal: rows(22, ['........kmskksmk........', '.......kmsmkkmsmk.......']),
  sneakers: rows(22, ['.......kWWrkkrWWk.......', '.......kAAAkkAAAk.......']),
  winged: rows(20, [
    '..k.k..............k.k..',
    '.kWkWk............kWkWk.',
    '.kWWWWWkgygkkgygkWWWWWk.',
    '..kqqqqkGgGkkGgGkqqqqk..',
  ]),
  skates: rows(22, ['.......kpWpkkpWpk.......', '.......kykykkykyk.......']),
  boots: rows(22, ['.......kmBBkkBBmk.......', '.......kBBBkkBBBk.......']),
};

// 손: held in the hand on the picture's left.
const HAND: Record<string, string[]> = {
  sword: rows(2, [
    '..kk....................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    '.kYmk...................',
    'kkYmkk..................',
    'kBBBBk..................',
    'kkbBkk..................',
    '.kBbk...................',
    '.kbBk...................',
    '.ksss...................',
    '.kSSS...................',
    '.kBBkk..................',
    '..kk....................',
  ]),
  spear: rows(2, [
    '...k....................',
    '..kqk...................',
    '.kqaAk..................',
    '.kqaAk..................',
    '.kqaAk..................',
    '..kAk...................',
    '..kgk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..klk...................',
    '..kss...................',
    '..kSS...................',
    '..klkk..................',
    '..klk...................',
    '...k....................',
  ]),
  pencil: rows(2, [
    '.kkk....................',
    'kppRk...................',
    'kppRk...................',
    'kqaAk...................',
    'kqaAk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'k1ygk...................',
    'kssss...................',
    'kSSSS...................',
    'kmmokk..................',
    '.knk....................',
    '..k.....................',
  ]),
  mic: rows(11, [
    '.kkkk...................',
    'kWqaak..................',
    'kqAqAk..................',
    'kaqAak..................',
    '.kAAk...................',
    '.kggk...................',
    '.kpRk...................',
    '.kpRk...................',
    '.ksss...................',
    '.kSSS...................',
    '..kkkk..................',
  ]),
  lightstick: rows(8, [
    '.p......................',
    'pWp.....................',
    '.p......................',
    '.kkkk...................',
    'kp44pk..................',
    'k4WW4k..................',
    'k4WW4k..................',
    'kRppRk..................',
    '.kkkk...................',
    '.kaAk...................',
    '.kRvk...................',
    '.ksss...................',
    '.kSSS...................',
    '.knvkk..................',
    '.knvk...................',
    '..kk....................',
  ]),
  staff: rows(2, [
    '.kkkk...................',
    'kW2uuk..................',
    'k2uuuk..................',
    'kuuuUk..................',
    'kuuUUk..................',
    '.kggk...................',
    '.kGGk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.klBk...................',
    '.ksss...................',
    '.kSSS...................',
    '.klBkk..................',
    '.klBk...................',
    '..kk....................',
  ]),
  wand: rows(7, [
    '.y......................',
    'yWy.....................',
    '.y......................',
    '..k.....................',
    '.kyk....................',
    'kkykk...................',
    'y1Wyyk..................',
    'kyygk...................',
    'kypyk...................',
    'kkpkk...................',
    '.kpk....................',
    '.kpk....................',
    '.ksss...................',
    '.kSSS...................',
    '.kpkkk..................',
    '..k.....................',
  ]),
  phone: rows(12, [
    '.kkkk...................',
    'kpdydk..................',
    'kddddk..................',
    'kxdudk..................',
    'kddddk..................',
    'kdd3d...................',
    'k3ddd...................',
    'kssss...................',
    'kSSSS...................',
    '.kkkkk..................',
  ]),
  flag: rows(2, [
    '....k...................',
    '...kyk..................',
    'kkkkak..................',
    'rrrrak..................',
    'rWWrak..................',
    'rWWrak..................',
    'rrrrak..................',
    '5555ak..................',
    'kkkkak..................',
    '...kak..................',
    '...kak..................',
    '...kak..................',
    '...kak..................',
    '...kak..................',
    '...kak..................',
    '...kak..................',
    '...ka...................',
    '..kss...................',
    '..kSS...................',
    '...kak..................',
    '...kak..................',
    '....k...................',
  ]),
  icecream: rows(8, [
    '..r.....................',
    '.kRk....................',
    '.kkkk...................',
    'kpWppk..................',
    'kppppk..................',
    'kpppRk..................',
    'kRpRRk..................',
    'kmRmok..................',
    'komomk..................',
    '.kmok...................',
    '.komk...................',
    '.ksss...................',
    '.kSSS...................',
    '..kkkk..................',
  ]),
};

// 팔: on the picture's right, over the arm.
const SHIELD: Record<string, string[]> = {
  round: rows(15, [
    '...................kkk..',
    '..................kgGGk.',
    '.................kgmymGk',
    '.................kGyWyGk',
    '.................kGmymGk',
    '..................kGGGk.',
    '...................kkk..',
  ]),
  book: rows(14, [
    '.................kkkkkk.',
    '.................k7rrrkk',
    '.................k7yyrWk',
    '.................k7rrrWk',
    '.................k7rrrWk',
    '.................k7rrrWk',
    '.................k7rrrqk',
    '.................kkkkkkk',
  ]),
  star: rows(14, [
    '.................kkkkkkk',
    '.................kqaaaAk',
    '.................kaayaAk',
    '.................kyyyyyk',
    '.................kayyyAk',
    '.................kayAyAk',
    '..................kaaAk.',
    '...................kkk..',
  ]),
};

// 등: capes and wings behind the body, the backpack with straps in front.
const CAPE: Record<string, string[]> = {
  red: rows(15, [
    '.....kc..........Ck.....',
    '....kcccgk....kgCCCk....',
    '...kccck........kCCCk...',
    '.kcC................CCk.',
    '.kcC................CCk.',
    '.kcC................CCk.',
    '.kccCC............CCCCk.',
    '.kcCccCC........CCCCCCk.',
    '..kkkkkk........kkkkkk..',
  ]),
  blue: rows(15, [
    '.....kc..........Ck.....',
    '....kcccgk....kgCCCk....',
    '...kccck........kCCCk...',
    '.kcC................CCk.',
    '.kcC................CCk.',
    '.kcC................CCk.',
    '.kccCC............CCCCk.',
    '.kcCccCC........CCCCCCk.',
    '..kkkkkk........kkkkkk..',
  ]),
  star: rows(15, [
    '.....kc..........Ck.....',
    '....kcccgk....kgCyCk....',
    '...kcyck........kCCCk...',
    '.kcC................yCk.',
    '.kyC................CCk.',
    '.kcC................CCk.',
    '.kccyC............CCCyk.',
    '.kcCccCy........yCCCCCk.',
    '..kkkkkk........kkkkkk..',
  ]),
  dragon: rows(3, [
    '.k....................k.',
    'kqk..................kqk',
    'krk..................krk',
    'krk..................krk',
    'krk..................krk',
    'k7rk................kr7k',
    'k7rk................kr7k',
    'k7rk................kr7k',
    'k77rk..............kr77k',
    'kr77r..............r77rk',
    'k7r7r..............r7r7k',
    '.k7rrk............krr7k.',
    'krrrrrk..........krrrrrk',
    'k777rk............kr777k',
    '.k7rk..............kr7k.',
    '..kk................kk..',
  ]),
  fairy: rows(6, [
    '.99..................99.',
    '9889................9889',
    '9W889..............988W9',
    '98889..............98889',
    '98p89..............98p89',
    '988p9..............9p889',
    '.9889..............9889.',
    '.9899..............9989.',
    '..9889............9889..',
    '..99899..........99899..',
    '.98899............99889.',
    '98W89..............98W89',
    '9889................9889',
    '.99..................99.',
  ]),
  backpack: rows(14, [
    '...kkk............kkk...',
    '..krrrr..........rrrrk..',
    '.k7rrrk.rk....kr.krrr7k.',
    '.k7rrk..rk....kr..krr7k.',
    '.k7gk..gk......kg..kg7k.',
    '.k77k.rk........kr.k77k.',
    '.k77k..............k77k.',
    '..kkkk............kkkk..',
  ]),
};

/** Hats that cover the top of the head hide hair that would stick up through them (the helmet hides curls too). */
function hidesHair(look: AvatarLook): boolean {
  const tall = ['bun', 'twinbun', 'spiky'].includes(look.hairStyle);
  return (look.helmet === 'galea' && (tall || look.hairStyle === 'curly')) || (['wizard', 'straw', 'cap', 'grad'].includes(look.helmet) && tall);
}

/** Layer for a look value, ignoring anything that isn't a real entry (such as 'constructor'). */
function layer(table: Record<string, string[]>, value: string | undefined): string[] | undefined {
  return value !== undefined && Object.hasOwn(table, value) ? table[value] : undefined;
}

const pick = <T,>(table: Record<string, T>, key: string, fallback: string): T => (Object.hasOwn(table, key) ? table[key] : table[fallback]);

// skin: base, shade, blush · hair: base, highlight · tunic and cape: base, shade.
const SKINS: Record<string, [string, string, string]> = {"light":["#F6D3B3","#DDAA86","#F3A3A0"],"medium":["#E4B08A","#C68B63","#E88E86"],"tan":["#BE8459","#9C6640","#D9776B"],"deep":["#8A5A3B","#6E4329","#B85F55"]};
const HAIRS: Record<string, [string, string]> = {"black":["#1F1B18","#3D3632"],"brown":["#5A3B26","#7E5638"],"blond":["#D2A65A","#EBC982"],"red":["#B5482B","#D7694A"],"pink":["#E58FB0","#F4B7CD"],"blue":["#3E64B3","#6A8ED6"],"silver":["#B9BEC8","#E1E4EA"]};
const TUNICS: Record<string, [string, string]> = {"white":["#EFE9DC","#CFC6B4"],"sky":["#A9C3DD","#7E9DBE"],"olive":["#B7C59A","#8E9E6E"]};
const CAPES: Record<string, [string, string]> = {"red":["#C2412D","#932E1F"],"blue":["#2F5DA8","#21457F"],"star":["#34446B","#232F4C"]};
const FIXED: Record<string, string> = {"1":"#FFE58A","2":"#C9B6F4","3":"#A9D3F7","4":"#FFD3E1","5":"#A8321F","7":"#A3301F","8":"#EAF4FB","9":"#E58FB0","k":"#22201C","e":"#1E1A16","M":"#A0524A","W":"#FFFFFF","b":"#7A5230","l":"#8A5A33","g":"#D7A94B","G":"#9A7330","r":"#E0452B","L":"#4E8A3E","y":"#F5C542","a":"#B9C1CA","A":"#7D8792","o":"#9A7330","Y":"#E9C46A","p":"#F4A7B9","R":"#D64563","n":"#2B2D42","d":"#5B7DB1","u":"#8E7CC3","U":"#65579E","v":"#34446B","B":"#6B4226","m":"#D9A066","q":"#DDE3EC","x":"#3E9B6E","X":"#2B7552","J":"#463A78","D":"#A8321F","i":"#F8E6AE","j":"#86BE5C","z":"#3D5E96","Z":"#8EB0E0","E":"#A3304E","I":"#B9A9EA","N":"#4B4E68","O":"#F2805F","F":"#C97F97"};

/** Every layer table, for checking that each row is exactly 24 pixels. */
export const ALL_LAYERS = { HAIR, EYES, TUNIC, HELMET, FACE, SHOES, HAND, SHIELD, CAPE };

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
  const apply = (l: string[] | undefined) =>
    l?.forEach((row, y) =>
      row.split('').forEach((ch, x) => {
        if (ch !== '.') grid[y][x] = ch;
      }),
    );
  // Back to front: top, back (cape, wings, bag), hair, eyes, shoes, hat, face, arm, then the hand.
  apply(layer(TUNIC, look.tunic));
  apply(layer(CAPE, look.cape));
  if (!hidesHair(look)) apply(layer(HAIR, look.hairStyle));
  apply(layer(EYES, look.eyes));
  apply(layer(SHOES, look.shoes));
  apply(layer(HELMET, look.helmet));
  apply(layer(FACE, look.face));
  apply(layer(SHIELD, look.shield));
  apply(layer(HAND, look.hand));

  const sk = pick(SKINS, look.skin, 'light');
  const hr = pick(HAIRS, look.hair, 'brown');
  const tu = pick(TUNICS, look.tunic, 'white');
  const cp = pick(CAPES, look.cape, 'red');
  const pal: Record<string, string> = { ...FIXED, s: sk[0], S: sk[1], P: sk[2], h: hr[0], H: hr[1], w: tu[0], t: tu[1], c: cp[0], C: cp[1] };

  const runs: PixelRun[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < GRID) {
      const color = pal[row[x]];
      if (!color) {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < GRID && pal[row[x + w]] === color) w++;
      runs.push({ x, y, w, color });
      x += w;
    }
  });
  return runs;
}

/** Base and shadow skin colours, for drawing face expressions on top of the avatar. */
export function skinTones(look: AvatarLook): [string, string] {
  const sk = pick(SKINS, look.skin, 'light');
  return [sk[0], sk[1]];
}

/** A hair colour swatch for the picker. */
export function hairColor(id: string): string {
  return pick(HAIRS, id, 'brown')[0];
}

/** A skin colour swatch for the picker. */
export function skinColor(id: string): string {
  return pick(SKINS, id, 'light')[0];
}

export function normalizeLook(raw: Partial<AvatarLook> | undefined): AvatarLook {
  return { ...DEFAULT_LOOK, ...(raw ?? {}) };
}
