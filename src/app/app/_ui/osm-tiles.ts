/**
 * OSM raster karo dizici + Web Mercator projeksiyonu (bağımlılıksız, API anahtarsız). Bölge analizi haritası kullanır;
 * portföy haritası (portfoyler/map-view.tsx) aynı formülü kendi içinde taşır.
 */
export const TILE = 256;

export function lngToX(lng: number) {
  return (lng + 180) / 360;
}

export function latToY(lat: number) {
  const r = (lat * Math.PI) / 180;
  return Math.min(1, Math.max(0, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2));
}

export type Tile = { key: string; src: string; left: number; top: number };

/** Görünür karolar: merkez (0..1 dünya koordinatı), yakınlık, kutu boyu. */
export function visibleTiles(center: { x: number; y: number }, zoom: number, width: number, height: number): {
  tiles: Tile[];
  originX: number;
  originY: number;
  scale: number;
} {
  const scale = TILE * 2 ** zoom;
  const n = 2 ** zoom;
  const originX = center.x * scale - width / 2;
  const originY = center.y * scale - height / 2;
  const tiles: Tile[] = [];
  if (width > 0) {
    const tx0 = Math.floor(originX / TILE);
    const tx1 = Math.floor((originX + width) / TILE);
    const ty0 = Math.max(0, Math.floor(originY / TILE));
    const ty1 = Math.min(n - 1, Math.floor((originY + height) / TILE));
    for (let tx = tx0; tx <= tx1; tx += 1) {
      const wrapX = ((tx % n) + n) % n;
      for (let ty = ty0; ty <= ty1; ty += 1) {
        tiles.push({
          key: `${zoom}/${tx}/${ty}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrapX}/${ty}.png`,
          left: tx * TILE - originX,
          top: ty * TILE - originY,
        });
      }
    }
  }
  return { tiles, originX, originY, scale };
}

/** Noktaları kutuya sığdıran en büyük yakınlık (kenar boşluklarıyla). */
export function fitZoom(xs: number[], ys: number[], width: number, height: number, pad = 90, min = 4, max = 13): number {
  let z = max;
  while (z > min) {
    const scale = TILE * 2 ** z;
    if ((Math.max(...xs) - Math.min(...xs)) * scale <= width - pad && (Math.max(...ys) - Math.min(...ys)) * scale <= height - pad) break;
    z -= 1;
  }
  return z;
}
