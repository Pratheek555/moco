import { clamp } from '@moco/kit';
import type { Overlay as OverlaySpec } from '@moco/spec';
import React from 'react';
import { AbsoluteFill } from 'remotion';
import { easeOut } from './timeline/actors.ts';
import { DISPLAY_FONT, TEXT_FONT, isDevanagari } from './fonts.ts';

function Ornament({ width, color }: { width: number; color: string }) {
  const h = width / 2;
  return (
    <svg width={width} height={28} viewBox={`${-h} -14 ${width} 28`} style={{ display: 'block', margin: '0 auto' }}>
      <path d={`M${-h} 0 L-34 0 M34 0 L${h} 0`} stroke={color} strokeWidth={3} />
      <path d="M0 -12 L12 0 L0 12 L-12 0 Z" fill={color} />
      <circle cx={-24} cy={0} r={4} fill={color} />
      <circle cx={24} cy={0} r={4} fill={color} />
    </svg>
  );
}

export const Overlay: React.FC<{ overlay: OverlaySpec; t: number; shotDuration: number }> = ({ overlay, t, shotDuration }) => {
  const start = overlay.at;
  const end = overlay.duration !== undefined ? start + overlay.duration : shotDuration;
  if (t < start || t > end + 0.05) return null;
  const local = t - start;
  const inK = easeOut(local / 0.6);
  const out = clamp((end - t) / 0.4, 0, 1);
  const opacity = Math.min(inK, out);
  const rise = (1 - inK) * 40;
  const deva = isDevanagari(overlay.text);
  const gold = 'linear-gradient(180deg, #fff6d0 0%, #ffd56b 45%, #e09a1f 100%)';

  if (overlay.kind === 'title' || overlay.kind === 'chapter') {
    const big = overlay.kind === 'title';
    return (
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: big ? 300 : 240, opacity }}>
        <div style={{ transform: `translateY(${rise}px)`, textAlign: 'center', width: 920 }}>
          {!big && overlay.subtitle && (
            <div style={{ display: 'inline-block', padding: '10px 26px', borderRadius: 999, background: 'rgba(0,0,0,0.45)', color: '#ffe8a8', fontFamily: TEXT_FONT, fontWeight: 600, fontSize: 30, letterSpacing: 6, textTransform: 'uppercase', marginBottom: 28 }}>
              {overlay.subtitle}
            </div>
          )}
          <div
            style={{
              fontFamily: deva ? `"Yatra One", ${TEXT_FONT}` : DISPLAY_FONT,
              fontWeight: deva ? 400 : 900,
              fontSize: big ? (overlay.text.length > 18 ? 96 : 118) : 84,
              lineHeight: 1.05,
              letterSpacing: deva ? 0 : 2,
              backgroundImage: gold,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              filter: 'drop-shadow(0 6px 0 rgba(60,20,0,0.55)) drop-shadow(0 12px 28px rgba(0,0,0,0.55))',
            }}
          >
            {overlay.text}
          </div>
          {big && (
            <div style={{ marginTop: 26 }}>
              <Ornament width={520 * clamp(local / 0.9, 0.2, 1)} color="#ffd56b" />
            </div>
          )}
          {big && overlay.subtitle && (
            <div style={{ marginTop: 22, color: '#fff3d6', fontFamily: TEXT_FONT, fontWeight: 600, fontSize: 34, letterSpacing: 8, textTransform: 'uppercase', textShadow: '0 3px 12px rgba(0,0,0,0.7)' }}>
              {overlay.subtitle}
            </div>
          )}
        </div>
      </AbsoluteFill>
    );
  }

  if (overlay.kind === 'quote') {
    return (
      <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: 150, opacity }}>
        <div style={{ transform: `translateY(${rise}px) scale(${0.96 + inK * 0.04})`, width: 900, padding: '36px 44px', borderRadius: 40, background: 'rgba(20,10,4,0.52)', border: '2px solid rgba(255,213,107,0.55)', textAlign: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ fontFamily: DISPLAY_FONT, color: '#ffd56b', fontSize: 120, lineHeight: 0.6, height: 60 }}>“</div>
          <div style={{ fontFamily: deva ? `"Yatra One", ${TEXT_FONT}` : DISPLAY_FONT, fontWeight: deva ? 400 : 700, fontSize: deva ? 76 : 58, lineHeight: 1.2, backgroundImage: gold, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            {overlay.text}
          </div>
          {overlay.subtitle && <div style={{ marginTop: 22, color: '#fff3d6', fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 34, lineHeight: 1.35 }}>{overlay.subtitle}</div>}
        </div>
      </AbsoluteFill>
    );
  }

  // lower-third
  const slide = (1 - inK) * -500;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', paddingBottom: 640, opacity: out }}>
      <div style={{ transform: `translateX(${slide}px)`, marginLeft: 60, display: 'flex', alignItems: 'stretch', gap: 0 }}>
        <div style={{ width: 14, background: '#ffd56b', borderRadius: 7 }} />
        <div style={{ padding: '18px 30px', background: 'rgba(12,8,24,0.72)', borderRadius: '0 18px 18px 0' }}>
          <div style={{ fontFamily: deva ? `"Yatra One", ${TEXT_FONT}` : TEXT_FONT, fontWeight: 800, fontSize: 58, color: '#fff' }}>{overlay.text}</div>
          {overlay.subtitle && <div style={{ fontFamily: TEXT_FONT, fontWeight: 500, fontSize: 32, color: '#ffe8a8', marginTop: 4 }}>{overlay.subtitle}</div>}
        </div>
      </div>
    </AbsoluteFill>
  );
};
