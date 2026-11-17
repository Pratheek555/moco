"""Copy a portable Living Enamel kit, make its environment and locate local tools."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, sys, urllib.request

MODEL_URLS = {
    'kokoro-v1.0.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx',
    'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
}

def run(args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, **kwargs)

def python_version(exe):
    try:
        result = run([exe, '-c', 'import json,sys;print(json.dumps(list(sys.version_info[:2])))'], capture_output=True, text=True)
        return tuple(json.loads(result.stdout))
    except (OSError, ValueError, subprocess.CalledProcessError):
        return ()

def choose_python(explicit):
    if explicit:
        if not (3, 11) <= python_version(explicit) < (3, 14):
            raise SystemExit('--python must be a Python 3.11–3.13 executable (3.11 recommended).')
        return explicit
    candidates = [sys.executable]
    uv = shutil.which('uv')
    if uv:
        for version in ('3.11', '3.12', '3.13'):
            result = subprocess.run([uv, 'python', 'find', version], capture_output=True, text=True)
            if result.returncode == 0: candidates.append(result.stdout.strip())
    for name in ('python3.11', 'python3.12', 'python3.13', 'python3'):
        if shutil.which(name): candidates.append(shutil.which(name))
    for exe in candidates:
        if (3, 11) <= python_version(exe) < (3, 14): return exe
    raise SystemExit('Install Python 3.11, or pass --python <compatible executable>. Existing environments are preserved.')

def copy_sources(source, target):
    for item in source.rglob('*'):
        relative = item.relative_to(source)
        if any(p.startswith('.') or p in {'__pycache__', 'work', 'out'} for p in relative.parts): continue
        if not item.is_file(): continue
        dest = target / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists(): shutil.copy2(item, dest)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target')
    parser.add_argument('--python', dest='python_exe')
    parser.add_argument('--models', help='Folder containing the two Kokoro model files')
    parser.add_argument('--no-tts', action='store_true', help='Install drawing/audio tooling without downloading voice weights')
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    target = Path(args.target).resolve()
    if target == source or source in target.parents:
        raise SystemExit('Choose a working directory outside the imported kit.')
    target.mkdir(parents=True, exist_ok=True)
    copy_sources(source, target)
    py = target / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not py.exists(): run([choose_python(args.python_exe), '-m', 'venv', target / '.venv'])
    if not (3, 11) <= python_version(py) < (3, 14):
        raise SystemExit('The preserved venv is incompatible; choose a fresh working folder with Python 3.11.')
    run([py, '-m', 'pip', 'install', '-r', target / 'requirements.txt'])
    binaries = {name: shutil.which(name) for name in ('ffmpeg', 'ffprobe')}
    if not all(binaries.values()):
        raise SystemExit('Install FFmpeg and ffprobe on PATH, then rerun setup. Windows: winget install Gyan.FFmpeg; macOS: brew install ffmpeg; Linux: apt install ffmpeg.')
    for exe in binaries.values(): run([exe, '-version'], capture_output=True)
    cfg_path = target / 'config.json'
    cfg = json.loads(cfg_path.read_text(encoding='utf-8-sig')) if cfg_path.exists() else {}
    cfg.update(binaries)
    cache = Path(os.environ.get('MOCO_VOICE_CACHE', str(Path.home() / '.cache' / 'moco-ink-history'))).resolve()
    if not args.no_tts:
        cache.mkdir(parents=True, exist_ok=True)
        manifest = []
        for name, url in MODEL_URLS.items():
            dest = cache / name
            if not dest.exists():
                temp = dest.with_suffix(dest.suffix + '.download')
                supplied = Path(args.models).resolve() / name if args.models else None
                if supplied and supplied.exists(): shutil.copy2(supplied, temp)
                else:
                    print(f'Downloading free Kokoro weight: {url}', flush=True)
                    urllib.request.urlretrieve(url, temp)
                if temp.stat().st_size < 1_000_000: raise SystemExit(f'Incomplete model download: {temp}')
                temp.replace(dest)
            if dest.stat().st_size < 1_000_000: raise SystemExit(f'Incomplete cached model: {dest}')
            digest = hashlib.sha256()
            with dest.open('rb') as file:
                for block in iter(lambda: file.read(4 * 1024 * 1024), b''): digest.update(block)
            manifest.append(f'{digest.hexdigest()}  {name}  {url}')
        (target / 'voice-models.txt').write_text('\n'.join(manifest) + '\n', encoding='utf-8')
    cfg['voiceCache'] = str(cache)
    cfg_path.write_text(json.dumps(cfg, indent=2), encoding='utf-8')
    (target / 'work').mkdir(exist_ok=True)
    (target / 'out').mkdir(exist_ok=True)
    run([py, '-c', 'import skia,numpy,cv2,PIL,numexpr,soundfile,kokoro_onnx;print("Imports OK")'], cwd=target)
    # Bundled recordings export locally: a new film needs no effects download.
    run([py, target / 'audio' / 'sfx.py'], cwd=target)
    print(f'READY\nPython: {py}\nWorking directory: {target}\nExample: example/story.py', flush=True)

if __name__ == '__main__': main()
