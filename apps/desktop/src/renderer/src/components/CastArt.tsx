// The kit's own characters, drawn at rest (frame 0, no idle motion) like a cast photo.
import { registry, rigStateAt, type CharacterDef } from "@moco/kit/components";
import { cn } from "@/lib/utils";

const CHARACTERS: Record<string, CharacterDef> = Object.fromEntries(
  registry.characters.map((def) => [def.id, def]),
);

export function CastArt({
  characters = ["krishna", "arjuna"],
  className,
}: {
  characters?: string[];
  className?: string;
}) {
  const shown = characters.filter((id) => CHARACTERS[id]).slice(0, 3);
  return (
    <svg className={className} viewBox="0 0 600 440" aria-hidden="true">
      <ellipse cx="300" cy="405" rx="210" ry="15" fill="#2e2446" opacity=".09" />
      {shown.map((id, i) => (
        <g
          key={`${id}${i}`}
          transform={`translate(${300 + (i - (shown.length - 1) / 2) * 175 - 100} 10) scale(.5)`}
        >
          <CastMember def={CHARACTERS[id]!} />
        </g>
      ))}
    </svg>
  );
}

// A round crop of one character's face, for cast lists.
export function CastAvatar({ character, className }: { character: string; className?: string }) {
  return (
    <div
      className={cn(
        "cast-avatar cast-backdrop size-10 shrink-0 overflow-hidden rounded-full border",
        className,
      )}
    >
      {CHARACTERS[character] ? (
        <CastArt characters={[character]} />
      ) : (
        // A generated character has no kit drawing to crop, so it gets its initial.
        <span className="flex size-full items-center justify-center text-sm font-medium uppercase">{character.charAt(0)}</span>
      )}
    </div>
  );
}

// One character in its 400×800 kit box, feet at the bottom centre.
function CastMember({ def }: { def: CharacterDef }) {
  const rig = rigStateAt({ actions: [], expression: [{ name: "smile", atFrame: 0 }] }, 0, { seed: def.id });
  return <def.Component rig={rig} variant={def.variants[0] ?? "default"} />;
}
