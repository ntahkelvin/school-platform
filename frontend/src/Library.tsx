// The library: the desk (scan a card, scan books, lend or return), the catalogue, loans, reading, cards and labels.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorText, type SchoolClass } from "./api";
import { InsightList, useBusy } from "./GrowthBits";
import { StudentPicker } from "./Helpdesk";
import Icon from "./Icon";
import { PrintSheet, Qr, ScanBox, beep } from "./Scanner";
import {
  lib, loadLibMeta, type BookDetail, type BookIn, type BookRow, type BorrowerInfo, type Found, type LibMeta, type LibOverview, type LibSettings, type LoanRow,
} from "./threeApi";
import { Avatar, Empty, Field, Glyph, hue, Modal, Stat } from "./ui";

const SPINES = ["#1e63d6", "#7c3aed", "#db2777", "#ea580c", "#0d9488", "#16a34a", "#b45309", "#4f46e5", "#be123c", "#0891b2"];
export function bookColour(b: { id: string; colour: string | null }): string {
  if (b.colour) return b.colour;
  let h = 0;
  for (const ch of b.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SPINES[h % SPINES.length];
}
const nice = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function useMeta(): LibMeta | null {
  const [m, setM] = useState<LibMeta | null>(null);
  useEffect(() => { loadLibMeta().then(setM).catch(() => {}); }, []);
  return m;
}

type Seg = "desk" | "books" | "loans" | "reading";
export default function LibraryPage({ schoolId }: { schoolId: string }) {
  const [seg, setSeg] = useState<Seg>(() => { try { return (sessionStorage.getItem("lib-seg") as Seg) || "desk"; } catch { return "desk"; } });
  const pick = (s: Seg) => { setSeg(s); try { sessionStorage.setItem("lib-seg", s); } catch { /* private */ } };
  const [o, setO] = useState<LibOverview | null>(null);
  const [modal, setModal] = useState<null | "settings" | "cards">(null);
  const load = useCallback(() => { lib.overview(schoolId).then(setO).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  return (
    <section className="stack library">
      {o && (
        <div className="stat-strip lib-stats">
          <Stat icon="book" hue="sky" value={o.stats.titles} label="titles" note={`${o.stats.copies} copies`} />
          <Stat icon="log-out" hue="violet" value={o.stats.out} label="on loan" note={`${o.stats.today_out} lent and ${o.stats.today_back} back today`} />
          <Stat icon="hourglass" hue={o.stats.overdue ? "red" : "green"} value={o.stats.overdue} label="overdue" note={o.stats.overdue ? "See Loans" : "All on time"} />
          <Stat icon="users" hue="amber" value={`${o.stats.reader_share}%`} label="of students reading" note={`${o.stats.readers} borrowers this term`} />
        </div>
      )}
      <div className="row wrap">
        <div className="segmented day-segs" role="tablist">
          {([["desk", "Desk", "scan"], ["books", "Books", "book"], ["loans", "Loans", "log-out"], ["reading", "Reading", "trophy"]] as const).map(([k, l, ic]) => (
            <button key={k} role="tab" aria-selected={seg === k} className={seg === k ? "on" : ""} onClick={() => pick(k)}><Icon name={ic} size={16} />{l}</button>
          ))}
        </div>
        <span className="grow" />
        <button className="with-icon" onClick={() => setModal("cards")}><Icon name="id-card" size={16} />Library cards</button>
        <button className="icon-button" aria-label="Library settings" onClick={() => setModal("settings")}><Icon name="settings" size={18} /></button>
      </div>
      {seg === "desk" && <><LibraryDesk schoolId={schoolId} onChange={load} />{o && o.insights.length > 0 && <InsightList items={o.insights} schoolId={schoolId} />}</>}
      {seg === "books" && <BooksTab schoolId={schoolId} onChange={load} />}
      {seg === "loans" && <LoansTab schoolId={schoolId} onChange={load} />}
      {seg === "reading" && <ReadingTab schoolId={schoolId} />}
      {modal === "settings" && <SettingsForm schoolId={schoolId} onClose={() => setModal(null)} />}
      {modal === "cards" && <CardsPicker schoolId={schoolId} onClose={() => setModal(null)} />}
    </section>
  );
}

// ---------- The desk ----------

type Msg = { tone: "good" | "bad" | "info"; text: string } | null;

function LibraryDesk({ schoolId, onChange }: { schoolId: string; onChange: () => void }) {
  const [who, setWho] = useState<BorrowerInfo | null>(null);
  const [basket, setBasket] = useState<{ number: string; title: string; colour: string }[]>([]);
  const [returning, setReturning] = useState<Extract<Found, { kind: "copy" }> | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [staffQ, setStaffQ] = useState("");
  const [staff, setStaff] = useState<{ user_id: string; name: string; job_title: string | null }[]>([]);
  useEffect(() => {
    if (staffQ.trim().length < 2) { setStaff([]); return; }
    const t = setTimeout(() => api.raw<typeof staff>("GET", `/api/schools/${schoolId}/library/staff?q=${encodeURIComponent(staffQ)}`).then(setStaff).catch(() => {}), 220);
    return () => clearTimeout(t);
  }, [schoolId, staffQ]);

  const say = (tone: "good" | "bad" | "info", text: string) => { setMsg({ tone, text }); if (tone !== "info") beep(tone === "good"); };
  const onCode = async (code: string) => {
    setBusy(true);
    try {
      const f = await lib.find(schoolId, code);
      if (f.kind === "borrower") { setWho(f); setBasket([]); setReturning(null); say("info", `${f.borrower.name}: can borrow ${f.can_borrow} more.`); }
      else if (f.copy.status === "on_loan" && f.loan) { setReturning(f); setMsg(null); }
      else if (f.copy.status !== "available") say("bad", `${f.copy.number} is marked ${f.copy.status}. Change it in Books if it has turned up.`);
      else if (!who) say("bad", `Scan the borrower's card first, then ${f.book.title}.`);
      else if (basket.some((b) => b.number === f.copy.number)) say("info", "Already in the pile.");
      else if (basket.length >= who.can_borrow) say("bad", `${who.borrower.name} can only borrow ${who.can_borrow} more.`);
      else { setBasket([...basket, { number: f.copy.number, title: f.book.title, colour: bookColour(f.book) }]); setMsg(null); beep(true); }
    } catch (e) { say("bad", errorText(e)); } finally { setBusy(false); }
  };
  const lend = async () => {
    if (!who) return;
    setBusy(true);
    try {
      const r = await lib.issue(schoolId, { student_id: who.borrower.kind === "student" ? who.borrower.id : null, user_id: who.borrower.kind === "staff" ? who.borrower.id : null,
        numbers: basket.map((b) => b.number) });
      say("good", `Lent ${r.issued.length} book${r.issued.length > 1 ? "s" : ""} to ${who.borrower.name}. Due back ${nice(r.due_on)}.`);
      setWho(r); setBasket([]); onChange();
    } catch (e) { say("bad", errorText(e)); } finally { setBusy(false); }
  };
  const giveBack = async (outcome: string, condition: string | null) => {
    if (!returning) return;
    setBusy(true);
    try {
      const r = await lib.giveBack(schoolId, { number: returning.copy.number, outcome, condition });
      say("good", `${returning.book.title} ${outcome === "returned" ? "is back" : `marked ${outcome}`}${r.late_days ? ` (${r.late_days} days late)` : ""}.${r.keep_for ? ` Keep it aside for ${r.keep_for}, who is waiting.` : ""}`);
      setReturning(null); onChange();
      if (who) lib.borrower(schoolId, who.borrower.kind === "student" ? { student_id: who.borrower.id } : { user_id: who.borrower.id }).then(setWho).catch(() => {});
    } catch (e) { say("bad", errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="lib-desk">
      <section className="card g-card" style={hue("sky")}>
        <h3 className="with-glyph"><Glyph icon="scan" hue="sky" size={32} />Scan a library card or a book</h3>
        <ScanBox onCode={onCode} busy={busy} placeholder="Card, admission number or book number (L00042)" />
        <p className="muted small">To lend: scan the card, then each book, then press Lend. To return: just scan the book.</p>
        {msg && <p className={`desk-msg ${msg.tone}`}><Icon name={msg.tone === "good" ? "circle-check" : msg.tone === "bad" ? "circle-x" : "info"} size={18} />{msg.text}</p>}
        {!who && (
          <div className="row wrap lib-pickers">
            <StudentPicker schoolId={schoolId} value={null} label="Or find a student" onPick={(s) => s && lib.borrower(schoolId, { student_id: s.id }).then((b) => { setWho(b); setBasket([]); }).catch((e) => say("bad", errorText(e)))} />
            <Field label="Or find a member of staff">
              <input value={staffQ} onChange={(e) => setStaffQ(e.target.value)} placeholder="Type a name…" />
              {staff.length > 0 && <ul className="mini-results">{staff.map((x) => <li key={x.user_id}><button type="button" onClick={() => { setStaffQ(""); lib.borrower(schoolId, { user_id: x.user_id }).then((b) => { setWho(b); setBasket([]); }).catch((e) => say("bad", errorText(e))); }}>{x.name}<small>{x.job_title}</small></button></li>)}</ul>}
            </Field>
          </div>
        )}
      </section>

      {returning && (
        <section className="card return-card" style={hue("violet")}>
          <span className="book-mini" style={{ background: bookColour(returning.book) }}><Icon name="book" size={22} /></span>
          <div className="grow">
            <h3>{returning.book.title}</h3>
            <p className="small">{returning.copy.number} · borrowed by <b>{returning.loan!.borrower.name}</b>{returning.loan!.borrower.class_name && ` (${returning.loan!.borrower.class_name})`} · due {nice(returning.loan!.due_on)}
              {returning.loan!.days_late > 0 && <span className="hue-chip" style={hue("red")}>{returning.loan!.days_late} days late</span>}</p>
            <ReturnButtons busy={busy} onReturn={giveBack} />
          </div>
          <button className="icon-button" aria-label="Cancel" onClick={() => setReturning(null)}><Icon name="close" size={16} /></button>
        </section>
      )}

      {who && (
        <section className="card borrower-card" style={hue(who.overdue ? "red" : "teal")}>
          <div className="row">
            <Avatar name={who.borrower.name} size={52} />
            <div className="grow">
              <h3>{who.borrower.name}</h3>
              <p className="muted small">{who.borrower.kind === "student" ? `${who.borrower.class_name ?? ""} · ${who.borrower.admission_no ?? ""}` : who.borrower.job_title ?? "Staff"} · {who.books_ever} books borrowed ever</p>
            </div>
            <span className="borrow-count"><b>{who.can_borrow}</b>of {who.limit} left</span>
            <button className="icon-button" aria-label="Finish with this borrower" onClick={() => { setWho(null); setBasket([]); setMsg(null); }}><Icon name="close" size={16} /></button>
          </div>
          {who.loans.length > 0 && (
            <ul className="loan-mini">{who.loans.map((l) => (
              <li key={l.id} className={l.days_late ? "late" : ""}><span className="book-mini small" style={{ background: bookColour(l.book) }} /><span className="grow"><strong>{l.book.title}</strong><small>{l.number} · due {nice(l.due_on)}</small></span>
                {l.days_late > 0 && <span className="hue-chip" style={hue("red")}>{l.days_late} days late</span>}</li>))}</ul>
          )}
          {who.overdue > 0 && <p className="desk-msg bad"><Icon name="hourglass" size={16} />Overdue books must come back before borrowing more.</p>}
          <div className="basket">
            {basket.length === 0 ? <p className="muted small">Scan the books to lend…</p> : basket.map((b) => (
              <span key={b.number} className="basket-book" style={{ background: b.colour }}><Icon name="book" size={14} /><span>{b.title}</span><small>{b.number}</small>
                <button aria-label={`Take ${b.title} out`} onClick={() => setBasket(basket.filter((x) => x.number !== b.number))}><Icon name="close" size={12} /></button></span>
            ))}
          </div>
          <div className="row"><span className="muted small">Due back {nice(who.due_on)}</span><span className="grow" />
            <button className="primary with-icon big-ok" disabled={busy || basket.length === 0} onClick={lend}><Icon name="check" size={18} />Lend {basket.length || ""} book{basket.length === 1 ? "" : "s"}</button></div>
        </section>
      )}
    </div>
  );
}

function ReturnButtons({ busy, onReturn }: { busy: boolean; onReturn: (outcome: string, condition: string | null) => void }) {
  const [cond, setCond] = useState<string>("");
  return (
    <div className="row wrap">
      <button className="ok-button big-ok with-icon" disabled={busy} autoFocus onClick={() => onReturn("returned", cond || null)}><Icon name="log-in" size={18} />Return</button>
      <select aria-label="Condition" value={cond} onChange={(e) => setCond(e.target.value)}><option value="">Condition as before</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option></select>
      <button disabled={busy} onClick={() => onReturn("damaged", "poor")}>Damaged</button>
      <button className="danger-outline" disabled={busy} onClick={() => { if (confirm("Mark this copy as lost?")) onReturn("lost", null); }}>Lost</button>
    </div>
  );
}

// ---------- Books ----------

function BooksTab({ schoolId, onChange }: { schoolId: string; onChange: () => void }) {
  const meta = useMeta();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [rows, setRows] = useState<BookRow[] | null>(null);
  const [modal, setModal] = useState<null | "add" | string>(null);
  const load = useCallback(() => { lib.books(schoolId, q, cat).then(setRows).catch(() => setRows([])); }, [schoolId, q, cat]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  return (
    <section className="stack">
      <div className="row wrap">
        <label className="search grow"><Icon name="search" size={16} /><input placeholder="Title, author, subject or ISBN…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="primary with-icon" onClick={() => setModal("add")}><Icon name="plus" size={16} />Add a book</button>
      </div>
      {meta && <div className="chips">{[["", "All"], ...Object.entries(meta.categories)].map(([k, l]) => <button key={k} className={`chip pick${cat === k ? " on" : ""}`} onClick={() => setCat(k)}>{l}</button>)}</div>}
      {rows && rows.length === 0 && <Empty icon="book">{q || cat ? "No books match." : "No books yet. Add the first one, with how many copies you have."}</Empty>}
      <div className="book-grid">
        {(rows ?? []).map((b) => (
          <button key={b.id} className="book-card" onClick={() => setModal(b.id)}>
            <span className="book-cover" style={{ ["--book" as string]: bookColour(b) }}>
              <span className="cover-title">{b.title}</span>{b.author && <span className="cover-author">{b.author}</span>}
            </span>
            <span className="book-info">
              <span className={`avail ${b.available ? "yes" : "no"}`}>{b.available ? `${b.available} of ${b.copies} on the shelf` : b.copies ? "All out" : "No copies"}</span>
              <small className="muted">{[b.category_label, b.level, b.shelf && `Shelf ${b.shelf}`].filter(Boolean).join(" · ")}</small>
              {b.holds > 0 && <small className="hold-note"><Icon name="users" size={12} />{b.holds} waiting</small>}
            </span>
          </button>
        ))}
      </div>
      {modal === "add" && <BookForm schoolId={schoolId} onClose={() => setModal(null)} onDone={(d) => { load(); onChange(); setModal(d.id); }} />}
      {modal && modal !== "add" && <BookView id={modal} schoolId={schoolId} onClose={() => setModal(null)} onChange={() => { load(); onChange(); }} />}
    </section>
  );
}

const EMPTY_BOOK: BookIn = { title: "", author: null, isbn: null, publisher: null, year: null, category: "textbook", subject: null, level: null, shelf: null, summary: null, colour: null, copies: 1 };

function BookForm({ schoolId, book, onClose, onDone }: { schoolId: string; book?: BookDetail; onClose: () => void; onDone: (b: BookDetail) => void }) {
  const meta = useMeta();
  const [f, setF] = useState<BookIn>(book ? { ...EMPTY_BOOK, ...book, copies: 0 } : EMPTY_BOOK);
  const [busy, error, run] = useBusy();
  const set = (k: keyof BookIn, v: string) => setF({ ...f, [k]: k === "year" || k === "copies" ? (v ? Number(v) : null) : v || null });
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => onDone(book ? await lib.editBook(book.id, f) : await lib.addBook(schoolId, f))); };
  return (
    <Modal title={book ? "Edit book" : "Add a book"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Title"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Things Fall Apart" /></Field>
        <div className="row wrap">
          <Field label="Author"><input value={f.author ?? ""} onChange={(e) => set("author", e.target.value)} /></Field>
          <Field label="Kind"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{meta && Object.entries(meta.categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <div className="row wrap">
          <Field label="Subject"><input value={f.subject ?? ""} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Mathematics" /></Field>
          <Field label="Class level"><input value={f.level ?? ""} onChange={(e) => set("level", e.target.value)} placeholder="e.g. SS 1, All" /></Field>
          <Field label="Shelf"><input value={f.shelf ?? ""} onChange={(e) => set("shelf", e.target.value)} placeholder="e.g. A3" /></Field>
        </div>
        <div className="row wrap">
          <Field label="ISBN (optional)"><input value={f.isbn ?? ""} onChange={(e) => set("isbn", e.target.value)} /></Field>
          <Field label="Publisher"><input value={f.publisher ?? ""} onChange={(e) => set("publisher", e.target.value)} /></Field>
          <Field label="Year"><input type="number" value={f.year ?? ""} onChange={(e) => set("year", e.target.value)} /></Field>
        </div>
        {!book && <Field label="How many copies do you have?" hint="Each copy gets its own number (L00001…) to stick inside the cover."><input type="number" min={0} max={300} value={f.copies} onChange={(e) => setF({ ...f, copies: Number(e.target.value) })} /></Field>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function BookView({ id, schoolId, onClose, onChange }: { id: string; schoolId: string; onClose: () => void; onChange: () => void }) {
  const [b, setB] = useState<BookDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [more, setMore] = useState(1);
  const [busy, error, run] = useBusy();
  useEffect(() => { lib.book(id).then(setB).catch(() => {}); }, [id]);
  if (!b) return <Modal title="Book" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  if (editing) return <BookForm schoolId={schoolId} book={b} onClose={() => setEditing(false)} onDone={(x) => { setB(x); setEditing(false); onChange(); }} />;
  const done = (x: BookDetail) => { setB(x); onChange(); };
  return (
    <Modal title={b.title} onClose={onClose}>
      <div className="book-head">
        <span className="book-cover small" style={{ ["--book" as string]: bookColour(b) }}><span className="cover-title">{b.title}</span></span>
        <div className="grow">
          <p className="small">{[b.author, b.publisher, b.year].filter(Boolean).join(" · ")}</p>
          <p className="muted small">{[b.category_label, b.subject, b.level, b.shelf && `Shelf ${b.shelf}`, b.isbn && `ISBN ${b.isbn}`].filter(Boolean).join(" · ")}</p>
          <p className="small"><b>{b.available}</b> of {b.copies} on the shelf · borrowed {b.borrowed_90} times in 90 days</p>
          <div className="row wrap">
            <button className="with-icon small" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Edit</button>
            <button className="with-icon small" onClick={() => setLabels(b.copy_list.map((c) => c.number))}><Icon name="scan-qr" size={14} />Print number labels</button>
            <button className="text-link danger-hover small" onClick={() => run(async () => { if (confirm(`Remove “${b.title}” and all its copies?`)) { await lib.removeBook(b.id); onChange(); onClose(); } })}>Remove</button>
          </div>
        </div>
      </div>
      <h4 className="goals-title"><Icon name="layers" size={16} />Copies</h4>
      <ul className="copy-list">
        {b.copy_list.map((c) => (
          <li key={c.id} className={`c-${c.status}`}>
            <span className="copy-no">{c.number}</span>
            <span className="grow">{c.loan ? <>With <b>{c.loan.borrower.name}</b>, due {nice(c.loan.due_on)}{c.loan.days_late > 0 && <span className="hue-chip" style={hue("red")}>{c.loan.days_late}d late</span>}</> : c.status_label}</span>
            <select aria-label={`Condition of ${c.number}`} value={c.condition} disabled={busy} onChange={(e) => run(async () => done(await lib.editCopy(c.id, { condition: e.target.value })))}>
              <option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option></select>
            {c.status !== "on_loan" && (
              <select aria-label={`Status of ${c.number}`} value={c.status} disabled={busy} onChange={(e) => run(async () => done(await lib.editCopy(c.id, { status: e.target.value })))}>
                <option value="available">On the shelf</option><option value="damaged">Damaged</option><option value="lost">Lost</option><option value="withdrawn">Withdrawn</option></select>
            )}
          </li>
        ))}
      </ul>
      <div className="row"><input type="number" min={1} max={300} value={more} onChange={(e) => setMore(Number(e.target.value))} aria-label="How many more copies" style={{ width: 80 }} />
        <button className="with-icon small" disabled={busy} onClick={() => run(async () => { const x = await lib.addCopies(b.id, more); done(x); setLabels(x.new_numbers ?? null); })}><Icon name="plus" size={14} />Add copies</button></div>
      {b.holds.length > 0 && <><h4 className="goals-title"><Icon name="users" size={16} />Waiting</h4>
        <ol className="hold-list">{b.holds.map((h) => <li key={h.id}><span className="grow">{h.who.name}{h.who.class_name && ` · ${h.who.class_name}`}</span><small>{nice(h.at)}</small>
          <button className="chip-x" aria-label="Remove from the queue" onClick={() => run(async () => { await lib.cancelHold(h.id); setB(await lib.book(b.id)); })}><Icon name="close" size={12} /></button></li>)}</ol></>}
      <AddHold schoolId={schoolId} bookId={b.id} onDone={(x) => setB(x)} />
      {b.history.length > 0 && <><h4 className="goals-title"><Icon name="history" size={16} />Recent loans</h4>
        <ul className="loan-history">{b.history.slice(0, 12).map((l) => <li key={l.id}><span className="grow">{l.borrower.name}<small>{l.number}</small></span><small>{nice(l.issued_at)} → {l.returned_at ? nice(l.returned_at) : "out"}</small></li>)}</ul></>}
      {error && <p className="error">{error}</p>}
      {labels && <CopyLabels schoolId={schoolId} numbers={labels} onClose={() => setLabels(null)} />}
    </Modal>
  );
}

function AddHold({ schoolId, bookId, onDone }: { schoolId: string; bookId: string; onDone: (b: BookDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  if (!open) return <button className="text-link small" onClick={() => setOpen(true)}>+ Put a student in the queue</button>;
  return (
    <div className="stack">
      <StudentPicker schoolId={schoolId} value={null} label="Student waiting for this book" onPick={(s) => s && lib.hold(schoolId, bookId, s.id).then((x) => { onDone(x as BookDetail); setOpen(false); }).catch((e) => setError(errorText(e)))} />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CopyLabels({ schoolId, numbers, onClose }: { schoolId: string; numbers: string[]; onClose: () => void }) {
  const [d, setD] = useState<{ school: string; labels: { number: string; title: string; shelf: string | null }[] } | null>(null);
  useEffect(() => { lib.labels(schoolId, numbers).then(setD).catch(() => {}); }, [schoolId, numbers]);
  return (
    <PrintSheet title="Book number labels" note="Stick one inside each cover." onClose={onClose}>
      <div className="label-sheet">{(d?.labels ?? []).map((l) => (
        <div key={l.number} className="qr-label"><Qr text={l.number} size={64} /><span><b>{l.number}</b><small>{l.title}</small><small>{d?.school}{l.shelf ? ` · ${l.shelf}` : ""}</small></span></div>
      ))}</div>
    </PrintSheet>
  );
}

// ---------- Loans ----------

function LoansTab({ schoolId, onChange }: { schoolId: string; onChange: () => void }) {
  const [scope, setScope] = useState<"overdue" | "out" | "recent">("overdue");
  const [rows, setRows] = useState<LoanRow[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  const load = useCallback(() => { lib.loans(schoolId, scope).then(setRows).catch(() => setRows([])); }, [schoolId, scope]);
  useEffect(load, [load]);
  return (
    <section className="stack">
      <div className="row wrap">
        <div className="segmented small-seg">{([["overdue", "Overdue"], ["out", "All out"], ["recent", "Recent"]] as const).map(([k, l]) => <button key={k} className={scope === k ? "on" : ""} onClick={() => setScope(k)}>{l}</button>)}</div>
        <span className="grow" />
        <button className="with-icon" disabled={busy} onClick={() => run(async () => { const r = await lib.remind(schoolId); setNote(`Reminders sent to ${r.teachers} form teacher${r.teachers === 1 ? "" : "s"} and ${r.staff} staff borrower${r.staff === 1 ? "" : "s"}.`); })}>
          <Icon name="bell" size={15} />Remind form teachers</button>
      </div>
      {note && <p className="saved-note"><Icon name="check" size={15} />{note}</p>}
      {error && <p className="error">{error}</p>}
      {rows && rows.length === 0 && <Empty icon="circle-check">{scope === "overdue" ? "Nothing overdue." : "Nothing here."}</Empty>}
      <ul className="loan-rows">
        {(rows ?? []).map((l) => (
          <li key={l.id} className={l.days_late ? "late" : ""}>
            <span className="book-mini" style={{ background: bookColour(l.book) }}><Icon name="book" size={16} /></span>
            <span className="grow"><strong>{l.book.title}</strong><small>{l.number} · {l.borrower.name}{l.borrower.class_name ? ` (${l.borrower.class_name})` : ""}</small></span>
            <span className="loan-when">{l.returned_at ? <>back {nice(l.returned_at)}</> : <>due {nice(l.due_on)}</>}{l.days_late > 0 && <b>{l.days_late} days late</b>}</span>
            {!l.returned_at && <span className="row">
              <button className="small" disabled={busy} onClick={() => run(async () => { await lib.renew(l.id); load(); })}>Renew</button>
              <button className="small ok-button" disabled={busy} onClick={() => run(async () => { await lib.giveBack(schoolId, { number: l.number }); load(); onChange(); })}>Returned</button>
            </span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Reading ----------

function ReadingTab({ schoolId }: { schoolId: string }) {
  const [r, setR] = useState<Awaited<ReturnType<typeof lib.reading>> | null>(null);
  useEffect(() => { lib.reading(schoolId).then(setR).catch(() => {}); }, [schoolId]);
  if (!r) return <p className="muted">Loading…</p>;
  const max = Math.max(0.5, ...r.classes.map((c) => c.per_student));
  return (
    <div className="growth-grid">
      <section className="card g-card" style={hue("amber")}>
        <h3 className="with-glyph"><Glyph icon="trophy" hue="amber" size={32} />Top readers this term</h3>
        {r.readers.length === 0 ? <p className="muted small">No loans yet this term.</p> : (
          <ol className="reader-list">{r.readers.map((x, i) => <li key={x.id}><span className={`rank r${i + 1}`}>{i + 1}</span><Avatar name={x.name} size={30} /><span className="grow"><strong>{x.name}</strong><small>{x.class_name}</small></span><b>{x.books}</b></li>)}</ol>
        )}
      </section>
      <section className="card g-card" style={hue("violet")}>
        <h3 className="with-glyph"><Glyph icon="book" hue="violet" size={32} />Most borrowed</h3>
        {r.books.length === 0 ? <p className="muted small">Nothing yet.</p> : <ol className="reader-list">{r.books.map((b, i) => <li key={b.id}><span className={`rank r${i + 1}`}>{i + 1}</span><span className="grow"><strong>{b.title}</strong></span><b>{b.loans}</b></li>)}</ol>}
      </section>
      <section className="card g-card wide" style={hue("teal")}>
        <h3 className="with-glyph"><Glyph icon="classes" hue="teal" size={32} />Books per student, by class</h3>
        <div className="class-bars">{r.classes.map((c) => (
          <div key={c.id} className="class-bar"><span className="cb-name">{c.name}</span><span className="cb-track"><i style={{ width: `${(c.per_student / max) * 100}%` }} /></span><span className="cb-val">{c.per_student}<small>{c.loans} loans</small></span></div>
        ))}</div>
      </section>
    </div>
  );
}

// ---------- Cards and settings ----------

function CardsPicker({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [cls, setCls] = useState("");
  const [print, setPrint] = useState(false);
  useEffect(() => { api.school(schoolId).then((s) => { if (s.campus_id) api.classes(s.campus_id).then(setClasses).catch(() => {}); }).catch(() => {}); }, [schoolId]);
  if (print && cls) return <LibraryCards schoolId={schoolId} classId={cls} onClose={onClose} />;
  return (
    <Modal title="Library cards" onClose={onClose}>
      <p className="muted small">Each student gets a card with a QR code. At the desk, scan the card instead of typing a name.</p>
      <Field label="Class"><select value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Choose…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!cls} onClick={() => setPrint(true)}>Show the cards</button></div>
    </Modal>
  );
}

function LibraryCards({ schoolId, classId, onClose }: { schoolId: string; classId: string; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof lib.cards>> | null>(null);
  useEffect(() => { lib.cards(schoolId, classId).then(setD).catch(() => {}); }, [schoolId, classId]);
  const colour = d?.school.colour || "#1e63d6";
  return (
    <PrintSheet title={`Library cards${d ? `: ${d.class_name}` : ""}`} note="8 cards to an A4 page. Cut along the lines." onClose={onClose}>
      <div className="lib-cards">{(d?.cards ?? []).map((c) => (
        <div key={c.id} className="lib-card" style={{ ["--card" as string]: colour }}>
          <div className="lc-head">{d?.school.logo ? <img src={d.school.logo} alt="" /> : <Icon name="book" size={14} />}<span>{d?.school.name}</span><b>LIBRARY</b></div>
          <div className="lc-body"><span><b>{c.name}</b><small>{d?.class_name}</small><small className="mono">{c.admission_no}</small></span><Qr text={c.code} size={70} /></div>
          <div className="lc-foot">Bring this card to borrow books</div>
        </div>
      ))}</div>
    </PrintSheet>
  );
}

function SettingsForm({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [s, setS] = useState<LibSettings | null>(null);
  const [busy, error, run] = useBusy();
  useEffect(() => { lib.settings(schoolId).then(setS).catch(() => {}); }, [schoolId]);
  if (!s) return <Modal title="Library settings" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const num = (k: keyof LibSettings) => <input type="number" min={0} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />;
  return (
    <Modal title="Library settings" onClose={onClose}>
      <div className="row wrap"><Field label="Students keep books for (days)">{num("student_days")}</Field><Field label="Students may borrow at once">{num("student_max")}</Field></div>
      <div className="row wrap"><Field label="Staff keep books for (days)">{num("staff_days")}</Field><Field label="Staff may borrow at once">{num("staff_max")}</Field></div>
      <Field label="Renewals allowed per loan">{num("renewals")}</Field>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={() => run(async () => { await lib.saveSettings(schoolId, s); onClose(); })}>Save</button></div>
    </Modal>
  );
}

// ---------- On a staff member's own page ----------

export function MyLibraryCard({ schoolId }: { schoolId: string }) {
  const [m, setM] = useState<Awaited<ReturnType<typeof lib.mine>> | null>(null);
  const [find, setFind] = useState(false);
  const load = useCallback(() => { lib.mine(schoolId).then(setM).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  if (!m || (m.librarian && m.loans.length === 0 && m.holds.length === 0)) return null;
  return (
    <section className="card editor portal-card" style={hue("sky")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="book" hue="sky" size={34} />My library</h2></div>
      {m.loans.length === 0 && m.holds.length === 0 && <p className="muted small">No books out. Find a book and ask for it.</p>}
      <ul className="loan-mini">{m.loans.map((l) => <li key={l.id} className={l.days_late ? "late" : ""}><span className="book-mini small" style={{ background: bookColour(l.book) }} />
        <span className="grow"><strong>{l.book.title}</strong><small>due {nice(l.due_on)}</small></span>{l.days_late > 0 && <span className="hue-chip" style={hue("red")}>{l.days_late} days late</span>}</li>)}</ul>
      {m.holds.map((h) => <p key={h.id} className="small"><Icon name={h.ready ? "circle-check" : "hourglass"} size={14} /> {h.title}: {h.ready ? "ready at the library desk" : `${h.ahead} ahead of you`}</p>)}
      <button className="with-icon small" onClick={() => setFind(true)}><Icon name="search" size={14} />Find a book</button>
      {find && <FindBook schoolId={schoolId} onClose={() => { setFind(false); load(); }} />}
    </section>
  );
}

function FindBook({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<BookRow[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { const t = setTimeout(() => { if (q.trim().length >= 2) lib.books(schoolId, q).then(setRows).catch(() => {}); }, 220); return () => clearTimeout(t); }, [schoolId, q]);
  return (
    <Modal title="Find a book" onClose={onClose}>
      <input autoFocus placeholder="Title, author or subject…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick-list">{rows.map((b) => (
        <li key={b.id}><div className="find-row"><span className="book-mini small" style={{ background: bookColour(b) }} /><span className="grow"><strong>{b.title}</strong><small>{b.author} · {b.available ? `${b.available} on the shelf` : "all out"}{b.shelf ? ` · shelf ${b.shelf}` : ""}</small></span>
          {!b.available && <button className="small" onClick={() => lib.hold(schoolId, b.id).then(() => setDone(b.title)).catch((e) => setError(errorText(e)))}>Keep one for me</button>}</div></li>
      ))}</ul>
      {done && <p className="saved-note"><Icon name="check" size={15} />You're in the queue for “{done}”. You'll get a notice when it's back.</p>}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
