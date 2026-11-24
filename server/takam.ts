import {
  lookupNumbers,
  validDay,
  type Catalog,
  type Edition,
  type Instruction,
  type Passage,
} from "./review.ts";

const origin = "https://takam.mof.gov.il";
const indexLifetime = 5 * 60 * 1000;
const dateInIsrael = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type RemoteInstruction = Instruction & { id: string };
type Row = Record<string, unknown>;
type CatalogIndex = {
  instructions: RemoteInstruction[];
  documentCodes: Map<string, string | null>;
};

async function rows(path: string, request: typeof fetch): Promise<Row[]> {
  const response = await request(origin + path, {
    signal: AbortSignal.timeout(5000),
    headers: {
      Accept: "application/json",
      "User-Agent": "takam-tender-review/1.0",
    },
  });
  if (!response.ok) throw new Error("תכ״ם החזיר שגיאת HTTP " + response.status);
  const value: unknown = await response.json();
  if (
    !Array.isArray(value) ||
    value.some((row) => !row || typeof row !== "object")
  )
    throw new Error("מבנה הנתונים של תכ״ם אינו תקין.");
  return value;
}

async function versions(
  item: RemoteInstruction,
  request: typeof fetch,
): Promise<Edition[]> {
  const records = await rows("/api/DocumentVersion/" + item.id, request);
  const editions = records
    .filter((row) => row.isdeleted !== true && row.rtn_publish__c !== false)
    .map((row) => {
      const edition = row.rtn_versionnumber__c;
      const from =
        typeof row.rtn_validfrom__c === "string"
          ? row.rtn_validfrom__c.slice(0, 10)
          : "";
      const end = row.rtn_validto__c;
      const to = typeof end === "string" ? end.slice(0, 10) : null;
      if (
        typeof edition !== "number" ||
        !Number.isInteger(edition) ||
        !validDay(from) ||
        (end !== null && (to === null || !validDay(to) || to < from))
      ) {
        throw new Error("תאריכי מהדורה חסרים או שגויים.");
      }
      return { edition, from, to };
    });
  return editions.filter(
    (v, index) =>
      editions.findIndex(
        (other) =>
          other.edition === v.edition &&
          other.from === v.from &&
          other.to === v.to,
      ) === index,
  );
}

export function createTakamLookup(
  fallback: Catalog,
  request: typeof fetch = fetch,
) {
  let index: { expires: number; documents: CatalogIndex } | undefined;
  let pendingIndex: Promise<CatalogIndex> | undefined;
  const pendingVersions = new Map<string, Promise<Edition[]>>();

  async function loadIndex(): Promise<CatalogIndex> {
    if (index && index.expires > Date.now()) return index.documents;
    pendingIndex ??= (async () => {
      const records = await rows("/api/Document", request);
      const documentCodes = new Map<string, string | null>();
      const instructions = records.flatMap<RemoteInstruction>((row) => {
        const docCode = row.documentcodetext;
        if (row.isdeleted === true || typeof docCode !== "string") return [];
        const code = docCode.match(/^[A-Z]+\.(\d+(?:\.\d+){2,4})$/);
        if (!code) return [];
        const number = code[1];
        const previousCode = documentCodes.get(number);
        documentCodes.set(
          number,
          previousCode === undefined || previousCode === docCode
            ? docCode
            : null,
        );

        if (
          !["Instruction", "Temporary Instruction"].includes(
            String(row.documenttype),
          ) ||
          typeof row.name !== "string" ||
          typeof row.sfid !== "string" ||
          !/^[A-Za-z0-9]{15,18}$/.test(row.sfid)
        )
          return [];
        return [
          {
            id: row.sfid,
            number,
            name: row.name,
            url: origin + "/document/" + docCode,
            versions: [],
          },
        ];
      });
      if (!instructions.length) throw new Error("קטלוג ההוראות של תכ״ם ריק.");
      const documents = { instructions, documentCodes };
      index = { expires: Date.now() + indexLifetime, documents };
      return documents;
    })().finally(() => {
      pendingIndex = undefined;
    });
    return pendingIndex;
  }

  function loadVersions(item: RemoteInstruction) {
    const existing = pendingVersions.get(item.id);
    if (existing) return existing;
    const pending = versions(item, request).finally(() =>
      pendingVersions.delete(item.id),
    );
    pendingVersions.set(item.id, pending);
    return pending;
  }

  const local = fallback.instructions.map((item) => ({
    ...item,
    source: "local" as const,
    asOf: fallback.collectedOn,
  }));

  return async (passages: Passage[]): Promise<Catalog> => {
    const collectedOn = dateInIsrael.format(new Date());
    if (!passages.length)
      return { collectedOn, source: "takam", instructions: [] };
    let indexData: CatalogIndex;
    try {
      indexData = await loadIndex();
    } catch {
      return { ...fallback, source: "local", instructions: local };
    }
    const { instructions: remote, documentCodes } = indexData;
    const catalog: Catalog = {
      collectedOn,
      source: "takam",
      instructions: remote,
      documentCodes,
      historicalReferences: fallback.historicalReferences,
    };
    const targets = lookupNumbers(passages, catalog);
    const queue = remote.filter((item) => targets.has(item.number));
    let failed = false;
    const replacements = new Map<RemoteInstruction, Instruction>();
    await Promise.all(
      Array.from({ length: Math.min(queue.length, 6) }, async () => {
        let item: RemoteInstruction | undefined;
        while ((item = queue.shift())) {
          try {
            const history = await loadVersions(item);
            replacements.set(item, {
              ...item,
              versions: history,
              source: "takam",
            });
          } catch {
            failed = true;
            const cached = local.find(
              (entry) =>
                entry.number === item!.number && entry.url === item!.url,
            );
            replacements.set(
              item,
              cached ?? { ...item, historyUnavailable: true },
            );
          }
        }
      }),
    );
    return {
      ...catalog,
      source: failed ? "mixed" : "takam",
      instructions: remote.map((item) => replacements.get(item) ?? item),
    };
  };
}
