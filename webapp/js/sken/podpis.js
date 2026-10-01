/* Preverjanje kod QR vstopnic na telefonu (issue Djurdje/outly-backend#86, skener brez povezave).
   Koda v2:  "o2." + base64url(JSON) + "." + base64url(podpis Ed25519, 64 B).
   Podpisano je UTF-8 besedilo vsega pred zadnjo piko ("o2.<base64url(JSON)>"); JSON je { v:2, t:serial, e:dogodek, i:cas, k:kid }.
   Stara koda v1 ("<base64url(JSON)>.<HMAC>") ima 2 dela: HMAC preveri samo streznik (skrivnost je samo tam).
   Ed25519: najprej WebCrypto (Chrome/Edge/Android Chrome 137+, Firefox 129+, Safari/iOS 17+ - MDN browser-compat-data,
   api/SubtleCrypto.json), sicer leno nalozena knjiznica vendor/noble-ed25519 (@noble/ed25519 3.2.0, MIT).
   Nobenega "zaupaj brez preverjanja": vsak preverjevalnik se pred uporabo preizkusi na znanem vektorju (RFC 8032, test 2)
   in mora ZAVRNITI popacen podpis in popacena sporocila - sicer ga ne uporabimo. */

const B64URL = /^[A-Za-z0-9_-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAJVEC_ZNAKOV = 1024;   // kot backend (QR_NAJVEC_ZNAKOV): daljse ni vstopnica

export function izBase64url(s) {
  if (typeof s !== "string" || !B64URL.test(s) || s.length % 4 === 1) throw new Error("base64url");
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export const vBase64url = bajti => {
  let s = "";
  for (let i = 0; i < bajti.length; i++) s += String.fromCharCode(bajti[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const izHex = h => Uint8Array.from(h.match(/../g), x => parseInt(x, 16));

/** Razclenitev kode (brez preverjanja podpisa).
    { vrsta: "v2", serial, dogodek, kid, sporocilo (Uint8Array), podpis (Uint8Array) } | { vrsta: "v1" } | { vrsta: "neznano" } */
export function razcleniQr(koda) {
  try {
    if (typeof koda !== "string") return { vrsta: "neznano" };
    const k = koda.trim();
    if (!k || k.length > NAJVEC_ZNAKOV) return { vrsta: "neznano" };
    const deli = k.split(".");
    if (deli.length === 3 && deli[0] === "o2") {
      const [, b, s] = deli;
      if (!b || !B64URL.test(b) || !/^[A-Za-z0-9_-]{86}$/.test(s)) return { vrsta: "neznano" };
      const telo = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(izBase64url(b)));
      if (!telo || telo.v !== 2 || typeof telo.t !== "string" || !UUID.test(telo.t) || !Number.isInteger(telo.e)) return { vrsta: "neznano" };
      const podpis = izBase64url(s);
      if (podpis.length !== 64) return { vrsta: "neznano" };
      return {
        vrsta: "v2", serial: telo.t.toLowerCase(), dogodek: telo.e, kid: typeof telo.k === "string" ? telo.k : "",
        sporocilo: new TextEncoder().encode("o2." + b), podpis
      };
    }
    // v1: base64url(JSON) + "." + HMAC (32 znakov). Telefon je ne more preveriti.
    if (deli.length === 2 && deli[0] && B64URL.test(deli[0]) && /^[A-Za-z0-9_-]{16,64}$/.test(deli[1])) return { vrsta: "v1" };
  } catch { /* poskodovana koda = neznano */ }
  return { vrsta: "neznano" };
}

/* ---------- preverjevalnik Ed25519 ---------- */

// RFC 8032, razdelek 7.1, TEST 2 (sporocilo = 0x72).
const TEST_JAVNI = izHex("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c");
const TEST_SPOROCILO = Uint8Array.of(0x72);
const TEST_PODPIS = izHex("92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00");

async function samoPreizkus(preveri) {
  try {
    const slab = TEST_PODPIS.slice(); slab[10] ^= 1;
    return (await preveri(TEST_JAVNI, TEST_SPOROCILO, TEST_PODPIS)) === true
      && (await preveri(TEST_JAVNI, TEST_SPOROCILO, slab)) === false
      && (await preveri(TEST_JAVNI, Uint8Array.of(0x73), TEST_PODPIS)) === false;
  } catch { return false; }
}

function webCrypto() {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) return null;
  const kljuci = new Map();   // javni kljuc (base64url) -> CryptoKey
  return async (javni, sporocilo, podpis) => {
    const id = vBase64url(javni);
    let k = kljuci.get(id);
    if (!k) { k = await s.importKey("raw", javni, { name: "Ed25519" }, false, ["verify"]); kljuci.set(id, k); }
    return s.verify({ name: "Ed25519" }, k, podpis, sporocilo);
  };
}

let obljuba = null;
/** { ime: "webcrypto" | "noble", preveri(javni, sporocilo, podpis) -> Promise<boolean> } ali null (brskalnik ne zna Ed25519 in
    knjiznice ni mogoce naloziti). Neuspeh zaradi omrezja se ne zapomni: naslednji klic poskusi znova. */
export function preverjevalnik() {
  if (!obljuba) {
    obljuba = (async () => {
      const wc = webCrypto();
      if (wc && await samoPreizkus(wc)) return { ime: "webcrypto", preveri: wc };
      const ed = await import("/vendor/noble-ed25519-3.2.0.mjs");
      const preveri = (javni, sporocilo, podpis) => ed.verifyAsync(podpis, sporocilo, javni);
      if (await samoPreizkus(preveri)) return { ime: "noble", preveri };
      return null;
    })().catch(() => null);
    obljuba.then(r => { if (!r) obljuba = null; });
  }
  return obljuba;
}

/** Podpis kode v2 z javnim kljucem (Uint8Array, 32 B). Vedno vrne true/false, nikoli izjeme. */
export async function podpisVeljaven(razclenjena, javni, preverjevalnikObjekt) {
  try {
    if (!razclenjena || razclenjena.vrsta !== "v2" || !javni || javni.length !== 32 || !preverjevalnikObjekt) return false;
    return (await preverjevalnikObjekt.preveri(javni, razclenjena.sporocilo, razclenjena.podpis)) === true;
  } catch { return false; }
}
