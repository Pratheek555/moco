from pathlib import Path
import soundfile as sf
from kokoro_onnx import Kokoro
root = Path(__file__).resolve().parent.parent
control = root / 'scripts/first-video-control'
tts = Kokoro(str(root / '.models/kokoro/kokoro-v1.0.onnx'), str(root / '.models/kokoro/voices-v1.0.bin'))
audio, rate = tts.create((control / 'script.txt').read_text(encoding='utf-8'), voice='am_michael', speed=1.4, lang='en-us')
sf.write(control / 'narration.wav', audio, rate)
print(f'{len(audio)/rate:.3f} seconds, {rate} Hz')

