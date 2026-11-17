"""Pinned, opt-in local voice installation. No inference service or API is used."""
from pathlib import Path
import ctypes, ctypes.util, hashlib, json, os, shutil, subprocess, sys, threading, time, urllib.request, zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from importlib.metadata import version

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / 'tts-models.json').read_text(encoding='utf8'))


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def fetch_model(spec, name, folder):
    """Resumable public weight download, including on Windows without symlink/long-path support.

    Bounded ranges also avoid multi-GB transfers failing near EOF. The final
    SHA-256, not a successful HTTP request, decides whether a model is usable.
    """
    meta = spec['files'][name]; path = folder / name
    if path.exists(): return path
    url = f'https://huggingface.co/{spec["repo"]}/resolve/{spec["revision"]}/{name}'
    parts = folder / (name + '.parts'); parts.mkdir(exist_ok=True)
    chunk = 4 * 1024 * 1024
    # Adopt larger complete parts from an older setup without fetching them again.
    for old in list(parts.iterdir()):
        if old.name.isdigit() and old.stat().st_size > chunk:
            start = int(old.name); data = old.read_bytes()
            for offset in range(0, len(data), chunk):
                target = parts / str(start + offset)
                temp = target.with_suffix('.split'); temp.write_bytes(data[offset:offset + chunk]); temp.replace(target)
    ranges = [(start, min(start + chunk, meta['size']) - 1) for start in range(0, meta['size'], chunk)]
    connections = threading.local()
    def fetch(bounds):
        start, end = bounds; target = parts / str(start)
        if target.exists() and target.stat().st_size == end - start + 1: return target
        import requests
        if not hasattr(connections, 'session'):
            connections.session = requests.Session()
            connections.session.auth = lambda request: request  # public files; never consult .netrc credentials
        for attempt in range(3):
            try:
                # Keep TLS connections alive between ranges instead of repeating
                # handshakes for every part on slow Windows/network paths.
                with connections.session.get(url + f'?download=true&moco_range={start}-{end}&attempt={attempt}&t={int(time.time())}',
                                             headers={'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'}, timeout=(20,45), stream=True) as response:
                    response.raise_for_status()
                    content_range = response.headers.get('Content-Range', '')
                    if len(ranges) > 1 and not content_range.startswith(f'bytes {start}-{end}/'):
                        raise ValueError(f'Server did not honor model byte range: {name} {start}-{end}')
                    blocks = []; size = 0
                    for block in response.iter_content(chunk_size=1024 * 1024):
                        size += len(block)
                        if size > end - start + 1: raise ValueError(f'Oversized model range: {name}')
                        blocks.append(block)
                    data = b''.join(blocks)
                if len(data) != end - start + 1: raise ValueError(f'Incomplete model range: {name} {start}-{end}')
                temp = target.with_suffix('.tmp'); temp.write_bytes(data); temp.replace(target)
                return target
            except (OSError, ValueError) as exc:
                if isinstance(exc, requests.HTTPError) and exc.response.status_code < 500 and exc.response.status_code != 429: raise
                if attempt == 2: raise
                delay = 5 * (attempt + 1)
                print(f'  Retry {name} bytes {start}-{end} in {delay}s: {exc}', flush=True)
                time.sleep(delay)
    print(f'Fetching {spec["repo"]}/{name} ({meta["size"] / 1e6:.1f} MB), resuming verified-length parts.', flush=True)
    jobs = int(os.environ.get('MOCO_TTS_DOWNLOAD_JOBS', '4'))
    if not 1 <= jobs <= 16: raise ValueError('MOCO_TTS_DOWNLOAD_JOBS must be 1..16.')
    pool = ThreadPoolExecutor(max_workers=jobs)
    futures = [pool.submit(fetch, bounds) for bounds in ranges]
    try:
        for i, future in enumerate(as_completed(futures)):
            future.result()
            if (i + 1) % 16 == 0: print(f'  {name}: {i + 1}/{len(ranges)} parts', flush=True)
    finally:
        # A failed part must not leave hundreds of queued requests running.
        pool.shutdown(wait=True, cancel_futures=True)
    temp = path.with_suffix(path.suffix + '.download')
    with temp.open('wb') as output:
        for start, _ in ranges:
            with (parts / str(start)).open('rb') as source:
                while block := source.read(4 * 1024 * 1024): output.write(block)
    if sha256(temp) != meta['sha256']:
        raise SystemExit(f'Model checksum mismatch: {temp}. Move it and {parts} aside, then rerun setup.')
    temp.replace(path)
    for start, _ in ranges: (parts / str(start)).unlink()
    try: parts.rmdir()
    except OSError: pass  # A leftover interrupted .tmp file is harmless; never delete unknown files.
    return path


def hardware(request='auto'):
    """Probe before installing torch, so a small GPU doesn't force a multi-GB CUDA install."""
    gpu = None
    try:
        line = subprocess.check_output(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], text=True).splitlines()[0]
        name, memory = line.rsplit(',', 1)
        gpu = dict(name=name.strip(), memoryMiB=int(memory.strip()))
    except (OSError, subprocess.SubprocessError, ValueError, IndexError): pass
    capable = gpu is not None and gpu['memoryMiB'] >= 6000
    if request == 'cuda' and not capable:
        raise SystemExit(f'CUDA narration requires an NVIDIA GPU with at least 6 GB VRAM; detected {gpu}. Use --device cpu (very slow).')
    device = 'cuda' if request == 'cuda' or (request == 'auto' and capable) else 'cpu'
    print(f'Voice hardware: {gpu or "no NVIDIA CUDA GPU"}; selected {device}.', flush=True)
    if device == 'cpu':
        print('WARNING: Zonos/Dia on CPU can be impractically slow for 12–18 minute narration. Audition short clauses first. Apple Silicon also uses CPU in this pinned kit.', flush=True)
    return device


def locate_espeak(explicit=None):
    """Prefer a supplied/native shared library; the pinned loader bundles one on Windows."""
    candidates = [explicit, os.environ.get('PHONEMIZER_ESPEAK_LIBRARY'), ctypes.util.find_library('espeak-ng')]
    for base in (os.environ.get('ProgramFiles', ''), os.environ.get('ProgramFiles(x86)', '')):
        if base: candidates.append(str(Path(base) / 'eSpeak NG' / 'libespeak-ng.dll'))
    candidates += ['/opt/homebrew/lib/libespeak-ng.dylib', '/usr/local/lib/libespeak-ng.dylib']
    for candidate in candidates:
        if candidate:
            try:
                ctypes.CDLL(candidate)
                return str(candidate)
            except OSError: pass
    try:
        import espeakng_loader
        return str(espeakng_loader.get_library_path())
    except (ImportError, OSError, RuntimeError):
        raise SystemExit('eSpeak NG shared library not found. Set PHONEMIZER_ESPEAK_LIBRARY or --espeak-library to libespeak-ng.dll/.so/.dylib. Windows: install 64-bit eSpeak NG; macOS: brew install espeak-ng; Linux: apt install espeak-ng libespeak-ng1.')


def configure_espeak(library):
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    EspeakWrapper.set_library(library)
    data = Path(library).parent / 'espeak-ng-data'
    if data.is_dir(): EspeakWrapper.set_data_path(str(data))


def install(py, engine, device):
    def pip(*args):
        uv = shutil.which('uv')
        command = [uv, 'pip', 'install', '--python', str(py)] if uv else [str(py), '-m', 'pip', 'install']
        subprocess.run([*command, *map(str, args)], check=True)
    if engine in {'zonos', 'dia'}:
        # Exact wheel versions; no FlashAttention, Triton, CUDA toolkit or source build.
        index = 'https://download.pytorch.org/whl/' + ('cu124' if device == 'cuda' else 'cpu')
        if sys.platform == 'darwin': pip('torch==2.6.0', 'torchaudio==2.6.0')
        else:
            build = '+cu124' if device == 'cuda' else '+cpu'
            pip('torch==2.6.0' + build, 'torchaudio==2.6.0' + build, '--index-url', index)
        pip('-r', ROOT / ('requirements-zonos.txt' if engine == 'zonos' else 'requirements-expressive.txt'))
    else:
        pip('-r', ROOT / 'requirements-kokoro.txt')


def download(engine, cache, *, espeak_library=None):
    """Run in the working venv. Downloads resume partial files; verify every locked byte."""
    models = {}; records = []
    for key in (['zonos', 'speaker', 'dac'] if engine == 'zonos' else ['dia', 'dac']):
        spec = LOCK[key]; folder = cache / key / spec['revision']; folder.mkdir(parents=True, exist_ok=True)
        for name, meta in spec['files'].items():
            path = folder / name
            if path.exists() and sha256(path) != meta['sha256']:
                raise SystemExit(f'Cached model checksum mismatch: {path}. Move the corrupt file aside and rerun setup.')
            if not path.exists():
                print(f'Downloading pinned free {spec["repo"]}: {name}', flush=True)
                path = fetch_model(spec, name, folder)
            if path.stat().st_size != meta['size'] or sha256(path) != meta['sha256']:
                raise SystemExit(f'Model checksum mismatch: {path}. Setup did not enable this engine.')
            records.append(f'{meta["sha256"]}  {path}')
        models[key] = str(folder)
    result = dict(device=os.environ['MOCO_TTS_DEVICE'], models=models,
                  fingerprint=hashlib.sha256(json.dumps({k: LOCK[k] for k in models}, sort_keys=True).encode()).hexdigest())
    if engine == 'zonos':
        spec = LOCK['zonos']['code']; archive = cache / f'zonos-{spec["revision"]}.zip'
        if not archive.exists():
            temp = archive.with_suffix('.download'); urllib.request.urlretrieve(spec['url'], temp); temp.replace(archive)
        if sha256(archive) != spec['sha256']: raise SystemExit(f'Zonos source checksum mismatch: {archive}')
        source = cache / f'Zonos-{spec["revision"]}'
        if not source.exists():
            with zipfile.ZipFile(archive) as z:
                for member in z.namelist():
                    if not (cache / member).resolve().is_relative_to(cache.resolve()): raise SystemExit('Unsafe source archive')
                z.extractall(cache)
        # Upstream eagerly downloads/loads the full Japanese dictionary even for
        # English. Defer it until Japanese text is actually requested. Keep this
        # tiny, explicitly recorded compatibility edit separate from the pinned archive.
        conditioning = source / 'zonos' / 'conditioning.py'
        code = conditioning.read_text(encoding='utf8')
        old = 'def normalize_jp_text(text: str, tokenizer=Dictionary(dict="full").create()) -> str:\n'
        new = ('# Modified by Moco: load the optional Japanese dictionary only for Japanese text.\n'
               'def normalize_jp_text(text: str, tokenizer=None) -> str:\n'
               '    if tokenizer is None:\n'
               '        tokenizer = Dictionary(dict="full").create()\n')
        if old in code: conditioning.write_text(code.replace(old, new), encoding='utf8')
        elif new not in code: raise SystemExit(f'Unexpected Zonos source: {conditioning}; compatibility edit was not applied.')
        records.append(f'{sha256(conditioning)}  {conditioning}  # Moco lazy Japanese dictionary compatibility edit')
        # Editable installation preserves upstream's backbone subpackage (its wheel finder omits it).
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-deps', '--no-build-isolation', '-e', str(source)], check=True)
        # The current setup process started before pip created the editable .pth.
        # Fresh prepare processes discover it normally on interpreter startup.
        sys.path.insert(0, str(source))
        result['espeakLibrary'] = locate_espeak(espeak_library)
        records.append(f'{spec["sha256"]}  {archive}')
        configure_espeak(result['espeakLibrary'])
        from zonos.model import Zonos
    else:
        from transformers import DiaForConditionalGeneration, DiaProcessor
    import torch, torchaudio
    if result['device'] == 'cuda' and not torch.cuda.is_available():
        raise SystemExit('Installed torch cannot use CUDA. Check the driver, or rerun setup --device cpu.')
    result['torch'] = torch.__version__
    packages = ['torch', 'torchaudio', 'transformers', 'huggingface-hub', 'safetensors',
                'accelerate', 'tokenizers', 'numpy', 'soundfile', 'requests']
    if engine == 'zonos': packages += ['zonos', 'phonemizer', 'espeakng-loader', 'SudachiPy', 'inflect', 'kanjize']
    result['packages'] = {name: version(name) for name in packages}
    result['fingerprint'] = hashlib.sha256(json.dumps(dict(models={k: LOCK[k] for k in models},
                                                          packages=result['packages'],
                                                          compatibility='lazy-japanese-v1'), sort_keys=True).encode()).hexdigest()
    (ROOT / f'voice-models-{engine}.txt').write_text('\n'.join(records) + '\n', encoding='utf8')
    return result


if __name__ == '__main__':
    engine, cache, output = sys.argv[1:4]
    result = download(engine, Path(cache), espeak_library=os.environ.get('MOCO_ESPEAK_LIBRARY'))
    Path(output).write_text(json.dumps(result, indent=2), encoding='utf8')
