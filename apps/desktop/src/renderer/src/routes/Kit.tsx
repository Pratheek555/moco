import { useEffect, useRef, useState } from "react";
import { CHARACTERS, BACKGROUNDS, PROPS } from "@moco/kit/catalog";
import { Player } from "@remotion/player";
import { ShotComposition, shotFrames } from "@moco/renderer";
import {
  CAMERA_MOVES,
  FX_TYPES,
  SFX,
  VOCAB_DOCS,
  ShotSchema,
  type Shot,
  type ShotInput,
} from "@moco/spec";
import { Search, Play, Sparkles, ArrowUpRight, Volume2 } from "lucide-react";
import { api } from "../lib/api.ts";
import { useApp, type KitTab } from "../lib/store.ts";
import { Button, CastArt, Modal, Tag, report } from "../components/ui.tsx";

const tabs: KitTab[] = [
  "characters",
  "backgrounds",
  "props",
  "camera",
  "effects",
  "sound",
];
export function KitPage() {
  const route = useApp((s) => s.route),
    setIdea = useApp((s) => s.setComposerIdea),
    go = useApp((s) => s.go);
  const [tab, setTab] = useState<KitTab>(
      route.name === "kit" ? (route.tab ?? "characters") : "characters",
    ),
    [q, setQ] = useState(""),
    [preview, setPreview] = useState<{ name: string; shot: Shot } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );
  const demo = (name: string, patch: Partial<ShotInput>) =>
    setPreview({
      name,
      shot: ShotSchema.parse({
        id: "kit-preview",
        duration: 6,
        background: { id: "studio", time: "day" },
        actors: [
          {
            id: "hero",
            character: "krishna",
            x: 0.5,
            y: 0.9,
            scale: 0.75,
            pose: "bless",
            expression: "smile",
          },
        ],
        ...patch,
      }),
    });
  const play = async (id: string) => {
    try {
      const sounds = await api.assets.sfx();
      audio.current?.pause();
      if (sounds[id as keyof typeof sounds]) {
        audio.current = new Audio(sounds[id as keyof typeof sounds]);
        await audio.current.play();
      }
    } catch (e) {
      report(e);
    }
  };
  return (
    <div className="page kit-page enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A WHOLE WORLD, READY TO ANIMATE</div>
          <h1>The creative kit</h1>
          <p>
            Consistent characters. Cinematic worlds. A little magic in every
            scene.
          </p>
        </div>
        <Tag>INCLUDED WITH MOCO</Tag>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              className={tab === t ? "selected" : ""}
              key={t}
              onClick={() => {
                setTab(t);
                setQ("");
              }}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label="Search creative kit"
            placeholder={`Find ${tab}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      <div className="kit-grid">
        {tab === "characters"
          ? CHARACTERS.filter((c) =>
              `${c.name} ${c.tags.join(" ")}`
                .toLowerCase()
                .includes(q.toLowerCase()),
            ).map((c) => (
              <button
                className="kit-card character-card"
                key={c.id}
                onClick={() =>
                  demo(c.name, {
                    actors: [
                      {
                        id: "hero",
                        character: c.id,
                        x: 0.5,
                        y: 0.9,
                        scale: 0.75,
                        pose: "stand",
                        expression: "smile",
                      },
                    ],
                  })
                }
              >
                <div className={`character-art pack-${c.pack}`}>
                  <span className="kit-pack">
                    {c.pack.replaceAll("-", " ")}
                  </span>
                  <CastArt characters={[c.id]} />
                  <span className="preview-art-button">
                    <Play size={13} fill="currentColor" />
                  </span>
                </div>
                <div className="kit-info">
                  <h3>
                    {c.name}
                    <ArrowUpRight size={15} />
                  </h3>
                  <p>{c.description}</p>
                </div>
              </button>
            ))
          : tab === "backgrounds"
            ? BACKGROUNDS.filter((b) =>
                `${b.name} ${b.description}`
                  .toLowerCase()
                  .includes(q.toLowerCase()),
              ).map((b) => (
                <button
                  className="kit-card"
                  key={b.id}
                  onClick={() =>
                    demo(b.name, {
                      background: { id: b.id, time: "dusk" },
                      actors: [],
                    })
                  }
                >
                  <div className={`background-tile swatch-${b.id}`}>
                    <div className="landscape-shape" />
                    <span>{b.name}</span>
                    <Play size={18} />
                  </div>
                  <div className="kit-info">
                    <h3>
                      {b.name}
                      <ArrowUpRight size={15} />
                    </h3>
                    <p>{b.description}</p>
                  </div>
                </button>
              ))
            : tab === "props"
              ? PROPS.filter((p) =>
                  `${p.name} ${p.description}`
                    .toLowerCase()
                    .includes(q.toLowerCase()),
                ).map((p) => (
                  <button
                    className="kit-card compact-kit"
                    key={p.id}
                    onClick={() =>
                      demo(
                        p.name,
                        p.kind === "held"
                          ? {
                              actors: [
                                {
                                  id: "hero",
                                  character: "krishna",
                                  x: 0.5,
                                  y: 0.9,
                                  scale: 0.75,
                                  holdRight: p.id,
                                },
                              ],
                            }
                          : {
                              actors: [],
                              props: [
                                {
                                  id: "object",
                                  prop: p.id,
                                  x: 0.5,
                                  y: 0.85,
                                  scale: 1,
                                  moving: true,
                                  actions: [],
                                  facing: "right",
                                },
                              ],
                            },
                      )
                    }
                  >
                    <Tag>{p.kind}</Tag>
                    <h3>
                      {p.name}
                      <Play size={14} />
                    </h3>
                    <p>{p.description}</p>
                  </button>
                ))
              : (tab === "camera"
                  ? CAMERA_MOVES
                  : tab === "effects"
                    ? FX_TYPES
                    : SFX
                )
                  .filter((x) => x.includes(q.toLowerCase()))
                  .map((id) => (
                    <button
                      className="kit-card compact-kit"
                      key={id}
                      onClick={() =>
                        tab === "sound"
                          ? void play(id)
                          : demo(
                              id,
                              tab === "camera"
                                ? {
                                    background: { id: "palace", time: "dusk" },
                                    camera: {
                                      move: id as Shot["camera"]["move"],
                                      intensity: 0.7,
                                    },
                                  }
                                : {
                                    background: { id: "cosmos", time: "night" },
                                    fx: [
                                      {
                                        type: id,
                                        target: "hero",
                                        variant:
                                          id === "particles"
                                            ? "sparkles"
                                            : undefined,
                                        intensity: 0.7,
                                      } as NonNullable<ShotInput["fx"]>[number],
                                    ],
                                  },
                            )
                      }
                    >
                      {tab === "sound" ? (
                        <Volume2 size={25} />
                      ) : (
                        <Sparkles size={25} />
                      )}
                      <h3>
                        {id.replaceAll("-", " ")}
                        <Play size={14} />
                      </h3>
                      <p>
                        {tab === "camera"
                          ? VOCAB_DOCS.camera[
                              id as keyof typeof VOCAB_DOCS.camera
                            ]
                          : tab === "effects"
                            ? VOCAB_DOCS.fx[id as keyof typeof VOCAB_DOCS.fx]
                            : VOCAB_DOCS.sfx[id as keyof typeof VOCAB_DOCS.sfx]}
                      </p>
                    </button>
                  ))}
      </div>
      <div className="kit-tip">
        <Sparkles size={18} />
        <p>
          Tell your AI writer which characters and worlds to use. The kit keeps
          their look consistent across your whole series.
        </p>
      </div>
      {preview && (
        <Modal title={preview.name} close={() => setPreview(null)}>
          <div className="kit-player">
            <Player
              component={ShotComposition}
              inputProps={{ shot: preview.shot }}
              durationInFrames={shotFrames(preview.shot)}
              fps={30}
              compositionWidth={1080}
              compositionHeight={1920}
              controls
              autoPlay
              loop
              acknowledgeRemotionLicense
              style={{
                height: 470,
                aspectRatio: "9/16",
                borderRadius: 12,
                overflow: "hidden",
              }}
            />
          </div>
          <div className="modal-actions">
            <Button onClick={() => setPreview(null)}>Close</Button>
            <Button
              variant="primary"
              onClick={() => {
                setIdea(`Tell a story featuring ${preview.name}.`);
                setPreview(null);
                go({ name: "studio" });
              }}
            >
              Create with this <ArrowUpRight size={14} />
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
