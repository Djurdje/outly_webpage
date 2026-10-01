/* Web Worker za jsQR (M2, pregled PR #24): branje kode QR iz slike kamere ne blokira glavne niti.
   Sporocilo { id, data (ArrayBuffer RGBA, prenesen), w, h } -> odgovor { id, koda: niz | null }. Modulski delavec (CSP: worker-src 'self'). */
import jsQR from "/vendor/jsqr-1.4.0.mjs";

self.onmessage = e => {
  const { id, data, w, h } = e.data || {};
  let koda = null;
  try {
    const r = jsQR(new Uint8ClampedArray(data), w, h, { inversionAttempts: "dontInvert" });
    koda = r && typeof r.data === "string" && r.data ? r.data : null;
  } catch { koda = null; }
  self.postMessage({ id, koda });
};
