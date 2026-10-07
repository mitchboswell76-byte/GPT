"""Generates tileable PBR-style textures for built structures.

Run: python3 tools/assets/gen_textures.py
Writes JPGs into public/assets/textures/. Deterministic (fixed seeds), so the
files can be regenerated or tweaked here rather than edited by hand.
"""
import os
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets', 'textures')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(11)


def spectral_noise(h, w, beta=2.0, ax=1.0, ay=1.0, seed=None):
    """Periodic (tileable) noise with 1/f^beta spectrum; ax/ay stretch it."""
    r = np.random.default_rng(seed) if seed is not None else rng
    white = r.standard_normal((h, w))
    fy = np.fft.fftfreq(h)[:, None] * ay
    fx = np.fft.fftfreq(w)[None, :] * ax
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1.0
    spec = np.fft.fft2(white) / f ** (beta / 2)
    spec[0, 0] = 0
    n = np.real(np.fft.ifft2(spec))
    n -= n.mean()
    n /= (np.abs(n).max() + 1e-9)
    return n


def normal_from_height(hgt, strength=4.0):
    gx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * strength
    gy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * strength
    n = np.dstack([-gx, gy, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)


def save(name, arr, q=90):
    Image.fromarray(arr).save(os.path.join(OUT, name), quality=q)


def to_rgb(base, var):
    return (np.clip(base[None, None, :] * var[..., None], 0, 255)).astype(np.uint8)


def planks(name, size=1024, boards=4, base=(118, 92, 66), weather=0.35, seed=1):
    """Horizontal timber boards with grain, end joints, gaps and weathering."""
    r = np.random.default_rng(seed)
    h = w = size
    grain = spectral_noise(h, w, beta=1.6, ax=0.06, ay=1.0, seed=seed)
    fine = spectral_noise(h, w, beta=1.0, ax=0.25, ay=1.0, seed=seed + 1)
    blotch = spectral_noise(h, w, beta=2.4, seed=seed + 2)
    height = np.zeros((h, w))
    col = np.zeros((h, w, 3))
    bh = h // boards
    y = np.arange(h)[:, None].repeat(w, 1)
    x = np.arange(w)[None, :].repeat(h, 0)
    for b in range(boards):
        y0 = b * bh
        tint = np.array(base) * (0.82 + 0.3 * r.random()) * np.array([1.0, 0.97 + 0.06 * r.random(), 0.95 + 0.08 * r.random()])
        joint = int(r.random() * w)
        sel = (y >= y0) & (y < y0 + bh)
        local = (y - y0) / bh
        # bevel at board edges
        bevel = np.clip(np.minimum(local, 1 - local) * 14, 0, 1)
        jd = np.minimum(np.abs(x - joint), w - np.abs(x - joint))
        jbevel = np.clip(jd / 5.0, 0, 1)
        hb = bevel * jbevel * (0.7 + 0.15 * grain + 0.05 * fine)
        height[sel] = hb[sel]
        shade = (0.78 + 0.2 * grain + 0.08 * fine + 0.12 * blotch)
        c = tint[None, None, :] * shade[..., None]
        grey = np.array([128, 124, 118])[None, None, :]
        wmix = np.clip(weather + 0.25 * blotch, 0, 0.8)[..., None]
        c = c * (1 - wmix) + grey * shade[..., None] * wmix
        c = c * (0.45 + 0.55 * (bevel * jbevel)[..., None])
        col[sel] = c[sel]
    save(f'{name}_color.jpg', col.clip(0, 255).astype(np.uint8))
    save(f'{name}_normal.jpg', normal_from_height(height, 3.0))
    rough = (200 + 40 * blotch - 20 * grain).clip(0, 255).astype(np.uint8)
    save(f'{name}_rough.jpg', np.dstack([rough] * 3))


def slate(name='slate', size=1024, rows=8, cols=6, seed=5):
    r = np.random.default_rng(seed)
    h = w = size
    n = spectral_noise(h, w, beta=2.2, seed=seed)
    fine = spectral_noise(h, w, beta=0.9, seed=seed + 3)
    col = np.zeros((h, w, 3)); height = np.zeros((h, w))
    rh = h // rows; cw = w // cols
    for i in range(rows):
        off = (cw // 2) * (i % 2)
        for j in range(cols + 1):
            x0 = j * cw - off
            tint = np.array([70, 74, 80]) * (0.8 + 0.35 * r.random())
            tint[2] *= 0.97 + 0.08 * r.random()
            ys = slice(i * rh, (i + 1) * rh)
            xs = np.arange(x0, x0 + cw) % w
            local_y = np.linspace(0, 1, rh)[:, None]
            local_x = np.linspace(0, 1, cw)[None, :]
            edge = np.clip(np.minimum(np.minimum(local_x, 1 - local_x) * 30, 1), 0, 1) * np.clip((1 - local_y) * 20, 0, 1)
            lip = 0.4 + 0.6 * local_y  # overlap: lower edge thicker
            hh = edge * lip
            height[ys][:, xs] = hh
            block = tint[None, None, :] * (0.85 + 0.25 * n[ys][:, xs] + 0.1 * fine[ys][:, xs])[..., None]
            block *= (0.5 + 0.5 * edge)[..., None]
            tmp = col[ys]; tmp[:, xs] = block; col[ys] = tmp
    save(f'{name}_color.jpg', col.clip(0, 255).astype(np.uint8))
    save(f'{name}_normal.jpg', normal_from_height(height * 0.9 + 0.08 * fine, 4.0))


def stone(name='stone', size=1024, seed=9):
    """Random-coursed rubble stone with mortar."""
    r = np.random.default_rng(seed)
    h = w = size
    pts = r.random((70, 2)) * size
    yy, xx = np.mgrid[0:h, 0:w]
    d1 = np.full((h, w), 1e9); d2 = np.full((h, w), 1e9); idx = np.zeros((h, w), int)
    for k, (py, px) in enumerate(pts):
        for oy in (-size, 0, size):
            for ox in (-size, 0, size):
                d = np.sqrt(((yy - py - oy) * 1.0) ** 2 + ((xx - px - ox) * 0.75) ** 2)
                closer = d < d1
                d2 = np.where(closer, d1, np.minimum(d2, d))
                idx = np.where(closer, k, idx)
                d1 = np.where(closer, d, d1)
    edge = np.clip((d2 - d1) / 10.0, 0, 1)
    n = spectral_noise(h, w, beta=2.0, seed=seed)
    tints = np.array([[150, 142, 128], [128, 124, 116], [160, 150, 132], [118, 112, 104], [140, 130, 112]])
    tint = tints[idx % len(tints)] * (0.85 + 0.3 * r.random((70,)))[idx][..., None]
    shade = (0.8 + 0.25 * n)[..., None]
    mortar = np.array([96, 92, 84])
    col = tint * shade * edge[..., None] ** 0.3 * (edge[..., None] > 0.05) + mortar * (edge[..., None] <= 0.05)
    hgt = np.sqrt(edge) * (0.8 + 0.2 * n)
    save(f'{name}_color.jpg', col.clip(0, 255).astype(np.uint8))
    save(f'{name}_normal.jpg', normal_from_height(hgt, 5.0))


def straw(name='straw', size=512, seed=13):
    r = np.random.default_rng(seed)
    h = w = size
    col = np.zeros((h, w, 3)); hgt = np.zeros((h, w))
    base = np.array([196, 160, 92])
    for _ in range(5000):
        x0, y0 = r.random() * w, r.random() * h
        ang = r.random() * np.pi; ln = 20 + r.random() * 60
        t = np.linspace(0, 1, int(ln))
        xs = ((x0 + np.cos(ang) * ln * t) % w).astype(int)
        ys = ((y0 + np.sin(ang) * ln * t) % h).astype(int)
        b = 0.6 + 0.5 * r.random()
        col[ys, xs] = base * b
        hgt[ys, xs] = b
    col[col.sum(2) == 0] = base * 0.35
    save(f'{name}_color.jpg', col.clip(0, 255).astype(np.uint8))
    save(f'{name}_normal.jpg', normal_from_height(hgt, 1.5))


def metal(name='galv', size=512, seed=17):
    n = spectral_noise(size, size, beta=1.2, seed=seed)
    blot = spectral_noise(size, size, beta=2.6, seed=seed + 1)
    v = 150 + 30 * n + 25 * blot
    col = np.dstack([v * 0.98, v, v * 1.02])
    save(f'{name}_color.jpg', col.clip(0, 255).astype(np.uint8))
    rough = (110 + 60 * blot + 30 * n).clip(0, 255).astype(np.uint8)
    save(f'{name}_rough.jpg', np.dstack([rough] * 3))


def soil(name='soil', size=512, seed=21):
    n = spectral_noise(size, size, beta=1.8, seed=seed)
    f = spectral_noise(size, size, beta=0.6, seed=seed + 1)
    v = 0.75 + 0.2 * n + 0.08 * f
    col = np.dstack([105 * v, 82 * v, 60 * v])
    save(f'{name}_color.jpg', col.clip(0, 255).astype(np.uint8))
    save(f'{name}_normal.jpg', normal_from_height(n * 0.6 + f * 0.4, 3.0))


if __name__ == '__main__':
    planks('planks', base=(124, 96, 68), weather=0.3, seed=1)
    planks('fence', size=512, boards=2, base=(132, 112, 88), weather=0.55, seed=4)
    slate()
    stone()
    straw()
    metal()
    soil()
    print('textures written to', os.path.abspath(OUT))
