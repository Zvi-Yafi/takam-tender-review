import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readWord } from "./word.ts";
import { review, validateDates, type Catalog, type Passage } from "./review.ts";

const limit = 10 * 1024 * 1024;
const routes: Record<string, [string, string]> = {
  "/": ["client/index.html", "text/html; charset=utf-8"],
  "/app.js": ["dist/app.js", "text/javascript; charset=utf-8"],
  "/app.css": ["dist/app.css", "text/css; charset=utf-8"],
  "/examples/eshel-demo.docx": [
    "examples/eshel-demo.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};
function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
async function readForm(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit + 65536) throw new Error("גודל הקובץ המרבי הוא 10 MB.");
    chunks.push(chunk);
  }
  const response = new Response(new Uint8Array(Buffer.concat(chunks)), {
    headers: { "Content-Type": req.headers["content-type"] || "" },
  });
  return response.formData();
}
export function app(
  catalog: Catalog,
  root = process.cwd(),
  lookup?: (passages: Passage[]) => Promise<Catalog>,
) {
  return createServer(async (req, res) => {
    const path = req.url?.split("?")[0] ?? "";
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "POST" && path === "/api/review") {
      try {
        const form = await readForm(req);
        const file = form.get("file");
        if (
          !file ||
          typeof file === "string" ||
          !/\.docx$/i.test(file.name) ||
          !file.size ||
          file.size > limit
        )
          throw new Error("יש לבחור קובץ DOCX תקין בגודל עד 10 MB.");
        const content = await readWord(
          Buffer.from(await file.arrayBuffer()),
        ).catch(() => {
          throw new Error(
            "לא ניתן לקרוא את קובץ ה־Word. יש לבדוק שהוא DOCX תקין ובגודל נתמך.",
          );
        });
        const publication = String(form.get("publication") || "");
        const previous = String(form.get("previous") || "");
        validateDates(publication, previous);
        const resolved = lookup ? await lookup(content) : catalog;
        json(res, 200, review(content, resolved, publication, previous));
      } catch (error) {
        json(res, 400, {
          error:
            error instanceof Error && /[א-ת]/.test(error.message)
              ? error.message
              : "הבקשה אינה תקינה. יש לבחור קובץ ותאריכים ולנסות שוב.",
        });
      }
      return;
    }
    if (req.method === "GET" && path === "/api/catalog")
      return json(res, 200, {
        collectedOn: catalog.collectedOn,
        count: catalog.instructions.length,
        live: Boolean(lookup),
      });
    if (req.method === "GET" && Object.hasOwn(routes, path)) {
      try {
        const [file, type] = routes[path];
        const bytes = await readFile(resolve(root, file));
        res.writeHead(200, { "Content-Type": type });
        res.end(bytes);
      } catch {
        json(res, 404, { error: "הקובץ אינו זמין." });
      }
      return;
    }
    json(res, 404, { error: "הכתובת אינה קיימת." });
  });
}
