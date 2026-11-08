/* Urejevalnik izreza bannerja dogodka (outly-backend#400): ob izbiri datoteke se slika NE naloži; odpre se okvir s fiksnim
   razmerjem (velik 4:5, majhen 3:4), v katerem uporabnik sliko premakne in poveča. "Use" naredi izrez lokalno (canvas, brez
   EXIF/GPS, širina največ 1080 px, manjših slik ne povečuje) in ga preda obstoječi poti nalaganja. Brez knjižnic.
   Okno in predogled rišeta isti izrez iz istega bitmapa, zato je predogled to, kar bo naloženo. */
import { html, useEffect, useRef, useState } from "../lib.js";
import { t } from "../i18n.js";
import { izrezSlike } from "../api.js";
import { sporocilo } from "../napake.js";

export const RAZMERJE = { velik: [4, 5], majhen: [3, 4] };
const NAJVEC_ZOOM = 4;
const omeji = (x, a, b) => Math.min(b, Math.max(a, x));

/** Pravokotnik izvorne slike, ki ga kaže okvir: pri zoom 1 največji izrez z danim razmerjem, ki še gre v sliko; sredina (cx, cy) je omejena na sliko. */
export function pravokotnik(sirina, visina, razmerje, zoom, cx, cy) {
  const a = razmerje[0] / razmerje[1];
  const sw = Math.min(sirina, visina * a) / zoom, sh = sw / a;
  return { sx: omeji(cx - sw / 2, 0, sirina - sw), sy: omeji(cy - sh / 2, 0, visina - sh), sw, sh };
}

function narisi(platno, bitmap, r) {
  if (!platno || !bitmap) return;
  const g = platno.getContext("2d");
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.fillStyle = "#fff"; g.fillRect(0, 0, platno.width, platno.height);
  g.drawImage(bitmap, r.sx, r.sy, r.sw, r.sh, 0, 0, platno.width, platno.height);
}

/** Vsebina lista: <List> je v klicatelju (Escape, fokus, inert). `ob Uporabi(blob)` dobi izrezan JPEG. */
export function UrejevalnikIzreza({ datoteka, vrsta, obUporabi, obPreklic, obDelam = () => {} }) {
  const razmerje = RAZMERJE[vrsta];
  const [W, H] = [480, Math.round(480 * razmerje[1] / razmerje[0])];
  const [bitmap, setBitmap] = useState(null);
  const [napaka, setNapaka] = useState("");
  const [poz, setPoz] = useState({ zoom: 1, cx: 0, cy: 0 });
  const [delam, setDelam] = useState(false);
  const okvir = useRef(null), glavno = useRef(null), predogled = useRef(null);
  const kazalci = useRef(new Map());

  useEffect(() => {
    let konec = false, b = null;
    createImageBitmap(datoteka).then(x => {
      if (konec) { x.close && x.close(); return; }
      b = x; setBitmap(x); setPoz({ zoom: 1, cx: x.width / 2, cy: x.height / 2 });
    }).catch(() => { if (!konec) setNapaka(t("This image could not be prepared for upload. Please choose a JPEG or PNG photo.")); });
    return () => { konec = true; b && b.close && b.close(); };
  }, [datoteka]);

  const r = bitmap ? pravokotnik(bitmap.width, bitmap.height, razmerje, poz.zoom, poz.cx, poz.cy) : null;
  useEffect(() => { if (r) { narisi(glavno.current, bitmap, r); narisi(predogled.current, bitmap, r); } });

  // Spremeni zoom (sredina izreza ostane) ali premakne sredino za (dx, dy) v pikslih izvorne slike.
  const zoomaj = f => setPoz(p => ({ ...p, zoom: omeji(p.zoom * f, 1, NAJVEC_ZOOM) }));
  const premakni = (dx, dy) => setPoz(p => {
    const q = pravokotnik(bitmap.width, bitmap.height, razmerje, p.zoom, p.cx, p.cy);
    return { ...p, cx: omeji(q.sx + q.sw / 2 + dx, q.sw / 2, bitmap.width - q.sw / 2), cy: omeji(q.sy + q.sh / 2 + dy, q.sh / 2, bitmap.height - q.sh / 2) };
  });
  const cssSirina = () => (okvir.current ? okvir.current.getBoundingClientRect().width : W) || W;

  const dol = e => {
    if (!bitmap) return;
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    kazalci.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const gor = e => { kazalci.current.delete(e.pointerId); };
  const premik = e => {
    const m = kazalci.current, prej = m.get(e.pointerId);
    if (!prej || !bitmap) return;
    const zdaj = { x: e.clientX, y: e.clientY };
    if (m.size === 1) {
      const k = r.sw / cssSirina();   // piksli izvorne slike na CSS piksel okvirja
      premakni(-(zdaj.x - prej.x) * k, -(zdaj.y - prej.y) * k);
    } else if (m.size === 2) {
      const drugi = [...m.entries()].find(([id]) => id !== e.pointerId)[1];
      const staro = Math.hypot(prej.x - drugi.x, prej.y - drugi.y), novo = Math.hypot(zdaj.x - drugi.x, zdaj.y - drugi.y);
      if (staro > 0 && novo > 0) zoomaj(novo / staro);
    }
    m.set(e.pointerId, zdaj);
  };
  const tipka = e => {
    if (!bitmap) return;
    const korak = r.sw * 0.05;
    const ukaz = { ArrowLeft: () => premakni(-korak, 0), ArrowRight: () => premakni(korak, 0), ArrowUp: () => premakni(0, -korak), ArrowDown: () => premakni(0, korak),
      "+": () => zoomaj(1.1), "=": () => zoomaj(1.1), "-": () => zoomaj(1 / 1.1), "_": () => zoomaj(1 / 1.1) }[e.key];
    if (ukaz) { e.preventDefault(); ukaz(); }
  };
  // Kolesce na okvirju: povecava (poslusalec brez passive, da se stran ne premakne).
  useEffect(() => {
    const el = okvir.current;
    if (!el) return;
    const kolesce = e => { e.preventDefault(); zoomaj(Math.exp(-e.deltaY * 0.0015)); };
    el.addEventListener("wheel", kolesce, { passive: false });
    return () => el.removeEventListener("wheel", kolesce);
  }, [bitmap]);

  async function uporabi() {
    if (!r || delam) return;
    setDelam(true); obDelam(true); setNapaka("");   // list se med izrezom in nalaganjem ne da zapreti
    try { await obUporabi(await izrezSlike(bitmap, r, razmerje, 1080)); }
    catch (e) { setNapaka(sporocilo(e)); setDelam(false); obDelam(false); }
  }

  const veliki = vrsta === "velik";
  return html`<div class="izrez">
    <div class="izrez-vrsta">
      <div class="izrez-stolpec">
        <div class="izrez-okvir" ref=${okvir} role="group" tabindex=${bitmap ? 0 : -1} aria-label=${t("Crop area")} aria-describedby="izrez-pomoc"
          style=${{ aspectRatio: razmerje[0] + " / " + razmerje[1] }}
          onPointerDown=${dol} onPointerMove=${premik} onPointerUp=${gor} onPointerCancel=${gor} onKeyDown=${tipka}>
          <canvas ref=${glavno} width=${W} height=${H} aria-hidden="true"></canvas>
        </div>
      </div>
      <div class="izrez-stolpec izrez-stran">
        <span class="izrez-oznaka">${t("Preview")}</span>
        <div class=${"izrez-predogled " + (veliki ? "velik" : "majhen")} style=${{ aspectRatio: razmerje[0] + " / " + razmerje[1] }} aria-hidden="true">
          <canvas ref=${predogled} width=${160} height=${Math.round(160 * razmerje[1] / razmerje[0])}></canvas>
          <span class="izrez-senca"></span>
        </div>
        <span class="izrez-oznaka">${veliki ? t("Event page") : t("Event card")}</span>
      </div>
    </div>
    <label class="polje-oznaceno">${t("Zoom")}
      <input type="range" min="1" max=${NAJVEC_ZOOM} step="0.01" value=${poz.zoom} disabled=${!bitmap}
        onInput=${e => setPoz(p => ({ ...p, zoom: omeji(Number(e.target.value), 1, NAJVEC_ZOOM) }))} />
    </label>
    <span class="opomba" id="izrez-pomoc">${t("Drag to move, pinch or use the slider to zoom. Arrow keys move, + and − zoom.")}</span>
    ${napaka ? html`<p class="napaka-besedilo" role="alert">${napaka}</p>` : null}
    <div class="izrez-gumbi">
      <button type="button" class="gumb-siv" onClick=${obPreklic} disabled=${delam}>${t("Cancel")}</button>
      <button type="button" class="gumb-glavni" onClick=${uporabi} disabled=${!bitmap || delam}>${delam ? t("Uploading...") : t("Use")}</button>
    </div>
  </div>`;
}
