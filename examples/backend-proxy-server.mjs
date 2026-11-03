// Minimal backend proxy for examples/backend-proxy-integration.html (Node 18+, no deps).
// Keeps the Resiliencesoft Interview AI API key on the server; forwards the multipart body as-is.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const BASE = process.env.RSI_URL ?? "http://localhost:3100";
const KEY = process.env.RSI_API_KEY; // dlv_test_… or dlv_live_…
const FORM = process.env.RSI_FORM_ID; // frm_…
if (!KEY || !FORM) throw new Error("Set RSI_API_KEY and RSI_FORM_ID");

createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(await readFile(new URL("./backend-proxy-integration.html", import.meta.url)));
  }
  if (req.method === "POST" && req.url === "/apply") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const upstream = await fetch(`${BASE}/api/v1/interview-forms/${FORM}/applications`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "content-type": req.headers["content-type"] },
      body: Buffer.concat(chunks),
    });
    res.writeHead(upstream.status, { "content-type": "application/json" });
    return res.end(await upstream.text());
  }
  res.writeHead(404).end();
}).listen(4000, () => console.log("Sample careers site on http://localhost:4000"));
