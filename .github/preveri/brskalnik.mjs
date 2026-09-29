import { chromium, webkit } from "playwright";
const U = "https://outly.si";
// pocakaj na objavo (zagon.js v lupini)
for (let i = 0; i < 30; i++) {
  const h = await (await fetch(U + "/app/?v=" + Date.now())).text();
  if (h.includes("/webapp/zagon.js")) { console.log("objava vidna po", i * 10, "s"); break; }
  await new Promise(r => setTimeout(r, 10000));
}
for (const [ime, tip] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await tip.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const napake = [];
  page.on("pageerror", e => napake.push(e.message.slice(0, 200)));
  page.on("console", m => { if (m.type() === "error" && !/cloudflareinsights/.test(m.text())) napake.push(m.text().slice(0, 200)); });
  for (let i = 1; i <= 3; i++) {
    await page.goto(U + "/app/?obisk=" + i, { waitUntil: "load" }); await page.waitForTimeout(4000);
    const t = await page.evaluate(() => document.body.innerText.slice(0, 60).replace(/\s+/g, " "));
    console.log(`[${ime}] obisk ${i}: ${t || "(vrtavka)"} | SW: ${await page.evaluate(() => !!navigator.serviceWorker.controller)}`);
  }
  const sw = await page.evaluate(async () => (await caches.keys()).join(","));
  console.log(`[${ime}] predpomnilniki: ${sw}`);
  console.log(`[${ime}] napake: ${JSON.stringify(napake)}`);
  await b.close();
}
