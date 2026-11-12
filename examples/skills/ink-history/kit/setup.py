"""Make a resumable working copy of the free local ink-history v2 kit.
python <skill>/kit/setup.py <workspace>/film [--models <cached-model-folder>] [--no-tts]
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, sys, urllib.request, venv

MODEL_URLS = {
    'kokoro-v1.0.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx',
    'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
}
SOURCE_FILES = {'package.json', 'package-lock.json', 'requirements.txt', 'LICENSE.txt'}

def run(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)

def copy_sources(src, dest):
    # Machine paths, environments, movies and reviews are never portable. Preserve creative edits on resume.
    for f in src.iterdir():
        if f.is_file() and (f.suffix in {'.mjs', '.py'} or f.name in SOURCE_FILES):
            if not (dest / f.name).exists(): shutil.copy2(f, dest / f.name)
        elif f.name in {'example', 'assets'} and f.is_dir():
            for child in f.rglob('*'):
                if not child.is_file() or '__pycache__' in child.parts: continue
                target = dest / child.relative_to(src)
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists(): shutil.copy2(child, target)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('target')
    p.add_argument('--models', help='Directory containing the two already downloaded Kokoro model files')
    p.add_argument('--no-tts', action='store_true', help='Skip voice model download for an uploaded recording')
    a = p.parse_args()
    if sys.version_info < (3, 10): raise SystemExit('Install Python 3.10 or newer, then run setup again.')
    node = shutil.which('node'); npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not node or not npm: raise SystemExit('Install Node.js 22 or newer (with npm), then run setup again.')
    major = int(run([node, '-p', 'process.versions.node.split(".")[0]'], capture_output=True, text=True).stdout)
    if major < 22: raise SystemExit('Node.js 22 or newer is required.')
    src = Path(__file__).resolve().parent; dest = Path(a.target).resolve()
    if src == dest or src in dest.parents: raise SystemExit('Choose a working folder outside the imported kit.')
    dest.mkdir(parents=True, exist_ok=True); copy_sources(src, dest)
    py = dest / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not py.exists(): venv.EnvBuilder(with_pip=True).create(dest / '.venv')
    run([py, '-m', 'pip', 'install', '-r', dest / 'requirements.txt'])
    run([npm, 'install', '--no-audit', '--no-fund'], cwd=dest)
    ffmpeg, ffprobe = shutil.which('ffmpeg'), shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        run([npm, 'install', '--no-save', '--no-audit', '--no-fund', 'ffmpeg-static@5.2.0', 'ffprobe-static@3.1.0'], cwd=dest)
        paths = json.loads(run([node, '-e', "console.log(JSON.stringify({ffmpeg:require('ffmpeg-static'),ffprobe:require('ffprobe-static').path}))"], cwd=dest, capture_output=True, text=True).stdout)
        ffmpeg, ffprobe = ffmpeg or paths['ffmpeg'], ffprobe or paths['ffprobe']
    for binary in (ffmpeg, ffprobe):
        try: run([binary, '-version'], capture_output=True)
        except (OSError, subprocess.CalledProcessError):
            raise SystemExit('Install native FFmpeg and ffprobe for this platform, then rerun setup (brew install ffmpeg / apt install ffmpeg on macOS/Linux).')
    cfg = {'node': node, 'ffmpeg': ffmpeg, 'ffprobe': ffprobe}
    if not a.no_tts:
        cache = Path(os.environ.get('MOCO_VOICE_CACHE', str(Path.home() / '.cache' / 'moco-ink-history'))).resolve()
        cache.mkdir(parents=True, exist_ok=True)
        for name, url in MODEL_URLS.items():
            file = cache / name
            if not file.exists():
                supplied = Path(a.models).resolve() / name if a.models else None
                temp = cache / (name + '.download')
                if supplied and supplied.exists(): shutil.copy2(supplied, temp)
                else:
                    print(f'Downloading free local voice model: {name}', flush=True)
                    urllib.request.urlretrieve(url, temp)
                if temp.stat().st_size < 1_000_000: raise SystemExit(f'Incomplete model download: {temp}. Rerun setup.')
                temp.replace(file)
            if file.stat().st_size < 1_000_000: raise SystemExit(f'Incomplete cached model: {file}. Remove it and rerun setup.')
        cfg['voiceCache'] = str(cache)
        (dest / 'voice-models.txt').write_text('\n'.join(f'{hashlib.sha256((cache / n).read_bytes()).hexdigest()}  {n}' for n in MODEL_URLS), encoding='utf8')
    (dest / 'config.json').write_text(json.dumps(cfg, indent=2), encoding='utf8')
    run([node, dest / 'render.mjs', 'describe', dest / 'example' / 'story.mjs'], stdout=subprocess.DEVNULL)
    print(f'READY. Python: {py}\nKit: {dest}\nExample: {dest / "example" / "story.mjs"}', flush=True)
    print('Prepare example (PowerShell: prepend & before the quoted Python path):', flush=True)
    print(f'"{py}" "{dest / "film.py"}" prepare "{dest / "example" / "story.mjs"}" --out "{dest / "work"}"', flush=True)

if __name__ == '__main__': main()
