// Shared types used by the server engine and the three client surfaces.

export type Pos = '명' | '동' | '형' | '부' | '대' | '전' | '접' | '감' | '구';
export type WordStatus = '사용' | '검토' | '보관';

export interface Confusable {
  word: string;
  meaning?: string;
}

export interface Word {
  /** Stable key that links the same word across weekly uploads. */
  key: string;
  spelling: string;
  altSpellings: string[];
  meaning: string;
  pos?: Pos;
  confusables: Confusable[];
  example?: string;
  exampleMeaning?: string;
  seconds?: number;
  set?: string;
  unit?: string;
  status: WordStatus;
}

export type QuestionMode = 'MEAN' | 'WORD' | 'CLOZE' | 'CUSTOM_MC' | 'CUSTOM_OX' | 'CUSTOM_TEXT';

export interface CustomQuestion {
  id: string;
  kind: '객관식' | 'OX' | '단답형';
  prompt: string;
  options: string[];
  /** Index into options for 객관식/OX, ignored for 단답형. */
  answerIndex: number;
  answers: string[];
  explanation?: string;
  feedback: string[];
  seconds?: number;
  set?: string;
  status: WordStatus;
}

export interface Option {
  label: string;
  /** Word key the option came from, used for automatic feedback. */
  sourceKey?: string;
  feedback?: string;
}

export interface Question {
  /** Stable id, e.g. "borrow:MEAN" or "custom:Q001". */
  id: string;
  wordKey?: string;
  mode: QuestionMode;
  prompt: string;
  /** Small label above the prompt, e.g. "뜻 고르기". */
  modeLabel: string;
  options: Option[];
  answerIndex: number;
  /** Accepted answers for text questions. */
  answers?: string[];
  seconds: number;
  explanation?: string;
  exampleMeaning?: string;
}

export type ItemTheme = 'rome' | 'school' | 'idol' | 'fantasy' | 'modern' | 'cute' | 'future' | 'medieval' | 'trend';

export interface ItemDef {
  id: string;
  name: string;
  slot: AvatarSlot;
  value: string;
  theme: ItemTheme;
}

/** Item slots, shown as 머리·얼굴·몸·발·손·팔·등·효과 (see SLOTS in src/lib/items.ts). */
export type AvatarSlot = 'helmet' | 'face' | 'tunic' | 'shoes' | 'hand' | 'shield' | 'cape' | 'effect';

export interface AvatarLook {
  // Skin, hair and eyes are free to choose (the lists and names are in src/lib/avatar.ts); the rest are items.
  skin: 'light' | 'medium' | 'tan' | 'deep';
  hair: 'brown' | 'black' | 'blond' | 'red' | 'pink' | 'blue' | 'silver';
  hairStyle: 'short' | 'long' | 'bob' | 'ponytail' | 'pigtails' | 'braid' | 'side' | 'curly' | 'spiky' | 'bun' | 'twinbun' | 'buzz';
  eyes: 'round' | 'big' | 'smile' | 'sharp' | 'dot';
  /** What the body wears, armour included (it used to be a separate slot on top). */
  tunic: 'white' | 'sky' | 'olive' | 'stripe' | 'hoodie' | 'vest' | 'sequin' | 'suit' | 'robe' | 'tracksuit' | 'lorica' | 'gold' | 'spacesuit' | 'chainmail' | 'monk' | 'tee67';
  helmet: 'none' | 'galea' | 'laurel' | 'straw' | 'crown' | 'cat' | 'ribbon' | 'grad' | 'wizard' | 'headset' | 'cap' | 'headphones' | 'space' | 'knight' | 'hennin' | 'capybara' | 'hardhat';
  face: 'none' | 'glasses' | 'sunglasses' | 'heartglasses' | 'visor' | 'pixelshades';
  /** Worn on the back: capes, wings or a bag. */
  cape: 'none' | 'red' | 'blue' | 'star' | 'dragon' | 'fairy' | 'backpack' | 'jetpack' | 'knightcape';
  shield: 'none' | 'round' | 'book' | 'star' | 'energy' | 'lion';
  shoes: 'none' | 'sandal' | 'boots' | 'sneakers' | 'winged' | 'skates' | 'hover';
  hand: 'none' | 'sword' | 'spear' | 'wand' | 'pencil' | 'flag' | 'mic' | 'lightstick' | 'phone' | 'staff' | 'icecream' | 'saber' | 'pilgrim' | 'lute' | 'cookie' | 'tanghulu' | 'bubbletea' | 'gamepad';
  effect: 'none' | 'sparkle' | 'dust' | 'gold' | 'hearts' | 'notes' | 'electric' | 'fire' | 'neon' | 'aura';
}

export interface RewardSetting {
  itemId: string;
  challengePct: number;
  growthPp: number;
}

export type Phase = 'lobby' | 'intro' | 'moving' | 'reveal' | 'checkpoint' | 'summary';
export type Round = 'main' | 'retry';

/** A position on the playground, both axes in 0..1. */
export interface FieldPoint {
  x: number;
  y: number;
}

export interface PublicQuestion {
  seq: number;
  mode: QuestionMode;
  modeLabel: string;
  prompt: string;
  options: string[];
  kind: 'field' | 'text';
  seconds: number;
}

export interface AvatarOnField {
  studentId: string;
  number: number;
  name: string;
  look: AvatarLook;
  point: FieldPoint;
}

export interface RevealInfo {
  correctIndex: number;
  correctLabel: string;
  zoneCounts: number[];
  unanswered: number;
  accuracy: number;
  topWrong?: { label: string; feedback?: string };
  explanation?: string;
  avatars: AvatarOnField[];
  textWrong?: string[];
  long: boolean;
}

export interface RosterEntry {
  id: string;
  number: number;
  name: string;
}

export interface WrongNote {
  questionId: string;
  wordKey?: string;
  spelling?: string;
  meaning?: string;
  prompt: string;
  correctLabel: string;
  mineLabel: string;
  feedback?: string;
  example?: string;
  exampleMeaning?: string;
}

/** What a student sees at the end of a session; also kept as their latest notes after the arena closes. */
export interface StudentSummary {
  mainCorrect: number;
  mainTotal: number;
  judged: boolean;
  reward: { itemId: string; reason: 'challenge' | 'growth'; alreadyOwned: boolean } | null;
  stampAdded: boolean;
  /** The teacher ended the quiz before half the words; answers count, rewards weren't judged. */
  shortQuiz?: boolean;
  /** Longest run of right answers this session (only this student sees it). */
  bestStreak?: number;
  unlocked: string[];
  wrong: WrongNote[];
  practice: Question[];
}
