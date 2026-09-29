/* Koda QR vstopnice. Vsebina je podpisan niz iz backenda (ticket.qr) - odjemalec ga samo narise,
   nikoli ga ne sestavlja. Popravljanje napak "M" kot na iOS. Izris kot SVG (<rect>), brez innerHTML. */
import { html, useMemo } from "./lib.js";
import qrcode from "/vendor/qrcode-generator-2.0.4.mjs";

export function KodaQR({ vsebina, velikost = 220, oznaka = "QR" }) {
  const moduli = useMemo(() => {
    if (!vsebina) return null;
    try {
      const q = qrcode(0, "M");
      q.addData(vsebina, "Byte");
      q.make();
      const n = q.getModuleCount();
      const polja = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.isDark(y, x)) polja.push([x, y]);
      return { n, polja };
    } catch { return null; }
  }, [vsebina]);
  if (!moduli) return html`<div class="qr qr-prazen" style=${{ width: velikost + "px", height: velikost + "px" }}>QR</div>`;
  const rob = 2, vse = moduli.n + rob * 2;
  return html`<div class="qr" style=${{ width: velikost + 24 + "px" }}>
    <svg viewBox=${`0 0 ${vse} ${vse}`} width=${velikost} height=${velikost} role="img" aria-label=${oznaka} shape-rendering="crispEdges">
      <rect width=${vse} height=${vse} fill="#fff" />
      <path fill="#000" d=${moduli.polja.map(([x, y]) => `M${x + rob} ${y + rob}h1v1h-1z`).join("")} />
    </svg>
  </div>`;
}
