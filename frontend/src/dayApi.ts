// The staff working day: signing in, leave, duty rota and lesson notes.
import { api, request } from "./api";
import type { Hue } from "./look";

export interface DaySettings {
  day_starts: string; late_after: string; day_ends: string; work_days: number[]; allow_self: boolean;
  latitude: number | null; longitude: number | null; radius_m: number; kiosk_token: string | null;
}
export interface BoardRow {
  user_id: string; name: string; job_title: string | null; department_name: string | null; photo: string | null;
  status: string; time_in: string | null; time_out: string | null; method_in: string | null; note: string | null; leave_kind: string | null;
}
export interface Board { on_date: string; work_day: boolean; day_over: boolean; counts: Record<string, number>; rows: BoardRow[] }
export interface SummaryRow { user_id: string; name: string; job_title: string | null; days: number; present: number; late: number; absent: number; leave: number; average_in: string | null }
export interface Stamp { user_id: string; name: string; photo: string | null; job_title: string | null; action: string; status: string; time_in: string | null; time_out: string | null; message: string }
export interface MyDay { on_date: string; work_day: boolean; status: string; time_in: string | null; time_out: string | null; allow_self: boolean; needs_location: boolean; late_after: string; recent: { date: string; status: string; time_in: string | null }[] }
export interface Leave {
  id: string; user_id: string; name: string; kind: string; kind_label: string; starts_on: string; ends_on: string; days: number;
  reason: string | null; status: string; decided_by: string | null; decision_note: string | null; cover_user_id: string | null; cover_name: string | null; created_at: string;
}
export interface Duty { id: string; user_id: string; name: string; duty: string; on_date: string; note: string | null }
export interface Note {
  id: string; user_id: string; teacher: string; kind: "note" | "scheme"; subject_id: string; subject_name: string; level: string;
  week_starting: string | null; term_label: string | null; topic: string; objectives: string | null; content: string | null;
  status: string; submitted_at: string | null; reviewer: string | null; reviewed_at: string | null; review_note: string | null;
  can_review: boolean; can_edit: boolean;
}
export interface NoteIn {
  kind: "note" | "scheme"; subject_id: string; level: string; week_starting: string | null; term_label: string | null;
  topic: string; objectives: string | null; content: string | null; submit: boolean;
}
export interface MySubject { subject_id: string; subject_name: string; level: string }

export const day = {
  settings: (sid: string) => api.raw<DaySettings>("GET", `/api/schools/${sid}/staff-day/settings`),
  saveSettings: (sid: string, s: Omit<DaySettings, "kiosk_token">) => api.raw<DaySettings>("PUT", `/api/schools/${sid}/staff-day/settings`, s),
  newKiosk: (sid: string) => api.raw<DaySettings>("POST", `/api/schools/${sid}/staff-day/new-kiosk-link`, {}),
  board: (sid: string, date?: string) => api.raw<Board>("GET", `/api/schools/${sid}/staff-attendance${date ? `?date=${date}` : ""}`),
  mark: (sid: string, body: { user_id: string; on_date: string; status: string; time_in?: string | null; note?: string | null }) =>
    api.raw<Board>("POST", `/api/schools/${sid}/staff-attendance/mark`, body),
  summary: (sid: string, from: string, to: string) => api.raw<SummaryRow[]>("GET", `/api/schools/${sid}/staff-attendance/summary?from=${from}&to=${to}`),
  myDay: (sid: string) => api.raw<MyDay>("GET", `/api/me/schools/${sid}/day`),
  sign: (sid: string, pos: { latitude?: number; longitude?: number }) => api.raw<Stamp>("POST", `/api/me/schools/${sid}/sign`, pos),
  leave: (sid: string, mine = false) => api.raw<Leave[]>("GET", `/api/schools/${sid}/leave${mine ? "?mine=true" : ""}`),
  askLeave: (sid: string, body: { kind: string; starts_on: string; ends_on: string; reason: string | null; user_id?: string }) =>
    api.raw<Leave>("POST", `/api/schools/${sid}/leave`, body),
  decide: (id: string, body: { approve: boolean; note: string | null; cover_user_id: string | null }) => api.raw<Leave>("PUT", `/api/leave/${id}/decision`, body),
  cancelLeave: (id: string) => api.raw<Leave>("PUT", `/api/leave/${id}/cancel`, {}),
  duties: (sid: string, from: string, to: string) => api.raw<{ duties: Duty[]; kinds: string[] }>("GET", `/api/schools/${sid}/duties?from=${from}&to=${to}`),
  addDuty: (sid: string, body: { user_id: string; duty: string; on_date: string; until: string | null; note: string | null }) =>
    api.raw<{ added: number }>("POST", `/api/schools/${sid}/duties`, body),
  removeDuty: (id: string) => api.raw<void>("DELETE", `/api/duties/${id}`),
  mySubjects: (sid: string) => api.raw<MySubject[]>("GET", `/api/schools/${sid}/my-subjects`),
  notes: (sid: string, view: "mine" | "review" | "all", status?: string) =>
    api.raw<Note[]>("GET", `/api/schools/${sid}/lesson-notes?view=${view}${status ? `&status=${status}` : ""}`),
  addNote: (sid: string, n: NoteIn) => api.raw<Note>("POST", `/api/schools/${sid}/lesson-notes`, n),
  editNote: (id: string, n: NoteIn) => api.raw<Note>("PUT", `/api/lesson-notes/${id}`, n),
  removeNote: (id: string) => api.raw<void>("DELETE", `/api/lesson-notes/${id}`),
  review: (id: string, approve: boolean, note: string | null) => api.raw<Note>("PUT", `/api/lesson-notes/${id}/review`, { approve, note }),
  // The gate device: no login, the secret kiosk link is its key.
  kiosk: (sid: string, token: string) =>
    request<{ school_name: string; logo: string | null; colour: string | null; motto: string | null; signed_in: number; staff: number; late_after: string }>(
      `/api/kiosk/${sid}`, { headers: { "X-Kiosk-Token": token } }),
  scan: (sid: string, token: string, code: string) =>
    request<Stamp>(`/api/kiosk/${sid}/scan`, { method: "POST", body: JSON.stringify({ code }), headers: { "X-Kiosk-Token": token } }),
};

export const STATUS_LOOK: Record<string, { label: string; hue: Hue; icon: string }> = {
  present: { label: "In on time", hue: "green", icon: "circle-check" },
  late: { label: "Late", hue: "amber", icon: "timer" },
  not_in: { label: "Not in yet", hue: "slate", icon: "hourglass" },
  absent: { label: "Absent", hue: "red", icon: "user-x" },
  excused: { label: "Excused", hue: "sky", icon: "umbrella" },
  leave: { label: "On leave", hue: "violet", icon: "palm-tree" },
  off: { label: "Not a work day", hue: "slate", icon: "moon" },
};
export const METHOD_LOOK: Record<string, { label: string; icon: string }> = {
  scan: { label: "ID card at the gate", icon: "scan-qr" },
  self: { label: "On their phone", icon: "smartphone" },
  admin: { label: "Marked by the office", icon: "clipboard" },
};
export const LEAVE_KINDS: { value: string; label: string; icon: string; hue: Hue }[] = [
  { value: "sick", label: "Sick leave", icon: "heart-pulse", hue: "red" },
  { value: "casual", label: "Casual leave", icon: "coffee", hue: "amber" },
  { value: "annual", label: "Annual leave", icon: "palm-tree", hue: "teal" },
  { value: "maternity", label: "Maternity leave", icon: "baby", hue: "pink" },
  { value: "paternity", label: "Paternity leave", icon: "baby", hue: "sky" },
  { value: "study", label: "Study leave", icon: "graduation-cap", hue: "indigo" },
  { value: "compassionate", label: "Compassionate leave", icon: "hand-heart", hue: "violet" },
  { value: "other", label: "Other", icon: "calendar-x", hue: "slate" },
];
export const leaveLook = (k: string) => LEAVE_KINDS.find((x) => x.value === k) ?? LEAVE_KINDS[LEAVE_KINDS.length - 1];
export const LEAVE_STATUS: Record<string, { label: string; hue: Hue }> = {
  pending: { label: "Waiting", hue: "amber" }, approved: { label: "Approved", hue: "green" },
  declined: { label: "Declined", hue: "red" }, cancelled: { label: "Cancelled", hue: "slate" },
};
export const NOTE_STATUS: Record<string, { label: string; hue: Hue; icon: string }> = {
  draft: { label: "Draft", hue: "slate", icon: "edit" },
  submitted: { label: "Waiting for review", hue: "amber", icon: "send" },
  approved: { label: "Approved", hue: "green", icon: "circle-check" },
  returned: { label: "Returned", hue: "rose", icon: "undo" },
};
const DUTY_HUES: Hue[] = ["teal", "indigo", "orange", "violet", "sky", "rose", "lime", "amber", "fuchsia", "cyan", "blue", "pink"];
export function dutyLook(duty: string, kinds: string[]): { hue: Hue; icon: string } {
  const icons: Record<string, string> = {
    "Teacher on duty": "shield-check", Assembly: "megaphone", "Morning prep": "sun", "Evening prep": "book", "Night duty": "moon",
    "Dining hall": "utensils", "Weekend duty": "calendar-days", Gate: "landmark", "Sick bay visit": "stethoscope", Sports: "trophy",
    "Sunday service / Mass": "church", "Exam invigilation": "clipboard",
  };
  const i = kinds.indexOf(duty);
  let h = 0;
  for (const ch of duty) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { hue: DUTY_HUES[(i >= 0 ? i : h) % DUTY_HUES.length], icon: icons[duty] ?? "star" };
}

// Dates as YYYY-MM-DD in the device's own time (Nigeria for our users).
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s: string, n: number) => { const d = fromIso(s); d.setDate(d.getDate() + n); return iso(d); };
export const monday = (s: string) => { const d = fromIso(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const niceDate = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  fromIso(s).toLocaleDateString("en-GB", opts);
/** Clock time in Nigeria (WAT) for a timestamp from the server. */
export const clock = (t: string | null) => t ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "";
export const hm = (t: string) => t.slice(0, 5);
