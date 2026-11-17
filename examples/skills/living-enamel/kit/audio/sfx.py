"""Export the bundled, measured foley library to work/sfx, entirely offline.

FLAC keeps the portable kit small; soundfile (already required) decodes it
losslessly. All design, onset trimming and headroom are baked into the assets.
Do not normalize effects here: the mixer owns their level under narration.
See assets/sfx/manifest.json for every variant's provenance and SHA-256.
"""
import hashlib
import re

from common import ROOT, WORK, SR, np, sf, read_json


def export():
    assets = ROOT / 'assets' / 'sfx'
    manifest = read_json(assets / 'manifest.json')
    if manifest['schema_version'] != 1 or manifest['sample_rate'] != SR:
        raise ValueError('Unsupported bundled sound library.')
    out = WORK / 'sfx'
    out.mkdir(exist_ok=True)
    variants = {}
    written = 0
    for effect in manifest['effects'] + manifest.get('ambiences', []):
        name, variant = effect['name'], effect['variant']
        kind = effect.get('kind', 'effect')
        key = (kind, name)
        if not re.fullmatch('[a-z]+', name) or variant != variants.get(key, 0) + 1:
            raise ValueError(f'Invalid name or noncontiguous variants: {name!r}')
        variants[key] = variant
        out = WORK / ('ambience' if kind == 'ambience' else 'sfx')
        out.mkdir(exist_ok=True)
        stem = name if variant == 1 else f'{name}-{variant}'
        if effect['file'] != stem + '.flac':
            raise ValueError(f'Unexpected asset filename: {effect["file"]!r}')
        source = assets / effect['file']
        if hashlib.sha256(source.read_bytes()).hexdigest() != effect['sha256']:
            raise ValueError(f'Bundled audio is damaged: {source}')
        dest = out / (stem + '.wav')
        # A rerun repairs edited/missing exports but leaves unrelated custom SFX.
        if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == effect['wav_sha256']:
            continue
        audio, rate = sf.read(source, dtype='float64')
        channels = 1 if audio.ndim == 1 else audio.shape[1]
        if (rate != SR or channels != effect['channels'] or channels not in (1, 2)
                or len(audio) != effect['frames'] or not np.isfinite(audio).all()
                or not audio.size or not 0 < np.max(np.abs(audio)) <= 10**(-3/20)):
            raise ValueError(f'Invalid bundled audio: {source}')
        # Atomic replacement avoids exposing a partially written WAV to the mixer.
        temp = out / (stem + '.wav.tmp')
        try:
            sf.write(temp, audio, SR, format='WAV', subtype='PCM_24')
            temp.replace(dest)
        finally:
            temp.unlink(missing_ok=True)
        written += 1
    print(f'sfx: {len(variants)} names, {sum(variants.values())} files '
          f'({written} exported); ' + ', '.join(f'{kind}:{name}' for kind, name in variants))


if __name__ == '__main__':
    export()
