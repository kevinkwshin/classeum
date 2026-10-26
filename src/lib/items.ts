import { DEFAULT_LOOK } from './avatar';
import type { AvatarLook, AvatarSlot, ItemDef, ItemTheme } from './types';

export const THEMES: { id: ItemTheme; name: string }[] = [
  { id: 'rome', name: '고대 로마' },
  { id: 'school', name: '학교' },
  { id: 'sports', name: '스포츠' },
  { id: 'idol', name: '아이돌' },
  { id: 'fantasy', name: '판타지' },
  { id: 'modern', name: '현대' },
  { id: 'cute', name: '귀여움' },
  { id: 'future', name: '미래' },
  { id: 'medieval', name: '중세' },
  { id: 'trend', name: '밈' },
];

// Named by where on the body it goes: hats, ears and headphones are all 머리; shields and the book are 팔.
export const SLOTS: { id: AvatarSlot; name: string }[] = [
  { id: 'helmet', name: '머리' },
  { id: 'face', name: '얼굴' },
  { id: 'tunic', name: '몸' },
  { id: 'shoes', name: '발' },
  { id: 'hand', name: '손' },
  { id: 'shield', name: '팔' },
  { id: 'cape', name: '등' },
  { id: 'effect', name: '효과' },
];

// The first eleven ids predate themes; they stay as they are so inventories keep working.
export const ITEMS: ItemDef[] = [
  { id: 'galea', name: '청동 투구', slot: 'helmet', value: 'galea', theme: 'rome' },
  { id: 'laurel', name: '월계관', slot: 'helmet', value: 'laurel', theme: 'rome' },
  { id: 'cape-red', name: '붉은 망토', slot: 'cape', value: 'red', theme: 'rome' },
  { id: 'cape-blue', name: '푸른 망토', slot: 'cape', value: 'blue', theme: 'rome' },
  { id: 'shield', name: '둥근 방패', slot: 'shield', value: 'round', theme: 'rome' },
  { id: 'lorica', name: '강철 갑옷', slot: 'tunic', value: 'lorica', theme: 'rome' },
  { id: 'tunic-sky', name: '하늘 튜닉', slot: 'tunic', value: 'sky', theme: 'cute' },
  { id: 'tunic-olive', name: '올리브 튜닉', slot: 'tunic', value: 'olive', theme: 'cute' },
  { id: 'fx-sparkle', name: '반짝임', slot: 'effect', value: 'sparkle', theme: 'idol' },
  { id: 'fx-dust', name: '착지 먼지', slot: 'effect', value: 'dust', theme: 'cute' },
  { id: 'fx-gold', name: '황금 테두리', slot: 'effect', value: 'gold', theme: 'rome' },

  { id: 'armor-gold', name: '금빛 갑옷', slot: 'tunic', value: 'gold', theme: 'rome' },
  { id: 'shoes-sandal', name: '샌들', slot: 'shoes', value: 'sandal', theme: 'rome' },
  { id: 'hand-sword', name: '목검', slot: 'hand', value: 'sword', theme: 'rome' },
  { id: 'hand-spear', name: '창', slot: 'hand', value: 'spear', theme: 'rome' },

  { id: 'hat-grad', name: '학사모', slot: 'helmet', value: 'grad', theme: 'school' },
  { id: 'face-glasses', name: '안경', slot: 'face', value: 'glasses', theme: 'school' },
  { id: 'top-vest', name: '교복 조끼', slot: 'tunic', value: 'vest', theme: 'school' },
  { id: 'hand-pencil', name: '대형 연필', slot: 'hand', value: 'pencil', theme: 'school' },
  { id: 'shield-book', name: '책 방패', slot: 'shield', value: 'book', theme: 'school' },
  { id: 'shoes-sneakers', name: '운동화', slot: 'shoes', value: 'sneakers', theme: 'school' },
  { id: 'back-backpack', name: '책가방', slot: 'cape', value: 'backpack', theme: 'school' },

  { id: 'hat-ribbon', name: '리본', slot: 'helmet', value: 'ribbon', theme: 'idol' },
  { id: 'hat-headset', name: '헤드셋 마이크', slot: 'helmet', value: 'headset', theme: 'idol' },
  { id: 'face-heart', name: '하트 선글라스', slot: 'face', value: 'heartglasses', theme: 'idol' },
  { id: 'top-sequin', name: '반짝이 무대옷', slot: 'tunic', value: 'sequin', theme: 'idol' },
  { id: 'hand-mic', name: '마이크', slot: 'hand', value: 'mic', theme: 'idol' },
  { id: 'hand-lightstick', name: '응원봉', slot: 'hand', value: 'lightstick', theme: 'idol' },
  { id: 'fx-hearts', name: '하트', slot: 'effect', value: 'hearts', theme: 'idol' },
  { id: 'fx-notes', name: '음표', slot: 'effect', value: 'notes', theme: 'idol' },

  { id: 'hat-crown', name: '왕관', slot: 'helmet', value: 'crown', theme: 'fantasy' },
  { id: 'hat-wizard', name: '마법사 모자', slot: 'helmet', value: 'wizard', theme: 'fantasy' },
  { id: 'top-robe', name: '마법사 로브', slot: 'tunic', value: 'robe', theme: 'fantasy' },
  { id: 'hand-staff', name: '마법 지팡이', slot: 'hand', value: 'staff', theme: 'fantasy' },
  { id: 'hand-wand', name: '마법봉', slot: 'hand', value: 'wand', theme: 'fantasy' },
  { id: 'back-dragon', name: '용 날개', slot: 'cape', value: 'dragon', theme: 'fantasy' },
  { id: 'back-fairy', name: '요정 날개', slot: 'cape', value: 'fairy', theme: 'fantasy' },
  { id: 'cape-star', name: '별무늬 망토', slot: 'cape', value: 'star', theme: 'fantasy' },
  { id: 'shield-star', name: '별 방패', slot: 'shield', value: 'star', theme: 'fantasy' },
  { id: 'shoes-winged', name: '날개 신발', slot: 'shoes', value: 'winged', theme: 'fantasy' },
  { id: 'fx-electric', name: '전기', slot: 'effect', value: 'electric', theme: 'fantasy' },
  { id: 'fx-fire', name: '불꽃', slot: 'effect', value: 'fire', theme: 'fantasy' },

  { id: 'hat-cap', name: '야구모자', slot: 'helmet', value: 'cap', theme: 'modern' },
  { id: 'hat-headphones', name: '헤드폰', slot: 'helmet', value: 'headphones', theme: 'modern' },
  { id: 'face-sunglasses', name: '선글라스', slot: 'face', value: 'sunglasses', theme: 'modern' },
  { id: 'top-suit', name: '정장', slot: 'tunic', value: 'suit', theme: 'modern' },
  { id: 'top-tracksuit', name: '운동복', slot: 'tunic', value: 'tracksuit', theme: 'modern' },
  { id: 'top-hoodie', name: '후드티', slot: 'tunic', value: 'hoodie', theme: 'modern' },
  { id: 'top-stripe', name: '줄무늬 티', slot: 'tunic', value: 'stripe', theme: 'modern' },
  { id: 'hand-phone', name: '스마트폰', slot: 'hand', value: 'phone', theme: 'modern' },
  { id: 'shoes-skates', name: '롤러스케이트', slot: 'shoes', value: 'skates', theme: 'modern' },
  { id: 'shoes-boots', name: '장화', slot: 'shoes', value: 'boots', theme: 'modern' },

  { id: 'hat-cat', name: '고양이 귀', slot: 'helmet', value: 'cat', theme: 'cute' },
  { id: 'hat-straw', name: '밀짚모자', slot: 'helmet', value: 'straw', theme: 'cute' },
  { id: 'hand-flag', name: '깃발', slot: 'hand', value: 'flag', theme: 'cute' },
  { id: 'hand-icecream', name: '아이스크림', slot: 'hand', value: 'icecream', theme: 'cute' },

  { id: 'hat-space', name: '우주 헬멧', slot: 'helmet', value: 'space', theme: 'future' },
  { id: 'face-visor', name: '네온 바이저', slot: 'face', value: 'visor', theme: 'future' },
  { id: 'top-spacesuit', name: '우주복', slot: 'tunic', value: 'spacesuit', theme: 'future' },
  { id: 'hand-saber', name: '광선검', slot: 'hand', value: 'saber', theme: 'future' },
  { id: 'shield-energy', name: '에너지 방패', slot: 'shield', value: 'energy', theme: 'future' },
  { id: 'back-jetpack', name: '제트팩', slot: 'cape', value: 'jetpack', theme: 'future' },
  { id: 'shoes-hover', name: '호버 부츠', slot: 'shoes', value: 'hover', theme: 'future' },
  { id: 'fx-neon', name: '네온 빛', slot: 'effect', value: 'neon', theme: 'future' },

  { id: 'hat-knight', name: '기사 투구', slot: 'helmet', value: 'knight', theme: 'medieval' },
  { id: 'hat-hennin', name: '공주 고깔모자', slot: 'helmet', value: 'hennin', theme: 'medieval' },
  { id: 'top-chainmail', name: '사슬 갑옷', slot: 'tunic', value: 'chainmail', theme: 'medieval' },
  { id: 'top-monk', name: '수도사 로브', slot: 'tunic', value: 'monk', theme: 'medieval' },
  { id: 'hand-pilgrim', name: '순례자 지팡이', slot: 'hand', value: 'pilgrim', theme: 'medieval' },
  { id: 'hand-lute', name: '류트', slot: 'hand', value: 'lute', theme: 'medieval' },
  { id: 'shield-lion', name: '기사 방패', slot: 'shield', value: 'lion', theme: 'medieval' },
  { id: 'back-knightcape', name: '기사 망토', slot: 'cape', value: 'knightcape', theme: 'medieval' },

  { id: 'top-tee67', name: '67 티셔츠', slot: 'tunic', value: 'tee67', theme: 'trend' },
  { id: 'hat-capybara', name: '카피바라 모자', slot: 'helmet', value: 'capybara', theme: 'trend' },
  { id: 'hat-hardhat', name: '안전모', slot: 'helmet', value: 'hardhat', theme: 'trend' },
  { id: 'face-pixelshades', name: '픽셀 선글라스', slot: 'face', value: 'pixelshades', theme: 'trend' },
  { id: 'hand-cookie', name: '두쫀쿠', slot: 'hand', value: 'cookie', theme: 'trend' },
  { id: 'hand-tanghulu', name: '탕후루', slot: 'hand', value: 'tanghulu', theme: 'trend' },
  { id: 'hand-bubbletea', name: '버블티', slot: 'hand', value: 'bubbletea', theme: 'trend' },
  { id: 'hand-gamepad', name: '게임패드', slot: 'hand', value: 'gamepad', theme: 'trend' },
  { id: 'fx-aura', name: '오라', slot: 'effect', value: 'aura', theme: 'trend' },
  { id: 'hat-bucket', name: '버킷햇', slot: 'helmet', value: 'bucket', theme: 'trend' },
  { id: 'face-bandaid', name: '코 반창고', slot: 'face', value: 'bandaid', theme: 'trend' },
  { id: 'top-longpad', name: '롱패딩', slot: 'tunic', value: 'longpad', theme: 'trend' },
  { id: 'shoes-slippers', name: '슬리퍼와 흰 양말', slot: 'shoes', value: 'slippers', theme: 'trend' },
  { id: 'shoes-chunky', name: '청키 운동화', slot: 'shoes', value: 'chunky', theme: 'trend' },
  { id: 'hand-tteok', name: '떡볶이 컵', slot: 'hand', value: 'tteok', theme: 'trend' },
  { id: 'shield-skateboard', name: '스케이트보드', slot: 'shield', value: 'skateboard', theme: 'trend' },

  { id: 'hat-sweatband', name: '스포츠 머리띠', slot: 'helmet', value: 'sweatband', theme: 'sports' },
  { id: 'face-facepaint', name: '응원 페이스페인팅', slot: 'face', value: 'facepaint', theme: 'sports' },
  { id: 'face-goggles', name: '수경', slot: 'face', value: 'goggles', theme: 'sports' },
  { id: 'top-bball', name: '농구 유니폼', slot: 'tunic', value: 'bball', theme: 'sports' },
  { id: 'top-soccer', name: '축구 유니폼', slot: 'tunic', value: 'soccer', theme: 'sports' },
  { id: 'top-baseball', name: '야구 유니폼', slot: 'tunic', value: 'baseball', theme: 'sports' },
  { id: 'shoes-hightop', name: '하이탑 농구화', slot: 'shoes', value: 'hightop', theme: 'sports' },
  { id: 'shoes-cleats', name: '축구화', slot: 'shoes', value: 'cleats', theme: 'sports' },
  { id: 'hand-basketball', name: '농구공', slot: 'hand', value: 'basketball', theme: 'sports' },
  { id: 'hand-soccerball', name: '축구공', slot: 'hand', value: 'soccerball', theme: 'sports' },
  { id: 'hand-bat', name: '야구 배트', slot: 'hand', value: 'bat', theme: 'sports' },
  { id: 'hand-racket', name: '배드민턴 라켓', slot: 'hand', value: 'racket', theme: 'sports' },
  { id: 'shield-glove', name: '야구 글러브', slot: 'shield', value: 'glove', theme: 'sports' },
  { id: 'fx-sweat', name: '땀방울', slot: 'effect', value: 'sweat', theme: 'sports' },

  { id: 'hat-bearears', name: '곰돌이 귀', slot: 'helmet', value: 'bearears', theme: 'cute' },
  { id: 'face-whiskers', name: '고양이 수염', slot: 'face', value: 'whiskers', theme: 'cute' },
  { id: 'top-dino', name: '공룡 잠옷', slot: 'tunic', value: 'dino', theme: 'cute' },
  { id: 'shoes-bunny', name: '토끼 슬리퍼', slot: 'shoes', value: 'bunny', theme: 'cute' },
  { id: 'shield-teddy', name: '곰 인형', slot: 'shield', value: 'teddy', theme: 'cute' },
  { id: 'back-bearpack', name: '곰돌이 백팩', slot: 'cape', value: 'bearpack', theme: 'cute' },
  { id: 'back-turtle', name: '거북이 등껍질', slot: 'cape', value: 'turtle', theme: 'cute' },
  { id: 'fx-bubbles', name: '비눗방울', slot: 'effect', value: 'bubbles', theme: 'cute' },
  { id: 'fx-petals', name: '벚꽃잎', slot: 'effect', value: 'petals', theme: 'cute' },
  { id: 'fx-snow', name: '눈송이', slot: 'effect', value: 'snow', theme: 'cute' },

  { id: 'hat-beanie', name: '비니', slot: 'helmet', value: 'beanie', theme: 'modern' },
  { id: 'shield-watch', name: '스마트워치', slot: 'shield', value: 'watch', theme: 'modern' },
  { id: 'back-guitar', name: '기타', slot: 'cape', value: 'guitar', theme: 'modern' },

  { id: 'face-roundglasses', name: '동그란 안경', slot: 'face', value: 'roundglasses', theme: 'school' },
];

/**
 * One item every 5 attendance footprints, in this order. The 10th, 20th and 30th match what
 * students already got when the reward came every 10 stamps.
 */
export const ATTENDANCE_UNLOCKS = [
  'shoes-sandal',
  'tunic-sky',
  'hat-ribbon',
  'fx-dust',
  'shoes-sneakers',
  'tunic-olive',
  'hat-cat',
  'face-glasses',
  'fx-notes',
  'hand-flag',
  'back-backpack',
  'hat-cap',
];
export const STAMPS_PER_UNLOCK = 5;

/** Items a quiz reward rotates through by default (attendance items are earned by coming). */
export const QUIZ_REWARD_ITEMS = ITEMS.filter((i) => !ATTENDANCE_UNLOCKS.includes(i.id));

export function itemById(id: string): ItemDef | undefined {
  return ITEMS.find((i) => i.id === id);
}

/** The attendance count that unlocks an item, if it's an attendance item. */
export function attendanceStamps(itemId: string): number | null {
  const i = ATTENDANCE_UNLOCKS.indexOf(itemId);
  return i < 0 ? null : (i + 1) * STAMPS_PER_UNLOCK;
}

/** A plain look wearing just this item (keeping skin, hair and top), for previews. */
export function previewLook(item: ItemDef, base: AvatarLook): AvatarLook {
  return {
    ...base,
    helmet: DEFAULT_LOOK.helmet,
    face: DEFAULT_LOOK.face,
    cape: DEFAULT_LOOK.cape,
    shield: DEFAULT_LOOK.shield,
    shoes: DEFAULT_LOOK.shoes,
    hand: DEFAULT_LOOK.hand,
    effect: DEFAULT_LOOK.effect,
    [item.slot]: item.value,
  } as AvatarLook;
}
