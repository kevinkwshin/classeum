import type { AvatarLook, ItemDef } from './types';

export const ITEMS: ItemDef[] = [
  { id: 'galea', name: '청동 투구', slot: 'helmet', value: 'galea' },
  { id: 'laurel', name: '월계관', slot: 'helmet', value: 'laurel' },
  { id: 'cape-red', name: '붉은 망토', slot: 'cape', value: 'red' },
  { id: 'cape-blue', name: '푸른 망토', slot: 'cape', value: 'blue' },
  { id: 'shield', name: '둥근 방패', slot: 'shield', value: 'round' },
  { id: 'lorica', name: '강철 갑옷', slot: 'armor', value: 'lorica' },
  { id: 'tunic-sky', name: '하늘 튜닉', slot: 'tunic', value: 'sky' },
  { id: 'tunic-olive', name: '올리브 튜닉', slot: 'tunic', value: 'olive' },
  { id: 'fx-sparkle', name: '반짝임', slot: 'effect', value: 'sparkle' },
  { id: 'fx-dust', name: '착지 먼지', slot: 'effect', value: 'dust' },
  { id: 'fx-gold', name: '황금 테두리', slot: 'effect', value: 'gold' },
];

/** Unlocked by cumulative attendance footprints, every 10 stamps. */
export const ATTENDANCE_UNLOCKS = ['tunic-sky', 'fx-dust', 'tunic-olive'];

export function itemById(id: string): ItemDef | undefined {
  return ITEMS.find((i) => i.id === id);
}

/** A bare look wearing just this item, for previews. */
export function previewLook(item: ItemDef, base: AvatarLook): AvatarLook {
  return {
    ...base,
    helmet: 'none',
    cape: 'none',
    shield: 'none',
    armor: 'none',
    effect: 'none',
    [item.slot]: item.value,
  } as AvatarLook;
}
