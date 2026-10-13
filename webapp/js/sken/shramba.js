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
      const zahteva = indexedDB.open(IME_BAZE, 2);
      zahteva.onupgradeneeded = () => {
        const db = zahteva.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        // Indeks po serialu: pred vsako odlocitvijo preberemo, ali je to vstopnico ze skeniral DRUG zavihek (M4).
        const sk = db.objectStoreNames.contains("skeni") ? zahteva.transaction.objectStore("skeni") : db.createObjectStore("skeni", { keyPath: "id" });
        if (!sk.indexNames.contains("serial")) sk.createIndex("serial", "serial");
      };
      zahteva.onsuccess = () => {
        // M8: nova razlicica (druga stran/zavihek) hoce nadgraditi bazo - odpri jo, sicer ostane blokirana in skenerji obvisijo.
        try { zahteva.result.onversionchange = () => { try { zahteva.result.close(); } catch { /* brez */ } }; } catch { /* brez */ }
        konec(ok, zahteva.result);
      };
      zahteva.onerror = () => konec(napaka, zahteva.error || new Error("IndexedDB"));
      zahteva.onblocked = () => konec(napaka, new Error("IndexedDB blokirana"));
    } catch (e) { konec(napaka, e); }
  });
}

/* Pisalne transakcije z durability "strict": brskalnik potrdi sele, ko je zapis na disku (Chrome privzeto "relaxed" lahko ob
   izpadu baterije/ugasnitvi izgubi zadnje zapise - sken, ki smo ga vratarju potrdili z zeleno). Starejsi brskalniki tretji
   argument ignorirajo ali zavrnejo - takrat brez. */
function odpriTx(db, shrambe, nacin) {
  if (nacin === "readwrite") { try { return db.transaction(shrambe, nacin, { durability: "strict" }); } catch { /* starejsi brskalnik */ } }
  return db.transaction(shrambe, nacin);
}

/* Ena transakcija; obljuba se razresi sele ob oncomplete (podatki so trajno zapisani), ne ob uspehu zahteve. */
function transakcija(db, shrambe, nacin, delo) {
  return new Promise((ok, napaka) => {
    let rezultat;
    const tx = odpriTx(db, shrambe, nacin);
    tx.oncomplete = () => ok(rezultat);
    tx.onerror = () => napaka(tx.error || new Error("IndexedDB tx"));
    tx.onabort = () => napaka(tx.error || new Error("IndexedDB tx prekinjena"));
    const zahteva = delo(tx);
    if (zahteva) zahteva.onsuccess = () => { rezultat = zahteva.result; };
  });
}

/* Starost zapisov v kv: vsak seznam (seznam:, dogodki:) nosi cas prenosa `cas`; brez veljavnega casa starosti ne vemo in zapis velja za star
   (seznam se ob povezavi znova prenese). */
const KOS_BRISANJA = 200;
const staroKv = (v, meja) => !(v && typeof v === "object" && Number.isFinite(v.cas) && v.cas >= meja);
const jeStarKv = (kljuc, v, predpone, meja) => predpone.some(p => String(kljuc).startsWith(p)) && staroKv(v, meja);

function shrambaIDB(db) {
  return {
    nacin: "idb",
    kvGet: k => transakcija(db, "kv", "readonly", tx => tx.objectStore("kv").get(k)),
    kvSet: (k, v) => transakcija(db, "kv", "readwrite", tx => { tx.objectStore("kv").put(v, k); }),
    kvDel: k => transakcija(db, "kv", "readwrite", tx => { tx.objectStore("kv").delete(k); }),
    skeniVsi: () => transakcija(db, "skeni", "readonly", tx => tx.objectStore("skeni").getAll()).then(v => v || []),
    skeniPoSerialu: serial => transakcija(db, "skeni", "readonly", tx => tx.objectStore("skeni").index("serial").getAll(serial)).then(v => v || []),
    kvPocisti: predpone => transakcija(db, "kv", "readwrite", tx => {
      const st = tx.objectStore("kv"), r = st.getAllKeys();
      r.onsuccess = () => { for (const k of r.result) if (predpone.some(p => String(k).startsWith(p))) st.delete(k); };
    }),
    skenPut: o => transakcija(db, "skeni", "readwrite", tx => { tx.objectStore("skeni").put(o); }),
    skenDel: id => transakcija(db, "skeni", "readwrite", tx => { tx.objectStore("skeni").delete(id); }),
    // Vec skenov po KOSIH (vsak kos ena zapisovalna transakcija): tisoc loceni transakcij s strogo trajnostjo bi zapis skena v drugem
    // zavihku blokiral sekunde (izmerjeno 2,5 s pri 3000), ena sama transakcija pa za ves cas brisanja (izmerjeno ~0,5 s).
    // Med kosi drugi zavihki pridejo na vrsto.
    skenDelVec: async ids => {
      for (let i = 0; i < ids.length; i += KOS_BRISANJA) {
        const kos = ids.slice(i, i + KOS_BRISANJA);
        await transakcija(db, "skeni", "readwrite", tx => { const st = tx.objectStore("skeni"); for (const id of kos) st.delete(id); });
      }
    },
    // Staro (cas starejsi od meje ali neveljaven) brise po korakih: branje brez zapisovalnega zaklepa, nato ena kratka zapisovalna
    // transakcija, ki pred brisanjem ZNOVA prebere vsak kandidat (seznam, ki ga je medtem osvezil drug zavihek, ostane).
    kvPocistiStare: async (predpone, meja) => {
      const kandidati = await new Promise((ok, napaka) => {
        const tx = db.transaction("kv", "readonly"), st = tx.objectStore("kv"), k = st.getAllKeys(), v = st.getAll();
        tx.oncomplete = () => ok(k.result.filter((kljuc, i) => jeStarKv(kljuc, v.result[i], predpone, meja)));
        tx.onerror = tx.onabort = () => napaka(tx.error || new Error("IndexedDB tx"));
      });
      if (!kandidati.length) return;
      await transakcija(db, "kv", "readwrite", tx => {
        const st = tx.objectStore("kv");
        for (const kljuc of kandidati) { const g = st.get(kljuc); g.onsuccess = () => { if (jeStarKv(kljuc, g.result, predpone, meja)) st.delete(kljuc); }; }
      });
    }
  };
}

function shrambaLS() {
  // Vsak sken je v SVOJEM kljucu "sken:<serial>:<id>" (ne en velik zemljevid: pri tisocih skenov bi vsak zapis prepisal megabajte
  // in zadel kvoto ~5 MB; poizvedba po serialu je sprehod po imenih kljucev brez razclenjevanja).
  const bere = k => { const v = localStorage.getItem(LS_PREDPONA + k); return v === null ? undefined : JSON.parse(v); };
  const pise = (k, v) => localStorage.setItem(LS_PREDPONA + k, JSON.stringify(v));
  localStorage.setItem(LS_PREDPONA + "preizkus", "1"); localStorage.removeItem(LS_PREDPONA + "preizkus");   // vrze, ce je blokiran
  const kljuci = pogoj => { const o = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREDPONA) && pogoj(k.slice(LS_PREDPONA.length))) o.push(k); } return o; };
  const razclenjeni = ks => ks.map(k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }).filter(x => x && typeof x === "object");
  return {
    nacin: "localStorage",
    kvGet: async k => bere("kv:" + k),
    kvSet: async (k, v) => pise("kv:" + k, v),
    kvDel: async k => localStorage.removeItem(LS_PREDPONA + "kv:" + k),
    kvPocisti: async predpone => { for (const k of kljuci(n => predpone.some(p => n.startsWith("kv:" + p)))) localStorage.removeItem(k); },
    skeniVsi: async () => razclenjeni(kljuci(n => n.startsWith("sken:"))),
    skeniPoSerialu: async serial => razclenjeni(kljuci(n => n.startsWith("sken:" + serial + ":"))),
    skenPut: async o => pise("sken:" + o.serial + ":" + o.id, o),
    skenDel: async id => { for (const k of kljuci(n => n.startsWith("sken:") && n.endsWith(":" + id))) localStorage.removeItem(k); },
    skenDelVec: async ids => { for (const id of ids) for (const k of kljuci(n => n.startsWith("sken:") && n.endsWith(":" + id))) localStorage.removeItem(k); },
    kvPocistiStare: async (predpone, meja) => {
      for (const k of kljuci(n => n.startsWith("kv:") && predpone.some(p => n.slice(3).startsWith(p)))) {
        let v; try { v = JSON.parse(localStorage.getItem(k)); } catch { v = null; }
        if (staroKv(v, meja)) localStorage.removeItem(k);
      }
    }
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
    skeniPoSerialu: async serial => [...skeni.values()].filter(o => o.serial === serial),
    kvPocisti: async predpone => { for (const k of [...kv.keys()]) if (predpone.some(p => String(k).startsWith(p))) kv.delete(k); },
    skenPut: async o => { skeni.set(o.id, o); },
    skenDel: async id => { skeni.delete(id); },
    skenDelVec: async ids => { for (const id of ids) skeni.delete(id); },
    kvPocistiStare: async (predpone, meja) => { for (const [k, v] of [...kv]) if (jeStarKv(k, v, predpone, meja)) kv.delete(k); }
  };
}

/* M8: skeni, ki so pristali v localStorage (IndexedDB takrat ni delal), bi ob vrnitvi IndexedDB ostali osirotele in nikoli poslani.
   Enkrat ob odprtju jih preselimo (add: obstojec zapis v IDB ima prednost) in sele nato odstranimo iz localStorage. */
async function preseliOsirotele(db) {
  const kljuci = [], zapisi = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(LS_PREDPONA + "sken:")) kljuci.push(k); }
  for (const k of kljuci) {
    try { const o = JSON.parse(localStorage.getItem(k)); if (o && typeof o === "object" && typeof o.id === "string" && typeof o.serial === "string") zapisi.push(o); } catch { /* pokvarjen zapis: pusti */ }
  }
  if (!zapisi.length) return;
  await transakcija(db, "skeni", "readwrite", tx => {
    const st = tx.objectStore("skeni");
    for (const o of zapisi) { const z = st.add(o); z.onerror = e => { e.preventDefault(); e.stopPropagation(); }; }   // ConstraintError (ze v IDB) ni napaka
  });
  for (const k of kljuci) { try { localStorage.removeItem(k); } catch { /* brez */ } }
}

let obljuba = null;
/** Shramba (en objekt na stran). Nikoli ne vrze: ob napaki IndexedDB preide na localStorage, nato na pomnilnik. */
export function odpriShrambo() {
  if (!obljuba) {
    obljuba = (async () => {
      try {
        const db = await odpriIDB();
        try { await Promise.race([preseliOsirotele(db), new Promise((_, n) => setTimeout(() => n(new Error("preselitev: cas")), 2000))]); } catch { /* ostanejo v localStorage do naslednjic */ }
        return shrambaIDB(db);
      } catch { /* naprej */ }
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

/** Odjava (M5): seznami vstopnic in dogodkov so podatki kluba - na skupni napravi ne smejo ostati za naslednjega uporabnika.
    Vrsta skenov (ki se ni poslana) in id naprave OSTANETA: sicer bi z odjavo izgubili skene, ki jih vrata se niso poslala. */
export async function pocistiPodatkeKluba() {
  try { await (await odpriShrambo()).kvPocisti(PREDPONE_SEZNAMOV); } catch { /* najboljsi trud */ }
}

/* Hramba v brskalniku osebja: najvec 3 dni (politika zasebnosti, razdelka 2 in 4). Poslani skeni ("poslan") 3 dni od skena, seznami
   vstopnic 3 dni od prenosa (`cas`); NE krajse: vrata brez povezave med dolgim dogodkom ne smejo izgubiti seznama ob
   ponovnem zagonu. Neposlani skeni ("caka") ostanejo, dokler se ne posljejo. Isti pogoj uporablja skener ob odprtju kluba (motor.js)
   in ciscenje ob zagonu aplikacije (spodaj). */
export const OBDRZI_POSLANE_MS = 3 * 24 * 3600e3;
export const OBDRZI_SEZNAM_MS = 3 * 24 * 3600e3;
const PREDPONE_SEZNAMOV = ["seznam:", "dogodki:", "izbran:"];   // brise se ob odjavi (pocistiPodatkeKluba)
/* Po starosti (ob zagonu) samo seznami vstopnic in izbira dogodka. `dogodki:<klub>` (id, naslov in cas dogodkov, nic osebnega) OSTANE:
   iz njega skener brez povezave ugotovi, kateri dogodek je danes aktiven - brez njega bi vratar, ki je aplikacijo odprl drugje,
   v kleti brez signala videl vsako veljavno vstopnico kot »ne-danes«. */
const PREDPONE_ZA_STAROST = ["seznam:", "izbran:"];
export const jeStarPoslan = (r, zdaj) => !!r && r.stanje === "poslan" && zdaj - (Date.parse(r.scanned_at) || 0) > OBDRZI_POSLANE_MS;

/** Ob zagonu aplikacije: pobrise poslane skene, starejse od 3 dni, za VSE klube (tudi konflikte, ki jih osebje ni videlo: strezniski
    scan-batch zavrnjenega skena ne zapise, zato je zapis o njem po izbrisu izgubljen - zavestna odlocitev zaradi roka v politiki)
    ter sezname vstopnic (seznam:, izbran:), ki so bili preneseni pred vec kot 3 dnevi; seznam dogodkov (dogodki:) ostane.
    Ima LASTEN, enkratni odpiralnik: odpriShrambo() si zapomni uspeh ali neuspeh za skener na isti strani, ob zasedeni strani ob zagonu
    pa bi neuspeh skener za vedno preklopil na localStorage. Skeni gredo v ENI transakciji. Najboljsi trud: nikoli ne vrze. */
export async function pocistiStareSkene(zdaj = Date.now()) {
  let db = null, shramba = null;
  try { db = await odpriIDB(); shramba = shrambaIDB(db); }
  catch { try { shramba = shrambaLS(); } catch { return 0; } }
  let izbrisanih = 0;
  try {
    const ids = (await shramba.skeniVsi()).filter(r => jeStarPoslan(r, zdaj)).map(r => r.id);
    await shramba.skenDelVec(ids); izbrisanih = ids.length;
  } catch { /* naprej: seznami */ }
  try { await shramba.kvPocistiStare(PREDPONE_ZA_STAROST, zdaj - OBDRZI_SEZNAM_MS); } catch { /* najboljsi trud */ }
  try { if (db) db.close(); } catch { /* brez */ }
  return izbrisanih;
}
