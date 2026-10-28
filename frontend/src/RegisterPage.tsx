import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api, errorText, longDate, registerPath, todayLocal,
  type AttendanceKind, type AttendanceStatus, type BranchDetail, type Me, type Register,
} from "./api";
import Layout from "./Layout";
import { cache, isNetworkError, pendingFor, saveOrQueue, useSyncStatus } from "./offline";
import { go, href } from "./router";
import { Empty } from "./ui";

const CHOICES: { value: AttendanceStatus; short: string; label: string }[] = [
  { value: "present", short: "P", label: "Present" },
  { value: "absent", short: "A", label: "Absent" },
  { value: "late", short: "L", label: "Late" },
  { value: "excused", short: "E", label: "Excused" },
];

type Marks = Record<string, { status: AttendanceStatus | null; note: string }>;

function marksFrom(reg: Register): Marks {
  return Object.fromEntries(reg.students.map((s) => [s.id, { status: s.status, note: s.note ?? "" }]));
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function RegisterPage({
  me, onLogout, kind, id, date,
}: { me: Me; onLogout: () => void; kind: AttendanceKind; id: string; date: string }) {
  const cacheKey = `register:${kind}:${id}:${date}`;
  const [reg, setReg] = useState<Register | null>(null);
  const [branch, setBranch] = useState<BranchDetail | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const sync = useSyncStatus();
  const queued = sync.pending.some((p) => p.key === cacheKey);

  const load = useCallback(async () => {
    setError("");
    try {
      const fresh = await api.register(kind, id, date);
      cache.set(cacheKey, fresh);
      setReg(fresh);
      setFromCache(false);
      // If an unsent save is waiting on this phone, show those marks rather than the server's older ones.
      const waiting = pendingFor(cacheKey);
      const m = marksFrom(fresh);
      if (waiting) {
        for (const e of (waiting.body as { entries: { student_id: string; status: AttendanceStatus; note: string | null }[] }).entries) {
          if (m[e.student_id]) m[e.student_id] = { status: e.status, note: e.note ?? "" };
        }
      }
      setMarks(m);
      api.branch(fresh.branch_id).then(setBranch).catch(() => {});
    } catch (err) {
      const saved = cache.get<Register>(cacheKey);
      if (isNetworkError(err) && saved) {
        setReg(saved);
        setMarks(marksFrom(saved));
        setFromCache(true);
      } else {
        setError(isNetworkError(err) ? "You're offline and this register hasn't been opened on this device before." : errorText(err));
      }
    }
  }, [kind, id, date, cacheKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Warn before closing the page with unsaved marks.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    for (const m of Object.values(marks)) c[m.status ?? "unmarked"]++;
    return c;
  }, [marks]);

  function setMark(studentId: string, status: AttendanceStatus) {
    setMarks((m) => ({ ...m, [studentId]: { ...m[studentId], status } }));
    setDirty(true);
    setSavedMsg("");
  }

  function setNote(studentId: string, note: string) {
    setMarks((m) => ({ ...m, [studentId]: { ...m[studentId], note } }));
    setDirty(true);
  }

  function markRestPresent() {
    setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.status ? v : { ...v, status: "present" }])));
    setDirty(true);
    setSavedMsg("");
  }

  async function save() {
    if (!reg) return;
    const entries = Object.entries(marks)
      .filter(([, v]) => v.status)
      .map(([student_id, v]) => ({ student_id, status: v.status as AttendanceStatus, note: v.note.trim() || null }));
    if (entries.length === 0) return setError("Mark at least one student before saving.");
    setBusy(true);
    setError("");
    try {
      const res = await saveOrQueue<Register>({
        key: cacheKey,
        method: "PUT",
        path: registerPath(kind, id),
        body: { on_date: date, entries },
        label: `${reg.title}, ${longDate(date)}`,
      });
      // Keep this device's copy up to date, so it can be reopened offline.
      const local: Register = {
        ...reg,
        students: reg.students.map((s) => ({ ...s, status: marks[s.id]?.status ?? null, note: marks[s.id]?.note || null })),
      };
      if (res.queued) {
        cache.set(cacheKey, local);
        setSavedMsg("Saved on this device. It will send automatically when you're back online.");
      } else {
        cache.set(cacheKey, res.data);
        setReg(res.data);
        setSavedMsg(`Saved at ${time(res.data.last_saved_at ?? new Date().toISOString())}`);
      }
      setDirty(false);
    } catch (err) {
      setError(errorText(err, "Could not save the register."));
    } finally {
      setBusy(false);
    }
  }

  const backTab = href({ page: "branch", id: reg?.branch_id ?? "", tab: "attendance" });
  const crumbs = [
    { label: "Home", href: "#/" },
    ...(branch ? [{ label: branch.name, href: backTab }] : []),
    { label: kind === "night" ? "Night roll call" : reg?.title ?? "Register" },
  ];

  return (
    <Layout me={me} onLogout={onLogout} crumbs={crumbs}>
      {error && <p className="error">{error}</p>}
      {reg && (
        <div className="register">
          <div className="page-head">
            <div>
              <h1>{kind === "night" ? "Night roll call" : `${reg.title} register`}</h1>
              <p className="muted">{longDate(date)}</p>
            </div>
            <input
              type="date"
              aria-label="Register date"
              value={date}
              max={todayLocal()}
              onChange={(e) => {
                if (!e.target.value) return;
                if (dirty && !window.confirm("You have unsaved marks. Leave without saving?")) return;
                go({ page: "register", kind, id, date: e.target.value });
              }}
            />
          </div>

          {fromCache && <p className="banner">You're offline. Showing the copy saved on this device.</p>}
          {queued && !dirty && <p className="banner">Waiting to send. This register is saved on this device and will send when you're online.</p>}

          <div className="count-bar">
            <span className="c-present">Present {counts.present}</span>
            <span className="c-absent">Absent {counts.absent}</span>
            <span className="c-late">Late {counts.late}</span>
            <span className="c-excused">Excused {counts.excused}</span>
            <span className="muted">Not marked {counts.unmarked}</span>
          </div>

          {reg.students.length === 0 ? (
            <Empty>{kind === "night" ? "No boarders at this branch yet." : "No students in this class yet."}</Empty>
          ) : (
            <>
              {counts.unmarked > 0 && (
                <button className="mark-rest" onClick={markRestPresent}>
                  Mark the other {counts.unmarked} present
                </button>
              )}
              <ul className="reg-list">
                {reg.students.map((s) => {
                  const m = marks[s.id] ?? { status: null, note: "" };
                  return (
                    <li key={s.id} className={m.status ? `is-${m.status}` : ""}>
                      <div className="reg-name">
                        <span>{s.full_name}</span>
                        <span className="muted small">
                          {s.admission_no}
                          {kind === "night" && s.class_name ? ` · ${s.class_name}` : ""}
                        </span>
                      </div>
                      <div className="reg-choices" role="radiogroup" aria-label={`Attendance for ${s.full_name}`}>
                        {CHOICES.map((c) => (
                          <button
                            key={c.value}
                            role="radio"
                            aria-checked={m.status === c.value}
                            aria-label={c.label}
                            title={c.label}
                            className={`choice choice-${c.value}${m.status === c.value ? " on" : ""}`}
                            onClick={() => setMark(s.id, c.value)}
                          >
                            {c.short}
                          </button>
                        ))}
                      </div>
                      {(m.status === "absent" || m.status === "excused" || m.status === "late" || m.note) && (
                        <input
                          className="reg-note"
                          aria-label={`Note for ${s.full_name}`}
                          placeholder={m.status === "excused" ? "Reason, e.g. sick bay, exeat" : "Note (optional)"}
                          value={m.note}
                          maxLength={200}
                          onChange={(e) => setNote(s.id, e.target.value)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="save-bar">
            <span className="small muted">
              {dirty
                ? "Unsaved changes"
                : savedMsg || (reg.last_saved_at ? `Last saved at ${time(reg.last_saved_at)}` : "Not saved yet")}
            </span>
            <button className="primary" disabled={busy || reg.students.length === 0} onClick={save}>
              {busy ? "Saving…" : "Save register"}
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
