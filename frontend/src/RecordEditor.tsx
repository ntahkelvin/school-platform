// One reusable card for listing, adding, editing and removing a kind of school record.
// Each screen just describes the fields; this handles the forms, saving and errors.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { errorText } from "./api";
import type { Item, PersonOption } from "./structureApi";
import { Empty, Field, Modal } from "./ui";

export type FieldType = "text" | "textarea" | "number" | "select" | "colour" | "date" | "time" | "person";

export interface FieldDef {
  key: string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  placeholder?: string;
  wide?: boolean; // take the full width of the form
  defaultValue?: string;
  allowNone?: string; // for selects: label of an empty choice, e.g. "All branches"
}

type Values = Record<string, string>;

function toValues(fields: FieldDef[], item?: Item): Values {
  const v: Values = {};
  for (const f of fields) {
    const raw = item?.[f.key];
    v[f.key] = raw === null || raw === undefined ? f.defaultValue ?? "" : String(raw);
    if (f.type === "time" && v[f.key]) v[f.key] = v[f.key].slice(0, 5);
  }
  return v;
}

function toPayload(fields: FieldDef[], values: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key]?.trim() ?? "";
    if (f.type === "number") out[f.key] = v === "" ? null : Number(v);
    else if (f.type === "person" || f.type === "date" || f.type === "select" || f.type === "colour") out[f.key] = v || null;
    else out[f.key] = v;
  }
  return out;
}

function check(fields: FieldDef[], values: Values): string {
  for (const f of fields) {
    const v = values[f.key]?.trim() ?? "";
    if (f.required && !v) return `${f.label.replace(/ \(optional\)$/, "")} is needed.`;
    if (f.type === "number" && v && !/^\d+$/.test(v)) return `${f.label} must be a whole number.`;
  }
  return "";
}

export function RecordForm({
  fields, item, people, submitLabel, onSubmit, onCancel,
}: {
  fields: FieldDef[];
  item?: Item;
  people: PersonOption[];
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Values>(() => toValues(fields, item));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: string, v: string) => {
    setValues((old) => ({ ...old, [key]: v }));
    setError("");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const msg = check(fields, values);
    if (msg) return setError(msg);
    setBusy(true);
    try {
      await onSubmit(toPayload(fields, values));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        {fields.map((f, i) => {
          const v = values[f.key] ?? "";
          let input: ReactNode;
          switch (f.type ?? "text") {
            case "textarea":
              input = <textarea rows={f.wide ? 8 : 3} value={v} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />;
              break;
            case "select":
              input = (
                <select value={v} onChange={(e) => set(f.key, e.target.value)}>
                  {(f.allowNone !== undefined || !f.required) && <option value="">{f.allowNone ?? "Not set"}</option>}
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              );
              break;
            case "person":
              input = (
                <select value={v} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">Nobody yet</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              );
              break;
            case "colour":
              input = (
                <div className="row">
                  <input type="color" value={v || "#0f7a4f"} onChange={(e) => set(f.key, e.target.value)} style={{ width: 56, padding: 4 }} />
                  {v ? <button type="button" className="ghost" onClick={() => set(f.key, "")}>No colour</button> : <span className="muted small">No colour chosen</span>}
                </div>
              );
              break;
            default:
              input = (
                <input
                  type={f.type === "number" ? "text" : f.type ?? "text"}
                  inputMode={f.type === "number" ? "numeric" : undefined}
                  value={v}
                  placeholder={f.placeholder}
                  autoFocus={i === 0}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              );
          }
          return (
            <div key={f.key} className={f.wide || f.type === "textarea" ? "span-all" : ""}>
              <Field label={f.label} hint={f.type === "person" && people.length === 0 ? "Add staff at a branch first, then choose them here." : f.hint}>
                {input}
              </Field>
            </div>
          );
        })}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function RecordEditor({
  title, noun, intro, fields, people, api, summary, emptyText, groupBy, actions, reloadKey, onChanged,
}: {
  title: string;
  noun: string; // "house", "club"...
  intro?: string;
  fields: FieldDef[];
  people: PersonOption[];
  api: {
    list: () => Promise<Item[]>;
    add: (d: Record<string, unknown>) => Promise<Item>;
    update: (id: string, d: Record<string, unknown>) => Promise<Item>;
    remove: (id: string) => Promise<void>;
  };
  summary: (item: Item) => ReactNode;
  emptyText: string;
  groupBy?: (item: Item) => string;
  actions?: (reload: () => void) => ReactNode;
  reloadKey?: unknown;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Item | "new" | null>(null);

  const load = useCallback(() => {
    api.list().then(setItems).catch((err) => setError(errorText(err)));
  }, [api]);
  useEffect(load, [load, reloadKey]);

  const changed = () => {
    load();
    onChanged?.();
  };

  const groups: [string, Item[]][] = [];
  for (const it of items ?? []) {
    const g = groupBy ? groupBy(it) : "";
    const found = groups.find(([name]) => name === g);
    if (found) found[1].push(it);
    else groups.push([g, [it]]);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <div className="row wrap">
          {actions?.(changed)}
          <button className="primary" onClick={() => setEditing("new")}>Add {noun}</button>
        </div>
      </div>
      {intro && <p className="muted small">{intro}</p>}
      {error && <p className="error">{error}</p>}
      {items?.length === 0 && <Empty>{emptyText}</Empty>}
      {groups.map(([g, list]) => (
        <div key={g}>
          {g && <h3 className="group-title">{g}</h3>}
          <ul className="list">
            {list.map((it) => (
              <li key={it.id}>
                <div className="grow">{summary(it)}</div>
                <div className="row">
                  <button className="ghost" onClick={() => setEditing(it)}>Edit</button>
                  <button
                    className="ghost"
                    onClick={() => {
                      const name = String(it.name ?? it.title ?? noun);
                      if (window.confirm(`Delete ${name}? This can't be undone.`))
                        api.remove(it.id).then(changed).catch((err) => setError(errorText(err)));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {editing && (
        <Modal title={editing === "new" ? `Add ${noun}` : `Edit ${noun}`} onClose={() => setEditing(null)}>
          <RecordForm
            fields={fields}
            item={editing === "new" ? undefined : editing}
            people={people}
            submitLabel={editing === "new" ? `Add ${noun}` : "Save changes"}
            onCancel={() => setEditing(null)}
            onSubmit={async (payload) => {
              if (editing === "new") await api.add(payload);
              else await api.update(editing.id, payload);
              setEditing(null);
              changed();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
