// Bulk upload: download a template, fill it in Excel, upload it, check it, bring it in.
import { useEffect, useRef, useState, type DragEvent } from "react";
import { api, errorText, type ImportKind, type ImportResult } from "./api";
import Icon from "./Icon";
import type { Hue } from "./look";
import { Empty, Glyph, hue, Modal, Stat } from "./ui";

/** The order that works best: things later rows depend on come first. */
const ORDER = ["departments", "subjects", "classes", "staff", "board", "students", "facilities", "beds", "bed-assignments",
  "houses", "clubs", "events", "vehicles"];

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadTemplate(branchId: string, kind: string) {
  const { blob, filename } = await api.importTemplate(branchId, kind);
  saveFile(blob, filename);
}

function loginsCsv(result: ImportResult): Blob {
  const q = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Name", "For", "Username", "Password"].map(q).join(",")]
    .concat(result.logins.map((l) => [l.name, l.for, l.username, l.password].map(q).join(",")));
  return new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" });
}

const STATUS: Record<string, { label: string; hue: Hue; icon: string }> = {
  added: { label: "New", hue: "green", icon: "plus" },
  updated: { label: "Update", hue: "blue", icon: "edit" },
  skipped: { label: "Skip", hue: "slate", icon: "close" },
  error: { label: "Problem", hue: "red", icon: "close" },
};

export function ImportWizard({ branchId, kind, onClose, onDone }: {
  branchId: string; kind: ImportKind; onClose: () => void; onDone?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"" | "template" | "checking" | "saving">("");
  const [error, setError] = useState("");
  const [show, setShow] = useState<"all" | "error" | "ok">("all");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function choose(f: File | undefined | null) {
    if (!f) return;
    setFile(f);
    setError("");
    setCheck(null);
    setBusy("checking");
    try {
      const res = await api.importFile(branchId, kind.key, f, false);
      setCheck(res);
      setShow(res.errors ? "error" : "all");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function bringIn() {
    if (!file) return;
    setBusy("saving");
    setError("");
    try {
      const res = await api.importFile(branchId, kind.key, file, true);
      setDone(res);
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files?.[0]);
  };
  const ready = check ? check.added + check.updated : 0;
  const rows = (check?.rows ?? []).filter((r) => show === "all" || (show === "error" ? r.status === "error" : r.status !== "error"));

  return (
    <Modal title={`Upload ${kind.title.toLowerCase()}`} onClose={onClose}>
      <div className="stack wizard" style={hue(kind.hue)}>
        {done ? (
          <>
            <div className="wizard-done">
              <Glyph icon="sparkle" hue="green" size={56} />
              <div>
                <strong>All done</strong>
                <span className="block muted">
                  {done.added} added{done.updated ? `, ${done.updated} updated` : ""}{done.skipped ? `, ${done.skipped} skipped` : ""}
                  {done.errors ? `, ${done.errors} left out because of problems` : ""}.
                </span>
              </div>
            </div>
            {done.logins.length > 0 && (
              <div className="logins-box">
                <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{done.logins.length} new {done.logins.length === 1 ? "login" : "logins"}</strong>
                    <span className="block small muted">Download these now. The passwords won't be shown again.</span>
                  </div>
                  <button className="primary with-icon" onClick={() => saveFile(loginsCsv(done), `${kind.title} logins.csv`)}>
                    <Icon name="chart" size={16} />Download logins
                  </button>
                </div>
                <div className="table-wrap plain logins-table">
                  <table>
                    <thead><tr><th>Name</th><th>For</th><th>Username</th><th>Password</th></tr></thead>
                    <tbody>
                      {done.logins.slice(0, 200).map((l) => (
                        <tr key={l.username}><td>{l.name}</td><td>{l.for}</td><td>{l.username}</td><td className="mono">{l.password}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="row"><button className="primary" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <ol className="wizard-steps">
              <li className={check ? "done" : "now"}>
                <span className="step-dot">1</span>
                <div className="grow">
                  <strong>Get the template</strong>
                  <span className="block small muted">An Excel file with the right columns and drop-down lists for this school. Fill it in, or paste from your own list.</span>
                  <div className="col-chips">
                    {kind.columns.map((c) => (
                      <span key={c.header} className={`col-chip${c.required ? " need" : ""}`} title={c.hint || undefined}>{c.header}{c.required ? " *" : ""}</span>
                    ))}
                  </div>
                </div>
                <button className="with-icon" disabled={busy === "template"} onClick={() => {
                  setBusy("template");
                  downloadTemplate(branchId, kind.key).catch((err) => setError(errorText(err))).finally(() => setBusy(""));
                }}>
                  <Icon name="chart" size={16} />{busy === "template" ? "Making…" : "Download template"}
                </button>
              </li>
              <li className={check ? "done" : ""}>
                <span className="step-dot">2</span>
                <div className="grow">
                  <strong>Upload the filled file</strong>
                  <label className={`drop-zone${over ? " over" : ""}`}
                         onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
                    <input ref={input} type="file" accept=".xlsx,.xlsm,.csv" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
                    <Glyph icon="layers" hue={kind.hue} size={44} soft />
                    <span>
                      <strong>{file ? file.name : "Drop the file here or click to choose"}</strong>
                      <span className="block small muted">Excel (.xlsx) or CSV. Nothing is saved yet: we check it first.</span>
                    </span>
                  </label>
                </div>
              </li>
            </ol>

            {busy === "checking" && <div className="checking"><span className="spinner" />Checking every row…</div>}
            {error && <p className="error">{error}</p>}

            {check && busy !== "checking" && (
              <>
                <div className="stat-strip">
                  <Stat icon="plus" hue="green" value={check.added} label="new" />
                  <Stat icon="edit" hue="blue" value={check.updated} label="updates" />
                  <Stat icon="close" hue={check.errors ? "red" : "slate"} value={check.errors} label="problems" note={check.skipped ? `${check.skipped} skipped` : undefined} />
                  <Stat icon="user-plus" hue="violet" value={check.new_logins} label="new logins" />
                </div>
                {check.unknown_columns.length > 0 && (
                  <p className="small notice-line">
                    <Icon name="sparkle" size={14} /> These columns were ignored: {check.unknown_columns.join(", ")}.
                  </p>
                )}
                <div className="filter-chips">
                  <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All rows<span className="chip-count">{check.total}</span></button>
                  <button className={show === "ok" ? "on" : ""} style={hue("green")} onClick={() => setShow("ok")}>Ready<span className="chip-count">{check.total - check.errors}</span></button>
                  <button className={show === "error" ? "on" : ""} style={hue("red")} onClick={() => setShow("error")}>Problems<span className="chip-count">{check.errors}</span></button>
                </div>
                {rows.length === 0 ? (
                  <Empty icon="sparkle">{show === "error" ? "No problems. Every row is fine." : "Nothing to show."}</Empty>
                ) : (
                  <ul className="check-list">
                    {rows.slice(0, 400).map((r) => {
                      const st = STATUS[r.status];
                      return (
                        <li key={r.row} className={`check-row ${r.status}`} style={hue(st.hue)}>
                          <span className="row-no">Row {r.row}</span>
                          <span className="hue-chip">{st.label}</span>
                          <span className="grow">{r.message}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="wizard-actions">
                  <p className="small muted grow">
                    {check.errors
                      ? "Rows with problems are left out. Fix them in the file and upload it again, or bring in the good rows now."
                      : "Everything looks right."}
                  </p>
                  <button onClick={() => input.current?.click()}>Choose another file</button>
                  <button className="primary with-icon" disabled={!ready || busy === "saving"} onClick={bringIn}>
                    <Icon name="sparkle" size={16} />{busy === "saving" ? "Saving…" : `Bring in ${ready} ${ready === 1 ? "row" : "rows"}`}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Opens the upload window for one kind; used by buttons on the Students and Staff pages. */
export function ImportButton({ branchId, kind, label, onDone }: { branchId: string; kind: string; label?: string; onDone?: () => void }) {
  const [k, setK] = useState<ImportKind | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open && !k) api.importKinds(branchId).then((all) => setK(all.find((x) => x.key === kind) ?? null)).catch(() => {});
  }, [open, k, branchId, kind]);
  return (
    <>
      <button className="with-icon" onClick={() => setOpen(true)}><Icon name="layers" size={16} />{label ?? "Upload from Excel"}</button>
      {open && k && <ImportWizard branchId={branchId} kind={k} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

export default function BulkPage({ branchId }: { branchId: string }) {
  const [kinds, setKinds] = useState<ImportKind[] | null>(null);
  const [open, setOpen] = useState<ImportKind | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.importKinds(branchId)
      .then((k) => setKinds([...k].sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))))
      .catch((err) => setError(errorText(err)));
  }, [branchId]);

  return (
    <div className="stack">
      <div className="bulk-intro">
        <Glyph icon="layers" hue="teal" size={56} />
        <div>
          <strong>Bring in a whole list at once</strong>
          <span className="block small">
            Download a template, fill it in Excel (or paste from the lists you already have), then upload it.
            Every row is checked before anything is saved. Work from top to bottom: staff need departments, students need classes.
          </span>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {kinds === null && !error && <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>}
      <div className="bulk-grid">
        {kinds?.map((k, i) => (
          <article key={k.key} className="bulk-card" style={hue(k.hue)}>
            <span className="bulk-step">{i + 1}</span>
            <Glyph icon={k.icon} hue={k.hue} size={48} />
            <h3>{k.title}</h3>
            <p className="small muted">{k.about}</p>
            <div className="bulk-actions">
              <button className="ghost small with-icon" onClick={() => downloadTemplate(branchId, k.key).catch((err) => setError(errorText(err)))}>
                <Icon name="chart" size={14} />Template
              </button>
              <button className="primary with-icon" onClick={() => setOpen(k)}><Icon name="layers" size={16} />Upload</button>
            </div>
          </article>
        ))}
      </div>
      {open && <ImportWizard branchId={branchId} kind={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
