"""Make a resumable working copy of the free local ink-history v2 kit.
python <skill>/kit/setup.py <workspace>/film [--tts kokoro|zonos|dia|gemini|none] [--device auto|cpu|cuda]
"""
from pathlib import Path
import argparse, json, os, platform, shutil, subprocess, sys, urllib.request, venv

MODEL_URLS = {
    'kokoro-v1.0.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx',
    'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
}
SOURCE_FILES = {'package.json', 'package-lock.json', 'tts-models.json', 'LICENSE.txt'}

def run(args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)

def copy_sources(src, dest):
    # Machine paths, environments, movies and reviews are never portable. Preserve creative edits on resume.
    # Copy every Python kit source, including the mandatory liveness.py gate.
    for f in src.iterdir():
        if f.is_file() and (f.suffix in {'.mjs', '.py'} or f.name in SOURCE_FILES or f.name.startswith('requirements')):
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
    p.add_argument('--tts', choices=['kokoro', 'zonos', 'dia', 'gemini', 'none'], default=None, help='Narration engine (default: kokoro); Gemini uses your key without local weights')
    p.add_argument('--device', choices=['auto', 'cpu', 'cuda'], default='auto', help='Expressive engines: auto selects CUDA only with >=6 GB VRAM')
    p.add_argument('--espeak-library', help='Zonos: path to the native eSpeak NG shared library (otherwise located/bundled)')
    a = p.parse_args()
    if a.no_tts and a.tts not in (None, 'none'): p.error('--no-tts is an alias for --tts none; do not combine with another engine')
    engine = 'none' if a.no_tts else (a.tts or 'kokoro')
    if sys.version_info < (3, 10): raise SystemExit('Install Python 3.10 or newer, then run setup again.')
    if engine in {'zonos', 'dia'} and sys.version_info >= (3, 13):
        raise SystemExit('Pinned Zonos/Dia dependencies require Python 3.10–3.12. On Windows run with py -3.11 (or a Python 3.11 executable).')
    if engine in {'zonos', 'dia'} and sys.platform == 'darwin' and platform.machine() != 'arm64':
        raise SystemExit('Pinned torch 2.6 has no Intel macOS wheel. Use Kokoro/uploaded speech here, or install Zonos/Dia on Apple Silicon, Linux or Windows x64.')
    node = shutil.which('node'); npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not node or not npm: raise SystemExit('Install Node.js 22 or newer (with npm), then run setup again.')
    major = int(run([node, '-p', 'process.versions.node.split(".")[0]'], capture_output=True, text=True).stdout)
    if major < 22: raise SystemExit('Node.js 22 or newer is required.')
    src = Path(__file__).resolve().parent; dest = Path(a.target).resolve()
    if src == dest or src in dest.parents: raise SystemExit('Choose a working folder outside the imported kit.')
    dest.mkdir(parents=True, exist_ok=True); copy_sources(src, dest)
    if not (dest / 'liveness.py').is_file():
        raise SystemExit('The kit is incomplete: liveness.py (mandatory motion QA) is missing. Re-import the entire skill.')
    if engine in {'zonos', 'dia'} and 'from tts import LocalVoice' not in (dest / 'film.py').read_text(encoding='utf-8-sig'):
        raise SystemExit(f'This working copy has an older/custom film.py without engine dispatch. It was preserved. '
                         f'Review/merge the updated voice adapter from {src / "film.py"}, or create a fresh working copy '
                         'and bring your story/drawing modules across. No creative source was overwritten.')
    py = dest / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not py.exists(): venv.EnvBuilder(with_pip=True).create(dest / '.venv')
    if engine in {'zonos', 'dia'}:
        py_version = tuple(json.loads(run([py, '-c', 'import json,sys; print(json.dumps(list(sys.version_info[:2])))'], capture_output=True, text=True).stdout))
        if not (3, 10) <= py_version < (3, 13):
            raise SystemExit(f'The existing working venv uses Python {py_version[0]}.{py_version[1]}; these pins need 3.10–3.12. '
                             'Keep it intact and create a fresh working copy with Python 3.11, or back up/rename that venv before rerunning setup.')
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
    cfg_file = dest / 'config.json'
    cfg = json.loads(cfg_file.read_text(encoding='utf-8-sig')) if cfg_file.exists() else {}
    cfg.update(node=node, ffmpeg=ffmpeg, ffprobe=ffprobe)
    if engine not in {'none', 'gemini'}:
        import tts_setup
        device = tts_setup.hardware(a.device) if engine != 'kokoro' else 'cpu'
        tts_setup.install(py, engine, device)
        cache = Path(os.environ.get('MOCO_VOICE_CACHE', str(Path.home() / '.cache' / 'moco-ink-history'))).resolve()
        cache.mkdir(parents=True, exist_ok=True)
    if engine in {'zonos', 'dia'}:
        result_file = dest / f'tts-{engine}.json'
        env = dict(os.environ, MOCO_TTS_DEVICE=device, HF_HUB_DISABLE_XET='1', HF_HUB_DISABLE_SYMLINKS_WARNING='1')
        if a.espeak_library: env['MOCO_ESPEAK_LIBRARY'] = str(Path(a.espeak_library).resolve())
        run([py, dest / 'tts_setup.py', engine, cache, result_file], env=env)
        cfg.setdefault('voiceEngines', {})[engine] = json.loads(result_file.read_text(encoding='utf8'))
    if engine == 'kokoro':
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
        from tts_setup import sha256
        (dest / 'voice-models-kokoro.txt').write_text('\n'.join(f'{sha256(cache / n)}  {cache / n}' for n in MODEL_URLS), encoding='utf8')
    # Keep a combined manifest when adding an engine on resume.
    legacy = dest / 'voice-models.txt'; kokoro_manifest = dest / 'voice-models-kokoro.txt'
    if legacy.exists() and not kokoro_manifest.exists():
        lines = [line for line in legacy.read_text(encoding='utf8').splitlines()
                 if any(line.endswith(name) for name in MODEL_URLS)]
        if lines: kokoro_manifest.write_text('\n'.join(lines) + '\n', encoding='utf8')
    manifests = sorted(dest.glob('voice-models-*.txt'))
    if manifests: (dest / 'voice-models.txt').write_text('\n'.join(f.read_text(encoding='utf8').rstrip() for f in manifests) + '\n', encoding='utf8')
    temp_cfg = dest / f'.config-{os.getpid()}.json.tmp'
    temp_cfg.write_text(json.dumps(cfg, indent=2), encoding='utf8'); temp_cfg.replace(cfg_file)
    run([node, dest / 'render.mjs', 'describe', dest / 'example' / 'story.mjs'], stdout=subprocess.DEVNULL)
    print(f'READY. Python: {py}\nKit: {dest}\nExample: {dest / "example" / "story.mjs"}', flush=True)
    if engine in {'zonos', 'dia'}:
        print(f'Select the installed voice in your story: voice: {{ engine: "{engine}", seed: 217 }}.', flush=True)
        print('The worked example keeps its Kokoro voice. Choose the new engine in that story before preparing it, '
              'or add Kokoro with setup --tts kokoro to run the example unchanged.', flush=True)
    print('Prepare example (PowerShell: prepend & before the quoted Python path):', flush=True)
    print(f'"{py}" "{dest / "film.py"}" prepare "{dest / "example" / "story.mjs"}" --out "{dest / "work"}"', flush=True)
    print('Fast silent motion/event preflight (also works before prepare, using estimated timing; final encode QA is authoritative):', flush=True)
    print(f'"{py}" "{dest / "film.py"}" motion "{dest / "example" / "story.mjs"}" --out "{dest / "work"}"', flush=True)

if __name__ == '__main__': main()
