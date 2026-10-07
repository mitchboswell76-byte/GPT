"""Build the game's recorded sounds from pinned public sources.

    python3 tools/audio/build_audio.py

Reads tools/audio/sources.json (one entry per output file: source repo, pinned
commit, path, optional time window, credit), downloads each source once into
tools/audio/.cache/, trims it to the event, matches loudness per group and
encodes mono MP3s into public/assets/audio/. Also writes
src/data/soundFiles.js (id -> files) and public/assets/audio/CREDITS.md.
Needs ffmpeg, curl and numpy.
"""
import json
import os
import subprocess
import sys
import urllib.parse

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'tools', 'audio', 'sources.json')
CACHE = os.environ.get('AUDIO_CACHE', os.path.join(ROOT, 'tools', 'audio', '.cache'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
SR = 44100

# hp: high-pass Hz; tail: dB below peak where the sound is cut; max: longest
# kept source duration (s); target: active RMS level (dBFS); dir: output folder
GROUPS = {
    'dog':      dict(hp=90, tail=-45, max=0.65, target=-15, dir='dog'),
    'dogfoley': dict(hp=80, tail=-45, max=0.8, target=-20, dir='dog'),
    'step':     dict(hp=70, tail=-50, max=0.45, target=-21, dir='steps'),
    'paw':      dict(hp=220, tail=-40, max=0.2, target=-27, dir='steps'),
    'pawwood':  dict(hp=350, tail=-40, max=0.15, target=-26, dir='steps'),
    'foley':    dict(hp=60, tail=-50, max=1.6, target=-18, dir='foley'),
    'long':     dict(hp=80, tail=None, max=2.0, target=-22, dir='foley'),
}


def fetch(src):
    url = 'https://raw.githubusercontent.com/{}/{}/{}'.format(src['repo'], src['ref'], urllib.parse.quote(src['path']))
    name = '{}_{}_{}'.format(src['repo'].replace('/', '_'), src['ref'][:10], src['path'].replace('/', '_'))
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        os.makedirs(CACHE, exist_ok=True)
        subprocess.run(['curl', '-sSfL', '-o', path + '.part', url], check=True)
        os.replace(path + '.part', path)
    return path


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def envelope(x, hop):
    n = max(1, len(x) // hop)
    return np.sqrt(np.mean(x[:n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-9


def highpass(x, hz):
    """Subtract a moving average: removes DC and rumble before measuring."""
    n = max(1, int(SR / hz))
    c = np.cumsum(np.concatenate([[0.0], x.astype(np.float64)]))
    avg = (c[n:] - c[:-n]) / n
    avg = np.concatenate([np.full(n // 2, avg[0]), avg, np.full(len(x) - len(avg) - n // 2, avg[-1])])
    return (x - avg).astype(np.float32)


def plan(x, item, g):
    """Return (start, duration, gain_db, fade_out) in source seconds."""
    x = highpass(x, g['hp'])
    w0, w1 = item.get('window') or [0, len(x) / SR]
    a = max(0, int((w0 - 0.03) * SR)); b = min(len(x), int((w1 + 0.03) * SR))
    seg = x[a:b]
    hop = int(0.005 * SR)
    env = envelope(seg, hop)
    pk = env.max()
    # never chase the tail below the recording's own noise floor
    wide = x[max(0, a - SR // 2):min(len(x), b + SR // 2)]
    floor = np.percentile(envelope(wide, hop), 10)
    if g['tail'] is None:
        s, e = int(w0 * SR) - a, min(len(seg), int(w1 * SR) - a)
    else:
        on = int(np.argmax(env > pk * 10 ** (-28 / 20)))
        s = max(0, (on - 2) * hop)
        thr = max(pk * 10 ** (g['tail'] / 20), floor * 2.5)
        last = len(env) - 1 - int(np.argmax(env[::-1] > thr))
        e = min(len(seg), (last + 6) * hop)
    e = min(e, s + int(g['max'] * SR))
    body = seg[s:e]
    benv = envelope(body, hop)
    active = benv[benv > benv.max() * 0.1]
    rms = np.sqrt(np.mean(active ** 2))
    gain = g['target'] - 20 * np.log10(rms)
    gain = min(gain, -1.0 - 20 * np.log10(np.abs(body).max() + 1e-9))
    dur = (e - s) / SR
    fade = 0.25 if g['tail'] is None else min(0.06, dur * 0.25)
    return (a + s) / SR, dur, gain, fade


def encode(src_path, out_path, start, dur, gain, fade, g, rate):
    chain = [f'highpass=f={g["hp"]}', 'afade=t=in:d=0.004', f'afade=t=out:st={max(0, dur - fade):.4f}:d={fade:.4f}',
             f'volume={gain:.2f}dB']
    if rate and rate != 1:
        chain += [f'asetrate={int(SR * rate)}', f'aresample={SR}']
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.4f}', '-t', f'{dur:.4f}', '-i', src_path,
                    '-af', ','.join(chain), '-ac', '1', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '96k',
                    out_path], check=True)


def main():
    items = json.load(open(SRC))['items']
    files, credits, count = {}, [], {}
    for it in items:
        g = GROUPS[it['group']]
        count[it['id']] = count.get(it['id'], 0) + 1
        rel = '{}/{}_{:02d}.mp3'.format(g['dir'], it['id'], count[it['id']])
        path = fetch(it['src'])
        x = decode(path)
        start, dur, gain, fade = plan(x, it, g)
        encode(path, os.path.join(OUT, rel), start, dur, gain, fade, g, it.get('rate'))
        files.setdefault(it['id'], []).append('assets/audio/' + rel)
        credits.append((rel, it))
        print(f'{rel:32s} {dur:5.2f}s {gain:+6.1f} dB  {it["credit"]["author"]}')
    with open(os.path.join(ROOT, 'src', 'data', 'soundFiles.js'), 'w') as f:
        f.write('// Generated by tools/audio/build_audio.py from tools/audio/sources.json. Do not edit.\n')
        f.write('export const SOUND_FILES = ' + json.dumps(files, indent=2) + ';\n')
    with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
        f.write('# Recorded sound credits\n\nGenerated by `tools/audio/build_audio.py`. Every file is a trimmed, '
                'level-matched excerpt of the recording listed. Paw sounds are footstep recordings shortened and '
                'pitched up.\n\n| File | Recording | Author | Licence | Via |\n|---|---|---|---|---|\n')
        for rel, it in credits:
            c = it['credit']
            rec = c.get('title', '')
            if c.get('original'):
                rec = f'[{rec or "source"}]({c["original"]})'
            src = 'https://github.com/{}/blob/{}/{}'.format(it['src']['repo'], it['src']['ref'], urllib.parse.quote(it['src']['path']))
            f.write(f'| `{rel}` | {rec} | {c["author"]} | {c["licence"]} | [{c["via"]}]({src}) |\n')
    print(len(credits), 'files')


if __name__ == '__main__':
    sys.exit(main())
