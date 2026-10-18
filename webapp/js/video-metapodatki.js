/* Cisti metapodatke videa (lokacija iz iPhona/Androida) PRED nalaganjem na Cloudinary, brez ponovnega kodiranja
   (outly_webpage#79; iOS isto resi s ponovnim izvozom, outly-app#110). Politika zasebnosti trdi, da lokacija ostane na napravi.

   ISO BMFF (MP4/MOV): skatle `udta` (npr. (c)xyz) in `meta` (npr. com.apple.quicktime.location.ISO6709) v `moov` in v vsakem
   `trak`, ter XMP (`uuid` BE7ACFCB-97A9-42E8-9C71-999491E3AFAC) na vrhu in v `moov`. Skatel NE brisemo (mdat bi se premaknil in
   odmiki v stco/co64 bi bili napacni): tip preimenujemo v `free`, vsebino prepisemo z nicami - velikost ostane ista.

   Pomnilnik: preberemo samo glave skatel (Blob.slice) in vsebino `moov`; `mdat` se ne kopira (nov File sestavimo iz kosov).
   Kar ni prepoznano kot MP4/MOV ali se ne razcleni, se ZAVRNE (NapakaDatoteke) - izvirnika ne posiljamo nikoli. */
import { t } from "./i18n.js";
import { NapakaDatoteke } from "./napake.js";

const XMP_UUID = [0xBE, 0x7A, 0xCF, 0xCB, 0x97, 0xA9, 0x42, 0xE8, 0x9C, 0x71, 0x99, 0x94, 0x91, 0xE3, 0xAF, 0xAC];
const KONTEJNERJI = new Set(["moov", "trak", "mdia", "minf", "edts"]);   // skatle, v katerih iscemo udta/meta/XMP
const ZACETNI_TIPI = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"]);   // prva skatla MP4/MOV
const NAJVEC_MOOV = 64 * 1024 * 1024;       // moov 100 MB videa je obicajno nekaj 100 KB
const NAJVEC_VRHNJA_SKATLA = 32 * 1024 * 1024;   // vrhnji udta/meta/XMP, ki ga prepisemo z nicami
const NAJVEC_SKATEL = 20000;                 // vrhnjih skatel (razdrobljen MP4 jih ima vec sto)
const NAJVEC_GLOBINE = 8;
const IZDAJA_LOKACIJE = [[0xA9, 0x78, 0x79, 0x7A], [...("ISO6709")].map(c => c.charCodeAt(0))];   // (c)xyz, ISO6709

const nepodprt = vzrok => new NapakaDatoteke(t("This video could not be prepared for upload. Please choose an MP4 or MOV video."), vzrok);
const FREE = [0x66, 0x72, 0x65, 0x65];

function tip(dv, o) {
  return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
}

/** Glava skatle na `o` (DataView `dv`); `konec` = konec nadrejenega obmocja v istih odmikih. Vrne { velikost, glava, tip }. */
function glava(dv, o, konec) {
  if (konec - o < 8 || dv.byteLength - o < 8) throw new Error("skatla je prekratka");
  let velikost = dv.getUint32(o), g = 8;
  const t4 = tip(dv, o + 4);
  if (velikost === 1) {
    if (dv.byteLength - o < 16) throw new Error("64-bitna glava je prekratka");
    const hi = dv.getUint32(o + 8);
    if (hi > 0x1FFFFF) throw new Error("prevelika skatla");
    velikost = hi * 4294967296 + dv.getUint32(o + 12); g = 16;
  } else if (velikost === 0) velikost = konec - o;   // do konca nadrejenega obmocja
  if (velikost < g || o + velikost > konec) throw new Error("velikost skatle ne ustreza");
  return { velikost, glava: g, tip: t4 };
}

const samoNicle = (dv, od, konec) => { for (let i = od; i < konec; i++) if (dv.getUint8(i) !== 0) return false; return true; };
const jeXmp = (u8, od, konec) => konec - od >= 16 && XMP_UUID.every((b, i) => u8[od + i] === b);

/** Prepise skatle udta/meta/XMP v obmocju [zacetek, konec) pomnilnika `u8` (rekurzivno po kontejnerjih). */
function ociscenje(u8, dv, zacetek, konec, globina) {
  if (globina > NAJVEC_GLOBINE) throw new Error("pregloboko gnezdenje");
  let o = zacetek;
  while (o < konec) {
    if (konec - o < 8 && samoNicle(dv, o, konec)) break;   // QuickTime konca s 32-bitno niclo
    const g = glava(dv, o, konec), vsebina = o + g.glava, kon = o + g.velikost;
    if (g.tip === "udta" || g.tip === "meta" || (g.tip === "uuid" && jeXmp(u8, vsebina, kon))) {
      u8.set(FREE, o + 4); u8.fill(0, vsebina, kon);
    } else if (KONTEJNERJI.has(g.tip)) ociscenje(u8, dv, vsebina, kon, globina + 1);
    o = kon;
  }
}

const vsebuje = (u8, vzorec) => {
  const n = vzorec.length, zadnji = u8.length - n;
  for (let i = 0; i <= zadnji; i++) {
    if (u8[i] !== vzorec[0]) continue;
    let j = 1; while (j < n && u8[i + j] === vzorec[j]) j++;
    if (j === n) return true;
  }
  return false;
};

async function ocisti(datoteka) {
  const velikost = datoteka.size;
  if (!velikost) throw new Error("prazna datoteka");
  const popravki = [];   // { od, bajti } po vrsti odmikov; vse ostalo se vzame iz izvirne datoteke
  let o = 0, stevec = 0, moov = 0;
  while (o < velikost) {
    if (++stevec > NAJVEC_SKATEL) throw new Error("prevec skatel");
    const dv = new DataView(await datoteka.slice(o, Math.min(o + 16, velikost)).arrayBuffer());
    if (velikost - o < 8) {   // ostanek < 8 B: dovoljen samo, ce so nicle
      if (!samoNicle(dv, 0, dv.byteLength)) throw new Error("smeti na koncu");
      break;
    }
    const g = glava(dv, 0, velikost - o);
    if (stevec === 1 && !ZACETNI_TIPI.has(g.tip)) throw new Error("ni MP4/MOV");
    if (g.tip === "moov") {
      if (g.velikost > NAJVEC_MOOV) throw new Error("prevelik moov");
      const u8 = new Uint8Array(await datoteka.slice(o, o + g.velikost).arrayBuffer());
      if (u8.length !== g.velikost) throw new Error("branje moov");
      ociscenje(u8, new DataView(u8.buffer), g.glava, u8.length, 0);
      // Varovalo: ce se lokacija skriva se kje drugje (npr. kljuc v zapisu metapodatkovne sledi), raje zavrnemo.
      if (IZDAJA_LOKACIJE.some(v => vsebuje(u8, v))) throw new Error("lokacija ostane v moov");
      popravki.push({ od: o, bajti: u8 }); moov++;
    } else if (g.tip === "udta" || g.tip === "meta" || g.tip === "uuid") {
      let prepisi = g.tip !== "uuid";
      if (!prepisi) {
        const id = new Uint8Array(await datoteka.slice(o + g.glava, o + g.glava + 16).arrayBuffer());
        prepisi = jeXmp(id, 0, id.length);
      }
      if (prepisi) {
        if (g.velikost > NAJVEC_VRHNJA_SKATLA) throw new Error("prevelika vrhnja skatla");
        const u8 = new Uint8Array(g.velikost);
        u8.set(new Uint8Array(dv.buffer, 0, g.glava));   // glava (velikost, tip, ev. 64-bitna velikost)
        u8.set(FREE, 4);
        popravki.push({ od: o, bajti: u8 });
      }
    }
    o += g.velikost;
  }
  if (!moov) throw new Error("ni moov");
  const deli = []; let poz = 0;
  for (const p of popravki) {
    if (p.od > poz) deli.push(datoteka.slice(poz, p.od));
    deli.push(p.bajti); poz = p.od + p.bajti.length;
  }
  if (poz < velikost) deli.push(datoteka.slice(poz));
  const izhod = new File(deli, datoteka.name || "video.mp4", { type: datoteka.type || "video/mp4" });
  if (izhod.size !== velikost) throw new Error("velikost se je spremenila");
  return izhod;
}

/** Vrne File iste velikosti brez udta/meta/XMP. Ne prepozna MP4/MOV ali ne uspe -> NapakaDatoteke (nalaganje se zavrne). */
export async function ocistiVideo(datoteka) {
  try { return await ocisti(datoteka); }
  catch (e) { throw e instanceof NapakaDatoteke ? e : nepodprt(e); }
}
