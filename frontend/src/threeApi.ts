// Library, cleaning rotas and the asset register.
import { api } from "./api";
import type { Insight } from "./growthApi";

const g = <T,>(p: string) => api.raw<T>("GET", p);

// ---------- Library ----------
export interface LibMeta { categories: Record<string, string>; conditions: Record<string, string>; copy_status: Record<string, string> }
export interface BookRow {
  id: string; title: string; author: string | null; isbn: string | null; publisher: string | null; year: number | null; category: string; category_label: string;
  subject: string | null; level: string | null; shelf: string | null; summary: string | null; colour: string | null;
  copies: number; available: number; out: number; holds: number; borrowed_90: number;
}
export interface Borrower { kind: "student" | "staff"; id: string; name: string; class_name?: string | null; admission_no?: string; job_title?: string | null }
export interface LoanRow {
  id: string; book: { id: string; title: string; author: string | null; colour: string | null }; number: string; borrower: Borrower; issued_at: string; due_on: string;
  returned_at: string | null; renewals: number; outcome: string | null; days_late: number; issued_by: string | null;
}
export interface CopyRow { id: string; number: string; status: string; status_label: string; condition: string; note: string | null; loan: LoanRow | null }
export interface BookDetail extends Omit<BookRow, "holds"> { copy_list: CopyRow[]; holds: { id: string; who: Borrower; at: string }[]; history: LoanRow[]; new_numbers?: string[] }
export interface BorrowerInfo { borrower: Borrower; loans: LoanRow[]; limit: number; can_borrow: number; overdue: number; books_ever: number; due_on: string }
export type Found =
  | ({ kind: "copy"; copy: { id: string; number: string; status: string; condition: string }; book: BookRow; loan: LoanRow | null })
  | ({ kind: "borrower" } & BorrowerInfo);
export interface LibOverview {
  stats: { titles: number; copies: number; out: number; overdue: number; today_out: number; today_back: number; term_loans: number; readers: number; reader_share: number };
  overdue: LoanRow[]; insights: Insight[];
}
export interface LibSettings { student_days: number; staff_days: number; student_max: number; staff_max: number; renewals: number }
export interface BookIn {
  title: string; author: string | null; isbn: string | null; publisher: string | null; year: number | null; category: string; subject: string | null;
  level: string | null; shelf: string | null; summary: string | null; colour: string | null; copies: number;
}
export const lib = {
  meta: () => g<LibMeta>("/api/library/meta"),
  overview: (sid: string) => g<LibOverview>(`/api/schools/${sid}/library/overview`),
  settings: (sid: string) => g<LibSettings>(`/api/schools/${sid}/library/settings`),
  saveSettings: (sid: string, s: LibSettings) => api.raw<LibSettings>("PUT", `/api/schools/${sid}/library/settings`, s),
  books: (sid: string, q = "", category = "") => g<BookRow[]>(`/api/schools/${sid}/library/books?q=${encodeURIComponent(q)}${category ? `&category=${category}` : ""}`),
  book: (id: string) => g<BookDetail>(`/api/library/books/${id}`),
  addBook: (sid: string, b: BookIn) => api.raw<BookDetail>("POST", `/api/schools/${sid}/library/books`, b),
  editBook: (id: string, b: BookIn) => api.raw<BookDetail>("PUT", `/api/library/books/${id}`, b),
  removeBook: (id: string) => api.raw<void>("DELETE", `/api/library/books/${id}`),
  addCopies: (id: string, count: number) => api.raw<BookDetail>("POST", `/api/library/books/${id}/copies`, { count }),
  editCopy: (id: string, body: { status?: string; condition?: string; note?: string | null }) => api.raw<BookDetail>("PUT", `/api/library/copies/${id}`, body),
  find: (sid: string, code: string) => g<Found>(`/api/schools/${sid}/library/find?code=${encodeURIComponent(code)}`),
  borrower: (sid: string, who: { student_id?: string; user_id?: string }) =>
    g<BorrowerInfo>(`/api/schools/${sid}/library/borrower?${who.student_id ? `student_id=${who.student_id}` : `user_id=${who.user_id}`}`),
  issue: (sid: string, body: { student_id?: string | null; user_id?: string | null; numbers: string[]; due_on?: string | null; skip_queue?: boolean }) =>
    api.raw<BorrowerInfo & { issued: { number: string; title: string }[] }>("POST", `/api/schools/${sid}/library/issue`, body),
  giveBack: (sid: string, body: { number: string; outcome?: string; condition?: string | null; note?: string | null }) =>
    api.raw<{ loan: LoanRow; late_days: number; keep_for: string | null }>("POST", `/api/schools/${sid}/library/return`, body),
  renew: (id: string) => api.raw<LoanRow>("POST", `/api/library/loans/${id}/renew`),
  loans: (sid: string, scope: "out" | "overdue" | "recent") => g<LoanRow[]>(`/api/schools/${sid}/library/loans?scope=${scope}`),
  hold: (sid: string, book_id: string, student_id?: string) => api.raw<BookDetail | { ok: true }>("POST", `/api/schools/${sid}/library/holds`, { book_id, student_id: student_id ?? null }),
  cancelHold: (id: string) => api.raw<void>("DELETE", `/api/library/holds/${id}`),
  reading: (sid: string) => g<{ since: string; readers: (Borrower & { books: number })[]; books: { id: string; title: string; loans: number }[]; classes: { id: string; name: string; loans: number; students: number; per_student: number }[] }>(`/api/schools/${sid}/library/reading`),
  remind: (sid: string) => api.raw<{ teachers: number; staff: number }>("POST", `/api/schools/${sid}/library/remind`),
  cards: (sid: string, classId: string) => g<{ school: { name: string; logo: string | null; colour: string | null; motto: string | null }; class_name: string; cards: { id: string; name: string; admission_no: string; code: string }[] }>(`/api/schools/${sid}/library/cards?class_id=${classId}`),
  labels: (sid: string, numbers: string[]) => g<{ school: string; labels: { number: string; title: string; shelf: string | null }[] }>(`/api/schools/${sid}/library/labels?numbers=${encodeURIComponent(numbers.join(","))}`),
  mine: (sid: string) => g<{ loans: LoanRow[]; holds: { id: string; title: string; ahead: number; ready: boolean }[]; librarian: boolean }>(`/api/me/schools/${sid}/library`),
};
let libMeta: Promise<LibMeta> | null = null;
export const loadLibMeta = () => (libMeta ??= lib.meta().catch((e) => { libMeta = null; throw e; }));

// ---------- Cleaning ----------
export interface CleanMeta { kinds: Record<string, { label: string; icon: string }>; shifts: Record<string, string>; checklists: Record<string, string[]> }
export interface Duty { weekday: number; user_id: string | null; name: string | null; team: string | null }
export interface Area {
  id: string; name: string; kind: string; kind_label: string; icon: string; days: number[]; shift: string; checklist: string[];
  facility_id: string | null; hostel_id: string | null; place: string | null; duties: Duty[];
}
export interface CleanLogRow { done_at: string | null; done_by: string | null; ticked: string[]; photo: string | null; score: number | null; inspected_by: string | null; comment: string | null }
export interface DayArea extends Area { log: CleanLogRow | null; mine: boolean; can_tick: boolean; can_inspect: boolean }
export interface CleanDay { date: string; areas: DayArea[]; done: number; total: number; inspected: number; average: number | null; manager: boolean; insights: Insight[] }
export interface AreaIn { name: string; kind: string; facility_id: string | null; hostel_id: string | null; days: number[]; shift: string; checklist: string[] }
export interface League {
  from: string; to: string; areas: { id: string; name: string; kind: string; due: number; done: number; rate: number | null; score: number | null; inspections: number }[];
  hostels: { id: string; name: string | null; score: number }[]; people: { name: string | null; due: number; done: number; rate: number | null }[]; insights: Insight[];
}
export const clean = {
  meta: () => g<CleanMeta>("/api/cleaning/meta"),
  areas: (sid: string) => g<Area[]>(`/api/schools/${sid}/cleaning/areas`),
  addArea: (sid: string, a: AreaIn) => api.raw<Area[]>("POST", `/api/schools/${sid}/cleaning/areas`, a),
  suggest: (sid: string) => api.raw<{ added: number; areas: Area[] }>("POST", `/api/schools/${sid}/cleaning/areas/suggest`),
  editArea: (id: string, a: AreaIn) => api.raw<Area[]>("PUT", `/api/cleaning/areas/${id}`, a),
  removeArea: (id: string) => api.raw<void>("DELETE", `/api/cleaning/areas/${id}`),
  setDuties: (id: string, duties: { weekday: number; user_id: string | null; team: string | null }[]) => api.raw<Area[]>("PUT", `/api/cleaning/areas/${id}/duties`, { duties }),
  copyDay: (sid: string, from_day: number, to_days: number[]) => api.raw<Area[]>("POST", `/api/schools/${sid}/cleaning/copy-day`, { from_day, to_days }),
  day: (sid: string, date?: string) => g<CleanDay>(`/api/schools/${sid}/cleaning/day${date ? `?date=${date}` : ""}`),
  done: (id: string, on_date: string, ticked: string[], photo?: string | null) => api.raw<CleanLogRow>("PUT", `/api/cleaning/areas/${id}/done`, { on_date, ticked, photo: photo ?? null }),
  inspect: (id: string, on_date: string, score: number, comment: string | null) => api.raw<CleanLogRow & { ticket: number | null }>("PUT", `/api/cleaning/areas/${id}/inspect`, { on_date, score, comment }),
  league: (sid: string, days = 14) => g<League>(`/api/schools/${sid}/cleaning/league?days=${days}`),
  mine: (sid: string) => g<{ date: string; areas: { id: string; name: string; kind: string; shift: string; checklist: string[]; done: boolean; score: number | null }[]; inspects: boolean }>(`/api/me/schools/${sid}/cleaning`),
};
let cleanMeta: Promise<CleanMeta> | null = null;
export const loadCleanMeta = () => (cleanMeta ??= clean.meta().catch((e) => { cleanMeta = null; throw e; }));
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------- Assets ----------
export interface AssetMeta { categories: Record<string, { label: string; code: string; icon: string; life: number }>; conditions: Record<string, string>; statuses: Record<string, string> }
export interface AssetRow {
  id: string; tag: string; code: string; name: string; category: string; category_label: string; icon: string; make_model: string | null; serial_no: string | null;
  facility_id: string | null; place: string | null; location: string | null; assigned_to_id: string | null; assigned_to: string | null; supplier: string | null;
  purchase_date: string | null; cost: number | null; life_years: number | null; value: number | null; end_of_life: string | null; warranty_until: string | null;
  warranty_days: number | null; condition: string; status: string; status_label: string; photo: string | null; notes: string | null; last_seen_at: string | null;
  repairs: number; repair_cost: number;
}
export interface AssetDetail extends AssetRow { history: { at: string; by: string; text: string }[]; jobs: { number: number; title: string; status: string; created_at: string; cost: number | null; fixed_by: string | null }[] }
export interface AssetList {
  assets: AssetRow[]; totals: { count: number; cost: number; value: number; missing: number; repair: number; poor: number };
  by_place: { place: string; count: number }[]; insights: Insight[]; prefix: string; facilities: { id: string; name: string }[];
}
export interface AssetIn {
  name: string; category: string; make_model: string | null; serial_no: string | null; facility_id: string | null; location: string | null; assigned_to_id: string | null;
  supplier: string | null; purchase_date: string | null; cost: number | null; life_years: number | null; warranty_until: string | null; condition: string; status: string;
  photo: string | null; notes: string | null; quantity: number;
}
export interface StockTake {
  id: string; name: string; place: string; facility_id: string | null; started_by: string | null; created_at: string; closed_at: string | null;
  expected: (AssetRow & { found: { at: string; by: string; condition: string } | null })[]; found: number; elsewhere: number;
}
export const assets = {
  meta: () => g<AssetMeta>("/api/assets/meta"),
  list: (sid: string) => g<AssetList>(`/api/schools/${sid}/assets`),
  add: (sid: string, a: AssetIn) => api.raw<AssetList & { tags: string[] }>("POST", `/api/schools/${sid}/assets`, a),
  one: (id: string) => g<AssetDetail>(`/api/assets/${id}`),
  edit: (id: string, a: AssetIn) => api.raw<AssetDetail>("PUT", `/api/assets/${id}`, a),
  remove: (id: string) => api.raw<void>("DELETE", `/api/assets/${id}`),
  fault: (id: string, body: { title: string; details: string | null; priority: string }) => api.raw<AssetDetail & { number: number }>("POST", `/api/assets/${id}/fault`, body),
  find: (sid: string, code: string) => g<AssetDetail>(`/api/schools/${sid}/assets/find?code=${encodeURIComponent(code)}`),
  counts: (sid: string) => g<{ id: string; name: string; place: string; started_by: string | null; created_at: string; closed_at: string | null; found: number; expected: number }[]>(`/api/schools/${sid}/asset-counts`),
  startCount: (sid: string, name: string, facility_id: string | null) => api.raw<StockTake>("POST", `/api/schools/${sid}/asset-counts`, { name, facility_id }),
  count: (id: string) => g<StockTake>(`/api/asset-counts/${id}`),
  seen: (id: string, code: string, condition?: string | null, unfound = false) =>
    api.raw<StockTake & { asset: { tag: string; name: string }; moved: string | null }>("POST", `/api/asset-counts/${id}/seen`, { code, condition: condition ?? null, unfound }),
  closeCount: (id: string, mark_missing: boolean) => api.raw<StockTake & { missing: number }>("POST", `/api/asset-counts/${id}/close`, { mark_missing }),
  labels: (sid: string, ids: string[]) => g<{ school: string; labels: { tag: string; code: string; name: string }[] }>(`/api/schools/${sid}/assets/labels?ids=${ids.join(",")}`),
};
let assetMeta: Promise<AssetMeta> | null = null;
export const loadAssetMeta = () => (assetMeta ??= assets.meta().catch((e) => { assetMeta = null; throw e; }));
export const naira = (n: number | null | undefined) => (n == null ? "–" : `₦${Math.round(n).toLocaleString()}`);
export const nairaShort = (n: number | null | undefined) => {
  if (n == null) return "–";
  const a = Math.abs(n);
  return a >= 1e9 ? `₦${(n / 1e9).toFixed(1)}bn` : a >= 1e6 ? `₦${(n / 1e6).toFixed(1)}m` : a >= 1e4 ? `₦${Math.round(n / 1e3)}k` : `₦${Math.round(n).toLocaleString()}`;
};
