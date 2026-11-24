import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTakamLookup } from "../server/takam.ts";
import { review, type Catalog } from "../server/review.ts";

const fallback: Catalog = { collectedOn: "2025-08-21", instructions: [] };
const passage = {
  location: "פסקה 1",
  text: "ראו הוראת תכ״ם 14.4.1 ערבויות דיגיטליות.",
};
const directory = [
  {
    documentcodetext: "H.14.4.1",
    sfid: "a0hKC000000kQlnYAE",
    name: "לינה בבית מלון",
  },
  {
    documentcodetext: "H.7.3.7",
    sfid: "a0hKC000000kQiEYAU",
    name: "ערבויות דיגיטליות",
  },
  {
    documentcodetext: "H.7.12.5",
    sfid: "a0h3X00003hMm6mQAC",
    name: "פורטל ספקים",
  },
].map((item) => ({ ...item, documenttype: "Instruction" }));
const history = [
  {
    rtn_versionnumber__c: 10,
    rtn_validfrom__c: "2024-01-15T00:00:00.000Z",
    rtn_validto__c: "2024-09-30T00:00:00.000Z",
  },
  {
    rtn_versionnumber__c: 11,
    rtn_validfrom__c: "2024-10-01T00:00:00.000Z",
    rtn_validto__c: null,
  },
];

test("checks public history and flags references whose number and title disagree", async () => {
  const requests: string[] = [];
  const lookup = createTakamLookup(fallback, async (url, options) => {
    requests.push(new URL(String(url)).pathname);
    assert.equal(
      new Headers(options?.headers).get("User-Agent"),
      "takam-tender-review/1.0",
    );
    const payload = String(url).endsWith("/api/Document") ? directory : history;
    return Response.json(payload);
  });

  const passages = [passage, { ...passage, text: "ראו הוראת תכ״ם 7.12.5." }];
  const catalog = await lookup(passages);
  const result = review(passages, catalog, "2024-09-30");
  assert.equal(result.source, "takam");
  assert.equal(result.findings[0].status, "review");
  assert.equal(
    result.findings[0].url,
    "https://takam.mof.gov.il/document/H.7.3.7",
  );
  assert.equal(result.findings[1].edition?.edition, 10);
  assert.equal(
    review(passages, catalog, "2024-10-01").findings[1].edition?.edition,
    11,
  );
  assert.equal(requests.length, 4);
});

test("labels an unavailable live catalog and preserves local validity coverage", async () => {
  const saved: Catalog = {
    ...fallback,
    instructions: [
      {
        number: "7.12.5",
        name: "פורטל ספקים",
        url: "https://takam.mof.gov.il/document/H.7.12.5",
        versions: [{ edition: 10, from: "2024-01-15", to: "2024-09-30" }],
      },
    ],
  };
  const lookup = createTakamLookup(
    saved,
    async () => new Response(null, { status: 503 }),
  );
  const passages = [{ ...passage, text: "ראו הוראת תכ״ם 7.12.5." }];
  const catalog = await lookup(passages);
  const result = review(passages, catalog, "2024-09-30");
  assert.equal(result.source, "local");
  assert.equal(result.findings[0].source, "local");
  assert.equal(result.findings[0].edition?.edition, 10);
  assert.equal(
    review(passages, catalog, "2025-08-22").findings[0].status,
    "unknown",
  );
});

test("links to a tender notice without treating it as an instruction", async () => {
  const notice = {
    documentcodetext: "HM.16.2.11",
    sfid: "a0h3X00003fyOZyQAM",
    name: "הספקת שירותי מחשוב למשרדי ממשלה",
    documenttype: "Tender Notice",
  };
  const lookup = createTakamLookup(fallback, async (url) => {
    assert.match(String(url), /api\/Document$/);
    return Response.json([...directory, notice]);
  });
  const passages = [{ ...passage, text: 'בהוראת תכ"מ 16.2.11.' }];
  const catalog = await lookup(passages);
  const [finding] = review(passages, catalog, "2022-07-03").findings;
  assert.equal(finding.referenceCode, "HM.16.2.11");
  assert.equal(finding.status, "unknown");
  assert.equal(finding.edition, null);
});

test("identifies Nimbus in the documented 2022 period without claiming its edition", async () => {
  const historicalReferences = JSON.parse(
    readFileSync("data/historical-references.json", "utf8"),
  );
  const saved: Catalog = { ...fallback, historicalReferences };
  const notice = {
    documentcodetext: "HM.16.2.2",
    sfid: "a0h3X00003jZfBhQAK",
    name: "מערכת מירב לביצוע מכרז דינאמי",
    documenttype: "Tender Notice",
  };
  const lookup = createTakamLookup(saved, async () =>
    Response.json([...directory, notice]),
  );
  const passages = [
    {
      ...passage,
      text: 'בהוראת תכ"ם 16.2.2 "פרויקט נימבוס- אספקת שירותי ענן ציבורי"- ספק במיקור חוץ.',
    },
  ];
  const catalog = await lookup(passages);

  for (const date of ["2022-07-03", "2022-07-07"]) {
    const [finding] = review(passages, catalog, date).findings;
    assert.equal(finding.status, "info");
    assert.equal(finding.edition, null);
    assert.equal(finding.referenceCode, undefined);
    assert.equal(finding.historicalSources?.length, 2);
  }
  const [later] = review(passages, catalog, "2025-01-02").findings;
  assert.equal(later.status, "unknown");
  assert.equal(later.referenceCode, "HM.16.2.2");
  assert.equal(later.historicalSources, undefined);
  const [numberOnly] = review(
    [{ ...passage, text: "הוראת תכ״ם 16.2.2." }],
    catalog,
    "2022-07-07",
  ).findings;
  assert.equal(numberOnly.historicalSources, undefined);
});
