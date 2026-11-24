import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { app } from "../server/http.ts";
import type { Report } from "../server/review.ts";
type Expected = {
  section?: string;
  table?: number;
  row?: number;
  column?: number;
  number?: string;
  titleOnly?: string;
  result: string;
  edition?: number;
  startsWith?: string;
  contains?: string;
};
type Sample = {
  file: string;
  publication: string;
  occurrences: Expected[];
  sha256?: string;
};
const expected: { demo: Sample; originals: Sample[] } = JSON.parse(
  readFileSync("examples/expected.json", "utf8"),
);
const catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const server = app(catalog);
let endpoint: string;
before(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  endpoint =
    "http://127.0.0.1:" +
    (server.address() as AddressInfo).port +
    "/api/review";
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function upload(
  name: string,
  publication: string,
  previous = "",
  bytes?: Uint8Array,
) {
  const form = new FormData();
  const content = bytes || readFileSync(join("examples", name));
  form.set(
    "file",
    new Blob([Uint8Array.from(content)]),
    name.split("/").pop()!,
  );
  form.set("publication", publication);
  form.set("previous", previous);
  return fetch(endpoint, { method: "POST", body: form });
}
const mapped: Record<string, string> = {
  unverifiable: "unknown",
  information: "info",
  match: "match",
  review: "review",
};
for (const sample of [expected.demo, ...expected.originals]) {
  test(
    "reference annotations agree with HTTP upload of " + sample.file,
    async () => {
      if (sample.sha256)
        assert.equal(
          createHash("sha256")
            .update(readFileSync(join("examples", sample.file)))
            .digest("hex"),
          sample.sha256,
        );
      const response = await upload(sample.file, sample.publication);
      assert.equal(response.status, 200);
      const report: Report = await response.json();
      const relevant = report.findings.filter((f) =>
        sample.file.includes("fuel-")
          ? catalog.instructions.some(
              (i: { number: string }) => i.number === f.number,
            )
          : sample.file.includes("edition-6")
            ? f.number === "1.4.2"
            : true,
      );
      const remaining = [...relevant];
      for (const e of sample.occurrences) {
        const location = e.section
          ? "סעיף " + e.section
          : e.table
            ? "טבלה " + e.table + " · שורה " + e.row + " · תא " + e.column
            : undefined;
        const index = remaining.findIndex(
          (f) =>
            f.number === (e.number ?? null) &&
            f.status === mapped[e.result] &&
            (!location || f.location === location) &&
            (!e.edition || f.edition?.edition === e.edition) &&
            (!e.titleOnly || e.titleOnly === f.name) &&
            (!e.contains || f.text.includes(e.contains)) &&
            (!e.startsWith || f.text.trim().startsWith(e.startsWith)),
        );
        assert.notEqual(index, -1, "Missing " + JSON.stringify(e));
        remaining.splice(index, 1);
      }
      assert.equal(
        remaining.length,
        0,
        "Unexpected matches in annotated scope",
      );
      if (sample === expected.demo) {
        assert.equal(report.findings[0].status, "review");
        assert.match(report.findings[0].reason, /09\.05\.2021/);
        assert.equal(
          report.findings[0].url,
          "https://takam.mof.gov.il/document/H.1.4.3",
        );
        assert.deepEqual(
          await (await upload(sample.file, sample.publication)).json(),
          report,
        );
      }
    },
  );
}
test("the same tender section matched its effective date in January 2024", async () => {
  const report: Report = await (
    await upload(expected.demo.file, "2024-01-25")
  ).json();
  const row = report.findings.find((f) => f.location === "סעיף 5.3");
  assert.equal(row?.status, "match");
  assert.equal(row.edition?.edition, 5);
});
test("input errors are readable and reference-free documents return an empty report", async () => {
  for (const response of [
    await upload("broken.docx", "2025-08-21", "", Buffer.from("broken")),
    await upload(expected.demo.file, "2025-08-21", "2026-01-01"),
  ]) {
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /[א-ת]/);
  }
  const response = await upload("no-references.docx", "2025-08-21");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).findings, []);
});
