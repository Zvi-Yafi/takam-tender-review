export type Edition = { edition: number; from: string; to: string | null };
export type Instruction = {
  number: string;
  name: string;
  url: string;
  versions: Edition[];
  source?: "takam" | "local";
  asOf?: string;
  historyUnavailable?: boolean;
};
export type HistoricalSource = { label: string; url: string };
export type HistoricalReference = {
  number: string;
  name: string;
  // A source dated only to a month contributes the first day of that month as an upper bound.
  evidenceFrom: string;
  evidenceThrough: string;
  sources: HistoricalSource[];
};
export type Catalog = {
  collectedOn: string;
  instructions: Instruction[];
  documentCodes?: ReadonlyMap<string, string | null>;
  historicalReferences?: readonly HistoricalReference[];
  source?: "takam" | "mixed" | "local";
};
export type Passage = { text: string; location: string };
export type Finding = Passage & {
  number: string | null;
  name: string;
  context?: Passage[];
  status: "review" | "unknown" | "info" | "match";
  reason: string;
  url: string | null;
  referenceCode?: string;
  historicalSources?: HistoricalSource[];
  edition: Edition | null;
  source?: Instruction["source"];
};
export type Report = {
  collectedOn: string;
  publication: string;
  previous: string;
  findings: Finding[];
  source?: Catalog["source"];
};

export function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const value = new Date(day + "T00:00:00Z");
  return (
    Number.isFinite(value.valueOf()) && value.toISOString().slice(0, 10) === day
  );
}
export function editionOn(item: Instruction, day: string, collected: string) {
  if (day > (item.asOf ?? collected)) return null;
  const active = item.versions.filter(
    (v) => v.from <= day && (!v.to || day <= v.to),
  );
  return active.length === 1 ? active[0] : null;
}
export const dateLabel = (value: string) =>
  value.split("-").reverse().join(".");
const dayPattern = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/;
const context =
  /(?:ה?הוראות|ה?הוראת|ה?הוראה)\s+(?:(?:ה?תכ\s*["״׳']?\s*[םמ]|ה?חשב\s+הכללי|ה?חשכ["״']?ל)(?:\s+מס(?:פר|[׳'])?)?|(?=["״“]))/g;
const refNumber = /(?<![\d.])\d{1,2}(?:\.\d{1,3}){2,4}(?!\d|\.\d)/g;
type Mention = { phrase: string; number: string | null; suffix: string };
function mentions(text: string, catalog: Catalog): Mention[] {
  const clean = text
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ");
  const anchors = Array.from(clean.matchAll(context));
  return anchors.flatMap<Mention>((anchor, i) => {
    const tail = clean.slice(
      anchor.index! + anchor[0].length,
      anchors[i + 1]?.index,
    );
    const phrase = tail.split(
      /(?:[;\n]|[.!?](?:\s|$)|(?:ראו|ראה|לפי|בהתאם ל)\s*סעיף)/u,
    )[0];
    const matches = Array.from(phrase.matchAll(refNumber));
    const first = matches[0];
    const partial =
      !first && phrase.match(/^\s*[:״"־-]?\s*(\d{1,2}\.\d{1,2})(?=\s|$)/);
    if (partial) return [{ phrase, number: partial[1], suffix: "" }];
    if (!first || /סעיף\s*$/.test(phrase.slice(0, first.index))) {
      const quotedTitle = /^\s*[,:(]*\s*["״“][^"״”]{3,}["״”]/.test(phrase);
      return namedInstructions(phrase, catalog).length ||
        (catalog.source && quotedTitle)
        ? [{ phrase, number: null, suffix: "" }]
        : [];
    }
    // Collect additional identifiers only when a list separator connects them.
    const numbers = [first];
    for (const next of matches.slice(1)) {
      const prior = numbers[numbers.length - 1];
      const between = phrase.slice(prior.index! + prior[0].length, next.index);
      if (!/^\s*(?:,\s*ו?|ו[־-]?|או)\s*$/.test(between)) break;
      numbers.push(next);
    }
    return numbers.map((n, index) => ({
      phrase,
      number: n[0],
      suffix: phrase.slice(n.index! + n[0].length, numbers[index + 1]?.index),
    }));
  });
}
function normalizeTitle(text: string) {
  return text
    .replace(/["׳״“”]/g, "")
    .replace(/^[\s:־–,()\-]+/, "")
    .trim();
}

function namedInstructions(text: string, catalog: Catalog) {
  const title = normalizeTitle(text);
  const matches = catalog.instructions.filter((item) => {
    const name = normalizeTitle(item.name);
    return (
      title === name ||
      (title.startsWith(name) && /^[\s,().־–-]/.test(title.slice(name.length)))
    );
  });
  const longest = Math.max(
    0,
    ...matches.map((item) => normalizeTitle(item.name).length),
  );
  return matches.filter((item) => normalizeTitle(item.name).length === longest);
}

function literalTitle({ phrase, number, suffix }: Mention, catalog: Catalog) {
  const tail = namedInstructions(suffix, catalog);
  if (tail.length || !number)
    return tail.length ? tail : namedInstructions(phrase, catalog);
  const beforeNumber = phrase
    .slice(0, phrase.indexOf(number))
    .replace(/(?:[,\s(]*מס(?:פר|[׳'])?\s*)?[,:\s(]*$/, "");
  const title = normalizeTitle(beforeNumber);
  return namedInstructions(title, catalog).filter(
    (item) => normalizeTitle(item.name) === title,
  );
}

function matchingHistoricalReference(
  { number, phrase, suffix }: Mention,
  catalog: Catalog,
  day: string,
) {
  if (!number) return undefined;

  const words = (text: string) =>
    normalizeTitle(text)
      .replace(/[\s:־–—,()\-]+/g, " ")
      .trim();
  const afterNumber = words(suffix);
  const beforeNumber = words(phrase.slice(0, phrase.indexOf(number))).replace(
    /(?:^| )מס(?:פר|')?$/,
    "",
  );
  const matches = catalog.historicalReferences?.filter((record) => {
    if (
      record.number !== number ||
      day < record.evidenceFrom ||
      day > record.evidenceThrough
    )
      return false;
    const title = words(record.name);
    return (
      afterNumber === title ||
      afterNumber.startsWith(title + " ") ||
      beforeNumber === title
    );
  });
  return matches?.length === 1 ? matches[0] : undefined;
}

export function lookupNumbers(passages: Passage[], catalog: Catalog) {
  const numbers = new Set<string>();
  for (const passage of passages) {
    for (const mention of mentions(passage.text, catalog)) {
      if (mention.number) numbers.add(mention.number);
      for (const item of literalTitle(mention, catalog))
        numbers.add(item.number);
    }
  }
  return numbers;
}

function inspect(
  passage: Passage,
  catalog: Catalog,
  day: string,
  previous: string,
): Finding[] {
  return mentions(passage.text, catalog).flatMap((mention) => {
    const { number, suffix } = mention;
    const titled = literalTitle(mention, catalog);
    const numbered = catalog.instructions.filter(
      (entry) => entry.number === number,
    );
    const byNumber = numbered.length === 1 ? numbered[0] : undefined;
    const byTitle = titled.length === 1 ? titled[0] : undefined;
    const item = number ? byNumber : byTitle;
    const historical = matchingHistoricalReference(mention, catalog, day);
    if (
      historical &&
      !numbered.some((entry) => editionOn(entry, day, catalog.collectedOn))
    ) {
      return [
        {
          ...passage,
          number,
          name: historical.name,
          status: "info",
          reason:
            "המספר והכותרת מתועדים יחד במקורות רשמיים מהתקופה של מועד הפרסום שנבחר. המהדורה שחלה ביום זה לא אומתה.",
          url: null,
          edition: null,
          historicalSources: historical.sources,
        },
      ];
    }
    const referenceCode = number
      ? (catalog.documentCodes?.get(number) ?? undefined)
      : undefined;
    const base = {
      ...passage,
      number,
      name: item?.name ?? "",
      url: item?.url ?? null,
      referenceCode,
      edition: null,
      source: item?.source,
    };
    const unknown = (reason: string): Finding[] => [
      { ...base, status: "unknown", reason },
    ];

    if (
      catalog.source &&
      catalog.source !== "local" &&
      number &&
      byTitle &&
      number !== byTitle.number &&
      (!numbered.length || byNumber)
    ) {
      const alternative = editionOn(byTitle, day, catalog.collectedOn);
      return [
        {
          ...base,
          status: "review",
          name: byTitle.name,
          url: byTitle.url,
          edition: alternative,
          source: byTitle.source,
          reason:
            (byNumber
              ? "בתכ״ם המספר " + number + " רשום תחת ״" + byNumber.name + "״."
              : "בתכ״ם לא נמצאה הוראה שמספרה " + number + ".") +
            " הכותרת שבטיוטה מופיעה תחת " +
            byTitle.number +
            ". יש לבדוק את מספר ההפניה.",
        },
      ];
    }
    if (!number && !item)
      return unknown(
        titled.length
          ? "נמצאו כמה הוראות בשם הזה. יש לציין את מספר ההוראה."
          : catalog.source === "local"
            ? "השם לא נמצא בגיבוי המקומי. נדרש חיבור לאתר תכ״ם."
            : "השם לא נמצא בקטלוג ההוראות הציבורי של תכ״ם.",
      );
    if (number && !item) {
      if (number.split(".").length < 3)
        return unknown("נמצא מספר הוראה חלקי. יש לבדוק את ההפניה בטיוטה.");
      if (numbered.length > 1)
        return unknown("תכ״ם החזיר כמה הוראות באותו מספר. נדרש אימות ידני.");
      if (catalog.source === "local")
        return unknown("לא ניתן להתחבר לתכ״ם ואין נתונים מקומיים להוראה הזו.");
      if (referenceCode)
        return unknown(
          "נמצאה רשומה עם אותו מספר בקטלוג תכ״ם הנוכחי. תוקף ההפניה למועד שנבחר לא אומת.",
        );
      return unknown(
        catalog.source
          ? "מספר ההוראה לא נמצא בקטלוג ההוראות הציבורי של תכ״ם."
          : "מספר ההוראה מחוץ למדגם המקומי.",
      );
    }
    if (!number && !catalog.source)
      return unknown("זוהה שם הוראה ללא מספר. נדרש אימות הזיהוי.");
    if (!item) return [];
    if (item.historyUnavailable)
      return unknown(
        "ההוראה נמצאה בתכ״ם, אך לא ניתן היה לקבל את תאריכי המהדורות שלה.",
      );
    const active = editionOn(item, day, catalog.collectedOn);
    const result = (status: Finding["status"], reason: string): Finding => ({
      ...base,
      status,
      reason,
      edition: active,
    });
    if (!active) {
      const covering = item.versions.filter(
        (v) => v.from <= day && (!v.to || day <= v.to),
      );
      const reason =
        day > (item.asOf ?? catalog.collectedOn)
          ? "מועד הפרסום מאוחר ממועד נתוני התוקף הזמינים לבדיקה."
          : covering.length > 1
            ? "במקור רשומות כמה מהדורות שחופפות במועד הפרסום. נדרש אימות ידני."
            : "ההוראה נמצאה, אך אין במקור מהדורה עם תקופת תוקף שמכסה את מועד הפרסום.";
      return [result("unknown", reason)];
    }
    if (!number)
      return [
        result(
          "info",
          "ההוראה זוהתה לפי הכותרת. מוצגת המהדורה שחלה במועד הפרסום.",
        ),
      ];
    const edition = suffix.match(/מהדורה\s*(?:מס(?:פר|[׳'])?\s*)?(\d+)/);
    const date = suffix.match(
      new RegExp(
        "(?:בתוקף|תחילת (?:ה)?תוקף|תאריך (?:ה)?מהדורה|מהדורה\\s*\\d*\\s*מיום)\\s*(?:החל\\s*)?(?:מ(?:יום|תאריך)?|החל מיום)?[\\s:־–-]*" +
          dayPattern.source,
      ),
    );
    if (date || edition) {
      const written =
        date &&
        [date[3], date[2].padStart(2, "0"), date[1].padStart(2, "0")].join("-");
      if (written && !validDay(written))
        return [result("unknown", "תאריך התוקף שנכתב בטיוטה אינו תאריך תקין.")];
      const agrees =
        (!written || written === active.from) &&
        (!edition || +edition[1] === active.edition);
      const given = [
        edition && "מהדורה " + edition[1],
        written && "תחילת תוקף " + dateLabel(written),
      ]
        .filter(Boolean)
        .join(", ");
      return [
        result(
          agrees ? "match" : "review",
          "בטיוטה מופיע " +
            given +
            ". במועד הפרסום חלה מהדורה " +
            active.edition +
            " מיום " +
            dateLabel(active.from) +
            ".",
        ),
      ];
    }
    if (!previous)
      return [
        result(
          "info",
          catalog.source
            ? "במועד הפרסום חלה מהדורה " +
                active.edition +
                ". ההפניה בטיוטה מציינת את מספר ההוראה בלבד."
            : "הטיוטה מציינת מספר הוראה בלבד. חסר מועד בדיקה קודמת להשוואת מהדורות.",
        ),
      ];
    const prior = editionOn(item, previous, catalog.collectedOn);
    if (!prior)
      return [
        result(
          "unknown",
          "אין מהדורה יחידה במועד הבדיקה הקודמת שאפשר להשוות אליה.",
        ),
      ];
    return [
      result(
        prior.edition === active.edition ? "match" : "review",
        "בבדיקה הקודמת חלה מהדורה " +
          prior.edition +
          " ובמועד הפרסום חלה מהדורה " +
          active.edition +
          ".",
      ),
    ];
  });
}
export function validateDates(publication: string, previous: string) {
  if (
    !validDay(publication) ||
    (previous && (!validDay(previous) || previous > publication))
  )
    throw new Error(
      "יש לבחור תאריך פרסום תקין ומועד בדיקה קודמת שאינו מאוחר ממנו.",
    );
}
export function review(
  passages: Passage[],
  catalog: Catalog,
  publication: string,
  previous = "",
): Report {
  validateDates(publication, previous);
  const rank = { review: 0, unknown: 1, info: 2, match: 3 };
  const findings = passages
    .flatMap((p, index) =>
      inspect(p, catalog, publication, previous).map((f) => ({
        ...f,
        context: passages.slice(Math.max(0, index - 1), index + 2),
      })),
    )
    .sort((a, b) => rank[a.status] - rank[b.status]);
  return {
    collectedOn: catalog.collectedOn,
    source: catalog.source,
    publication,
    previous,
    findings,
  };
}
