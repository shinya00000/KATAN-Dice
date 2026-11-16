# Usage: python3 scripts/paper-texture.py <out-dir>  (needs numpy and Pillow); paste each <name>.b64 into --grain / --fibre in src/style.css
# Pre-render the paper textures once, so the browser draws a bitmap instead of running feTurbulence on every paint.
import base64, io, sys
import numpy as np
from PIL import Image
rng = np.random.default_rng(20261116)
out = sys.argv[1]

def blur(a, r):
    # cheap separable box blur, wrapping so the tile stays seamless
    for ax in (0, 1):
        acc = np.zeros_like(a)
        for k in range(-r, r + 1):
            acc += np.roll(a, k, axis=ax)
        a = acc / (2 * r + 1)
    return a

def grain(rgb, opacity, size=180):
    n = rng.random((size, size)) * 0.7 + blur(rng.random((size, size)), 1) * 0.3   # fine, single-pixel noise
    n = (n - n.mean()) / n.std() * 0.1 + 0.5
    a = np.clip(9 * n - 5.4, 0, 1) * opacity              # the speck matrix, thresholded higher: sparse specks, not a haze
    return la(rgb, a)

def la(level, a, steps=6):
    # grey + alpha, alpha quantised to a few steps: invisible at these opacities, and it compresses well
    q = np.round(a / a.max() * steps) / steps * a.max() if a.max() > 0 else a
    img = np.zeros(a.shape + (2,), np.uint8)
    img[..., 0] = level
    img[..., 1] = np.round(q * 255).astype(np.uint8)
    return Image.fromarray(img, 'LA')

def fibre(size=420, opacity=0.1):
    base = rng.random((size // 6, size // 60 + 1))
    n = np.array(Image.fromarray((base * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC), float) / 255
    n = np.abs(n - 0.5) * 2                               # turbulence: ridges become long pale fibres
    a = np.clip(-1.6 * n + 0.75, 0, 1) * opacity
    return la(252, a)

tiles = {'grain-light': grain(36, 0.08, 128), 'grain-dark': grain(255, 0.06, 128), 'fibre': fibre(300)}
for name, im in tiles.items():
    buf = io.BytesIO(); im.save(buf, 'PNG', optimize=True)
    data = base64.b64encode(buf.getvalue()).decode()
    open(f'{out}/{name}.b64', 'w').write(data)
    im.save(f'{out}/{name}.png')
    print(name, im.size, len(buf.getvalue()), 'bytes')
