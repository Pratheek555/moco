import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource/poppins/800.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import '@fontsource/yatra-one/400.css';
import { continueRender, delayRender, getRemotionEnvironment } from 'remotion';

export const TEXT_FONT = 'Poppins, "Noto Sans Devanagari", system-ui, sans-serif';
export const DISPLAY_FONT = 'Cinzel, Georgia, serif';

export const isDevanagari = (text: string) => /[ऀ-ॿ]/.test(text);

let loading: Promise<unknown> | null = null;

/** Make sure caption/title fonts are ready before frames are captured. */
export function ensureFonts() {
  if (loading || typeof document === 'undefined') return;
  const env = getRemotionEnvironment();
  const handle = env.isRendering ? delayRender('Loading fonts') : null;
  loading = Promise.all([
    document.fonts.load('800 64px Poppins'),
    document.fonts.load('600 64px Poppins'),
    document.fonts.load('800 64px Poppins', 'नमस्ते'),
    document.fonts.load('900 64px Cinzel'),
    document.fonts.load('700 64px Cinzel'),
    document.fonts.load('400 64px "Yatra One"', 'कर्म'),
  ])
    .catch(() => undefined)
    .finally(() => {
      if (handle !== null) continueRender(handle);
    });
}
