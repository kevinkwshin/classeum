// 오늘의 보상 뽑기: an event or 아고라 whose reward is 무작위 (RANDOM_REWARD) draws its item for each lesson as its
// 대기실 opens (the projector plays the draw), and again at [다시 뽑기]. A set item is the lesson's prize from the moment
// its 대기실 opens.
import { PRIZE_SHOW_MS, QUIZ_REWARD_ITEMS, RANDOM_REWARD } from '@/lib/items';
import { db } from './store';

/**
 * A lesson's reward: the item (null until drawn), how many times the teacher has drawn (the screens' click says which
 * draw it saw, so a late or second one draws nothing new), and when the projector's draw shows the item (server clock;
 * 0 for a set item or one drawn quietly at the start).
 */
export interface Prize {
  itemId: string | null;
  seq: number;
  revealAt: number;
}

/** The prize a lesson opens with: its record's item, or none yet for 무작위. */
export function prizeFor(rewardItemId: string): Prize {
  return { itemId: rewardItemId === RANDOM_REWARD ? null : rewardItemId, seq: 0, revealAt: 0 };
}

/** The draw as the 대기실 opens, or [다시 뽑기]: a new item for the class, shown when the projector's draw ends. */
export function drawn(prize: Prize, classId: string, now: number): Prize {
  return { itemId: drawItem(classId, prize.itemId), seq: prize.seq + 1, revealAt: now + PRIZE_SHOW_MS };
}

/** Leaving the 대기실 fixes the prize (one somehow never drawn is drawn now, without the show). */
export function settled(prize: Prize, classId: string): Prize {
  return prize.itemId === null ? { ...prize, itemId: drawItem(classId, null) } : prize;
}

/**
 * A draw for a class: at random among the items the fewest of its students own, so most of them can get something
 * new; never the item just drawn while another is possible, so [다시 뽑기] always changes it.
 */
export function drawItem(classId: string, previous: string | null): string {
  const owners = new Map<string, number>(QUIZ_REWARD_ITEMS.map((i) => [i.id, 0]));
  for (const s of Object.values(db().students)) {
    if (s.classId !== classId) continue;
    for (const id of s.inventory) {
      const n = owners.get(id);
      if (n !== undefined) owners.set(id, n + 1);
    }
  }
  const candidates = [...owners].filter(([id]) => id !== previous);
  const fewest = Math.min(...candidates.map(([, n]) => n));
  const pool = candidates.filter(([, n]) => n === fewest).map(([id]) => id);
  return pool[Math.floor(Math.random() * pool.length)];
}
