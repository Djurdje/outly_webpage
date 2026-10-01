/* Trajna shramba skenerja: javni kljuc, seznami vstopnic, seznam dogodkov in VRSTA SKENOV (preziveti mora osvezitev strani,
   zaprtje brskalnika in izpad omrezja - vrata ne smejo izgubiti niti enega skena).
   Prva izbira IndexedDB (seznam ima lahko nekaj tisoc vrstic, localStorage ima ~5 MB in je sinhron). Ce IndexedDB ne dela
   (zasebno okno, blokirani podatki, pokvarjena baza), gre isti vmesnik prek localStorage, nazadnje prek pomnilnika strani
   (takrat `nacin` = "pomnilnik" in vmesnik opozori, da skeni ne preziveto osvezitve). Vsak dostop je v try/catch. */

const IME_BAZE = "outly-sken";
const CAKANJE_ODPIRANJA_MS = 3000;
const LS_PREDPONA = "outly_sken:";

function odpriIDB() {
  return new Promise((ok, napaka) => {
    let koncano = false;
    const konec = (f, v) => { if (!koncano) { koncano = true; clearTimeout(t); f(v); } };
    const t = setTimeout(() => konec(napaka, new Error("IndexedDB: cas")), CAKANJE_ODPIRANJA_MS);
    try {
      if (!globalThis.indexedDB) throw new Error("brez IndexedDB");
      const zahteva = indexedDB.open(IME_BAZE, 1);
      zahteva.onupgradeneeded = () => {
        const db = zahteva.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("skeni")) db.createObjectStore("skeni", { keyPath: "id" });
      };
      zahteva.onsuccess = () => konec(ok, zahteva.result);
      zahteva.onerror = () => konec(napaka, zahteva.error || new Error("IndexedDB"));
      zahteva.onblocked = () => konec(napaka, new Error("IndexedDB blokirana"));
    } catch (e) { konec(napaka, e); }
  });
}

/* Ena transakcija; obljuba se razresi sele ob oncomplete (podatki so trajno zapisani), ne ob uspehu zahteve. */
function transakcija(db, shrambe, nacin, delo) {
  return new Promise((ok, napaka) => {
    let rezultat;
    const tx = db.transaction(shrambe, nacin);
    tx.oncomplete = () => ok(rezultat);
    tx.onerror = () => napaka(tx.error || new Error("IndexedDB tx"));
    tx.onabort = () => napaka(tx.error || new Error("IndexedDB tx prekinjena"));
    const zahteva = delo(tx);
    if (zahteva) zahteva.onsuccess = () => { rezultat = zahteva.result; };
  });
}

function shrambaIDB(db) {
  return {
    nacin: "idb",
    kvGet: k => transakcija(db, "kv", "readonly", tx => tx.objectStore("kv").get(k)),
    kvSet: (k, v) => transakcija(db, "kv", "readwrite", tx => { tx.objectStore("kv").put(v, k); }),
    kvDel: k => transakcija(db, "kv", "readwrite", tx => { tx.objectStore("kv").delete(k); }),
    skeniVsi: () => transakcija(db, "skeni", "readonly", tx => tx.objectStore("skeni").getAll()).then(v => v || []),
    skenPut: o => transakcija(db, "skeni", "readwrite", tx => { tx.objectStore("skeni").put(o); }),
    skenDel: id => transakcija(db, "skeni", "readwrite", tx => { tx.objectStore("skeni").delete(id); })
  };
}

function shrambaLS() {
  const bere = k => { const v = localStorage.getItem(LS_PREDPONA + k); return v === null ? undefined : JSON.parse(v); };
  const pise = (k, v) => localStorage.setItem(LS_PREDPONA + k, JSON.stringify(v));
  localStorage.setItem(LS_PREDPONA + "preizkus", "1"); localStorage.removeItem(LS_PREDPONA + "preizkus");   // vrze, ce je blokiran
  const skeni = () => { const v = bere("skeni"); return v && typeof v === "object" ? v : {}; };
  return {
    nacin: "localStorage",
    kvGet: async k => bere("kv:" + k),
    kvSet: async (k, v) => pise("kv:" + k, v),
    kvDel: async k => localStorage.removeItem(LS_PREDPONA + "kv:" + k),
    skeniVsi: async () => Object.values(skeni()),
    skenPut: async o => { const s = skeni(); s[o.id] = o; pise("skeni", s); },
    skenDel: async id => { const s = skeni(); delete s[id]; pise("skeni", s); }
  };
}

function pomnilnik() {
  const kv = new Map(), skeni = new Map();
  return {
    nacin: "pomnilnik",
    kvGet: async k => kv.get(k),
    kvSet: async (k, v) => { kv.set(k, v); },
    kvDel: async k => { kv.delete(k); },
    skeniVsi: async () => [...skeni.values()],
    skenPut: async o => { skeni.set(o.id, o); },
    skenDel: async id => { skeni.delete(id); }
  };
}

let obljuba = null;
/** Shramba (en objekt na stran). Nikoli ne vrze: ob napaki IndexedDB preide na localStorage, nato na pomnilnik. */
export function odpriShrambo() {
  if (!obljuba) {
    obljuba = (async () => {
      try { return shrambaIDB(await odpriIDB()); } catch { /* naprej */ }
      try { return shrambaLS(); } catch { /* naprej */ }
      return pomnilnik();
    })();
  }
  return obljuba;
}

/** Naj brskalnik shrambe ne pobrise ob pomanjkanju prostora (Safari/Chrome jo sicer lahko). Najboljsi trud, brez opozoril. */
export function zahtevajTrajno() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* brez */ }
}
