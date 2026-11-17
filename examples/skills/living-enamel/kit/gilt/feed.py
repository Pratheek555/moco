"""Phone typography and replay timing, in full-size screen pixels (not stage units).

Consolidates the three feed pilots' post-lighting hooks, measured capitals and
pair/triple captions. No proprietary font is copied into the kit.
"""
from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

SAFE = (54, 154, 950, 1536)  # 1080x1920: top 8%, bottom 20%, right 12%.
INK = '#102a3b'


@lru_cache(1)
def heavy_face():
    """Require an actual heavy sans; never silently substitute a thin serif."""
    win = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts'
    candidates = [win/'impact.ttf', win/'ariblk.ttf', win/'arialbd.ttf',
                  Path('/System/Library/Fonts/Supplemental/Arial Black.ttf'),
                  Path('/System/Library/Fonts/Supplemental/Impact.ttf'),
                  Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
                  Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'),
                  'Impact.ttf', 'Arial Black.ttf', 'DejaVuSans-Bold.ttf']
    for name in candidates:
        try:
            font = ImageFont.truetype(str(name), 100)
            family, style = font.getname()
            if 'impact' in family.lower() or any(w in (family+' '+style).lower()
                                                  for w in ('black', 'heavy', 'bold')):
                return str(name)
        except OSError:
            pass
    raise RuntimeError('Feed text needs a heavy sans-serif. Install Impact, Arial Black, '
                       'Arial Bold, DejaVu Sans Bold or Liberation Sans Bold, then retry. '
                       'No heavy face was found; Cinzel is intentionally not a fallback.')


@lru_cache(16)
def cap_font(cap_height=92):
    probe = ImageFont.truetype(heavy_face(), 100)
    box = probe.getbbox('H')
    size = round(cap_height * 100 / (box[3]-box[1]))
    return ImageFont.truetype(heavy_face(), size)


@lru_cache(256)
def line_tile(text, cap_height, fill, outline=10, width=864, stretch=False, highlight=None):
    """Fit horizontally only: a long line never loses its measured cap height."""
    font = cap_font(cap_height)
    box = font.getbbox(text, stroke_width=outline)
    tile = Image.new('RGBA', (box[2]-box[0]+4, box[3]-box[1]+4))
    draw = ImageDraw.Draw(tile)
    draw.text((2-box[0], 2-box[1]), text, font=font, fill=fill,
              stroke_width=outline, stroke_fill=INK)
    if highlight is not None:
        tokens = text.split()
        prefix = ' '.join(tokens[:highlight])+(' ' if highlight else '')
        draw.text((2-box[0]+font.getlength(prefix), 2-box[1]), tokens[highlight],
                  font=font, fill='#fff34c', stroke_width=outline, stroke_fill=INK)
    if stretch or tile.width > width:
        tile = tile.resize((round(width), tile.height), Image.Resampling.LANCZOS)
    return tile


def composite(rgb, overlays, fmt):
    if not overlays:
        return rgb
    image = Image.fromarray(rgb).convert('RGBA')
    for tile, x, y in overlays:
        if fmt.scale != 1:
            tile = tile.resize((max(1, round(tile.width*fmt.scale)),
                                max(1, round(tile.height*fmt.scale))), Image.Resampling.LANCZOS)
        image.alpha_composite(tile, (round(x*fmt.scale), round(y*fmt.scale)))
    return np.asarray(image.convert('RGB'))


@dataclass(frozen=True)
class Hook:
    """Two/three all-caps claim lines. Full on frame 0, gone after 2s, back at seam.

    Screen coordinates are independent of the shot camera and material light.
    This is for portrait feed cuts; landscape keeps its authored typography.
    """
    lines: tuple
    cap_height: int = 128
    width: int = 864
    top: int = 178
    hold: float = 2.0
    return_span: float = .3
    fill: str = '#fff34c'
    outline: int = 10

    def __post_init__(self):
        lines = tuple(s.strip().upper() for s in
                      (self.lines.split('\n') if isinstance(self.lines, str) else self.lines))
        object.__setattr__(self, 'lines', lines)
        if len(lines) not in (2, 3) or any(not s for s in lines):
            raise ValueError('Hook needs two or three nonempty lines.')
        if not 3 <= len(' '.join(lines).split()) <= 6:
            raise ValueError('Hook claim must contain 3–6 words.')
        if self.cap_height < 110 or not 1.8 <= self.hold <= 2.2 or self.return_span < 0:
            raise ValueError('Hook needs >=110px capitals, about 2s hold and nonnegative return_span.')
        for tile, x, y in self.overlays():
            if x < SAFE[0] or y < SAFE[1] or x+tile.width > SAFE[2] or y+tile.height > SAFE[3]:
                raise ValueError('Hook including outline must fit the portrait feed safe area.')

    def active(self, t, duration, fps=30):
        # Last ENCODED picture, not the unrendered t=duration boundary.
        last = (round(duration*fps)-1)/fps
        return 0 <= t < self.hold or (self.return_span > 0 and t >= last-self.return_span)

    def overlays(self):
        out, y = [], self.top
        for line in self.lines:
            tile = line_tile(line, self.cap_height, self.fill, self.outline, self.width, True)
            out.append((tile, round(496-self.width/2), y))
            y += tile.height + 8
        return out

    def rgba(self, fmt):
        """Expected screen overlay used to check the actual encoded hook pixels."""
        image = Image.new('RGBA', fmt.size)
        for tile, x, y in self.overlays():
            if fmt.scale != 1:
                tile = tile.resize((round(tile.width*fmt.scale), round(tile.height*fmt.scale)),
                                   Image.Resampling.LANCZOS)
            image.alpha_composite(tile, (round(x*fmt.scale), round(y*fmt.scale)))
        return np.asarray(image)


def loop_return(t, duration, span=.4, fps=30):
    """None until the return window; then opening-local time ending at exactly 0.

    Draw the opener with this time (also set p.time for its light). Animate the
    approach at negative time rather than clamping it into a still end hold.
    Return all geometry, clouds and light; Hook restores its own type globally.
    """
    if span <= 0 or fps <= 0 or duration*fps < 2:
        raise ValueError('Loop return needs positive span/fps and at least two frames.')
    last = (round(duration*fps)-1)/fps
    return t-last if t >= last-span else None


def _caption_lines(tokens, cap_height=92):
    font = cap_font(cap_height)
    if font.getlength(' '.join(tokens))+24 <= 864:
        return (' '.join(tokens),)
    if len(tokens) == 1:
        return (tokens[0],)  # Only this exceptional word condenses horizontally.
    split = min(range(1, len(tokens)), key=lambda k: max(
        font.getlength(' '.join(tokens[:k])), font.getlength(' '.join(tokens[k:]))))
    return (' '.join(tokens[:split]), ' '.join(tokens[split:]))


@lru_cache(128)
def caption_groups(tokens, cap_height=92, max_words=3):
    """Phrase-local groups; stack wide groups instead of shrinking them."""
    best = {len(tokens): (0., ())}
    for i in reversed(range(len(tokens))):
        choices = []
        for n in range(1, max_words+1):
            j = i+n
            if j not in best:
                continue
            lines = _caption_lines(tokens[i:j], cap_height)
            overflow = sum(max(0, cap_font(cap_height).getlength(s)-840)**2 for s in lines)
            cost = 10 + (100 if n == 1 and len(tokens) > 1 else 0) + 3*(len(lines)-1) + overflow
            choices.append((cost+best[j][0], ((i, j),)+best[j][1]))
        best[i] = min(choices, key=lambda v: v[0])
    return best[0][1]


def captions(p, ctx, t, profile='feed'):
    """Queue phone captions above bottom 20%, outside camera and lighting."""
    if getattr(p, 'hide_captions', False):
        return
    # Story type is 3.33% of 1920px high, centred near 70% of the frame.
    story = profile == 'story'
    cap_height, max_words = (64, 4) if story else (92, 3)
    for clause in reversed(ctx.clauses):
        words = clause.get('words', [])
        active = next((i for i in reversed(range(len(words)))
                       if words[i]['start'] <= t < words[i]['end']+.1), None)
        if active is None:
            continue
        tokens = tuple(w['w'].upper() for w in words)
        lo, hi = next((a, b) for a, b in caption_groups(tokens, cap_height, max_words) if a <= active < b)
        lines = _caption_lines(tokens[lo:hi], cap_height)
        tiles, offset = [], 0
        for s in lines:
            index = active-lo-offset
            tiles.append(line_tile(s, cap_height, '#ffffff', outline=7 if story else 10,
                                   highlight=index if not story and 0 <= index < len(s.split()) else None))
            offset += len(s.split())
        height = sum(tile.height for tile in tiles)+8*(len(tiles)-1)
        y = round(1344-height/2) if story else 1510-height
        for tile in tiles:
            p.screen_overlays.append((tile, round(496-tile.width/2), y))
            y += tile.height+8
        return
