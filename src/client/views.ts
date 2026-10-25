// Shapes of the views the server pushes over SSE (see src/server/hub.ts).
import type { AvatarLook, ItemDef, Phase, PublicQuestion, Question, RevealInfo, RewardSetting, Round, StudentSummary, WrongNote } from '@/lib/types';

export type { WrongNote };

export interface SessionPublic {
  id: string;
  eventName: string;
  classId: string;
  className: string;
  phase: Phase;
  round: Round;
  index: number;
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
  lobby?: { avatars: { studentId: string; number: number; name: string; look: AvatarLook }[]; connected: number; joined: number } | null;
  settled?: number;
  participants?: number;
  reveal?: RevealInfo | null;
  parade?: { studentId: string; look: AvatarLook; rewarded: boolean }[] | null;
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
  played: number;
}

export interface TeacherLive extends SessionPublic {
  blank: boolean;
  nameLabels: boolean;
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
  remainingSec: number;
}

export interface TeacherView {
  role: 'teacher';
  serverNow: number;
  joinUrl: string;
  qr: string;
  classes: { id: string; name: string; students: number; devices: number }[];
  students: TeacherStudent[];
  requests: { id: string; studentId: string; className: string; number?: number; name?: string; symbol: string; replace: boolean; createdAt: number }[];
  events: TeacherEvent[];
  live: TeacherLive | null;
  items: ItemDef[];
}


export interface StudentView {
  role: 'student';
  serverNow: number;
  me: { id: string; className: string; number: number; name: string; look: AvatarLook | null; inventory: string[]; stamps: number } | null;
  request?: { status: 'pending' | 'approved' | 'rejected' | 'expired'; symbol: string; className: string; number: number | null; name: string } | null;
  /** Set when the server turned this phone away for now; it tries again on its own. */
  refused?: string;
  /** Names come masked (김*윤) and only while the teacher or projector screen is open. */
  roster?: { id: string; classId: string; number: number; name: string }[];
  /** Classes to pick from before the name list; only today's class while a lobby or quiz is on. */
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
    mineLabel: string | null;
    feedback?: string;
    explanation?: string;
    counted: boolean;
  } | null;
  mySummary?: StudentSummary | null;
  /** The latest finished session's notes, shown from the home screen between classes. */
  lastNotes?: { eventName: string; at: number; wrong: WrongNote[]; practice: StudentSummary['practice'] } | null;
}
