// Lokalni streznik za webapp/orodja/razlicice/test.mjs: posnema Cloudflare Pages za /app, VKLJUCNO s pastjo (/webapp/* dobi
// max-age=14400, ker nastavitev racuna "Browser Cache TTL" povozi no-cache iz _headers). Samo za lokalni test, ne za produkcijo.
// Upravljanje: GET /__ctl?root=<mapa>&fail=/pot1,/pot2&nostore=/pot3&hang=/pot4  (fail = prekinjena povezava, kot slab signal;
// fail=* = vse; hang = zahtevo sprejme in nanjo ne odgovori - "viseca" povezava, outly-backend#396)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.argv[2] || 8790);
let stanje = { root: "", fail: new Set(), nostore: new Set(), hang: new Set() };
const visece = [];
const dnevnik = [];
const TIPI = { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".jpg": "image/jpeg" };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; font-src 'self'; connect-src 'self' https://outly-backend-roy3.onrender.com https://api.cloudinary.com https://zbewqcxnvrwebxonvebx.supabase.co wss://zbewqcxnvrwebxonvebx.supabase.co https://o4512176179773440.ingest.de.sentry.io; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);
  if (p === "/__ctl") {
    const g = k => (url.searchParams.get(k) || "").split(",").filter(Boolean);
    if (url.searchParams.has("root")) stanje.root = url.searchParams.get("root");
    stanje.fail = new Set(g("fail"));
    stanje.nostore = new Set(g("nostore"));
    stanje.hang = new Set(g("hang"));
    for (const r of visece.splice(0)) r.destroy();   // prejsnje visece zahteve ne smejo obviseti za vedno
    dnevnik.length = 0;
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ root: stanje.root, fail: [...stanje.fail], nostore: [...stanje.nostore] }));
  }
  if (p === "/__log") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(dnevnik)); }
  if (stanje.hang.has(p)) { dnevnik.push(p + " VISI"); visece.push(req.socket); return; }
  if (stanje.fail.has(p) || stanje.fail.has("*")) { dnevnik.push(p + " PREKINJENO"); req.socket.destroy(); return; }

  let datoteka = path.join(stanje.root, p);
  const jeLupina = p === "/app" || (p.startsWith("/app/") && !path.extname(p));
  if (jeLupina) datoteka = path.join(stanje.root, "app/index.html");
  if (!datoteka.startsWith(stanje.root) || !fs.existsSync(datoteka) || fs.statSync(datoteka).isDirectory()) {
    dnevnik.push(p + " 404"); res.writeHead(404, { "content-type": "text/plain" }); return res.end("ni");
  }
  const vsebina = fs.readFileSync(datoteka);
  const etag = '"' + crypto.createHash("sha1").update(vsebina).digest("hex").slice(0, 16) + '"';
  const glave = { "content-type": TIPI[path.extname(datoteka)] || "application/octet-stream", etag };
  if (jeLupina) { glave["cache-control"] = "public, max-age=0, must-revalidate"; glave["content-security-policy"] = CSP; }
  else if (p.startsWith("/webapp/")) glave["cache-control"] = "public, max-age=14400";   // Cloudflare "Browser Cache TTL" povozi no-cache
  else glave["cache-control"] = "public, max-age=14400";
  if (stanje.nostore.has(p)) glave["cache-control"] = "no-store";
  if (p === "/webapp/sw.js") glave["service-worker-allowed"] = "/app/";
  if (req.headers["if-none-match"] === etag) { dnevnik.push(p + " 304"); res.writeHead(304, glave); return res.end(); }
  dnevnik.push(p + " 200");
  res.writeHead(200, glave);
  res.end(vsebina);
}).listen(PORT, "127.0.0.1", () => console.log("streznik " + PORT));
