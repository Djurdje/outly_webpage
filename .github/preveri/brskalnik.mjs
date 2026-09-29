import { chromium, webkit } from "playwright";
const U = "https://outly.si";
const poti = ["/", "/app/", "/app/profile", "/app/map", "/app/business/1/scan", "/privacy-app"];
for (const [ime, tip] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await tip.launch();
  for (const p of poti) {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, isMobile: ime === "chromium", locale: "sl-SI" });
    const page = await ctx.newPage();
    const napake = [];
    page.on("console", m => { if (["error", "warning"].includes(m.type())) napake.push(m.type() + ": " + m.text().slice(0, 300)); });
    page.on("pageerror", e => napake.push("pageerror: " + e.message.slice(0, 300)));
    page.on("requestfailed", r => napake.push("failed: " + r.url() + " " + (r.failure() && r.failure().errorText)));
    page.on("response", r => { if (r.status() >= 400) napake.push("HTTP " + r.status() + " " + r.url()); });
    let st = "?";
    try { const o = await page.goto(U + p, { waitUntil: "load", timeout: 30000 }); st = o && o.status(); } catch (e) { napake.push("goto: " + e.message.slice(0, 200)); }
    await page.waitForTimeout(4000);
    const txt = (await page.evaluate(() => document.body ? document.body.innerText.slice(0, 160).replace(/\s+/g, " ") : "BREZ BODY").catch(e => "eval " + e.message));
    const url = page.url();
    console.log(`[${ime}] ${p} -> ${st} ${url}\n   besedilo: ${txt}`);
    for (const n of napake) console.log("   " + n);
    // drugi obisk (service worker aktiven)
    if (p === "/app/") {
      await page.reload({ waitUntil: "load" }).catch(e => console.log("   reload: " + e.message));
      await page.waitForTimeout(3000);
      console.log("   po osvezitvi: " + (await page.evaluate(() => document.body.innerText.slice(0, 100).replace(/\s+/g, " "))));
      console.log("   SW: " + (await page.evaluate(async () => { const r = await navigator.serviceWorker?.getRegistration("/app/"); return r ? (r.active && r.active.state) : "ni"; })));
    }
    await ctx.close();
  }
  await b.close();
}
