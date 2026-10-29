import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText, type BranchDetail } from "./api";
import Icon from "./Icon";
import RecordEditor, { RecordForm } from "./RecordEditor";
import {
  FACILITY_KIND, HOSTEL_GENDER, optionsOf, records, structure, VEHICLE_KIND,
  type Bed, type Hostel, type Item, type PersonOption,
} from "./structureApi";
import { Empty, Field, IconButton, Modal } from "./ui";

/** True when the department name only repeats what the facility's name or type already says. */
function sameIdea(dept: string, name: string, kind: string): boolean {
  const words = (x: string) => x.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && w !== "and");
  const seen = new Set([...words(name), ...words(kind)]);
  return words(dept).some((w) => seen.has(w) || seen.has(w.replace(/s$/, "")));
}

type Totals = { facilities: number; places: number; hostels: number; rooms: number; beds: number; vehicles: number; seats: number };

export default function FacilitiesTab({ branch }: { branch: BranchDetail }) {
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [departments, setDepartments] = useState<Item[]>([]);
  const [t, setT] = useState<Totals>({ facilities: 0, places: 0, hostels: 0, rooms: 0, beds: 0, vehicles: 0, seats: 0 });
  const facilityApi = useMemo(() => records("branch", branch.id, "facilities"), [branch.id]);
  const vehicleApi = useMemo(() => records("branch", branch.id, "vehicles"), [branch.id]);

  useEffect(() => {
    structure.staffOptions(branch.school_id).then(setPeople).catch(() => {});
    records("school", branch.school_id, "departments").list().then(setDepartments).catch(() => {});
  }, [branch.school_id]);

  const sum = (list: Item[], key: string) => list.reduce((n, x) => n + (Number(x[key]) || 0), 0);

  return (
    <div className="stack facilities-page">
      <div className="summary-strip">
        <div><Icon name="facilities" size={20} /><strong>{t.facilities}</strong><span>facilities{t.places ? `, room for ${t.places.toLocaleString("en-NG")}` : ""}</span></div>
        <div><Icon name="hostel" size={20} /><strong>{t.hostels}</strong><span>{t.hostels === 1 ? "hostel" : "hostels"}{t.rooms ? `, ${t.rooms} rooms` : ""}</span></div>
        <div><Icon name="bed" size={20} /><strong>{t.beds}</strong><span>{t.beds === 1 ? "bed" : "beds"}</span></div>
        <div><Icon name="bus" size={20} /><strong>{t.vehicles}</strong><span>{t.vehicles === 1 ? "vehicle" : "vehicles"}{t.seats ? `, ${t.seats} seats` : ""}</span></div>
      </div>

      <RecordEditor
        title="Facilities"
        noun="facility"
        intro="Classrooms, labs, library, sick bay, kitchen, halls and sports fields."
        layout="tiles"
        icon={(f) => String(f.kind)}
        onItems={(list) => setT((x) => ({ ...x, facilities: list.length, places: sum(list, "capacity") }))}
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
        summary={(f) => (
          <>
            <strong>{String(f.name)}</strong>
            <span className="muted small block">
              {[
                FACILITY_KIND[f.kind as keyof typeof FACILITY_KIND],
                f.capacity ? `Holds ${f.capacity}` : null,
                f.department_name && !sameIdea(String(f.department_name), String(f.name), FACILITY_KIND[f.kind as keyof typeof FACILITY_KIND])
                  ? String(f.department_name) : null,
                f.in_charge_name ? `In charge: ${f.in_charge_name}` : null,
              ].filter(Boolean).join(", ") || "No details yet"}
            </span>
          </>
        )}
        emptyText="No facilities yet."
      />

      <HostelsCard branch={branch} people={people} onTotals={(h, r, b) => setT((x) => ({ ...x, hostels: h, rooms: r, beds: b }))} />

      <RecordEditor
        title="Vehicles"
        noun="vehicle"
        intro="School buses and other vehicles. Students are put on bus routes later."
        layout="tiles"
        icon={() => "bus"}
        onItems={(list) => setT((x) => ({ ...x, vehicles: list.length, seats: sum(list, "capacity") }))}
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
            {v.plate_number ? <span className="plate">{String(v.plate_number)}</span> : null}
            <span className="muted small block">
              {[
                VEHICLE_KIND[v.kind as keyof typeof VEHICLE_KIND],
                v.capacity ? `${v.capacity} seats` : null,
                v.driver_name ? `Driver: ${v.driver_name}${v.driver_phone ? ` (${v.driver_phone})` : ""}` : null,
              ].filter(Boolean).join(", ")}
            </span>
          </>
        )}
        emptyText="No vehicles yet."
      />
    </div>
  );
}

// ---------------- Hostels with a bed map ----------------

const natural = new Intl.Collator("en", { numeric: true }).compare;
// "Bunk 2 top" before "Bunk 2 bottom", and Bed 2 before Bed 10.
const bedKey = (label: string) => label.replace(/ top$/i, " 1").replace(/ bottom$/i, " 2");
const sortBeds = (beds: Bed[]) => [...beds].sort((a, b) => natural(bedKey(a.label), bedKey(b.label)));
const shortLabel = (label: string) => label.replace(/^Bed /i, "").replace(/^Bunk (\d+) top$/i, "$1T").replace(/^Bunk (\d+) bottom$/i, "$1B");

function HostelsCard({ branch, people, onTotals }: {
  branch: BranchDetail; people: PersonOption[]; onTotals: (hostels: number, rooms: number, beds: number) => void;
}) {
  const hostelApi = useMemo(() => records("branch", branch.id, "hostels"), [branch.id]);
  const [hostels, setHostels] = useState<Hostel[] | null>(null);
  const [editing, setEditing] = useState<Hostel | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    hostelApi.list().then((h) => setHostels(h as unknown as Hostel[])).catch((err) => setError(errorText(err)));
  }, [hostelApi]);
  useEffect(load, [load]);
  useEffect(() => {
    if (hostels) onTotals(hostels.length, hostels.reduce((n, h) => n + h.rooms.length, 0), hostels.reduce((n, h) => n + h.beds.length, 0));
  }, [hostels]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (h: Hostel) => setHostels((list) => (list ?? []).map((x) => (x.id === h.id ? h : x)));

  return (
    <section className="card editor">
      <div className="card-head">
        <div>
          <h2>Hostels</h2>
          <p className="muted small editor-intro">
            {branch.has_boarding
              ? "Boarding houses with their rooms and beds. Boarders are given beds in the boarding module."
              : "This is a day school. To use hostels, change its type to boarding or day and boarding with Rename or change type."}
          </p>
        </div>
        <button className="primary with-icon" onClick={() => setEditing("new")}><Icon name="plus" size={16} />Add hostel</button>
      </div>
      {error && <p className="error">{error}</p>}
      {hostels?.length === 0 && <Empty icon="hostel">No hostels yet.</Empty>}
      <div className="hostel-grid">
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
      </div>
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
  const [managing, setManaging] = useState(false);
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

  const places: { id: string | null; name: string; beds: Bed[] }[] = hostel.rooms.map((r) => ({
    id: r.id, name: r.name, beds: sortBeds(hostel.beds.filter((b) => b.room_id === r.id)),
  }));
  const loose = sortBeds(hostel.beds.filter((b) => !b.room_id));
  if (loose.length || hostel.rooms.length === 0) places.push({ id: null, name: hostel.rooms.length ? "Not in a room" : "Hall", beds: loose });

  return (
    <article className="hostel">
      <header className="hostel-head">
        <span className="item-icon"><Icon name="hostel" size={20} /></span>
        <div className="grow">
          <h3>{hostel.name}</h3>
          <span className="muted small">
            {HOSTEL_GENDER[hostel.gender]}
            {hostel.house_parent_name ? `, house parent ${hostel.house_parent_name}` : ""}
          </span>
        </div>
        <div className="item-actions">
          <IconButton icon="edit" label={`Edit ${hostel.name}`} onClick={onEdit} />
          <IconButton icon="trash" label={`Delete ${hostel.name}`} danger onClick={onDelete} />
        </div>
      </header>

      <div className="hostel-stats">
        <span><strong>{hostel.rooms.length || "No"}</strong> {hostel.rooms.length === 1 ? "room" : "rooms"}</span>
        <span><strong>{hostel.beds.length}</strong> {hostel.beds.length === 1 ? "bed" : "beds"}</span>
      </div>

      {hostel.beds.length === 0 && !managing ? (
        <p className="muted small">No beds yet. Click Rooms and beds to add them.</p>
      ) : (
        places.map((p) => (
          <div key={p.id ?? "loose"} className="room">
            <div className="room-head">
              <span className="small"><strong>{p.name}</strong> <span className="muted">{p.beds.length} {p.beds.length === 1 ? "bed" : "beds"}</span></span>
              {managing && p.id && (
                <button className="ghost small" onClick={() => {
                  if (window.confirm(`Delete ${p.name} and its ${p.beds.length} beds?`)) run(structure.deleteRoom(p.id as string));
                }}>Delete room</button>
              )}
            </div>
            <div className="bed-map">
              {p.beds.map((b) => (
                <button
                  key={b.id}
                  className={`bed${/bottom$/i.test(b.label) ? " lower" : ""}`}
                  title={managing ? `Remove ${b.label}` : b.label}
                  aria-label={managing ? `Remove ${b.label}` : b.label}
                  disabled={!managing}
                  onClick={() => run(structure.deleteBed(b.id))}
                >
                  {shortLabel(b.label)}
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {managing && (
        <div className="hostel-tools">
          <form className="row wrap" onSubmit={addRoom} noValidate>
            <input aria-label="New room name" placeholder="New room, e.g. Room 1" value={roomName} onChange={(e) => { setRoomName(e.target.value); setError(""); }} />
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
          <p className="muted small">Click a bed to remove it.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="manage-toggle" onClick={() => setManaging(!managing)} aria-expanded={managing}>
        {managing ? "Done" : "Rooms and beds"}
      </button>
    </article>
  );
}
