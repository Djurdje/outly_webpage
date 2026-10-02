// Posodobi <link rel="modulepreload"> v app/index.html IN seznam GRAF v webapp/sw.js: vsi moduli, ki jih main.js uvozi STATICNO (tudi posredno),
// da jih brskalnik prenese hkrati namesto v zaporednih valovih (faza 5, pocasen 4G). Leno uvozeni (import())
// niso na seznamu. Pozeni po vsakem novem staticnem uvozu:  node webapp/orodja/predhodno-nalaganje.mjs
// Preveri brez pisanja:  node webapp/orodja/predhodno-nalaganje.mjs --preveri   (izhod 1, ce seznam ni svez)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const koren = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vDatoteko = url => path.join(koren, url);
const najdeni = new Set();
function obisci(url) {
  if (najdeni.has(url)) return;
  najdeni.add(url);
  const vir = fs.readFileSync(vDatoteko(url), "utf8");
  // samo staticni uvozi: import ... from "x" / import "x" (ne import("x"))
  for (const m of vir.matchAll(/^\s*import\s+(?:[^'"()]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    const cilj = m[1].startsWith("/") ? m[1] : path.posix.join(path.posix.dirname(url), m[1]);
    obisci(cilj);
  }
}
obisci("/webapp/js/main.js");
const seznam = [...najdeni];
const html = seznam.map(u => `  <link rel="modulepreload" href="${u}" />`).join("\n");
// 1) app/index.html: <link rel="modulepreload">
const datoteka = path.join(koren, "app/index.html");
const staro = fs.readFileSync(datoteka, "utf8");
const novo = staro.replace(/  <!-- modulepreload:zacetek[^]*?modulepreload:konec -->/, `  <!-- modulepreload:zacetek (generira webapp/orodja/predhodno-nalaganje.mjs) -->\n${html}\n  <!-- modulepreload:konec -->`);
if (novo === staro && !staro.includes("modulepreload:zacetek")) { console.error("V app/index.html ni oznak modulepreload:zacetek/konec."); process.exit(2); }

// 2) webapp/sw.js: isti graf kot GRAF (v JEDRO predpomnilnika service workerja). Brez tega po objavi brez povezave ne dela,
// dokler uporabnik aplikacije enkrat ne odpre s povezavo se enkrat (sporocilo "shrani" pride sele v ze aktivnega workerja,
// activate pa med tem pobrise stari predpomnilnik) - pregled PR #24, P1. Isti izracun kot modulepreload, da se ne razideta.
const datotekaSw = path.join(koren, "webapp/sw.js");
const staroSw = fs.readFileSync(datotekaSw, "utf8");
const graf = seznam.map(u => `  ${JSON.stringify(u)}`).join(",\n");
const novoSw = staroSw.replace(/\/\* graf:zacetek[^]*?graf:konec \*\//, `/* graf:zacetek (generira webapp/orodja/predhodno-nalaganje.mjs - isti izracun kot modulepreload v app/index.html) */\nconst GRAF = [\n${graf}\n];\n/* graf:konec */`);
if (novoSw === staroSw && !staroSw.includes("graf:zacetek")) { console.error("V webapp/sw.js ni oznak graf:zacetek/konec."); process.exit(2); }

if (process.argv.includes("--preveri")) {
  if (novo !== staro) { console.error("Seznam modulepreload ni svez - pozeni node webapp/orodja/predhodno-nalaganje.mjs"); process.exit(1); }
  if (novoSw !== staroSw) { console.error("GRAF v webapp/sw.js ni svez - pozeni node webapp/orodja/predhodno-nalaganje.mjs"); process.exit(1); }
  console.log("modulepreload + sw.js GRAF: " + seznam.length + " modulov, svez");
} else {
  fs.writeFileSync(datoteka, novo);
  fs.writeFileSync(datotekaSw, novoSw);
  console.log("modulepreload + sw.js GRAF: " + seznam.length + " modulov zapisanih");
}
