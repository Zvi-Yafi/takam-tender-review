import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { review, editionOn, validDay, type Catalog } from "../server/review.ts";
const catalog: Catalog = JSON.parse(readFileSync("data/catalog.json", "utf8"));
const payment = catalog.instructions.find((i) => i.number === "1.4.3")!;
function check(text: string, day = "2025-08-21", previous = "") {
  return review([{ text, location: "פסקה 1" }], catalog, day, previous)
    .findings;
}
test("inclusive version boundary, coverage and conflicting intervals", () => {
  assert.equal(
    editionOn(payment, "2024-09-18", catalog.collectedOn)?.edition,
    5,
  );
  assert.equal(
    editionOn(payment, "2024-09-19", catalog.collectedOn)?.edition,
    6,
  );
  assert.equal(editionOn(payment, "2015-01-01", catalog.collectedOn), null);
  assert.equal(editionOn(payment, "2099-01-01", catalog.collectedOn), null);
  const overlapping = {
    ...payment,
    versions: [
      ...payment.versions,
      { edition: 99, from: "2020-01-01", to: null },
    ],
  };
  assert.equal(editionOn(overlapping, "2025-08-21", catalog.collectedOn), null);
  assert.equal(check("הוראת תכ״ם 1.4.3", "2099-01-01")[0].status, "unknown");
});
test("number-only comparison with two dates or one", () => {
  const text = "הוראת החשב הכללי מס׳ 1.4.3";
  assert.equal(check(text)[0].status, "info");
  assert.equal(check(text, undefined, "2024-09-18")[0].status, "review");
  assert.equal(check(text, undefined, "2024-09-19")[0].status, "match");
  assert.equal(check(text, undefined, "2010-01-01")[0].status, "unknown");
});
test("explicit edition, effective date and unrelated dates", () => {
  assert.equal(check("הוראת תכ״ם 1.4.3 מהדורה 5")[0].status, "review");
  assert.equal(check("הוראת תכ״ם 1.4.3 מהדורה 6")[0].status, "match");
  assert.equal(
    check("הוראת תכ״ם 1.4.3 תחילת תוקף 19/9/2024")[0].status,
    "match",
  );
  assert.equal(
    check("הוראת תכ״ם 1.4.3 מועד הגשה 09.05.2021")[0].status,
    "info",
  );
});
test("internal sections, name-only references and unknown numbers", () => {
  assert.match(check("הוראת תכ״ם 1.4")[0].reason, /חלקי/);
  assert.deepEqual(check("ראו סעיף 1.4.3 לעיל"), []);
  assert.equal(check("הוראת תכ״ם ״בדיקת חשבון״")[0].number, null);
  assert.equal(check("הוראת תכ״ם 9.9.9")[0].status, "unknown");
  assert.equal(check("ראו סעיף 1.4.3 וגם הוראת תכ״ם 1.4.3")[0].number, "1.4.3");
});
test("calendar input and previous date validation", () => {
  assert.equal(validDay("2024-02-29"), true);
  assert.equal(validDay("2025-02-29"), false);
  assert.throws(() => check("", "2025-02-29"));
  assert.throws(() => check("", "2025-01-01", "2025-01-02"));
});
test("references sharing a plural instruction marker and name-only quoted title", () => {
  const found = check("הוראות תכ״ם 1.4.2 ו־1.4.3. ראו סעיף 7.8.9.");
  assert.deepEqual(
    found.map((f) => f.number),
    ["1.4.2", "1.4.3"],
  );
  assert.equal(check("על פי הוראה ״בדיקת חשבון״")[0].status, "unknown");
});

test("recognizes takam with a medial or final mem", () => {
  for (const spelling of ['תכ"מ', "תכ״מ", 'תכ"ם', "תכ״ם"]) {
    assert.deepEqual(
      check("בהוראת " + spelling + " 16.2.11 - הספקת שירותי מחשוב למשרדי ממשלה.").map(
        (finding) => finding.number,
      ),
      ["16.2.11"],
    );
  }
});
