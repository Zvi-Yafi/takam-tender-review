import { existsSync, readFileSync } from "node:fs";
import { app } from "./http.ts";
import { createTakamLookup } from "./takam.ts";
import { validDay, type Catalog } from "./review.ts";
if (existsSync(".env")) process.loadEnvFile(".env");
const catalog: Catalog = JSON.parse(
  readFileSync(process.env.CATALOG_PATH || "data/catalog.json", "utf8"),
);
catalog.historicalReferences = JSON.parse(
  readFileSync("data/historical-references.json", "utf8"),
);
if (
  !validDay(catalog.collectedOn) ||
  !catalog.instructions?.length ||
  catalog.instructions.some(
    (i) =>
      !i.number ||
      !i.name ||
      !i.url?.startsWith("https://") ||
      !i.versions?.length ||
      i.versions.some(
        (v) =>
          !Number.isInteger(v.edition) ||
          !validDay(v.from) ||
          (v.to !== null && (!validDay(v.to) || v.to < v.from)),
      ),
  )
) {
  throw new Error("מדגם ההוראות אינו תקין.");
}
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
app(catalog, process.cwd(), createTakamLookup(catalog)).listen(port, host, () =>
  console.log("תוקף • http://" + host + ":" + port),
);
