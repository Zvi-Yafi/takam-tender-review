import yauzl from "yauzl";
import { DOMParser, type Element } from "@xmldom/xmldom";
import type { Passage } from "./review.ts";

const wordNamespace =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const maxXml = 16 * 1024 * 1024;
function documentXml(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(new Error("קובץ Word פגום."));
      zip.on("error", reject);
      zip.on("end", () => reject(new Error("חסר מסמך Word בקובץ.")));
      zip.on("entry", (entry) => {
        if (entry.fileName !== "word/document.xml") return zip.readEntry();
        if (entry.uncompressedSize > maxXml) {
          zip.close();
          return reject(new Error("מסמך Word גדול מדי לעיבוד."));
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            zip.close();
            return reject(error);
          }
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on("error", reject);
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxXml) stream.destroy(new Error("מסמך גדול מדי."));
            else chunks.push(chunk);
          });
          stream.on("end", () => {
            zip.close();
            resolve(Buffer.concat(chunks).toString("utf8"));
          });
        });
      });
      zip.readEntry();
    });
  });
}
export async function readWord(buffer: Buffer): Promise<Passage[]> {
  const source = await documentXml(buffer);
  if (/<!DOCTYPE/i.test(source)) throw new Error("מבנה XML אינו נתמך.");
  const xml = new DOMParser({
    onError: () => {
      throw new Error("XML פגום.");
    },
  }).parseFromString(source, "application/xml");
  const body = xml.getElementsByTagNameNS(wordNamespace, "body")[0];
  if (!body) throw new Error("גוף המסמך חסר.");
  const passages: Passage[] = [];
  let paragraph = 0,
    tables = 0;
  function walk(el: Element, location = "", row = 0, cell = 0) {
    const tag = el.namespaceURI === wordNamespace ? el.localName : "";
    if (tag === "tbl") location = "טבלה " + ++tables;
    if (tag === "tr") location += " · שורה " + row;
    if (tag === "tc") location += " · תא " + cell;
    if (tag === "p") {
      paragraph++;
      let text = "";
      for (const child of Array.from(el.getElementsByTagName("*"))) {
        if (child.namespaceURI !== wordNamespace) continue;
        if (child.localName === "t") text += child.textContent;
        if (["br", "tab", "cr"].includes(child.localName || "")) text += " ";
      }
      const section = text
        .replace(/[\u200e\u200f]/g, "")
        .trim()
        .match(/^(?:סעיף\s+)?(\d+(?:\.\d+){0,5})[.)]?\s+/);
      if (text.trim())
        passages.push({
          text,
          location:
            location || (section ? "סעיף " + section[1] : "פסקה " + paragraph),
        });
      return;
    }
    let rows = 0,
      cells = 0;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== 1) continue;
      const node = child as Element;
      if (node.localName === "tr") rows++;
      if (node.localName === "tc") cells++;
      if (node.localName !== "del") walk(node, location, rows, cells);
    }
  }
  walk(body);
  return passages;
}
