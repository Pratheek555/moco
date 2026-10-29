import { clamp } from '@moco/kit';
import { estimateWords, type Episode, type TimelineEntry, type Word } from '@moco/spec';
import React, { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import { DISPLAY_FONT, TEXT_FONT, isDevanagari } from './fonts.ts';

interface Chunk {
  words: Word[];
  start: number;
  end: number;
}

/** Word timings for one shot, in episode seconds. */
export function shotWords(entry: TimelineEntry, fps: number): Word[] {
  const shot = entry.shot;
  const offset = entry.from / fps;
  const text = (shot.caption ?? shot.narration).trim();
  if (!text) return [];
  const own = entry.durationInFrames / fps;
  const custom = shot.caption && shot.caption.trim() !== shot.narration.trim();
  const words =
    shot.voice && shot.voice.words.length && !custom
      ? shot.voice.words
      : estimateWords(text, 0.15, Math.max(0.6, (shot.voice?.duration ?? own) - 0.15));
  return words.map((w) => ({ text: w.text, start: w.start + offset, end: w.end + offset }));
}

function chunkWords(words: Word[], maxWords: number, maxChars: number): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({ words: cur, start: cur[0]!.start, end: cur[cur.length - 1]!.end });
    cur = [];
  };
  for (const w of words) {
    const len = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= maxWords || len > maxChars)) flush();
    cur.push(w);
    if (/[.!?;:,—।]$/.test(w.text)) flush();
  }
  flush();
  // Hold each chunk until the next one starts (no flicker between words).
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1];
    const c = chunks[i]!;
    c.end = next ? Math.min(next.start, c.end + 0.6) : c.end + 0.5;
  }
  return chunks;
}

export const Captions: React.FC<{ episode: Episode; entries: TimelineEntry[]; t: number }> = ({ episode, entries, t }) => {
  const style = episode.captions.style;
  const fps = episode.fps;
  const chunks = useMemo(() => {
    if (style === 'none') return [];
    const words = entries.flatMap((e) => shotWords(e, fps));
    const tight = style === 'bold' || style === 'boxed';
    return chunkWords(words, tight ? 3 : 6, tight ? 18 : 34);
  }, [entries, fps, style]);
  if (style === 'none') return null;
  const chunk = chunks.find((c) => t >= c.start - 0.02 && t < c.end);
  if (!chunk) return null;

  const local = t - chunk.start;
  const pop = 1 - Math.cos(clamp(local / 0.22, 0, 1) * Math.PI * 2.2) * Math.exp(-clamp(local / 0.22, 0, 1) * 5) * 0.14;
  const enter = clamp(local / 0.08, 0, 1);
  const top = { top: '20%', center: '46%', bottom: '66%' }[episode.captions.position];
  const highlight = episode.captions.highlight;
  const deva = chunk.words.some((w) => isDevanagari(w.text));

  const wordEl = (w: Word, i: number) => {
    const active = t >= w.start && t < w.end + 0.05;
    const spoken = t >= w.start;
    const k = clamp((t - w.start) / 0.12, 0, 1);
    switch (style) {
      case 'boxed':
        return (
          <span key={i} style={{ display: 'inline-block', padding: '4px 16px', margin: '0 4px', borderRadius: 14, background: active ? highlight : 'transparent', color: active ? '#111' : '#111', transform: `scale(${active ? 1 + 0.06 * k : 1})` }}>
            {w.text}
          </span>
        );
      case 'clean':
        return (
          <span key={i} style={{ opacity: spoken ? 1 : 0.55, marginRight: 14 }}>
            {w.text}
          </span>
        );
      case 'gold':
        return (
          <span key={i} style={{ marginRight: 16, opacity: spoken ? 1 : 0.4 }}>
            {w.text}
          </span>
        );
      default:
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              margin: '0 10px',
              color: active ? highlight : '#ffffff',
              transform: `scale(${active ? 1 + 0.1 * (1 - Math.abs(k - 0.5) * 0.6) : 1}) translateY(${active ? -4 : 0}px)`,
            }}
          >
            {w.text}
          </span>
        );
    }
  };

  const base: React.CSSProperties = {
    position: 'absolute',
    left: 60,
    right: 60,
    top,
    transform: `translateY(-50%) scale(${pop})`,
    textAlign: 'center',
    opacity: enter,
    lineHeight: 1.12,
  };

  if (style === 'boxed') {
    return (
      <AbsoluteFill>
        <div style={base}>
          <span style={{ display: 'inline-block', padding: '16px 20px', borderRadius: 26, background: '#ffffff', boxShadow: '0 14px 40px rgba(0,0,0,0.35)', fontFamily: TEXT_FONT, fontWeight: 800, fontSize: 64, color: '#111' }}>
            {chunk.words.map(wordEl)}
          </span>
        </div>
      </AbsoluteFill>
    );
  }
  if (style === 'clean') {
    return (
      <AbsoluteFill>
        <div style={{ ...base, fontFamily: TEXT_FONT, fontWeight: 600, fontSize: 58, color: '#fff', textShadow: '0 3px 14px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)' }}>{chunk.words.map(wordEl)}</div>
      </AbsoluteFill>
    );
  }
  if (style === 'gold') {
    return (
      <AbsoluteFill>
        <div
          style={{
            ...base,
            fontFamily: deva ? `"Yatra One", ${TEXT_FONT}` : DISPLAY_FONT,
            fontWeight: deva ? 400 : 700,
            fontSize: deva ? 72 : 64,
            backgroundImage: 'linear-gradient(180deg, #fff6d0 0%, #ffd56b 50%, #e09a1f 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            filter: 'drop-shadow(0 4px 0 rgba(60,20,0,0.6)) drop-shadow(0 8px 18px rgba(0,0,0,0.6))',
          }}
        >
          {chunk.words.map(wordEl)}
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill>
      <div
        style={{
          ...base,
          fontFamily: TEXT_FONT,
          fontWeight: 800,
          fontSize: deva ? 76 : 82,
          color: '#fff',
          textTransform: deva ? 'none' : 'uppercase',
          WebkitTextStroke: '12px #000',
          paintOrder: 'stroke fill',
          textShadow: '0 8px 22px rgba(0,0,0,0.55)',
          letterSpacing: deva ? 0 : 1,
        }}
      >
        {chunk.words.map(wordEl)}
      </div>
    </AbsoluteFill>
  );
};
