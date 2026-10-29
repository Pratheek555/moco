import { clamp } from '@moco/kit';
import {
  EpisodeSchema,
  ShotSchema,
  TRANSITION_SECONDS,
  episodeTimeline,
  shotSeconds,
  type EpisodeInput,
  type SfxId,
  type ShotInput,
  type TimelineEntry,
} from '@moco/spec';
import React, { useMemo } from 'react';
import { AbsoluteFill, Html5Audio, Sequence, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from 'remotion';
import { Captions } from './Captions.tsx';
import { ensureFonts, TEXT_FONT } from './fonts.ts';
import { ShotView } from './Shot.tsx';
import { easeInOut } from './timeline/actors.ts';

export interface Assets {
  /** Prefix for relative audio paths in the spec (the episode folder URL). */
  base?: string;
  /** Absolute URLs of the shared sound-effect files. */
  sfx?: Partial<Record<SfxId, string>>;
}

export interface EpisodeProps extends Record<string, unknown> {
  episode: EpisodeInput;
  assets?: Assets;
  muted?: boolean;
  captions?: boolean;
}

const ABSOLUTE = /^(https?:|moco-asset:|file:|data:|blob:)/;
export const resolveSrc = (src: string, assets?: Assets) => (ABSOLUTE.test(src) ? src : `${assets?.base ?? ''}${src.replace(/^\.?\//, '')}`);

class ShotBoundary extends React.Component<{ id: string; children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (getRemotionEnvironment().isRendering) throw new Error(`[shot:${this.props.id}] ${error.message}`);
    return <ErrorCard title={`Shot “${this.props.id}” failed`} detail={error.message} />;
  }
}

export function ErrorCard({ title, detail }: { title: string; detail: string }) {
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(#2b0d12, #12060a)', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
      <div style={{ fontFamily: TEXT_FONT, color: '#ffb4b4', fontSize: 52, fontWeight: 700, textAlign: 'center' }}>{title}</div>
      <div style={{ fontFamily: 'ui-monospace, monospace', color: '#ffd6d6', fontSize: 30, marginTop: 30, whiteSpace: 'pre-wrap', textAlign: 'left', maxWidth: 900 }}>{detail}</div>
    </AbsoluteFill>
  );
}

function transitionStyle(entry: TimelineEntry, local: number): React.CSSProperties | undefined {
  const n = entry.transitionFrames;
  if (!entry.overlapIn || local >= n) return undefined;
  const k = easeInOut(local / Math.max(1, n));
  switch (entry.shot.transition) {
    case 'fade':
      return { opacity: k };
    case 'zoom':
      return { opacity: clamp(k * 1.6, 0, 1), transform: `scale(${1.35 - 0.35 * k})`, filter: `blur(${(1 - k) * 14}px)` };
    case 'slide-left':
      return { transform: `translateX(${(1 - k) * 100}%)` };
    case 'slide-up':
      return { transform: `translateY(${(1 - k) * 100}%)` };
    case 'whip':
      return { transform: `translateX(${(1 - k) * 100}%)`, filter: `blur(${(1 - k) * 26}px)` };
    default:
      return undefined;
  }
}

const ShotSequence: React.FC<{ entry: TimelineEntry; uid: string }> = ({ entry, uid }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = transitionStyle(entry, frame);
  return (
    <AbsoluteFill style={style}>
      <ShotBoundary id={entry.shot.id}>
        <ShotView shot={entry.shot} t={frame / fps} frame={frame} duration={entry.durationInFrames / fps} uid={uid} />
      </ShotBoundary>
    </AbsoluteFill>
  );
};

/** Dips and flashes drawn over the cut point. */
function CutOverlays({ entries, frame, fps }: { entries: TimelineEntry[]; frame: number; fps: number }) {
  return (
    <>
      {entries.map((e) => {
        const kind = e.shot.transition;
        if (e.index === 0 || (kind !== 'dip-black' && kind !== 'dip-white' && kind !== 'flash')) return null;
        const n = Math.max(1, Math.round(TRANSITION_SECONDS[kind] * fps));
        const d = frame - e.from;
        if (kind === 'flash') {
          if (d < 0 || d > n) return null;
          return <AbsoluteFill key={e.index} style={{ background: '#fff', opacity: 1 - d / n }} />;
        }
        if (Math.abs(d) > n / 2) return null;
        return <AbsoluteFill key={e.index} style={{ background: kind === 'dip-black' ? '#000' : '#fff', opacity: 1 - Math.abs(d) / (n / 2) }} />;
      })}
    </>
  );
}

function Brand({ handle, watermark, progressBar, accent, frame, total }: { handle: string; watermark: boolean; progressBar: boolean; accent: string; frame: number; total: number }) {
  return (
    <>
      {watermark && handle && (
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: progressBar ? 70 : 60 }}>
          <div style={{ fontFamily: TEXT_FONT, fontWeight: 700, fontSize: 34, color: 'rgba(255,255,255,0.78)', textShadow: '0 2px 10px rgba(0,0,0,0.6)', letterSpacing: 1 }}>{handle}</div>
        </AbsoluteFill>
      )}
      {progressBar && (
        <AbsoluteFill>
          <div style={{ position: 'absolute', left: 0, top: 0, height: 10, width: `${(frame / Math.max(1, total - 1)) * 100}%`, background: accent, boxShadow: `0 0 18px ${accent}` }} />
        </AbsoluteFill>
      )}
    </>
  );
}

export const EpisodeComposition: React.FC<EpisodeProps> = ({ episode: raw, assets, muted, captions = true }) => {
  ensureFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const parsed = useMemo(() => EpisodeSchema.safeParse(raw), [raw]);
  const timeline = useMemo(() => (parsed.success ? episodeTimeline(parsed.data) : null), [parsed]);
  if (!parsed.success || !timeline) {
    const detail = parsed.success ? '' : parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    if (getRemotionEnvironment().isRendering) throw new Error(`Invalid episode spec:\n${detail}`);
    return <ErrorCard title="Invalid episode spec" detail={detail} />;
  }
  const episode = parsed.data;
  const { entries, durationInFrames } = timeline;

  // Voice segments (frames) for music ducking.
  const voiced = entries.filter((e) => e.shot.voice).map((e) => [e.from, e.from + Math.round((e.shot.voice!.duration ?? 0) * fps)] as const);
  const musicVolume = (f: number) => {
    let duck = 1;
    for (const [a, b] of voiced) {
      const inside = f >= a - 6 && f <= b + 6;
      if (inside) {
        const edge = Math.min(1, (f - (a - 6)) / 6, (b + 6 - f) / 6);
        duck = Math.min(duck, 1 - 0.55 * clamp(edge, 0, 1));
      }
    }
    const fadeIn = clamp(f / (fps * 0.6), 0, 1);
    const fadeOut = clamp((durationInFrames - f) / (fps * 1.4), 0, 1);
    return episode.music.volume * duck * fadeIn * fadeOut;
  };

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {entries.map((e) => (
        <Sequence key={`${e.index}-${e.shot.id}`} from={e.from} durationInFrames={e.durationInFrames} name={e.shot.id}>
          <ShotSequence entry={e} uid={`s${e.index}`} />
        </Sequence>
      ))}
      <CutOverlays entries={entries} frame={frame} fps={fps} />
      {captions && <Captions episode={episode} entries={entries} t={frame / fps} />}
      <Brand {...episode.brand} frame={frame} total={durationInFrames} />
      {!muted && (
        <>
          {entries.map((e) =>
            e.shot.voice ? (
              <Sequence key={`vo${e.index}`} from={e.from} durationInFrames={e.durationInFrames} name={`vo ${e.shot.id}`}>
                <Html5Audio src={resolveSrc(e.shot.voice.src, assets)} />
              </Sequence>
            ) : null,
          )}
          {entries.flatMap((e) =>
            e.shot.sfx.map((s, i) => {
              const src = assets?.sfx?.[s.id];
              if (!src) return null;
              return (
                <Sequence key={`sfx${e.index}-${i}`} from={e.from + Math.round(s.at * fps)} name={`sfx ${s.id}`}>
                  <Html5Audio src={src} volume={0.85 * s.volume} />
                </Sequence>
              );
            }),
          )}
          {episode.music.src && episode.music.mood !== 'none' && <Html5Audio src={resolveSrc(episode.music.src, assets)} volume={musicVolume} />}
        </>
      )}
    </AbsoluteFill>
  );
};

export interface ShotProps extends Record<string, unknown> {
  shot: ShotInput;
}

/** One shot on its own — for previews, thumbnails and preflight stills. */
export const ShotComposition: React.FC<ShotProps> = ({ shot: raw }) => {
  ensureFonts();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const parsed = useMemo(() => ShotSchema.safeParse(raw), [raw]);
  if (!parsed.success) {
    const detail = parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    if (getRemotionEnvironment().isRendering) throw new Error(`[shot:${(raw as { id?: string }).id ?? '?'}] invalid spec\n${detail}`);
    return <ErrorCard title="Invalid shot" detail={detail} />;
  }
  return (
    <ShotBoundary id={parsed.data.id}>
      <ShotView shot={parsed.data} t={frame / fps} frame={frame} duration={shotSeconds(parsed.data)} uid="shot" />
    </ShotBoundary>
  );
};
