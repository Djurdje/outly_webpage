/* Majhna trgovina stanja: en vir resnice za sejo, jezik in predpomnjene podatke.
   useStore(izbirnik) izrise komponento znova samo, ko se izbrana vrednost spremeni. */
import { useState, useEffect, useRef } from "./lib.js";

export function ustvariTrgovino(zacetno) {
  let stanje = zacetno;
  const poslusalci = new Set();
  return {
    get: () => stanje,
    set(delni) {
      const novo = typeof delni === "function" ? delni(stanje) : delni;
      stanje = { ...stanje, ...novo };
      poslusalci.forEach(fn => fn(stanje));
    },
    subscribe(fn) { poslusalci.add(fn); return () => poslusalci.delete(fn); }
  };
}

export function useStore(trgovina, izbirnik = s => s) {
  const [vrednost, setVrednost] = useState(() => izbirnik(trgovina.get()));
  const izbRef = useRef(izbirnik);
  izbRef.current = izbirnik;
  useEffect(() => {
    const preveri = s => {
      const nova = izbRef.current(s);
      setVrednost(stara => (Object.is(stara, nova) ? stara : nova));
    };
    preveri(trgovina.get());
    return trgovina.subscribe(preveri);
  }, [trgovina]);
  return vrednost;
}

/* Varno branje/pisanje localStorage (zasebno okno ali blokirani piskotki vrzejo izjemo). */
export const lokalno = {
  get(kljuc, privzeto = null) {
    try { const v = localStorage.getItem(kljuc); return v === null ? privzeto : JSON.parse(v); }
    catch { return privzeto; }
  },
  set(kljuc, vrednost) {
    try {
      if (vrednost === null || vrednost === undefined) localStorage.removeItem(kljuc);
      else localStorage.setItem(kljuc, JSON.stringify(vrednost));
    } catch { /* brez shranjevanja */ }
  }
};
