import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText, type BranchDetail } from "./api";
import RecordEditor, { RecordForm } from "./RecordEditor";
import {
  FACILITY_KIND, HOSTEL_GENDER, optionsOf, records, structure, VEHICLE_KIND,
  type Bed, type Hostel, type Item, type PersonOption,
} from "./structureApi";
import { Empty, Field, Modal } from "./ui";

export default function FacilitiesTab({ branch }: { branch: BranchDetail }) {
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [departments, setDepartments] = useState<Item[]>([]);
  const facilityApi = useMemo(() => records("branch", branch.id, "facilities"), [branch.id]);
  const vehicleApi = useMemo(() => records("branch", branch.id, "vehicles"), [branch.id]);

  useEffect(() => {
    structure.staffOptions(branch.school_id).then(setPeople).catch(() => {});
    records("school", branch.school_id, "departments").list().then(setDepartments).catch(() => {});
  }, [branch.school_id]);

  return (
    <div className="sections wide">
      <RecordEditor
        title="Facilities"
        noun="facility"
        intro="Classrooms, labs, library, sick bay, kitchen, halls, sports fields..."
        fields={[
          { key: "kind", label: "Type", type: "select", required: true, options: optionsOf(FACILITY_KIND), defaultValue: "classroom" },
          { key: "name", label: "Name", required: true, placeholder: "e.g. Chemistry lab, Classroom 3" },
          { key: "capacity", label: "Capacity (optional)", type: "number", hint: "How many people it holds." },
          { key: "department_id", label: "Department (optional)", type: "select", options: departments.map((d) => ({ value: d.id, label: String(d.name) })) },
          { key: "in_charge_user_id", label: "Person in charge", type: "person" },
          { key: "notes", label: "Notes (optional)", type: "textarea" },
        ]}
        people={people}
        api={facilityApi}
        reloadKey={departments.length}
        groupBy={(f) => FACILITY_KIND[f.kind as keyof typeof FACILITY_KIND]}
        summary={(f) => (
          <>
            <strong>{String(f.name)}</strong>
            <span className="muted small block">
              {[
                f.capacity ? `Holds ${f.capacity}` : null,
                f.department_name ? String(f.department_name) : null,
                f.in_charge_name ? `In charge: ${f.in_charge_name}` : null,
              ].filter(Boolean).join(" · ") || "No details yet"}
            </span>
          </>
        )}
        emptyText="No facilities yet."
      />
      <HostelsCard branch={branch} people={people} />
      <RecordEditor
        title="Vehicles"
        noun="vehicle"
        intro="School buses and other vehicles. Students are put on bus routes later."
        fields={[
          { key: "name", label: "Name", required: true, placeholder: "e.g. Bus 1" },
          { key: "kind", label: "Type", type: "select", required: true, options: optionsOf(VEHICLE_KIND), defaultValue: "bus" },
          { key: "plate_number", label: "Plate number (optional)" },
          { key: "capacity", label: "Seats (optional)", type: "number" },
          { key: "driver_name", label: "Driver's name (optional)" },
          { key: "driver_phone", label: "Driver's phone (optional)" },
          { key: "route", label: "Route (optional)", type: "textarea", placeholder: "e.g. Okija junction, Ihiala, Uli" },
        ]}
        people={people}
        api={vehicleApi}
        summary={(v) => (
          <>
            <strong>{String(v.name)}</strong>
            {v.plate_number ? <span className="mono small"> {String(v.plate_number)}</span> : null}
            <span className="muted small block">
              {[
                VEHICLE_KIND[v.kind as keyof typeof VEHICLE_KIND],
                v.capacity ? `${v.capacity} seats` : null,
                v.driver_name ? `Driver: ${v.driver_name}${v.driver_phone ? ` (${v.driver_phone})` : ""}` : null,
              ].filter(Boolean).join(" · ")}
            </span>
          </>
        )}
        emptyText="No vehicles yet."
      />
    </div>
  );
}

// ---------------- Hostels ----------------

const natural = new Intl.Collator("en", { numeric: true }).compare;
// "Bunk 2 top" before "Bunk 2 bottom", and Bed 2 before Bed 10.
const bedKey = (label: string) => label.replace(/ top$/i, " 1").replace(/ bottom$/i, " 2");
const sortBeds = (beds: Bed[]) => [...beds].sort((a, b) => natural(bedKey(a.label), bedKey(b.label)));

function HostelsCard({ branch, people }: { branch: BranchDetail; people: PersonOption[] }) {
  const hostelApi = useMemo(() => records("branch", branch.id, "hostels"), [branch.id]);
  const [hostels, setHostels] = useState<Hostel[] | null>(null);
  const [editing, setEditing] = useState<Hostel | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    hostelApi.list().then((h) => setHostels(h as unknown as Hostel[])).catch((err) => setError(errorText(err)));
  }, [hostelApi]);
  useEffect(load, [load]);

  const replace = (h: Hostel) => setHostels((list) => (list ?? []).map((x) => (x.id === h.id ? h : x)));
  const totalBeds = (hostels ?? []).reduce((n, h) => n + h.beds.length, 0);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Hostels</h2>
        <button className="primary" onClick={() => setEditing("new")}>Add hostel</button>
      </div>
      <p className="muted small">
        {branch.has_boarding
          ? `Boarding houses, with rooms if you use them, and beds. ${totalBeds} ${totalBeds === 1 ? "bed" : "beds"} in total. Boarders are given beds in the boarding module.`
          : "This is a day school. To use hostels, change its type to boarding or day and boarding with Rename or change type."}
      </p>
      {error && <p className="error">{error}</p>}
      {hostels?.length === 0 && <Empty>No hostels yet.</Empty>}
      {hostels?.map((h) => (
        <HostelBlock
          key={h.id}
          hostel={h}
          onChanged={replace}
          onEdit={() => setEditing(h)}
          onDelete={() => {
            if (window.confirm(`Delete ${h.name} with all its rooms and beds?`))
              hostelApi.remove(h.id).then(load).catch((err) => setError(errorText(err)));
          }}
        />
      ))}
      {editing && (
        <Modal title={editing === "new" ? "Add hostel" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <RecordForm
            fields={[
              { key: "name", label: "Name", required: true, placeholder: "e.g. St Mary's House" },
              { key: "gender", label: "For", type: "select", required: true, options: optionsOf(HOSTEL_GENDER), defaultValue: "girls" },
              { key: "house_parent_user_id", label: "House parent", type: "person" },
              { key: "notes", label: "Notes (optional)", type: "textarea" },
            ]}
            item={editing === "new" ? undefined : (editing as unknown as Item)}
            people={people}
            submitLabel={editing === "new" ? "Add hostel" : "Save changes"}
            onCancel={() => setEditing(null)}
            onSubmit={async (payload) => {
              if (editing === "new") await hostelApi.add(payload);
              else await hostelApi.update(editing.id, payload);
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function HostelBlock({
  hostel, onChanged, onEdit, onDelete,
}: { hostel: Hostel; onChanged: (h: Hostel) => void; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [count, setCount] = useState("10");
  const [roomId, setRoomId] = useState("");
  const [bunks, setBunks] = useState(false);
  const [error, setError] = useState("");

  const run = (p: Promise<Hostel>) => p.then((h) => { onChanged(h); setError(""); }).catch((err) => setError(errorText(err)));

  function addRoom(e: FormEvent) {
    e.preventDefault();
    if (!roomName.trim()) return setError("Enter a room name, e.g. Room 1.");
    run(structure.addRoom(hostel.id, roomName.trim())).then(() => setRoomName(""));
  }

  function addBeds(e: FormEvent) {
    e.preventDefault();
    const n = Number(count);
    if (!/^\d+$/.test(count) || n < 1 || n > 500) return setError("Enter how many beds to add (1 to 500).");
    run(structure.addBeds(hostel.id, n, roomId || null, bunks));
  }

  const places: { id: string | null; name: string; beds: Bed[] }[] = [
    ...hostel.rooms.map((r) => ({ id: r.id, name: r.name, beds: sortBeds(hostel.beds.filter((b) => b.room_id === r.id)) })),
  ];
  const loose = sortBeds(hostel.beds.filter((b) => !b.room_id));
  if (loose.length || hostel.rooms.length === 0) places.push({ id: null, name: hostel.rooms.length ? "Not in a room" : "Beds", beds: loose });

  return (
    <div className="sub-card">
      <div className="card-head">
        <button className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
          <strong>{open ? "▾" : "▸"} {hostel.name}</strong>
          <span className="muted small block">
            {HOSTEL_GENDER[hostel.gender]} · {hostel.rooms.length ? `${hostel.rooms.length} ${hostel.rooms.length === 1 ? "room" : "rooms"} · ` : ""}
            {hostel.beds.length} {hostel.beds.length === 1 ? "bed" : "beds"}{hostel.house_parent_name ? ` · House parent: ${hostel.house_parent_name}` : ""}
          </span>
        </button>
        <div className="row">
          <button className="ghost" onClick={onEdit}>Edit</button>
          <button className="ghost" onClick={onDelete}>Delete</button>
        </div>
      </div>
      {open && (
        <div className="stack">
          <form className="row wrap" onSubmit={addRoom} noValidate>
            <input aria-label="New room name" placeholder="Room name, e.g. Room 1 (optional)" value={roomName} onChange={(e) => { setRoomName(e.target.value); setError(""); }} />
            <button>Add room</button>
          </form>
          <form className="row wrap bed-form" onSubmit={addBeds} noValidate>
            <Field label="Add beds">
              <input aria-label="How many beds" inputMode="numeric" value={count} onChange={(e) => { setCount(e.target.value); setError(""); }} style={{ width: 80 }} />
            </Field>
            {hostel.rooms.length > 0 && (
              <Field label="In room">
                <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  <option value="">No particular room</option>
                  {hostel.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
            <label className="check">
              <input type="checkbox" checked={bunks} onChange={(e) => setBunks(e.target.checked)} />
              Bunk beds (top and bottom)
            </label>
            <button className="primary">Add beds</button>
          </form>
          {error && <p className="error">{error}</p>}
          {places.map((p) => (
            <div key={p.id ?? "loose"} className="room">
              <div className="card-head">
                <strong className="small">{p.name} <span className="muted">({p.beds.length})</span></strong>
                {p.id && (
                  <button
                    className="ghost small"
                    onClick={() => {
                      if (window.confirm(`Delete ${p.name} and its ${p.beds.length} beds?`)) run(structure.deleteRoom(p.id as string));
                    }}
                  >
                    Delete room
                  </button>
                )}
              </div>
              {p.beds.length === 0 ? (
                <span className="muted small">No beds yet.</span>
              ) : (
                <div className="chips">
                  {p.beds.map((b) => (
                    <span key={b.id} className="chip">
                      {b.label}
                      <button className="chip-x" aria-label={`Remove ${b.label}`} onClick={() => run(structure.deleteBed(b.id))}>✕</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
