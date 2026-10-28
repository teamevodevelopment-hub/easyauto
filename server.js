// Minimal static server for Railway. Railway sets PORT automatically.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};
// Only these files/folders are public, so server.js, package.json etc. are never served
const PUBLIC = new Set(["index.html", "terms.html", "privacy.html", "favicon.ico", "assets"]);

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/health") return res.end("ok");

  let rel = path.normalize(urlPath).replace(/^[\\/]+/, "") || "index.html";
  if (!PUBLIC.has(rel.split(/[\\/]/)[0])) rel = "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(400); return res.end(); }

  fs.readFile(file, (err, data) => {
    if (err) {
      // Unknown paths fall back to the apply page
      return fs.readFile(path.join(ROOT, "index.html"), (e, html) => {
        res.writeHead(e ? 500 : 200, { "Content-Type": TYPES[".html"] });
        res.end(html);
      });
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": rel === "index.html" ? "no-cache" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.end(data);
  });
}).listen(PORT, () => console.log(`EasyAuto running on port ${PORT}`));
