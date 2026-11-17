"""Lazy local TTS adapters. Heavy models are loaded once per prepare, never for uploads/motion."""
from pathlib import Path
import hashlib, inspect, json, os, re, subprocess, time

import numpy as np
import soundfile as sf

SR = 24000
ROOT = Path(__file__).resolve().parent
ANCHOR_TEXT = 'Our story begins with a bold plan, a missing receipt, and a king who should have known better.'


class InvalidAudio(ValueError):
    """An engine returned unusable speech, rather than invalid caller options."""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def file_hash(path):
    from tts_setup import sha256
    return sha256(path)


def mono(audio):
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim == 2: audio = audio.mean(axis=1)  # soundfile layout: samples, channels
    if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
        raise InvalidAudio('TTS returned empty, non-finite or incorrectly shaped audio.')
    if np.max(np.abs(audio)) < 1e-5: raise InvalidAudio('TTS returned silent audio.')
    return audio


def resample(audio, rate, ffmpeg):
    audio = mono(audio)
    if rate == SR: return audio
    result = subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'f32le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0',
                             '-f', 'f32le', '-ar', str(SR), '-ac', '1', 'pipe:1'],
                            input=audio.astype('<f4').tobytes(), capture_output=True, check=True)
    return mono(np.frombuffer(result.stdout, dtype='<f4').copy())


def finish(audio, rate, ffmpeg, trim, *, normalize):
    audio = trim(resample(audio, rate, ffmpeg))
    if normalize:
        active = np.abs(audio) > .012
        level = float(np.sqrt(np.mean(audio[active].astype(np.float64) ** 2))) if active.any() else 0
        audio *= min(.12 / max(level, 1e-9), .95 / float(np.max(np.abs(audio))))
    return audio


def seed(value):
    import torch
    torch.manual_seed(value)
    np.random.seed(value % (2 ** 32))
    if torch.cuda.is_available(): torch.cuda.manual_seed_all(value)


class LocalVoice:
    def __init__(self, voice, cfg, story_dir, out, ffmpeg, trim):
        self.voice = dict(voice or {}); self.engine = self.voice.get('engine', 'kokoro')
        if self.engine not in {'kokoro', 'zonos', 'dia'}:
            raise ValueError(f'Unknown voice.engine {self.engine!r}; use kokoro, zonos or dia.')
        allowed = ({'engine', 'name', 'speed', 'lang'} if self.engine == 'kokoro' else
                   {'engine', 'seed', 'reference', 'anchor_text', 'conditioning', 'generation', 'precision'} if self.engine == 'zonos' else
                   {'engine', 'seed', 'audio_prompt', 'anchor_text', 'speaker', 'generation', 'precision'})
        if extra := set(self.voice) - allowed: raise ValueError(f'Unsupported {self.engine} voice options: {sorted(extra)}')
        self.cfg = cfg; self.ffmpeg = ffmpeg; self.trim = trim; self.model = None
        self.story_dir = Path(story_dir); self.out = Path(out)
        self.seed = self.voice.get('seed', 217)
        if not isinstance(self.seed, int) or not 0 <= self.seed < 2 ** 32: raise ValueError('voice.seed must be an integer in 0..2^32-1.')
        self.settings = cfg.get('voiceEngines', {}).get(self.engine, {})
        self.device = self.settings.get('device', 'cpu')
        self.precision = self.voice.get('precision', 'float32' if self.device == 'cpu' else 'float16')
        if self.precision not in {'float32', 'float16', 'bfloat16', 'int8'}: raise ValueError('Invalid voice.precision.')
        if self.precision == 'int8' and self.device != 'cpu': raise ValueError('int8 is CPU-only.')
        if self.device == 'cpu' and self.precision == 'float16': raise ValueError('Use float32 or int8 on CPU.')
        self.anchor = None; self.anchor_text = None; self.speaker_embedding = None
        self.prompt_inputs = None
        self.last_clip_seed = None
        self.anchor_id = None
        self.identity = dict(engine=self.engine, options=self.voice, model=self.settings.get('fingerprint'),
                             device=self.device, precision=self.precision,
                             pipeline=digest([file_hash(__file__), inspect.getsource(trim)]))
        if self.engine == 'kokoro':
            self.name = self.voice.get('name', 'bm_george'); self.speed = float(self.voice.get('speed', 1.12))
            self.lang = self.voice.get('lang', 'en-gb' if self.name.startswith('b') else 'en-us')
            self.identity.update(name=self.name, speed=self.speed, lang=self.lang, model='kokoro-v1.0/voices-v1.0/kokoro-onnx-0.6.1')
        else:
            if not self.settings: raise ValueError(f'{self.engine} is not installed. Rerun setup.py <film> --tts {self.engine}.')
            self._anchor_spec()

    def _path(self, name):
        path = Path(name)
        path = path if path.is_absolute() else self.story_dir / path
        if not path.is_file(): raise ValueError(f'Voice reference clip not found: {path}')
        return path.resolve()

    def _anchor_spec(self):
        supplied = self.voice.get('reference') if self.engine == 'zonos' else self.voice.get('audio_prompt')
        if supplied:
            if self.engine == 'dia':
                if not isinstance(supplied, dict) or not supplied.get('path') or not supplied.get('transcript'):
                    raise ValueError('Dia audio_prompt needs {path, transcript}; the transcript must match the audio including [S1]/[S2] tags.')
                self.anchor_text = supplied['transcript'].strip()
                if not self.anchor_text.startswith('[S1]'): raise ValueError('Dia prompt transcript must start with [S1].')
                supplied = supplied['path']
            self.anchor = self._path(supplied)
            self.anchor_id = file_hash(self.anchor)
        else:
            self.anchor_text = self.voice.get('anchor_text', ANCHOR_TEXT)
            if self.engine == 'dia': self.anchor_text = '[S1] ' + self.anchor_text.removeprefix('[S1]').strip()
            key = digest([self.identity, self.anchor_text, 'fixed-anchor-v1'])[:24]
            folder = self.out / 'voice-anchors'; folder.mkdir(exist_ok=True)
            self.anchor = folder / f'{self.engine}-{key}.wav'
            self.anchor_id = key
        self.identity.update(anchor=self.anchor_id, anchorText=self.anchor_text)

    def _load(self):
        if self.model is not None: return
        started = time.perf_counter()
        if self.engine == 'kokoro':
            if 'voiceCache' not in self.cfg: raise ValueError('No Kokoro model configured. Run setup.py --tts kokoro, or pass --voice with a recording.')
            from kokoro_onnx import Kokoro
            self.model = Kokoro(str(Path(self.cfg['voiceCache']) / 'kokoro-v1.0.onnx'), str(Path(self.cfg['voiceCache']) / 'voices-v1.0.bin'))
        else:
            # No unpinned downloads during prepare, including hidden codec downloads.
            os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'
            import torch
            torch.set_num_threads(min(4, os.cpu_count() or 1))
            if self.device == 'cuda' and not torch.cuda.is_available():
                raise ValueError('Configured CUDA is unavailable; rerun setup --device cpu or repair the CUDA driver/runtime.')
            if self.device == 'cuda' and self.precision == 'bfloat16' and not torch.cuda.is_bf16_supported():
                raise ValueError('This GPU does not support bfloat16. Use precision: float16.')
            self.dtype = getattr(torch, self.precision if self.precision != 'int8' else 'float32')
            if self.engine == 'zonos': self._load_zonos()
            else: self._load_dia()
        print(f'{self.engine} loaded on {self.device} ({self.precision}) in {time.perf_counter() - started:.2f}s.', flush=True)

    def _codec(self):
        from transformers import DacModel
        return DacModel.from_pretrained(self.settings['models']['dac'], local_files_only=True).eval().to(self.device)

    def _load_zonos(self):
        import torch
        from tts_setup import configure_espeak
        configure_espeak(self.settings['espeakLibrary'])
        from zonos.model import Zonos
        from zonos.config import ZonosConfig
        from zonos.backbone import BACKBONES
        from safetensors.torch import load_file
        import zonos.autoencoder
        # Upstream hardcodes an unrevisioned codec download. Inject our pinned local instance.
        codec = self._codec()
        original = zonos.autoencoder.DacModel.from_pretrained
        zonos.autoencoder.DacModel.from_pretrained = lambda *a, **kw: codec
        try:
            folder = Path(self.settings['models']['zonos'])
            conf = ZonosConfig.from_dict(json.loads((folder / 'config.json').read_text()))
            # Meta construction avoids a second full 6.5 GB float32 allocation on a 16 GB machine.
            with torch.device('meta'): model = Zonos(conf, BACKBONES['torch'])
            state = load_file(str(folder / 'model.safetensors'))
            model.load_state_dict(state, assign=True, strict=True)
            self.model = model.to(self.device, self.dtype).eval().requires_grad_(False)
            del state  # release original half-precision mappings before CPU quantization
        finally: zonos.autoencoder.DacModel.from_pretrained = original
        self.model.autoencoder.dac = codec  # codec stays float32; it is not a model submodule
        original_cache = self.model.setup_cache
        self.model.setup_cache = lambda batch_size, max_seqlen, dtype=None: original_cache(batch_size, max_seqlen, self.dtype)
        if self.precision == 'int8':
            # Keep embeddings/conditioning in float32, quantize large linear layers only.
            self.model.backbone = torch.ao.quantization.quantize_dynamic(self.model.backbone, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)

    def _load_dia(self):
        import torch
        from transformers import DiaForConditionalGeneration, DiaProcessor, DiaTokenizer, DiaFeatureExtractor
        folder = self.settings['models']['dia']
        self.processor = DiaProcessor(DiaFeatureExtractor.from_pretrained(folder, local_files_only=True),
                                      DiaTokenizer.from_pretrained(folder, local_files_only=True), self._codec())
        self.model = DiaForConditionalGeneration.from_pretrained(folder, local_files_only=True, torch_dtype=self.dtype,
                                                                low_cpu_mem_usage=True, attn_implementation='sdpa').to(self.device).eval()
        if self.precision == 'int8':
            self.model = torch.ao.quantization.quantize_dynamic(self.model, {torch.nn.Linear}, dtype=torch.qint8, inplace=True)

    def _speaker(self):
        if self.speaker_embedding is not None: return
        import torch
        from zonos.speaker_cloning import SpeakerEmbeddingLDA
        import zonos.speaker_cloning as module
        folder = Path(self.settings['models']['speaker'])
        original = module.hf_hub_download
        module.hf_hub_download = lambda repo_id, filename, **kw: str(folder / filename)
        try: model = SpeakerEmbeddingLDA(device='cpu')
        finally: module.hf_hub_download = original
        audio, rate = sf.read(self.anchor, dtype='float32', always_2d=True)
        with torch.inference_mode(): _, embedding = model(torch.from_numpy(audio.mean(axis=1)[None]), rate)
        self.speaker_embedding = embedding.unsqueeze(0).to(self.device, self.dtype)

    def _generate(self, text, *, anchor=False, seed_offset=0):
        self._load()
        if self.engine == 'kokoro': return self.model.create(text, voice=self.name, speed=self.speed, lang=self.lang)
        import torch
        if self.engine == 'zonos' and not anchor: self._speaker()
        seed((self.seed + seed_offset) % (2 ** 32))  # independent of cache hits/order
        with torch.inference_mode():
            if self.engine == 'zonos':
                from zonos.conditioning import make_cond_dict
                options = dict(self.voice.get('conditioning') or {})
                if set(options) & {'text', 'speaker', 'device'}: raise ValueError('Use reference for Zonos speaker; text/device are managed by the kit.')
                cond = make_cond_dict(text=text, speaker=None if anchor else self.speaker_embedding, device=self.device, **options)
                cond = {k: v.to(dtype=self.dtype) if isinstance(v, torch.Tensor) and v.is_floating_point() else v for k,v in cond.items()}
                gen = dict(max_new_tokens=86 * 20, progress_bar=False, disable_torch_compile=True)
                gen.update(self.voice.get('generation') or {})
                if set(gen) - {'max_new_tokens', 'cfg_scale', 'sampling_params', 'progress_bar', 'disable_torch_compile'}:
                    raise ValueError('Unsupported Zonos generation options (see voice documentation).')
                codes = self.model.generate(self.model.prepare_conditioning(cond), **gen)
                if codes.shape[-1] >= gen['max_new_tokens'] - 10: raise ValueError('Zonos hit max_new_tokens; shorten the clause or increase the limit.')
                audio = self.model.autoencoder.decode(codes)[0, 0].cpu().float().numpy()
            else:
                text = self._dia_text(text)
                if anchor:
                    inputs = self.processor(text=text, return_tensors='pt')
                else:
                    prefix = self.anchor_text
                    if re.findall(r'\[S[12]\]', prefix)[-1] == re.findall(r'\[S[12]\]', text)[0]:
                        text = re.sub(r'^\[S[12]\]\s*', '', text)
                    if self.prompt_inputs is None:
                        prompt, rate = sf.read(self.anchor, dtype='float32', always_2d=True)
                        if rate != 44100: raise ValueError('Dia anchor must be resampled to 44100 Hz before generation.')
                        inputs = self.processor(text=prefix + ' ' + text, audio=prompt.mean(axis=1), sampling_rate=44100, return_tensors='pt')
                        self.prompt_inputs = {k: inputs[k].detach().cpu().clone() for k in ('decoder_input_ids', 'decoder_attention_mask')}
                    else:
                        inputs = self.processor(text=prefix + ' ' + text, return_tensors='pt')
                        inputs.update({k: v.clone() for k,v in self.prompt_inputs.items()})
                if inputs['input_ids'].shape[-1] > 1024: raise ValueError('Dia prompt plus clause exceeds 1024 text tokens; split the clause.')
                inputs = inputs.to(self.device)
                prompt_len = self.processor.get_audio_prompt_len(inputs['decoder_attention_mask'])
                gen = dict(max_new_tokens=1720, guidance_scale=3.0, temperature=1.8, top_p=.9, top_k=45, do_sample=True)
                gen.update(self.voice.get('generation') or {})
                if set(gen) - {'max_new_tokens', 'guidance_scale', 'temperature', 'top_p', 'top_k', 'do_sample'}:
                    raise ValueError('Unsupported Dia generation options (see voice documentation).')
                if gen['max_new_tokens'] + inputs['decoder_input_ids'].shape[1] > 3072:
                    raise ValueError('Dia prompt plus max_new_tokens exceeds its 3072 frame context; reduce the limit or shorten the prompt.')
                output = self.model.generate(**inputs, **gen)
                # HF strips the delay-mask tail before generation: prompt_len,
                # rather than the padded decoder input length, is the true prefix.
                if output.shape[1] - int(prompt_len) >= gen['max_new_tokens']:
                    raise ValueError('Dia hit max_new_tokens; shorten the clause or increase the limit within its context.')
                decoded = self.processor.batch_decode(output, audio_prompt_len=prompt_len)
                if not decoded: raise InvalidAudio('Dia returned no new audio after the fixed prompt.')
                audio = decoded[0].cpu().float().numpy()
        return mono(audio), 44100

    def _dia_text(self, text):
        if not text.lstrip().startswith(('[S1]', '[S2]')):
            speaker = self.voice.get('speaker', 'S1')
            if speaker not in {'S1', 'S2'}: raise ValueError('Dia speaker must be S1 or S2.')
            text = f'[{speaker}] {text}'
        tags = re.findall(r'\[S[12]\]', text)
        if any(a == b for a,b in zip(tags, tags[1:])): raise ValueError('Dia speaker tags must alternate within a clause.')
        if self.anchor_text and re.search(r'\[S2\]\s*\S', text) and '[S2]' not in self.anchor_text:
            raise ValueError('For a consistent second Dia speaker, supply an audio_prompt with both speakers and its transcript.')
        return text

    def ensure_anchor(self):
        if self.engine == 'kokoro': return
        if not self.anchor.exists():
            print(f'Generating fixed {self.engine} speaker anchor (once).', flush=True)
            audio, rate = self._generate(self.anchor_text, anchor=True)
            audio = mono(audio)
            temp = self.anchor.with_suffix('.tmp.wav'); sf.write(temp, audio, rate, subtype='FLOAT'); temp.replace(self.anchor)
        audio, rate = sf.read(self.anchor, dtype='float32', always_2d=True)
        mono(audio)
        duration = len(audio) / rate
        if not 3 <= duration <= 30: raise ValueError(f'Voice reference is {duration:.1f}s; use a clean 5–10s clip (3–30s allowed).')
        if self.engine == 'dia' and duration > 10: raise ValueError('Dia audio_prompt must be 3–10s to leave room for each clause.')
        if self.engine == 'dia' and rate != 44100:
            # Resample without modifying the user-owned reference.
            folder = self.out / 'voice-anchors'; folder.mkdir(exist_ok=True)
            dest = folder / f'dia-resampled-{file_hash(self.anchor)[:24]}.wav'
            if not dest.exists():
                subprocess.run([str(self.ffmpeg), '-v', 'error', '-y', '-i', str(self.anchor), '-ar', '44100', '-ac', '1', str(dest)], check=True)
            self.anchor = dest
        self.identity['anchorSha256'] = file_hash(self.anchor)
        folder = self.out / 'voice-anchors'; folder.mkdir(exist_ok=True)
        (folder / f'{self.engine}-anchor-{self.anchor_id[:24]}.json').write_text(
            json.dumps(dict(path=str(self.anchor), transcript=self.anchor_text, seed=self.seed, sha256=file_hash(self.anchor)), indent=2), encoding='utf8')

    def clip(self, text, cache):
        key = digest([self.identity, text])[:24]; file = cache / f'{self.engine}-{key}.wav'
        metadata = file.with_suffix('.json')
        spoken = re.sub(r'\[[^\]]*\]|\([^)]*\)', '', text)
        minimum = max(.12, len(re.findall(r"[\w']+", spoken)) / 12) if self.engine != 'kokoro' else 0
        if file.exists():
            audio, rate = sf.read(file, dtype='float32')
            if rate != SR or audio.ndim != 1: raise ValueError(f'Invalid cached voice format: {file}')
            if len(audio) / SR < minimum: raise InvalidAudio(f'Cached speech is implausibly short: {file}. Move it aside and prepare again.')
            self.last_clip_seed = json.loads(metadata.read_text(encoding='utf8')).get('seed') if metadata.exists() else None
            return mono(audio), True
        # Short generative utterances can end immediately at EOS (a 10 ms blip).
        # Keep the speaker anchor fixed, retry reproducibly, and never time a film
        # against missing speech. This is a plausibility gate, not transcription.
        attempts = 1 if self.engine == 'kokoro' else 3
        for attempt in range(attempts):
            try:
                audio, rate = self._generate(text, seed_offset=attempt)
                audio = finish(audio, rate, self.ffmpeg, self.trim, normalize=self.engine != 'kokoro')
                if len(audio) / SR < minimum:
                    raise InvalidAudio(f'{self.engine} returned {len(audio) / SR:.3f}s for {text!r}; expected at least {minimum:.2f}s.')
            except InvalidAudio as exc:
                if attempt == attempts - 1: raise InvalidAudio(f'{exc} All {attempts} deterministic attempts failed; rewrite/merge this clause or change the voice settings.') from exc
                print(f'Rejected speech: {exc} Retrying with the same anchor, seed {(self.seed + attempt + 1) % (2 ** 32)}.', flush=True)
                continue
            self.last_clip_seed = (self.seed + attempt) % (2 ** 32) if self.engine != 'kokoro' else None
            temp = file.with_suffix('.tmp.wav'); sf.write(temp, audio, SR, subtype='FLOAT'); temp.replace(file)
            if self.engine != 'kokoro':
                temp_meta = metadata.with_suffix('.tmp.json')
                temp_meta.write_text(json.dumps(dict(seed=self.last_clip_seed, attempts=attempt + 1)), encoding='utf8'); temp_meta.replace(metadata)
            return audio, False

    def info(self):
        if self.engine == 'kokoro':
            return {'engine': 'kokoro-onnx (local, free)', 'voice': self.name, 'speed': self.speed, 'lang': self.lang}
        return dict(engine=self.engine, local=True, device=self.device, precision=self.precision, seed=self.seed,
                    retryPolicy='Short/silent output: at most 3 attempts, base seed then +1/+2, fixed speaker anchor; per-clip seeds in voice-performance.json/cache metadata.',
                    modelFingerprint=self.settings['fingerprint'], options=self.voice,
                    anchor=str(self.anchor), anchorSha256=file_hash(self.anchor), anchorTranscript=self.anchor_text)
