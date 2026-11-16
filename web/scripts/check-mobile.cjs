/**
 * Teste de layout no celular: nenhuma página pode ficar mais larga que a tela
 * (senão o usuário consegue "arrastar para o lado").
 *
 * Uso: suba o build (npx vite preview --port 4173 --base=/poc_agents_plataform/) e rode
 *   node web/scripts/check-mobile.cjs [url-base]
 *
 * Ele ignora a trava de CSS (overflow-x: clip) e mede os elementos de verdade,
 * para o problema ser corrigido na origem e não só escondido.
 */
const { chromium, devices } = require("playwright");

(async () => {
const BASE = process.argv[2] ?? "http://localhost:4173/poc_agents_plataform";
const PAGES = ["/", "/playground", "/compare", "/agents", "/llms", "/mcp", "/memory", "/prompts", "/audit", "/learn"];
const DEVICES = ["iPhone SE", "iPhone 13", "Pixel 7"];

const browser = await chromium.launch();
let failures = 0;
for (const name of DEVICES) {
  const page = await browser.newPage({ ...devices[name] });
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const offenders = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const inScroller = (el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== "visible") return true; // áreas roláveis/recortadas de propósito
        }
        return false;
      };
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1 || inScroller(el)) continue;
        if (el.parentElement.getBoundingClientRect().right > vw + 1) continue; // reporta só o mais externo
        out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 50)}"> vai até ${Math.round(r.right)}px (tela: ${vw}px)`);
      }
      return out;
    });
    if (offenders.length) {
      failures++;
      console.error(`✗ ${name} ${path}`);
      for (const o of offenders.slice(0, 5)) console.error(`    ${o}`);
    } else console.log(`✓ ${name} ${path}`);
  }
  await page.close();
}
await browser.close();
if (failures) {
  console.error(`\n${failures} página(s) mais largas que a tela.`);
  process.exit(1);
}
console.log("\nNenhuma página passa da largura da tela.");
})();
