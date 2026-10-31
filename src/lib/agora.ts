// Limits and choices shared by the 아고라 server (src/server/agora.ts) and its screens.

/** Longest 주제, the question the class answers. */
export const TOPIC_MAX = 200;
/** Longest 보조 설명 under the question. */
export const NOTE_MAX = 300;
/** Longest answer a student can send. */
export const ANSWER_MAX = 300;
/** How many columns of answer cards the projector can show. */
export const COLUMN_CHOICES = [1, 2, 3, 4] as const;

/** Cards in number order, or in the order students first answered (those who haven't follow, by number). */
export type TopicSort = 'number' | 'time';
export type TopicStatus = 'draft' | 'open' | 'closed';
export type TopicReveal = 'hidden' | 'public';
