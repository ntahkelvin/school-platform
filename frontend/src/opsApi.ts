// School operations: helpdesk, gate, incidents and sick bay.
import { api } from "./api";
import type { Insight } from "./growthApi";
import type { Hue } from "./look";

export interface Person { user_id: string; name: string | null; job_title: string | null; photo: string | null }
export interface StudentCard { id: string; name: string; admission_no: string; class_name: string | null; gender: string; boarder: boolean }
export interface DeskInfo { label: string; icon: string; hue: Hue }
export interface OpsMeta {
  desks: Record<string, DeskInfo & { words: string[] }>; categories: Record<string, { label: string; desk: string; icon: string; hint: string }>;
  visitor_kinds: Record<string, string>; pass_kinds: Record<string, string>; incident_kinds: Record<string, string>; symptoms: string[]; outcomes: Record<string, string>;
}
export interface Desk extends DeskInfo { key: string; members: (Person & { lead: boolean })[] }
export interface Comment { at: string; by: string; name: string; text: string; kind: string }
export interface Ticket {
  id: string; number: number; desk: string; category: string; title: string; details: string | null; location: string | null; facility_id: string | null;
  priority: "low" | "normal" | "urgent"; status: "new" | "assigned" | "working" | "waiting" | "done" | "closed";
  raised_by: Person | null; assigned_to: Person | null; due_on: string | null; overdue: boolean; photo: string | null; created_at: string;
  done_at: string | null; rating: number | null; feedback: string | null; cost: number | null; comments: Comment[]; can_work: boolean; is_mine: boolean; can_rate: boolean;
}
export interface TicketIn { category: string; title: string; details: string | null; location: string | null; priority: string; photo: string | null }
export interface DeskStats { open: number; overdue: number; urgent: number; done_30: number; avg_hours: number | null; rating: number | null }
export interface Visitor {
  id: string; kind: string; kind_label: string; name: string; phone: string | null; organisation: string | null; purpose: string; to_see: string | null;
  to_see_user_id: string | null; student: StudentCard | null; badge: string | null; vehicle: string | null; people: number; time_in: string; time_out: string | null;
  note: string | null; logged_by: string | null;
}
export interface VisitorIn { kind: string; name: string; phone: string | null; organisation: string | null; purpose: string; to_see: string | null; student_id: string | null; badge: string | null; vehicle: string | null; people: number; note: string | null }
export interface Pass {
  id: string; code: string; student: StudentCard; kind: string; kind_label: string; reason: string; leave_at: string; return_by: string | null;
  escort_name: string | null; escort_phone: string | null; escort_relation: string | null; guardians: { name: string; phone: string | null; relation: string }[];
  status: "requested" | "approved" | "declined" | "out" | "returned" | "cancelled"; requested_by: string | null; approved_by: string | null; decision_note: string | null;
  left_at: string | null; returned_at: string | null; late: boolean; medical_note: boolean; can_decide: boolean; can_gate: boolean; can_cancel: boolean;
}
export interface PassIn { student_id: string; kind: string; reason: string; leave_at: string; return_by: string | null; escort_name: string | null; escort_phone: string | null; escort_relation: string | null }
export interface Gate { visitors: Visitor[]; inside: number; passes: Pass[]; out: number; leaving: number; insights: Insight[] }
export interface Incident {
  id: string; number: number; kind: string; kind_label: string; severity: "minor" | "serious" | "critical"; occurred_at: string; location: string | null;
  summary: string; description: string | null; students: StudentCard[]; staff: Person[]; others: string | null; action_taken: string | null;
  reported_by: Person | null; assigned_to: Person | null; status: "open" | "investigating" | "closed"; outcome: string | null; parents_informed: boolean;
  notes: Comment[]; created_at: string; can_manage: boolean;
}
export interface IncidentIn { kind: string; severity: string; occurred_at: string; location: string | null; summary: string; description: string | null; student_ids: string[]; staff_ids: string[]; others: string | null; action_taken: string | null }
export interface Health { blood_group: string | null; genotype: string | null; allergies: string | null; conditions: string | null; medications: string | null; hospital: string | null; diet: string | null; notes: string | null }
export interface Visit {
  id: string; student: StudentCard | null; staff: Person | null; seen_at: string; complaint: string; symptoms: string[]; temperature: number | null; treatment: string | null;
  medicines: { stock_id: string | null; name: string; quantity: number; dose: string | null }[]; outcome: string; outcome_label: string; parent_informed: boolean;
  follow_up_on: string | null; discharged_at: string | null; nurse: string | null; health: Health | null;
}
export interface VisitIn {
  student_id: string | null; staff_user_id: string | null; complaint: string; symptoms: string[]; temperature: number | null; treatment: string | null;
  medicines: { stock_id: string | null; name: string; quantity: number; dose: string | null }[]; outcome: string; parent_informed: boolean; follow_up_on: string | null;
}
export interface Stock { id: string; name: string; unit: string; quantity: number; reorder_level: number; expiry: string | null; notes: string | null; low: boolean; expired: boolean; expiring: boolean }
export interface Clinic { date: string; visits: Visit[]; lying_in: Visit[]; follow_ups: Visit[]; trend: { date: string; visits: number; fever: number }[]; top_symptoms: { symptom: string; count: number }[]; stock: Stock[]; insights: Insight[] }
export interface OpsOverview {
  tickets: Record<string, DeskStats>; gate: { inside: number; out: number; leaving: number; visitors_today: number };
  clinic: { today: number; lying_in: number; trend: { date: string; visits: number; fever: number }[]; low_stock: number };
  incidents: { open: number; serious: number }; insights: Insight[];
}
export interface MyOps { desks: (DeskInfo & { key: string; open: number })[]; my_open: number; to_rate: number; assigned: number; can_request_pass: boolean; can_approve_pass: boolean; passes_waiting: number }

const g = <T,>(p: string) => api.raw<T>("GET", p);
export const ops = {
  meta: () => g<OpsMeta>("/api/ops/meta"),
  desks: (sid: string) => g<Desk[]>(`/api/schools/${sid}/desks`),
  setDesk: (sid: string, desk: string, user_ids: string[], lead_ids: string[]) => api.raw<Desk[]>("PUT", `/api/schools/${sid}/desks/${desk}`, { user_ids, lead_ids }),
  overview: (sid: string) => g<OpsOverview>(`/api/schools/${sid}/ops/overview`),
  me: (sid: string) => g<MyOps>(`/api/me/schools/${sid}/ops`),
  tickets: (sid: string, scope: "mine" | "desk" | "all", desk?: string) => g<Ticket[]>(`/api/schools/${sid}/tickets?scope=${scope}${desk ? `&desk=${desk}` : ""}`),
  raise: (sid: string, t: TicketIn) => api.raw<Ticket>("POST", `/api/schools/${sid}/tickets`, t),
  act: (id: string, body: { action: string; user_id?: string; text?: string | null; rating?: number; cost?: number | null; priority?: string; desk?: string }) => api.raw<Ticket>("PUT", `/api/tickets/${id}`, body),
  summary: (sid: string) => g<{ desks: Record<string, DeskStats>; insights: Insight[] }>(`/api/schools/${sid}/tickets/summary`),
  students: (sid: string, q: string) => g<StudentCard[]>(`/api/schools/${sid}/ops/students?q=${encodeURIComponent(q)}`),
  gate: (sid: string) => g<Gate>(`/api/schools/${sid}/gate`),
  visitors: (sid: string, q?: string, date?: string) => g<Visitor[]>(`/api/schools/${sid}/visitors?${q ? `q=${encodeURIComponent(q)}` : ""}${date ? `&date=${date}` : ""}`),
  visitorIn: (sid: string, v: VisitorIn) => api.raw<Visitor>("POST", `/api/schools/${sid}/visitors`, v),
  visitorOut: (id: string) => api.raw<Visitor>("PUT", `/api/visitors/${id}/out`, {}),
  passes: (sid: string, view: "open" | "today" | "history" | "mine") => g<Pass[]>(`/api/schools/${sid}/passes?view=${view}`),
  requestPass: (sid: string, p: PassIn) => api.raw<Pass>("POST", `/api/schools/${sid}/passes`, p),
  passAction: (id: string, action: string, note?: string | null) => api.raw<Pass>("PUT", `/api/passes/${id}`, { action, note }),
  passByCode: (sid: string, code: string) => g<Pass>(`/api/schools/${sid}/passes/code/${encodeURIComponent(code)}`),
  incidents: (sid: string) => g<Incident[]>(`/api/schools/${sid}/incidents`),
  report: (sid: string, i: IncidentIn) => api.raw<Incident>("POST", `/api/schools/${sid}/incidents`, i),
  updateIncident: (id: string, body: Partial<{ status: string; severity: string; assigned_to_id: string | null; action_taken: string; outcome: string; parents_informed: boolean; note: string }>) =>
    api.raw<Incident>("PUT", `/api/incidents/${id}`, body),
  clinic: (sid: string, date?: string) => g<Clinic>(`/api/schools/${sid}/clinic${date ? `?date=${date}` : ""}`),
  addVisit: (sid: string, v: VisitIn) => api.raw<Visit>("POST", `/api/schools/${sid}/clinic/visits`, v),
  updateVisit: (id: string, body: { outcome?: string; parent_informed?: boolean; discharge?: boolean; follow_up_on?: string | null }) => api.raw<Visit>("PUT", `/api/clinic/visits/${id}`, body),
  health: (studentId: string) => g<{ student: StudentCard; health: Health | null; can_edit: boolean; visits: Visit[] }>(`/api/students/${studentId}/health`),
  saveHealth: (studentId: string, h: Health) => api.raw<{ student: StudentCard; health: Health | null; can_edit: boolean; visits: Visit[] }>("PUT", `/api/students/${studentId}/health`, h),
  addStock: (sid: string, s: Omit<Stock, "id" | "low" | "expired" | "expiring">) => api.raw<Stock>("POST", `/api/schools/${sid}/clinic/stock`, s),
  editStock: (id: string, s: Omit<Stock, "id" | "low" | "expired" | "expiring">) => api.raw<Stock>("PUT", `/api/clinic/stock/${id}`, s),
  removeStock: (id: string) => api.raw<void>("DELETE", `/api/clinic/stock/${id}`),
};

let metaCache: Promise<OpsMeta> | null = null;
export const loadOpsMeta = () => (metaCache ??= ops.meta().catch((e) => { metaCache = null; throw e; }));

export const TICKET_STATUS: Record<string, { label: string; hue: Hue; icon: string }> = {
  new: { label: "New", hue: "sky", icon: "inbox" }, assigned: { label: "Given to someone", hue: "indigo", icon: "user-check" },
  working: { label: "Being worked on", hue: "violet", icon: "wrench" }, waiting: { label: "Waiting", hue: "amber", icon: "hourglass" },
  done: { label: "Done: please check", hue: "green", icon: "circle-check" }, closed: { label: "Closed", hue: "slate", icon: "check" },
};
export const PRIORITY: Record<string, { label: string; hue: Hue }> = { urgent: { label: "Urgent", hue: "red" }, normal: { label: "Normal", hue: "sky" }, low: { label: "Can wait", hue: "slate" } };
export const PASS_STATUS: Record<string, { label: string; hue: Hue; icon: string }> = {
  requested: { label: "Waiting for approval", hue: "amber", icon: "hourglass" }, approved: { label: "Approved: can leave", hue: "green", icon: "circle-check" },
  declined: { label: "Declined", hue: "red", icon: "circle-x" }, out: { label: "Out of school", hue: "violet", icon: "log-out" },
  returned: { label: "Back in school", hue: "teal", icon: "log-in" }, cancelled: { label: "Cancelled", hue: "slate", icon: "close" },
};
export const SEVERITY: Record<string, { label: string; hue: Hue }> = { minor: { label: "Minor", hue: "amber" }, serious: { label: "Serious", hue: "orange" }, critical: { label: "Critical", hue: "red" } };
export const INC_STATUS: Record<string, { label: string; hue: Hue }> = { open: { label: "Open", hue: "rose" }, investigating: { label: "Being looked into", hue: "amber" }, closed: { label: "Closed", hue: "slate" } };
export const INC_LOOK: Record<string, { icon: string; hue: Hue }> = {
  injury: { icon: "heart-pulse", hue: "rose" }, fight: { icon: "swords", hue: "orange" }, bullying: { icon: "user-x", hue: "violet" },
  theft: { icon: "shopping-bag", hue: "amber" }, damage: { icon: "hammer", hue: "orange" }, security: { icon: "shield", hue: "indigo" },
  fire: { icon: "flame", hue: "red" }, health: { icon: "stethoscope", hue: "pink" }, conduct: { icon: "gavel", hue: "slate" }, other: { icon: "star", hue: "slate" },
};
export const OUTCOME_LOOK: Record<string, { icon: string; hue: Hue }> = {
  class: { icon: "school", hue: "green" }, rest: { icon: "moon", hue: "teal" }, sick_bay: { icon: "bed", hue: "amber" }, home: { icon: "house", hue: "violet" }, hospital: { icon: "heart-pulse", hue: "red" },
};
export const VISITOR_LOOK: Record<string, { icon: string; hue: Hue }> = {
  parent: { icon: "users", hue: "pink" }, visitor: { icon: "user", hue: "blue" }, contractor: { icon: "wrench", hue: "orange" },
  delivery: { icon: "bus", hue: "teal" }, official: { icon: "landmark", hue: "indigo" },
};

/** Shrinks a photo from the camera so it uploads quickly on mobile data. */
export function shrinkPhoto(file: File, max = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.72));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
export const dayTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
/** "2026-11-01T09:30" for <input type="datetime-local"> in Nigerian time. */
export const localInput = (d: Date) => {
  const w = new Date(d.getTime() + 60 * 60 * 1000);   // WAT is UTC+1 all year
  return w.toISOString().slice(0, 16);
};
export const fromLocalInput = (s: string) => `${s}:00+01:00`;
