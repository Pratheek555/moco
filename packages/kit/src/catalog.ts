// Pure data about the kit — no React — so the engine (Node) can put it in AI
// prompts and validate specs, and the app can list it without loading art.

export interface CatalogCharacter {
  id: string;
  name: string;
  description: string;
  tags: string[];
  pack: string;
  /** Props this character holds by default. */
  holds: string[];
}

export interface CatalogProp {
  id: string;
  name: string;
  description: string;
  /** `held` props go in a hand (holdRight/holdLeft); `placed` props are scene objects. */
  kind: 'held' | 'placed';
  /** Vehicles can carry actors via `ride`. */
  vehicle?: boolean;
  /** Animates when `moving: true`. */
  animates?: boolean;
}

export interface CatalogBackground {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Where feet go by default (fraction of frame height). */
  ground: number;
}

export const CHARACTERS: CatalogCharacter[] = [
  { id: 'krishna', name: 'Krishna', description: 'Blue-skinned divine prince, peacock-feather crown, yellow dhoti, flower garland; plays the flute; charioteer and guide', tags: ['mahabharat', 'divine', 'krishna'], pack: 'mahabharat', holds: [] },
  { id: 'bal-krishna', name: 'Bal Krishna', description: 'Child Krishna — mischievous, butter-loving, peacock feather in his hair', tags: ['krishna', 'child', 'divine'], pack: 'krishna-leela', holds: [] },
  { id: 'arjuna', name: 'Arjuna', description: 'Pandava archer prince in golden armour and tall crown, carries the Gandiva bow', tags: ['mahabharat', 'warrior'], pack: 'mahabharat', holds: ['bow'] },
  { id: 'karna', name: 'Karna', description: 'Son of Surya with sun crown and glowing golden armour (kavach), tragic hero, archer', tags: ['mahabharat', 'warrior'], pack: 'mahabharat', holds: ['bow'] },
  { id: 'bhishma', name: 'Bhishma', description: 'White-bearded grandsire of the Kurus in silver armour, bound by his vow', tags: ['mahabharat', 'elder', 'warrior'], pack: 'mahabharat', holds: ['bow'] },
  { id: 'duryodhana', name: 'Duryodhana', description: 'Proud Kaurava prince in dark armour with a mace, the antagonist', tags: ['mahabharat', 'villain', 'warrior'], pack: 'mahabharat', holds: ['mace'] },
  { id: 'draupadi', name: 'Draupadi', description: 'Fiery queen of the Pandavas in a magenta saree with long open hair', tags: ['mahabharat', 'queen'], pack: 'mahabharat', holds: [] },
  { id: 'rama', name: 'Rama', description: 'Prince of Ayodhya, blue-green skin, tall crown, saffron dhoti, carries the Kodanda bow', tags: ['ramayan', 'divine', 'warrior'], pack: 'ramayan', holds: ['bow'] },
  { id: 'sita', name: 'Sita', description: 'Princess of Mithila in a golden-yellow saree with a braid', tags: ['ramayan', 'divine', 'queen'], pack: 'ramayan', holds: [] },
  { id: 'hanuman', name: 'Hanuman', description: 'Mighty vanara devotee of Rama with crown, tail and mace', tags: ['ramayan', 'divine', 'warrior'], pack: 'ramayan', holds: ['mace'] },
  { id: 'shiva', name: 'Shiva', description: 'Ash-blue ascetic god: matted hair with crescent moon and Ganga, third eye, snake, tiger skin, trident', tags: ['shiva', 'divine'], pack: 'shiva', holds: ['trident'] },
  { id: 'sage', name: 'Rishi', description: 'White-bearded sage in saffron robes with a water pot — a narrator, guru or Vyasa', tags: ['narrator', 'sage', 'elder'], pack: 'core', holds: ['kamandalu'] },
  { id: 'chanakya', name: 'Chanakya', description: 'Shrewd teacher and strategist with a shikha tuft and a palm-leaf scroll', tags: ['history', 'teacher'], pack: 'history', holds: ['scroll'] },
  { id: 'king', name: 'King', description: 'Grey-bearded crowned king (Dhritarashtra, Dasharatha, Drupada…)', tags: ['royal', 'elder'], pack: 'core', holds: [] },
  { id: 'soldier', name: 'Soldier', description: 'Foot soldier with bronze helmet and spear — use several for armies', tags: ['warrior', 'extra'], pack: 'core', holds: ['spear'] },
];

export const PROPS: CatalogProp[] = [
  { id: 'chariot', name: 'Chariot', description: 'War chariot with two white horses, side view; riders stand in it via `ride`', kind: 'placed', vehicle: true, animates: true },
  { id: 'horse', name: 'Horse', description: 'White war horse, side view, gallops when moving', kind: 'placed', animates: true },
  { id: 'diya', name: 'Diya', description: 'Clay oil lamp with a flickering flame', kind: 'placed', animates: true },
  { id: 'throne', name: 'Throne', description: 'Golden royal throne (simhasana)', kind: 'placed' },
  { id: 'havan', name: 'Havan kund', description: 'Fire altar with sacred flames', kind: 'placed', animates: true },
  { id: 'tree', name: 'Kadamba tree', description: 'Large flowering tree', kind: 'placed', animates: true },
  { id: 'cow', name: 'Cow', description: 'Gentle white cow with bell, side view', kind: 'placed' },
  { id: 'banner', name: 'War banner', description: 'Tall pole with a fluttering saffron flag', kind: 'placed', animates: true },
  { id: 'matka', name: 'Butter pot', description: 'Clay pot (matka) hanging from a rope — Krishna’s butter', kind: 'placed', animates: true },
  { id: 'flute', name: 'Flute', description: 'Bansuri — automatic with the `flute` pose', kind: 'held' },
  { id: 'bow', name: 'Bow', description: 'Great bow; use with `draw-bow` to aim', kind: 'held' },
  { id: 'arrow', name: 'Arrow', description: 'Single arrow', kind: 'held' },
  { id: 'mace', name: 'Mace', description: 'Golden gada', kind: 'held' },
  { id: 'trident', name: 'Trident', description: 'Shiva’s trishul with damaru', kind: 'held' },
  { id: 'spear', name: 'Spear', description: 'Soldier’s spear', kind: 'held' },
  { id: 'sword', name: 'Sword', description: 'Straight sword', kind: 'held' },
  { id: 'lotus', name: 'Lotus', description: 'Pink lotus flower', kind: 'held' },
  { id: 'conch', name: 'Conch', description: 'Shankh — blown before battle', kind: 'held' },
  { id: 'chakra', name: 'Sudarshan chakra', description: 'Spinning divine discus floating above the hand', kind: 'held' },
  { id: 'kamandalu', name: 'Kamandalu', description: 'Sage’s water pot', kind: 'held' },
  { id: 'scroll', name: 'Scroll', description: 'Palm-leaf manuscript', kind: 'held' },
];

export const BACKGROUNDS: CatalogBackground[] = [
  { id: 'kurukshetra', name: 'Kurukshetra', description: 'Vast battlefield plain with distant armies, banners and dust', tags: ['battle', 'mahabharat'], ground: 0.86 },
  { id: 'palace', name: 'Palace hall', description: 'Royal court with carved arches, pillars, lamps and drapes', tags: ['royal', 'interior'], ground: 0.88 },
  { id: 'forest', name: 'Forest ashram', description: 'Deep forest with a sage’s hut and shafts of light', tags: ['nature', 'exile'], ground: 0.87 },
  { id: 'river', name: 'River ghat', description: 'Stone ghat steps on a sacred river with temple spires', tags: ['devotional', 'water'], ground: 0.9 },
  { id: 'kailash', name: 'Mount Kailash', description: 'Snowy Himalayan peak — Shiva’s abode', tags: ['shiva', 'mountain', 'divine'], ground: 0.88 },
  { id: 'temple', name: 'Temple', description: 'Stone temple sanctum with bells, pillars and lamps', tags: ['devotional', 'interior'], ground: 0.88 },
  { id: 'cosmos', name: 'Cosmos', description: 'Deep space, nebula and a slowly turning cosmic mandala — divine visions', tags: ['divine', 'cosmic'], ground: 0.82 },
  { id: 'vrindavan', name: 'Vrindavan', description: 'Meadow by the Yamuna with kadamba trees, cows and village huts', tags: ['krishna', 'nature', 'village'], ground: 0.88 },
  { id: 'studio', name: 'Studio', description: 'Soft gradient backdrop for character close-ups and title cards', tags: ['plain'], ground: 0.9 },
];

export const characterIds = () => CHARACTERS.map((c) => c.id);
export const propIds = () => PROPS.map((p) => p.id);
export const backgroundIds = () => BACKGROUNDS.map((b) => b.id);
export const findBackground = (id: string) => BACKGROUNDS.find((b) => b.id === id);
export const findProp = (id: string) => PROPS.find((p) => p.id === id);
export const findCharacter = (id: string) => CHARACTERS.find((c) => c.id === id);
