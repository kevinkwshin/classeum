// Shapes of the views the server pushes over SSE (see src/server/hub.ts).
import type { AvatarLook, Phase, PublicQuestion, Question, RevealInfo, RewardSetting, Round, StudentSummary, WrongNote } from '@/lib/types';
import type { AgoraPhase, TopicReveal, TopicSort } from '@/lib/agora';

export type { WrongNote };

export interface SessionPublic {
  id: string;
  eventName: string;
  classId: string;
  className: string;
  phase: Phase;
  round: Round;
  index: number;
  /** The first grammar question after the words is in its intro: the screens show '이제 문법!'. */
  grammarStart: boolean;
  total: number;
  mainCount: number;
  question: PublicQuestion | null;
  phaseEndsAt: number | null;
  paused: boolean;
  pausedRemaining: number | null;
  checkpoint: { kind: 'block' | 'retry'; accuracy: number; done: number; total: number } | null;
  summary: { accuracy: number; rewarded: number; judged: number } | null;
  reward: (RewardSetting & { itemName: string }) | null;
}

export interface DisplayView {
  role: 'display';
  serverNow: number;
  joinUrl: string;
  qr: string;
  session: SessionPublic | null;
  blank?: boolean;
  nameLabels?: boolean;
  sound?: boolean;
  music?: boolean;
  /** The 놀이 방법 demo is playing in the lobby; howtoAt is when it began (server clock). */
  howto?: boolean;
  howtoAt?: number | null;
  lobby?: { avatars: { studentId: string; number: number; name: string; look: AvatarLook }[]; connected: number; joined: number } | null;
  settled?: number;
  participants?: number;
  reveal?: RevealInfo | null;
  parade?: { studentId: string; look: AvatarLook; rewarded: boolean }[] | null;
  /** The open 아고라 (never while an arena session is open). */
  agora?: DisplayAgora | null;
}

/** A student's card in the 아고라. The server sends `text` only when the answer shows. */
export interface AgoraCard {
  number: number;
  name: string;
  look: AvatarLook;
  sent: boolean;
  text?: string;
}

/** The projector's 아고라: in the 대기실 the topic and who has come in (`joined`), from [쓰기 시작] the cards. */
export interface DisplayAgora {
  phase: AgoraPhase;
  className: string;
  topic: { id: string; text: string; note: string; minutes: number | null; columns: number; sort: TopicSort };
  reveal: TopicReveal;
  joined: { number: number; name: string; look: AvatarLook }[];
  cards: AgoraCard[];
  /** The page the teacher turned to; the projector splits the cards into pages itself and tells the server how many. */
  page: number;
  /** The song plays (the teacher's switch). */
  music: boolean;
  timer: AgoraTimer;
}

/** A phone's 아고라: the topic, its own answer whether it shows or not, and the class's cards once writing starts. */
export interface StudentAgora {
  phase: AgoraPhase;
  topic: { id: string; text: string; note: string };
  /** Whether the teacher has shown every answer ([전체 공개]); the cards carry the text either way. */
  reveal: TopicReveal;
  mine: { text: string } | null;
  cards: AgoraCard[];
  timer: AgoraTimer;
}

export interface TeacherStudent {
  id: string;
  classId: string;
  number: number;
  name: string;
  hasDevice: boolean;
  lastSeen: number | null;
  connected: boolean;
  joined: boolean;
  stamps: number;
  look: AvatarLook | null;
}

export interface TeacherEvent {
  id: string;
  name: string;
  createdAt: number;
  count: number;
  warnings: string[];
  reward: RewardSetting;
  estimateSec: number;
  /** The usual seconds per question (most questions have it). */
  seconds: number;
  retryRound: boolean;
  /** The Excel file it was made from; null for events made before this was kept. */
  fileName: string | null;
  /** Typed in the teacher screen ([직접 작성하기]) instead of uploaded. */
  typed: boolean;
  /** Classes that have played it: latest run's day and accuracy, number of runs, and whether it was cut short. */
  classRuns: { classId: string; last: number; runs: number; accuracy: number; partial: boolean }[];
  played: number;
}

export interface TeacherLive extends SessionPublic {
  blank: boolean;
  nameLabels: boolean;
  sound: boolean;
  music: boolean;
  howto: boolean;
  autoAdvance: boolean;
  joined: number;
  connected: number;
  current: Question | null;
  counts: number[] | null;
  settled: number;
  participants: number;
  unsettled: { number: number; name: string }[];
  reveal: RevealInfo | null;
  accuracySoFar: number | null;
  mainDone: number;
  mainPlanned: number;
  remainingSec: number;
  /** At the end: each scored question with the class's share of right answers, the lowest first. */
  hardest: { id: string; kind: string; text: string; answer: string; accuracy: number; total: number; topWrong: string | null; missed: { number: number; name: string; mine: string }[] }[] | null;
  /** The type being asked now (단어, 문법 고르기, …), how many of it are left, and what comes next ('다시 도전', or null: the results). */
  section: { key: string; label: string; left: number; next: string | null } | null;
  /** In the lobby, 오늘 낼 문제: each type with its row count and whether it is in, the time, and the 10-question rest. */
  plan: { sections: { key: string; label: string; count: number; on: boolean }[]; estimateSec: number; breaks: boolean } | null;
}

export interface TeacherView {
  role: 'teacher';
  serverNow: number;
  joinUrl: string;
  qr: string;
  classes: { id: string; name: string; students: number; devices: number }[];
  students: TeacherStudent[];
  /** kind: match = on the roster · replace = new phone for a registered student · new = not on the roster yet · conflict = that number belongs to someone else. */
  /** bound: the seat's student has a phone · records: they already have a character, items, attendance or notes. */
  requests: { id: string; className: string; number: number; name: string; kind: 'match' | 'replace' | 'new' | 'conflict'; note: string; bound: boolean; records: boolean; holder: string; /** [모두 승인] takes it; otherwise the teacher checks it alone. */ auto: boolean; symbol: string; createdAt: number }[];
  events: TeacherEvent[];
  live: TeacherLive | null;
  /** A projector screen is open. */
  displayOn: boolean;
  /** Phones connected right now, registered or not. */
  phones: number;
  /** The 아고라 topics in the teacher's order, and the open session if any. */
  agora: { topics: TeacherTopic[]; live: TeacherAgoraLive | null };
}

/** The open 아고라's 입력 시간, on the server's clock; null with no limit, before [쓰기 시작] or once closed. */
export type AgoraTimer = { startedAt: number; endsAt: number } | null;

/** The open 아고라 on the teacher screen: its topic and class, phase, [공개], projector page, song, 입력 시간, and who has come in. */
export interface TeacherAgoraLive {
  topicId: string;
  classId: string;
  className: string;
  phase: AgoraPhase;
  reveal: TopicReveal;
  page: number;
  pages: number;
  music: boolean;
  timer: AgoraTimer;
  joined: string[];
}

/**
 * An 아고라 topic on the teacher screen: the classes that did it ([쓰기 시작], latest time) and every answer whether
 * shown or not, from every class (studentId is one of `students`).
 */
export interface TeacherTopic {
  id: string;
  text: string;
  note: string;
  columns: number;
  sort: TopicSort;
  /** 입력 시간 in minutes; null for no limit. */
  minutes: number | null;
  createdAt: number;
  runs: { classId: string; at: number }[];
  answers: { studentId: string; text: string; shown: boolean | null; createdAt: number; updatedAt: number }[];
}


export interface StudentView {
  role: 'student';
  serverNow: number;
  me: { id: string; className: string; number: number; name: string; look: AvatarLook | null; inventory: string[]; stamps: number } | null;
  request?: { status: 'pending' | 'approved' | 'rejected' | 'expired'; reason?: 'timeout' | 'taken' | 'class' | 'cancelled' | 'gone'; symbol: string; className: string; number: number; name: string } | null;
  /** Set when the server turned this phone away for now; it tries again on its own. */
  refused?: string;
  /** Classes a first-time phone can register in; only today's class while a lobby or quiz is on. */
  classes?: { id: string; name: string }[];
  registrationOpen?: boolean;
  /** Set when another class is having its quiz right now. */
  elsewhere?: string | null;
  session?: SessionPublic | null;
  joined?: boolean;
  myPoint?: { x: number; y: number } | null;
  myText?: string | null;
  myTextFinal?: boolean;
  result?: {
    choice: number;
    correct: boolean;
    correctLabel: string;
    /** A grammar question's gaps filled with the right answers. */
    fill?: string[];
    mineLabel: string | null;
    feedback?: string;
    explanation?: string;
    counted: boolean;
    /** Right answers in a row including this one (0 if wrong); `broke` is the run a wrong answer just ended. */
    streak: number;
    broke: number;
    /** Others who got it right: how many, and up to 9 of their characters (none on text questions). */
    friends: { total: number; looks: AvatarLook[] };
  } | null;
  mySummary?: StudentSummary | null;
  /** The latest finished session's notes, shown from the home screen between classes. */
  lastNotes?: { eventName: string; at: number; wrong: WrongNote[]; practice: StudentSummary['practice'] } | null;
  /** The 아고라 topic my class has on screen, if any. */
  agora?: StudentAgora | null;
}
