// Limits and choices shared by the 아고라 server (src/server/agora.ts) and its screens.

/** Longest 주제, the question the class answers. */
export const TOPIC_MAX = 200;
/** Longest 보조 설명 under the question. */
export const NOTE_MAX = 300;
/** Longest answer a student can send. */
export const ANSWER_MAX = 300;
/** How many columns of answer cards the projector can show. */
export const COLUMN_CHOICES = [1, 2, 3, 4] as const;
/** 입력 시간 choices in minutes (a topic may also have no limit), and the one a new topic starts with. */
export const MINUTE_CHOICES = [3, 5, 10, 15, 20] as const;
export const DEFAULT_MINUTES = 10;

/** Cards in number order, or in the order students first answered (those who haven't follow, by number). */
export type TopicSort = 'number' | 'time';
export type TopicReveal = 'hidden' | 'public';
/** An open 아고라: its 대기실, writing after [쓰기 시작], and 마감 (by the teacher or the 입력 시간) until it is closed. */
export type AgoraPhase = 'lobby' | 'writing' | 'closed';
