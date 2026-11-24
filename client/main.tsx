import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Report, Finding } from "../server/review.ts";
import "./style.css";

const takamSearch = "https://takam.mof.gov.il/document";
const date = (s: string) => s.split("-").reverse().join(".");
const statusText = {
  review: "נדרשת בדיקה",
  unknown: "לא ניתן לאמת",
  info: "לידיעה",
  match: "תואם במועד שנבדק",
};
function FileIcon() {
  return (
    <span className="fileIcon" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
function FindingCard({ f }: { f: Finding }) {
  return (
    <article className={"finding " + f.status}>
      <div className="findingTop">
        <span className="chip">
          {f.historicalSources ? "זוהתה הפניה היסטורית" : statusText[f.status]}
        </span>
        <span>{f.location}</span>
      </div>
      <h3>
        {f.number && <bdi>{f.number}</bdi>} {f.name}
      </h3>
      <blockquote>{f.text}</blockquote>
      <p>{f.reason}</p>
      <div className="evidence">
        {f.edition && (
          <span>
            מהדורה <bdi>{f.edition.edition}</bdi> · בתוקף מ־
            <bdi>{date(f.edition.from)}</bdi>
            {f.edition.to && (
              <>
                {" "}
                עד <bdi>{date(f.edition.to)}</bdi>
              </>
            )}
          </span>
        )}
        {f.source === "local" && <span>נתוני גיבוי מקומיים</span>}
        {f.historicalSources ? (
          f.historicalSources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              {source.label}
            </a>
          ))
        ) : f.url ? (
          <a href={f.url} target="_blank" rel="noreferrer">
            כרטיס ההוראה הרשמי
          </a>
        ) : (
          <>
            {f.number && (
              <a
                className="takam-search-desktop"
                href={takamSearch + "/" + encodeURIComponent(f.number)}
                target="_blank"
                rel="noreferrer"
              >
                חיפוש <bdi>{f.number}</bdi> באתר תכ״ם
              </a>
            )}
            <a
              className={f.number ? "takam-search-mobile" : undefined}
              href={
                f.referenceCode
                  ? takamSearch + "/" + encodeURIComponent(f.referenceCode)
                  : takamSearch
              }
              target="_blank"
              rel="noreferrer"
            >
              {f.referenceCode ? "כרטיס המסמך בתכ״ם" : "חיפוש באתר תכ״ם"}
            </a>
          </>
        )}
      </div>
      <details>
        <summary>הצגת המקום בטיוטה</summary>
        {f.context?.map((p, i) => (
          <div
            className={
              p.location === f.location && p.text === f.text
                ? "passage selected"
                : "passage"
            }
            key={i}
          >
            <b>{p.location}</b>
            <p>{p.text}</p>
          </div>
        ))}
      </details>
    </article>
  );
}
function App() {
  const [file, setFile] = useState<File | null>(null),
    [publication, setPublication] = useState(""),
    [previous, setPrevious] = useState("");
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    output = useRef<HTMLElement>(null);
  useEffect(() => {
    if (report) output.current?.focus();
  }, [report]);
  function choose(f: File | null) {
    setReport(null);
    setError("");
    if (f && (!/\.docx$/i.test(f.name) || f.size > 10485760 || !f.size)) {
      setFile(null);
      setError("יש לבחור קובץ DOCX בגודל עד 10 MB.");
      return;
    }
    setFile(f);
  }
  async function demo() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/examples/eshel-demo.docx");
      if (!r.ok) throw Error();
      choose(new File([await r.blob()], "eshel-demo.docx"));
      setPublication("2025-08-21");
      setPrevious("");
    } catch {
      setError("טעינת הדוגמה נכשלה. אפשר להעלות קובץ מהמחשב.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setReport(null);
    if (!file) {
      setError("יש לבחור טיוטת Word.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("publication", publication);
      form.set("previous", previous);
      const r = await fetch("/api/review", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הבדיקה נכשלה.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header>
        <div className="bar">
          <div className="brand">
            <span className="mark" aria-hidden="true">
              ✓
            </span>
            <strong>תוקף</strong>
            <span className="divider" />
            <span>סביבת בדיקת מכרזים</span>
          </div>
          <div className="project-credit">
            <strong>מטלת בית - משרד האוצר</strong>
            <span>צביקה יאפעי</span>
          </div>
        </div>
      </header>
      <main>
        <div className="intro">
          <h1>בדיקת הפניות במכרז</h1>
          <p>
            העלו טיוטת Word כדי לבדוק אילו הפניות להוראות תכ״ם דורשות עיון לפני
            הפרסום.
          </p>
        </div>
        <div className="layout">
          <section className="panel formPanel">
            <h2>פרטי הבדיקה</h2>
            <form onSubmit={submit}>
              <fieldset disabled={busy}>
                <label className="fieldTitle" htmlFor="doc">
                  טיוטת המכרז
                </label>
                <input
                  id="doc"
                  ref={input}
                  className="hiddenFile"
                  type="file"
                  accept=".docx"
                  onChange={(e) => choose(e.target.files?.[0] || null)}
                />
                <button
                  type="button"
                  className={"drop " + (drag ? "drag" : "")}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    choose(e.dataTransfer.files[0] || null);
                  }}
                  onClick={() => input.current?.click()}
                >
                  <FileIcon />
                  <strong>
                    {file ? <bdi>{file.name}</bdi> : "בחירת קובץ מהמחשב"}
                  </strong>
                  <span>
                    {file
                      ? "לחצו להחלפת הקובץ"
                      : "אפשר גם לגרור לכאן קובץ DOCX עד 10 MB"}
                  </span>
                </button>
                <div className="dates">
                  <label>
                    מועד פרסום המכרז
                    <input
                      aria-label="מועד פרסום המכרז"
                      type="date"
                      required
                      value={publication}
                      onChange={(e) => {
                        setPublication(e.target.value);
                        setReport(null);
                      }}
                    />
                  </label>
                  <label>
                    מועד בדיקה קודמת <small>רשות</small>
                    <input
                      aria-label="מועד בדיקה קודמת"
                      type="date"
                      max={publication || undefined}
                      value={previous}
                      onChange={(e) => {
                        setPrevious(e.target.value);
                        setReport(null);
                      }}
                    />
                  </label>
                </div>
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                <button className="primary" type="submit">
                  {busy ? "בטעינה…" : "בדיקת ההפניות"}
                </button>
              </fieldset>
            </form>
          </section>
          <aside>
            <section className="guide">
              <div className="docart" aria-hidden="true">
                <div className="sheet back" />
                <div className="sheet front">
                  <i />
                  <i />
                  <i />
                  <b>✓</b>
                </div>
              </div>
              <h2>בדיקה לדוגמה</h2>
              <p>
                בדקו את סעיף 5.3 ממכרז אשל הנשיא מול המהדורה שחלה באוגוסט 2025.
              </p>
              <button className="secondary" disabled={busy} onClick={demo}>
                טעינת טיוטה לדוגמה
              </button>
            </section>
            <div className="coverage">
              <b>מקור נתוני התוקף</b>
              <span>
                המהדורות נבדקות לפי מועד הפרסום שבחרתם, על סמך הנתונים הזמינים
                בתכ״ם.
              </span>
            </div>
          </aside>
        </div>
        {report && (
          <section className="results" ref={output} tabIndex={-1}>
            <div className="resultsHead">
              <h2>דוח הבדיקה</h2>
              <span>{report.findings.length} מופעים זוהו</span>
            </div>
            <p>
              מועד פרסום <bdi>{date(report.publication)}</bdi>
              {report.previous && (
                <>
                  {" "}
                  · בדיקה קודמת <bdi>{date(report.previous)}</bdi>
                </>
              )}{" "}
              ·{" "}
              {report.source === "local"
                ? "מועד נתוני הגיבוי"
                : "מועד הבדיקה מול תכ״ם"}{" "}
              <bdi>{date(report.collectedOn)}</bdi>
            </p>
            {report.source === "local" && (
              <p role="status">
                לא ניתן היה להתחבר לאתר תכ״ם. התוצאות הזמינות מבוססות על הגיבוי
                המקומי.
              </p>
            )}
            {report.source === "mixed" && (
              <p role="status">
                בחלק מההפניות לא התקבלו נתוני מהדורות מתכ״ם. מקור הנתונים מצוין
                בממצא.
              </p>
            )}
            {report.findings.length ? (
              report.findings.map((f, i) => <FindingCard key={i} f={f} />)
            ) : (
              <div className="panel">לא זוהו הפניות להוראות תכ״ם בטיוטה.</div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
