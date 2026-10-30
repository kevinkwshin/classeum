// How a question's right answer and a student's own answer read, for the reveal, 오답 노트 and the teacher's lists.
import type { Question } from '@/lib/types';

/** The right answer as words: a grammar question's filled gaps (a 고치기 deletion reads 삭제), else its first answer. */
export function correctLabelOf(q: Question): string {
  if (q.mode !== 'CUSTOM_TEXT') return q.options[q.answerIndex]?.label ?? '';
  if (q.fill) return q.fill.map((f) => f || '삭제').join(', ');
  return (q.answers ?? [])[0] ?? '';
}

/** What a student answered: the box they were in, what they typed, or that they gave none. */
export function answerLabelOf(q: Question, r: { choice: number; text?: string }): string {
  if (r.choice >= 0) return q.options[r.choice]?.label ?? '';
  if (r.text) return r.text;
  return q.mode === 'CUSTOM_TEXT' ? '(못 썼어요)' : '(못 골랐어요)';
}
