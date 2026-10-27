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

/** The four 문법 tabs, named for what the students do. */
export type GrammarTab = '고르기' | '쓰기' | '고치기' | '배열';

/** A piece of a grammar sentence: plain text, the gap a choice or a blank fills, or a part underlined for 고치기. */
export type GrammarPart = { text: string } | { gap: number } | { mark: number; text: string };

/** How a grammar question is shown. Every screen gets it before the reveal, so it never holds the answer. */
export interface GrammarShow {
  tab: GrammarTab;
  /** 고치기 plays twice: find the wrong part on the field, then type the fix. */
  step?: 'find' | 'fix';
  /** 지시문, small above the sentence. */
  lead: string;
  /** 우리말, or the facts the sentence is checked against. */
  ko?: string;
  parts: GrammarPart[];
  /** Whole-sentence options (보기1~4), listed with ①②; `short` is what differs between them, for the zones. */
  sentences?: string[];
  short?: string[];
  /** Boxes to type into, one per [ ] in a 쓰기 sentence. */
  blanks?: number;
  /** 배열 chunks, shuffled. */
  chips?: string[];
  /** An accepted answer is in Hangul, so the phone doesn't warn about the Korean keyboard. */
  hangulOk?: boolean;
}

export interface Option {
  label: string;
  /** Word key the option came from, used for automatic feedback. */
  sourceKey?: string;
  feedback?: string;
}

export interface Question {
  /** Stable id, e.g. "borrow:MEAN", "custom:Q001" or "g:k3x9a:find". */
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
  /** A question from the 문법 tabs: scored like a word question, and shown from this. */
  grammar?: GrammarShow;
  /** What goes in the gaps at the reveal (the right answers in place); kept off the screens until then. */
  fill?: string[];
  /** Each blank's accepted answers, for grading a 쓰기 question with [ ] blanks. */
  gaps?: string[][];
  /** The answer as the 오답 노트 shows it when the reveal's would mislead: a 고치기 find step's 'fastly → fast'. */
  noteLabel?: string;
  /** The answer stays where the teacher put it: whole-sentence options (a 해설 may say ②번) and 고치기 parts. */
  fixedOrder?: boolean;
  /** The row as typed on its 문법 tab, on the row's first question, so [엑셀로 받기] writes it back unchanged. */
  source?: { tab: GrammarTab; cells: Record<string, string> };
}

/** One row of a 문법 tab, checked and turned into its questions at upload (two for 고치기). */
export interface GrammarItem {
  id: string;
  tab: GrammarTab;
  /** 번호 as typed, for the upload preview. */
  label?: string;
  questions: Question[];
  set?: string;
  status: WordStatus;
}

export type ItemTheme = 'rome' | 'school' | 'sports' | 'idol' | 'fantasy' | 'modern' | 'cute' | 'future' | 'medieval' | 'trend';

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
  /** What the body wears, armour included. */
  tunic: 'white' | 'sky' | 'olive' | 'stripe' | 'hoodie' | 'vest' | 'sequin' | 'suit' | 'robe' | 'tracksuit' | 'lorica' | 'gold' | 'spacesuit' | 'chainmail' | 'monk' | 'tee67' | 'bball' | 'soccer' | 'baseball' | 'longpad' | 'dino';
  helmet: 'none' | 'galea' | 'laurel' | 'straw' | 'crown' | 'cat' | 'ribbon' | 'grad' | 'wizard' | 'headset' | 'cap' | 'headphones' | 'space' | 'knight' | 'hennin' | 'capybara' | 'hardhat' | 'sweatband' | 'beanie' | 'bearears' | 'bucket';
  face: 'none' | 'glasses' | 'sunglasses' | 'heartglasses' | 'visor' | 'pixelshades' | 'facepaint' | 'goggles' | 'roundglasses' | 'bandaid' | 'whiskers';
  /** Worn on the back: capes, wings or a bag. */
  cape: 'none' | 'red' | 'blue' | 'star' | 'dragon' | 'fairy' | 'backpack' | 'jetpack' | 'knightcape' | 'bearpack' | 'turtle' | 'guitar';
  shield: 'none' | 'round' | 'book' | 'star' | 'energy' | 'lion' | 'glove' | 'skateboard' | 'teddy' | 'watch';
  shoes: 'none' | 'sandal' | 'boots' | 'sneakers' | 'winged' | 'skates' | 'hover' | 'hightop' | 'cleats' | 'slippers' | 'chunky' | 'bunny';
  hand: 'none' | 'sword' | 'spear' | 'wand' | 'pencil' | 'flag' | 'mic' | 'lightstick' | 'phone' | 'staff' | 'icecream' | 'saber' | 'pilgrim' | 'lute' | 'cookie' | 'tanghulu' | 'bubbletea' | 'gamepad' | 'basketball' | 'soccerball' | 'bat' | 'racket' | 'tteok';
  effect: 'none' | 'sparkle' | 'dust' | 'gold' | 'hearts' | 'notes' | 'electric' | 'fire' | 'neon' | 'aura' | 'sweat' | 'bubbles' | 'petals' | 'snow';
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
  grammar?: GrammarShow;
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
  /** A grammar question's gaps filled with the right answers. */
  fill?: string[];
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
  /** A grammar question's 우리말 (or facts) and its rule. */
  ko?: string;
  rule?: string;
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
