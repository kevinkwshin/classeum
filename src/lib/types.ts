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

export interface ItemDef {
  id: string;
  name: string;
  slot: AvatarSlot;
  value: string;
}

export type AvatarSlot = 'helmet' | 'cape' | 'shield' | 'armor' | 'tunic' | 'effect';

export interface AvatarLook {
  skin: 'light' | 'medium' | 'tan';
  hair: 'brown' | 'black' | 'blond';
  hairStyle: 'short' | 'long' | 'ponytail';
  tunic: 'white' | 'sky' | 'olive';
  helmet: 'none' | 'galea' | 'laurel';
  armor: 'none' | 'lorica';
  cape: 'none' | 'red' | 'blue';
  shield: 'none' | 'round';
  effect: 'none' | 'sparkle' | 'dust' | 'gold';
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
  unlocked: string[];
  wrong: WrongNote[];
  practice: Question[];
}
