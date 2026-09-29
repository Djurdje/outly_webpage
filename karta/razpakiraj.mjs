// Razpakira .pmtiles v staticne ploscice {z}/{x}/{y}.pbf (Cloudflare Pages ne podpira HTTP Range).
import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import { PMTiles, Compression, TileType } from "pmtiles";
class Datoteka { constructor(p) { this.p = p; this.fd = fs.openSync(p, "r"); }
  getKey() { return this.p; }
  async getBytes(off, len) { const b = Buffer.alloc(len); fs.readSync(this.fd, b, 0, len, off); return { data: b.buffer.slice(b.byteOffset, b.byteOffset + len) }; } }
const [,, vhod, izhod, minz, maxz] = process.argv;
const a = new PMTiles(new Datoteka(vhod), undefined, async (buf) => buf);   // brez razsirjanja: ploscice ostanejo gzip
const h = await a.getHeader();
console.error("glava", { tip: h.tileType, stisk: h.tileCompression, minZ: h.minZoom, maxZ: h.maxZoom, meje: [h.minLon, h.minLat, h.maxLon, h.maxLat] });
const seznam = []; let bajti = 0;
const d2 = (lng, lat, z) => { const n = 2 ** z; return [Math.floor((lng + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
for (let z = Number(minz); z <= Number(maxz); z++) {
  const [x0, y0] = d2(h.minLon, h.maxLat, z), [x1, y1] = d2(h.maxLon, h.minLat, z);
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const r = await a.getZxy(z, x, y); if (!r || !r.data || !r.data.byteLength) continue;
    const b = Buffer.from(r.data);
    if (b[0] !== 0x1f || b[1] !== 0x8b) throw new Error("ploscica ni gzip " + z + "/" + x + "/" + y);

    fs.mkdirSync(path.join(izhod, String(z), String(x)), { recursive: true });
    fs.writeFileSync(path.join(izhod, String(z), String(x), y + ".pbf"), b);
    seznam.push(`${z}/${x}/${y}`); bajti += b.length;
  }
}
console.error(izhod, seznam.length, "ploscic", (bajti / 1e6).toFixed(1), "MB");
fs.writeFileSync(path.join(izhod, "seznam.json"), JSON.stringify(seznam));
