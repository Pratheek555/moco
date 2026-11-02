// What the AI can pick from in any generated world: plain data with no three.js in it, because the engine reads
// this too. shots.ts draws the cameras and moves.ts the moves.

// The shot's subject can be named by the player's id or its model's: AIs use both.
export const isSubject = (player: { id: string; model: string }, subject: string) => player.id === subject || player.model === subject;

// The joints a humanoid model must have. "_L" is the character's left.
export const HUMANOID_JOINTS = ["hips", "chest", "head", "arm_L", "arm_R", "forearm_L", "forearm_R", "leg_L", "leg_R", "shin_L", "shin_R"];

export const WORLD_CAMERAS: { id: string; hint: string }[] = [
  { id: "establishing", hint: "Far and high, the whole place with the subject small in it. Opens a sequence." },
  { id: "wide", hint: "The subject head to toe with the place around them." },
  { id: "medium", hint: "From the waist up. The everyday shot for action and talk." },
  { id: "close", hint: "Head and shoulders, for a feeling or a decision." },
  { id: "push_in", hint: "Starts wide and moves slowly into a close shot. For a realisation or a key line." },
  { id: "pull_back", hint: "Starts close and moves back to reveal the place. For a surprise or an ending." },
  { id: "orbit", hint: "Circles the subject slowly. For a turning point or a reveal of power." },
  { id: "low_hero", hint: "From near the ground looking up, so the subject looms." },
  { id: "high_down", hint: "From above looking down, so the subject looks small or trapped." },
  { id: "over_shoulder", hint: "Over the other player's shoulder at the subject. Needs two players." },
  { id: "tracking", hint: "Level with the subject and moving with it. For anything travelling." },
  { id: "behind", hint: "Following from behind, looking where the subject is going." },
];
