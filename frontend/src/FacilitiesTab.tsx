import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorText, type BranchDetail, type StudentRow } from "./api";
import Icon from "./Icon";
import RecordEditor, { RecordForm } from "./RecordEditor";
import { FACILITY_LOOK, HOSTEL_LOOK } from "./look";
import {
  FACILITY_KIND, HOSTEL_GENDER, optionsOf, records, structure, VEHICLE_KIND,
  type Bed, type Hostel, type Item, type PersonOption,
} from "./structureApi";
import { Avatar, Empty, Field, Glyph, hue, IconButton, Modal, Stat } from "./ui";

/** True when the department name only repeats what the facility's name or type already says. */
function sameIdea(dept: string, name: string, kind: string): boolean {
  const words = (x: string) => x.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && w !== "and");
  const seen = new Set([...words(name), ...words(kind)]);
  return words(dept).some((w) => seen.has(w) || seen.has(w.replace(/s$/, "")));
}

type Totals = {
  facilities: number; places: number; hostels: number; rooms: number; beds: number; taken: number; vehicles: number; seats: number;
};

interface Live {
  facilities: Record<string, { open: number; done_90: number; cost_90: number; desk: string | null; live: { big: string; line: string; more: string; alerts: number } | null }>;
  vehicles: Record<string, { expired: string[]; soon: string[]; missing: number; checked: boolean; check_ok: boolean | null; service_due: boolean; out: boolean }>;
}
const DESK_SEG: Record<string, [string, string]> = { kitchen: ["kitchen", "Open the kitchen"], store: ["store", "Open the store"], sickbay: ["sickbay", "Open the sick bay"] };

/** Opens a part of the Operations page. */
export function openOps(schoolId: string, seg: string): void {
  try { sessionStorage.setItem("ops-seg", seg); } catch { /* private mode */ }
  window.location.hash = `#/school/${schoolId}/operations`;
}

export default function FacilitiesTab({ branch }: { branch: BranchDetail }) {
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [history, setHistory] = useState<Item | null>(null);
  const loadLive = useCallback(() => { api.raw<Live>("GET", `/api/schools/${branch.school_id}/facilities/live`).then(setLive).catch(() => {}); }, [branch.school_id]);
  useEffect(loadLive, [loadLive]);
  const [departments, setDepartments] = useState<Item[]>([]);
  const [t, setT] = useState<Totals>({ facilities: 0, places: 0, hostels: 0, rooms: 0, beds: 0, taken: 0, vehicles: 0, seats: 0 });
  const facilityApi = useMemo(() => records("branch", branch.id, "facilities"), [branch.id]);
  const vehicleApi = useMemo(() => records("branch", branch.id, "vehicles"), [branch.id]);

  useEffect(() => {
    structure.staffOptions(branch.school_id).then(setPeople).catch(() => {});
    records("school", branch.school_id, "departments").list().then(setDepartments).catch(() => {});
  }, [branch.school_id]);

  const sum = (list: Item[], key: string) => list.reduce((n, x) => n + (Number(x[key]) || 0), 0);

  return (
    <div className="stack facilities-page">
      <div className="stat-strip">
        <Stat icon="facilities" hue="teal" value={t.facilities} label="facilities" note={t.places ? `Room for ${t.places.toLocaleString("en-NG")}` : undefined} />
        <Stat icon="hostel" hue="violet" value={t.hostels} label={t.hostels === 1 ? "hostel" : "hostels"} note={t.rooms ? `${t.rooms} rooms` : undefined} />
        <Stat icon="bed" hue="indigo" value={t.beds} label={t.beds === 1 ? "bed" : "beds"} note={t.beds ? `${t.taken} taken, ${t.beds - t.taken} free` : undefined} />
        <Stat icon="bus" hue="amber" value={t.vehicles} label={t.vehicles === 1 ? "vehicle" : "vehicles"} note={t.seats ? `${t.seats} seats` : undefined} />
      </div>

      <RecordEditor
        title="Facilities"
        noun="facility"
        intro="Classrooms, labs, library, sick bay, kitchen, halls and sports fields."
        layout="tiles"
        emptyIcon="facilities"
        look={(f) => FACILITY_LOOK[String(f.kind)] ?? FACILITY_LOOK.other}
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
        summary={(f) => {
          const kind = FACILITY_KIND[f.kind as keyof typeof FACILITY_KIND];
          const dept = f.department_name && !sameIdea(String(f.department_name), String(f.name), kind) ? String(f.department_name) : null;
          const l = live?.facilities[f.id];
          const seg = l?.desk ? DESK_SEG[l.desk] : null;
          return (
            <>
              <strong>{String(f.name)}</strong>
              <span className="muted small block">{[kind, dept, f.in_charge_name ? `In charge: ${f.in_charge_name}` : null].filter(Boolean).join(" · ")}</span>
              <span className="pill-row">
                {f.capacity ? <span className="mini-pill"><Icon name="users" size={12} stroke={2.2} />Holds {String(f.capacity)}</span> : null}
                {l && l.open > 0 && <span className="mini-pill" style={hue("orange")}><Icon name="wrench" size={12} />{l.open} open job{l.open > 1 ? "s" : ""}</span>}
                {l && (l.done_90 > 0 || l.open > 0) && <button className="mini-pill as-link" onClick={() => setHistory(f)}><Icon name="history" size={12} />{l.done_90} repair{l.done_90 === 1 ? "" : "s"} in 90 days{l.cost_90 ? ` · \u20a6${Math.round(l.cost_90).toLocaleString()}` : ""}</button>}
              </span>
              {l?.live && seg && (
                <button className="live-line" style={hue(l.desk === "kitchen" ? "lime" : l.desk === "store" ? "amber" : "rose")} onClick={() => openOps(branch.school_id, seg[0])}>
                  <b>{l.live.big}</b><span>{l.live.line}</span><Icon name="chevron-right" size={14} />
                </button>
              )}
            </>
          );
        }}
        emptyText="No facilities yet."
      />

      <HostelsCard branch={branch} people={people}
                   onTotals={(h, r, b, taken) => setT((x) => ({ ...x, hostels: h, rooms: r, beds: b, taken }))} />

      <RecordEditor
        title="Vehicles"
        noun="vehicle"
        intro="School buses and other vehicles. Students are put on bus routes later."
        layout="tiles"
        emptyIcon="bus"
        look={(v) => (v.kind === "bus" ? { icon: "bus", hue: "amber" } : { icon: "car", hue: "sky" })}
        onItems={(list) => setT((x) => ({ ...x, vehicles: list.length, seats: sum(list, "capacity") }))}
        fields={[
          { key: "name", label: "Name", required: true, placeholder: "e.g. Bus 1" },
          { key: "kind", label: "Type", type: "select", required: true, options: optionsOf(VEHICLE_KIND), defaultValue: "bus" },
          { key: "plate_number", label: "Plate number (optional)" },
          { key: "capacity", label: "Seats (optional)", type: "number" },
          { key: "driver_user_id", label: "Driver (on the staff)", type: "person", hint: "They will see this vehicle and its daily check on their page." },
          { key: "driver_name", label: "Or the driver's name, if not on the staff" },
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
              {[VEHICLE_KIND[v.kind as keyof typeof VEHICLE_KIND], v.capacity ? `${v.capacity} seats` : null].filter(Boolean).join(" · ")}
            </span>
            <VehicleStatus v={live?.vehicles[v.id]} onOpen={() => openOps(branch.school_id, "transport")} />
            {v.driver_user_id ? (
              <span className="small block driver"><Icon name="user" size={13} />{people.find((p) => p.id === v.driver_user_id)?.full_name ?? "Driver"}</span>
            ) : v.driver_name ? (
              <span className="small block driver"><Icon name="user" size={13} />{String(v.driver_name)}
                {v.driver_phone ? <a href={`tel:${String(v.driver_phone).replace(/[^\d+]/g, "")}`}>{String(v.driver_phone)}</a> : null}
              </span>
            ) : null}
          </>
        )}
        emptyText="No vehicles yet."
        onChanged={loadLive}
      />
      {history && <FacilityHistory facility={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function VehicleStatus({ v, onOpen }: { v?: Live["vehicles"][string]; onOpen: () => void }) {
  if (!v) return null;
  return (
    <span className="pill-row">
      {v.expired.map((p) => <span key={p} className="mini-pill" style={hue("red")}><Icon name="circle-x" size={12} />{p} expired</span>)}
      {v.soon.map((p) => <span key={p} className="mini-pill" style={hue("amber")}><Icon name="calendar" size={12} />{p} ends soon</span>)}
      {v.missing > 0 && <span className="mini-pill" style={hue("slate")}><Icon name="file" size={12} />{v.missing} paper{v.missing > 1 ? "s" : ""} not recorded</span>}
      <span className="mini-pill" style={hue(!v.checked ? "slate" : v.check_ok ? "green" : "red")}><Icon name={v.checked ? (v.check_ok ? "circle-check" : "circle-x") : "hourglass"} size={12} />{!v.checked ? "Not checked today" : v.check_ok ? "Checked today" : "Check failed"}</span>
      {v.out && <span className="mini-pill" style={hue("violet")}><Icon name="log-out" size={12} />Out on a trip</span>}
      {v.service_due && <span className="mini-pill" style={hue("orange")}><Icon name="wrench" size={12} />Service due</span>}
      <button className="mini-pill as-link" onClick={onOpen}>Transport<Icon name="chevron-right" size={12} /></button>
    </span>
  );
}

function FacilityHistory({ facility, onClose }: { facility: Item; onClose: () => void }) {
  const [h, setH] = useState<{ jobs: { id: string; number: number; title: string; status: string; created_at: string; done_at: string | null; cost: number | null; by: string | null; fixed_by: string | null; rating: number | null }[]; spent: number } | null>(null);
  useEffect(() => { api.raw<typeof h>("GET", `/api/facilities/${facility.id}/history`).then(setH).catch(() => {}); }, [facility.id]);
  return (
    <Modal title={`${String(facility.name)}: jobs and repairs`} onClose={onClose}>
      {!h ? <p className="muted">Loading…</p> : h.jobs.length === 0 ? <Empty icon="wrench">No jobs for this place yet.</Empty> : (
        <>
          <p className="muted small">{h.jobs.length} jobs{h.spent ? `, \u20a6${Math.round(h.spent).toLocaleString()} spent on parts` : ""}.</p>
          <ul className="fac-jobs">
            {h.jobs.map((j) => (
              <li key={j.id} className={j.status === "done" || j.status === "closed" ? "done" : ""}>
                <span className="job-no">#{j.number}</span>
                <span className="grow"><strong>{j.title}</strong>
                  <small className="block muted">{new Date(j.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{j.by && ` · reported by ${j.by}`}{j.fixed_by && ` · ${j.fixed_by}`}{j.cost ? ` · \u20a6${Math.round(j.cost).toLocaleString()}` : ""}{j.rating ? ` · ${"\u2605".repeat(j.rating)}` : ""}</small></span>
                <span className="hue-chip" style={hue(j.status === "done" || j.status === "closed" ? "green" : "orange")}>{j.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

// ---------------- Hostels with a bed map ----------------

const natural = new Intl.Collator("en", { numeric: true }).compare;
// "Bunk 2 top" before "Bunk 2 bottom", and Bed 2 before Bed 10.
const bedKey = (label: string) => label.replace(/ top$/i, " 1").replace(/ bottom$/i, " 2");
const sortBeds = (beds: Bed[]) => [...beds].sort((a, b) => natural(bedKey(a.label), bedKey(b.label)));
const shortLabel = (label: string) => label.replace(/^Bed /i, "").replace(/^Bunk (\d+) top$/i, "$1T").replace(/^Bunk (\d+) bottom$/i, "$1B");
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function HostelsCard({ branch, people, onTotals }: {
  branch: BranchDetail; people: PersonOption[]; onTotals: (hostels: number, rooms: number, beds: number, taken: number) => void;
}) {
  const hostelApi = useMemo(() => records("branch", branch.id, "hostels"), [branch.id]);
  const [hostels, setHostels] = useState<Hostel[] | null>(null);
  const [boarders, setBoarders] = useState<StudentRow[]>([]);
  const [editing, setEditing] = useState<Hostel | "new" | null>(null);
  const [assigning, setAssigning] = useState<{ hostel: Hostel; bed: Bed; place: string } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    hostelApi.list().then((h) => setHostels(h as unknown as Hostel[])).catch((err) => setError(errorText(err)));
  }, [hostelApi]);
  useEffect(load, [load]);
  useEffect(() => {
    api.students(branch.id, {}).then((list) => setBoarders(list.filter((s) => s.boarding_status === "boarder"))).catch(() => {});
  }, [branch.id]);
  useEffect(() => {
    if (!hostels) return;
    const beds = hostels.flatMap((h) => h.beds);
    onTotals(hostels.length, hostels.reduce((n, h) => n + h.rooms.length, 0), beds.length, beds.filter((b) => b.student_id).length);
  }, [hostels]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (h: Hostel) => setHostels((list) => (list ?? []).map((x) => (x.id === h.id ? h : x)));
  const bedOf = new Map((hostels ?? []).flatMap((h) => h.beds.filter((b) => b.student_id).map((b) => [b.student_id as string, { bed: b, hostel: h }] as const)));

  return (
    <section className="card editor">
      <div className="card-head">
        <div>
          <h2>Hostels</h2>
          <p className="muted small editor-intro">
            {branch.has_boarding
              ? "Point at a bed to see who sleeps there. Click a bed to give it to a boarder."
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
            onPick={(bed, place) => setAssigning({ hostel: h, bed, place })}
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
      {assigning && (
        <AssignBed
          {...assigning}
          boarders={boarders}
          bedOf={bedOf}
          onClose={() => setAssigning(null)}
          onDone={() => { setAssigning(null); load(); }}
        />
      )}
    </section>
  );
}

function BedButton({ bed, place, managing, onClick }: { bed: Bed; place: string; managing: boolean; onClick: () => void }) {
  const taken = !!bed.student_id;
  return (
    <button
      className={`bed${/bottom$/i.test(bed.label) ? " lower" : ""}${taken ? " taken" : ""}${managing ? " removing" : ""}`}
      aria-label={managing ? `Remove ${bed.label}` : taken ? `${bed.label}: ${bed.student_name}` : `${bed.label}: empty`}
      title={managing ? `Remove ${bed.label}` : undefined}
      onClick={onClick}
    >
      <span className="bed-label">{shortLabel(bed.label)}</span>
      {taken && <span className="bed-who">{initialsOf(bed.student_name ?? "")}</span>}
      {!managing && (
        <span className="bed-tip" role="tooltip">
          <span className="bed-tip-place">{place} · {bed.label}</span>
          {taken ? (
            <span className="bed-tip-person">
              <Avatar name={bed.student_name ?? ""} size={34} />
              <span>
                <strong>{bed.student_name}</strong>
                <span className="block">{[bed.student_class, bed.student_admission_no].filter(Boolean).join(" · ")}</span>
              </span>
            </span>
          ) : (
            <span className="bed-tip-empty">Empty. Click to give it to a boarder.</span>
          )}
        </span>
      )}
    </button>
  );
}

function HostelBlock({
  hostel, onChanged, onPick, onEdit, onDelete,
}: {
  hostel: Hostel; onChanged: (h: Hostel) => void; onPick: (bed: Bed, place: string) => void; onEdit: () => void; onDelete: () => void;
}) {
  const [managing, setManaging] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [count, setCount] = useState("10");
  const [roomId, setRoomId] = useState("");
  const [bunks, setBunks] = useState(false);
  const [error, setError] = useState("");
  const look = HOSTEL_LOOK[hostel.gender] ?? HOSTEL_LOOK.mixed;

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
  const taken = hostel.beds.filter((b) => b.student_id).length;
  const pct = hostel.beds.length ? Math.round((100 * taken) / hostel.beds.length) : 0;

  return (
    <article className="hostel" style={hue(look.hue)}>
      <header className="hostel-head">
        <Glyph icon="hostel" hue={look.hue} size={48} />
        <div className="grow">
          <h3>{hostel.name}</h3>
          <span className="hue-chip"><Icon name={look.icon} size={12} stroke={2.4} />{HOSTEL_GENDER[hostel.gender]}</span>
          {hostel.house_parent_name && <span className="muted small"> House parent {hostel.house_parent_name}</span>}
        </div>
        <div className="item-actions">
          <IconButton icon="edit" label={`Edit ${hostel.name}`} onClick={onEdit} />
          <IconButton icon="trash" label={`Delete ${hostel.name}`} danger onClick={onDelete} />
        </div>
      </header>

      <div className="occupancy">
        <div className="occupancy-text">
          <span><strong>{taken}</strong> of {hostel.beds.length} beds taken</span>
          <span className="muted">{hostel.rooms.length ? `${hostel.rooms.length} ${hostel.rooms.length === 1 ? "room" : "rooms"}` : "One open hall"}</span>
        </div>
        <div className="occupancy-bar"><span style={{ width: `${pct}%` }} /></div>
      </div>

      {hostel.beds.length === 0 && !managing ? (
        <p className="muted small">No beds yet. Click Rooms and beds to add them.</p>
      ) : (
        places.map((p) => (
          <div key={p.id ?? "loose"} className="room">
            <div className="room-head">
              <span className="small"><strong>{p.name}</strong> <span className="muted">{p.beds.filter((b) => b.student_id).length}/{p.beds.length}</span></span>
              {managing && p.id && (
                <button className="ghost small" onClick={() => {
                  if (window.confirm(`Delete ${p.name} and its ${p.beds.length} beds?`)) run(structure.deleteRoom(p.id as string));
                }}>Delete room</button>
              )}
            </div>
            <div className="bed-map">
              {p.beds.map((b) => (
                <BedButton key={b.id} bed={b} place={p.name} managing={managing}
                           onClick={() => (managing ? run(structure.deleteBed(b.id)) : onPick(b, p.name))} />
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
      <div className="hostel-foot">
        <span className="legend"><span className="bed-dot" />Empty</span>
        <span className="legend"><span className="bed-dot taken" />Taken</span>
        <button className="manage-toggle" onClick={() => setManaging(!managing)} aria-expanded={managing}>
          <Icon name={managing ? "close" : "bed"} size={15} />{managing ? "Done" : "Rooms and beds"}
        </button>
      </div>
    </article>
  );
}

function AssignBed({ hostel, bed, place, boarders, bedOf, onClose, onDone }: {
  hostel: Hostel; bed: Bed; place: string; boarders: StudentRow[];
  bedOf: Map<string, { bed: Bed; hostel: Hostel }>; onClose: () => void; onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const wanted = hostel.gender === "boys" ? "male" : hostel.gender === "girls" ? "female" : null;
  const fits = boarders
    .filter((s) => !wanted || s.gender === wanted)
    .filter((s) => s.id !== bed.student_id)
    .filter((s) => !q || `${s.first_name} ${s.last_name} ${s.admission_no} ${s.class_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(bedOf.has(a.id)) - Number(bedOf.has(b.id)) || natural(a.last_name, b.last_name));

  const save = (studentId: string | null) => {
    setBusy(true);
    structure.assignBed(bed.id, studentId).then(onDone).catch((err) => { setError(errorText(err)); setBusy(false); });
  };

  return (
    <Modal title={`${hostel.name} · ${place} · ${bed.label}`} onClose={onClose}>
      <div className="stack">
        {bed.student_id ? (
          <div className="occupant" style={hue(HOSTEL_LOOK[hostel.gender]?.hue ?? "violet")}>
            <Avatar name={bed.student_name ?? ""} size={48} />
            <div className="grow">
              <span className="muted small">Sleeps here now</span>
              <strong className="block">{bed.student_name}</strong>
              <span className="small muted">{[bed.student_class, bed.student_admission_no].filter(Boolean).join(" · ")}</span>
            </div>
            <button className="danger-outline" disabled={busy} onClick={() => save(null)}>Empty this bed</button>
          </div>
        ) : (
          <p className="small muted">This bed is empty. Choose a boarder to sleep here.</p>
        )}
        <label className="search">
          <Icon name="search" size={17} />
          <input aria-label="Find a boarder" placeholder="Find a boarder by name, class or number" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        {fits.length === 0 ? (
          <Empty icon="students">
            {boarders.length === 0 ? "No boarders yet. Mark students as boarders when you add them." : "No boarders match."}
          </Empty>
        ) : (
          <ul className="pick-list">
            {fits.slice(0, 60).map((s) => {
              const has = bedOf.get(s.id);
              return (
                <li key={s.id}>
                  <button disabled={busy} onClick={() => save(s.id)}>
                    <Avatar name={`${s.first_name} ${s.last_name}`} size={36} />
                    <span className="grow">
                      <strong>{s.first_name} {s.last_name}</strong>
                      <span className="small muted block">{[s.class_name, s.admission_no].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className={`bed-status${has ? "" : " free"}`}>
                      {has ? `${has.hostel.name === hostel.name ? "" : `${has.hostel.name}, `}${has.bed.label} (move)` : "No bed yet"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
