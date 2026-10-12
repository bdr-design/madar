#!/usr/bin/env python3
"""Render the fresh natural map from the bundled Natural Earth II tiles.

The owner's map choice (Build 373): the natural relief with livelier colour and a
clear blue sea. Water is told from land by its blue cast, as in
render_dark_map_tiles.py; land keeps its relief with more saturation and a little
more light; the sea is pulled toward one clear blue. The colours are baked into
the tiles once, so the game draws them without any CSS filter. Requires Pillow and
NumPy. The output mirrors WebApp/assets/maps/ne2 tile for tile.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'WebApp/assets/maps/ne2'
TARGET = ROOT / 'WebApp/assets/maps/ne2-fresh'
SEA = np.array([0x4F, 0xA3, 0xD9], dtype=float)
SEA_WEIGHT, LAND_COLOUR, LAND_LIGHT, QUALITY = 0.65, 1.25, 1.06, 84


def render(src: Path, dst: Path) -> None:
    tile = Image.open(src).convert('RGB')
    rgb = np.asarray(tile, dtype=float)
    water = ((rgb[..., 2] - rgb[..., 0]) / 255 > 0.15).astype(np.uint8) * 255
    water = np.asarray(Image.fromarray(water).filter(ImageFilter.GaussianBlur(0.7)), dtype=float)[..., None] / 255
    land = np.asarray(ImageEnhance.Brightness(ImageEnhance.Color(tile).enhance(LAND_COLOUR)).enhance(LAND_LIGHT), dtype=float)
    sea = land * (1 - SEA_WEIGHT) + SEA * SEA_WEIGHT
    out = land * (1 - water) + sea * water
    dst.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, 'WEBP', quality=QUALITY, method=6)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--force', action='store_true', help='re-render tiles that already exist')
    args = parser.parse_args()
    tiles = sorted(SOURCE.rglob('*.webp'))
    for tile in tiles:
        out = TARGET / tile.relative_to(SOURCE)
        if out.exists() and not args.force:
            continue
        render(tile, out)
    (TARGET / 'SOURCE.txt').write_text('Rendered by tools/render_fresh_map_tiles.py from assets/maps/ne2.\n'
                                       'Made with Natural Earth. Natural Earth II is in the public domain.\n')
    manifest_path = ROOT / 'WebApp/runtime-required.json'
    manifest = json.loads(manifest_path.read_text())
    web = ROOT / 'WebApp'
    manifest['files'] = sorted(set(manifest['files']) | {str(f.relative_to(web)) for f in TARGET.rglob('*') if f.is_file()})
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(tiles)} tiles -> {TARGET.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
