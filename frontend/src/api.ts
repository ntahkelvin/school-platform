// Small helper for talking to the backend.

const TOKEN_KEY = "sp_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: stay logged in for this tab only */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401 && path !== "/api/auth/login") {
    setToken(null);
    window.location.hash = "";
    window.location.reload();
  }
  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = String(data.detail[0]?.msg ?? message).replace(/^Value error, /, "");
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const get = <T,>(path: string) => request<T>(path);
const send = <T,>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export type SchoolType = "day" | "boarding" | "mixed";
export type Gender = "male" | "female";
export type BoardingStatus = "day" | "boarder";
export type StudentStatus = "active" | "graduated" | "withdrawn";
export type StaffRole = "head" | "bursar" | "teacher" | "house_parent" | "support";
export type EmploymentType = "full_time" | "part_time" | "contract" | "nysc" | "volunteer";

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  phone?: string | null;
  email?: string | null;
  has_boarding: boolean;
}
export interface BranchDetail extends Branch {
  school_id: string;
  school_name: string;
  school_type: SchoolType;
}
export interface School {
  id: string;
  name: string;
  school_type: SchoolType;
  branches: Branch[];
  motto?: string | null;
  logo?: string | null;
  campus_id?: string | null;
  has_boarding?: boolean;
  colour?: string | null;
}

export interface SchoolStats {
  students: number;
  boys: number;
  girls: number;
  boarders: number;
  staff: number;
  classes: number;
  departments: number;
  today: { in_classes: number; marked: number; present: number; absent: number };
}
export interface Group {
  id: string;
  name: string;
  logo?: string | null;
  schools: School[];
}
export interface Me {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  must_change_password?: boolean;
  memberships: { role: string; group_id: string; school_id: string | null; branch_id: string | null }[];
}
export interface LoginInfo {
  user_id: string;
  full_name: string;
  title: string | null;
  username: string;
  phone: string | null;
  email: string | null;
  roles: string[];
  kind: "staff" | "board" | "parent" | "student";
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  is_admin: boolean;
}
export interface Term {
  id: string;
  number: number;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_current: boolean;
}
export interface AcademicSession {
  id: string;
  name: string;
  terms: Term[];
}
export interface Subject {
  id: string;
  name: string;
  code: string | null;
  department_id: string | null;
}
export interface SchoolClass {
  id: string;
  level: string;
  arm: string;
  name: string;
  student_count: number;
  boys?: number;
  girls?: number;
  boarders?: number;
}
export interface StudentRow {
  id: string;
  admission_no: string;
  full_name: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: Gender;
  date_of_birth: string | null;
  state_of_origin: string | null;
  class_id: string | null;
  class_name: string | null;
  boarding_status: BoardingStatus;
  status: StudentStatus;
}
export interface Guardian {
  link_id: string;
  user_id: string;
  full_name: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  other_children: { id: string; full_name: string; branch_name: string; class_name: string | null }[];
}
export interface StudentDetail extends StudentRow {
  branch_id: string;
  guardians: Guardian[];
}
export interface NewLogin {
  name: string;
  username: string;
  password: string;
}
export interface GuardianInput {
  full_name: string;
  relationship: string;
  phone: string;
  email: string;
}
export interface StudentInput {
  first_name: string;
  middle_name: string;
  last_name: string;
  gender: Gender;
  date_of_birth: string | null;
  state_of_origin: string;
  class_id: string | null;
  boarding_status: BoardingStatus;
  admission_no: string;
}
export interface StaffMember {
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  roles: { membership_id: string; role: StaffRole }[];
  staff_no: string | null;
  title: string | null;
  gender: Gender | null;
  job_title: string | null;
  department_id: string | null;
  department_name: string | null;
  teaching: boolean;
  employment_type: EmploymentType;
  date_joined: string | null;
  qualification: string | null;
  heads_departments: string[];
}
export interface StaffProfileIn {
  full_name: string;
  staff_no: string | null;
  title: string | null;
  gender: Gender | null;
  job_title: string | null;
  department_id: string | null;
  teaching: boolean;
  employment_type: EmploymentType;
  date_joined: string | null;
  qualification: string | null;
}
export interface ImportKind {
  key: string;
  title: string;
  noun: string;
  about: string;
  icon: string;
  hue: string;
  columns: { header: string; required: boolean; hint: string }[];
}
export interface ImportRow { row: number; status: "added" | "updated" | "skipped" | "error"; message: string }
export interface ImportResult {
  kind: string;
  committed: boolean;
  total: number;
  added: number;
  updated: number;
  skipped: number;
  errors: number;
  new_logins: number;
  unknown_columns: string[];
  rows: ImportRow[];
  logins: { name: string; username: string; password: string; for: string }[];
}

export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type AttendanceKind = "school" | "night";

export interface RegisterStudent {
  id: string;
  full_name: string;
  admission_no: string;
  class_name: string | null;
  status: AttendanceStatus | null;
  note: string | null;
}
export interface Register {
  kind: AttendanceKind;
  on_date: string;
  title: string;
  branch_id: string;
  class_id: string | null;
  students: RegisterStudent[];
  last_saved_at: string | null;
}
export interface Counts {
  total: number;
  marked: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}
export interface DaySummary {
  on_date: string;
  classes: (Counts & { class_id: string; class_name: string })[];
  school: Counts;
  night: Counts | null;
}
export interface StudentAttendance {
  days: number;
  school: Counts;
  rate: number | null;
  not_present: { on_date: string; kind: AttendanceKind; status: AttendanceStatus; note: string | null }[];
}

/** Where a register lives on the server: used for loading and saving it. */
export function registerPath(kind: AttendanceKind, id: string): string {
  return kind === "school" ? `/api/classes/${id}/register` : `/api/branches/${id}/night-roll`;
}

export const api = {
  async login(identifier: string, password: string): Promise<void> {
    const body = new URLSearchParams({ username: identifier, password });
    const res = await request<{ access_token: string }>("/api/auth/login", { method: "POST", body });
    setToken(res.access_token);
  },
  me: () => get<Me>("/api/me"),

  groups: () => get<Group[]>("/api/groups"),
  dashboardStats: (date: string) => get<Record<string, SchoolStats>>(`/api/dashboard-stats?date=${date}`),
  addSchool: (groupId: string, name: string, school_type: SchoolType) =>
    send<School>("POST", `/api/groups/${groupId}/schools`, { name, school_type }),
  school: (id: string) => get<School>(`/api/schools/${id}`),
  updateSchool: (id: string, name: string, school_type: SchoolType) =>
    send<School>("PATCH", `/api/schools/${id}`, { name, school_type }),
  addBranch: (schoolId: string, name: string, address: string, has_boarding: boolean, phone = "", email = "") =>
    send<Branch>("POST", `/api/schools/${schoolId}/branches`, { name, address, has_boarding, phone, email }),
  branch: (id: string) => get<BranchDetail>(`/api/branches/${id}`),
  updateBranch: (id: string, name: string, address: string, has_boarding: boolean, phone = "", email = "") =>
    send<BranchDetail>("PATCH", `/api/branches/${id}`, { name, address, has_boarding, phone, email }),

  sessions: (schoolId: string) => get<AcademicSession[]>(`/api/schools/${schoolId}/sessions`),
  addSession: (schoolId: string, name: string) =>
    send<AcademicSession>("POST", `/api/schools/${schoolId}/sessions`, { name }),
  updateTerm: (termId: string, starts_on: string | null, ends_on: string | null) =>
    send<Term>("PATCH", `/api/terms/${termId}`, { starts_on, ends_on }),
  makeCurrent: (termId: string) => send<AcademicSession[]>("POST", `/api/terms/${termId}/make-current`),

  subjects: (schoolId: string) => get<Subject[]>(`/api/schools/${schoolId}/subjects`),
  addSubject: (schoolId: string, name: string, code: string) =>
    send<Subject>("POST", `/api/schools/${schoolId}/subjects`, { name, code }),
  addCommonSubjects: (schoolId: string) => send<Subject[]>("POST", `/api/schools/${schoolId}/subjects/add-common`),
  deleteSubject: (id: string) => send<void>("DELETE", `/api/subjects/${id}`),

  levels: () => get<string[]>("/api/levels"),
  classes: (branchId: string) => get<SchoolClass[]>(`/api/branches/${branchId}/classes`),
  addClass: (branchId: string, level: string, arm: string) =>
    send<SchoolClass[]>("POST", `/api/branches/${branchId}/classes`, { level, arm }),
  deleteClass: (id: string) => send<void>("DELETE", `/api/classes/${id}`),

  students: (branchId: string, params: { q?: string; class_id?: string; include_inactive?: boolean }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.class_id) qs.set("class_id", params.class_id);
    if (params.include_inactive) qs.set("include_inactive", "true");
    return get<StudentRow[]>(`/api/branches/${branchId}/students?${qs}`);
  },
  addStudent: (branchId: string, data: StudentInput, guardian: GuardianInput | null) =>
    send<{ student: StudentDetail; new_login: NewLogin | null }>("POST", `/api/branches/${branchId}/students`, {
      ...data,
      guardian,
    }),
  student: (id: string) => get<StudentDetail>(`/api/students/${id}`),
  updateStudent: (id: string, data: StudentInput & { status: StudentStatus }) =>
    send<StudentDetail>("PATCH", `/api/students/${id}`, data),
  addGuardian: (studentId: string, g: GuardianInput) =>
    send<{ student: StudentDetail; new_login: NewLogin | null }>("POST", `/api/students/${studentId}/guardians`, g),
  removeGuardian: (studentId: string, linkId: string) =>
    send<void>("DELETE", `/api/students/${studentId}/guardians/${linkId}`),

  staff: (branchId: string) => get<StaffMember[]>(`/api/branches/${branchId}/staff`),
  addStaff: (branchId: string, data: StaffProfileIn & { phone: string; email: string; role: StaffRole }) =>
    send<{ staff: StaffMember[]; new_login: NewLogin | null }>("POST", `/api/branches/${branchId}/staff`, data),
  updateStaff: (branchId: string, userId: string, data: StaffProfileIn) =>
    send<StaffMember[]>("PUT", `/api/branches/${branchId}/staff/${userId}`, data),
  raw: <T,>(method: string, path: string, body?: unknown) => (method === "GET" ? get<T>(path) : send<T>(method, path, body)),
  logins: (schoolId: string) => get<LoginInfo[]>(`/api/schools/${schoolId}/logins`),
  loginInfo: (schoolId: string, userId: string) => get<LoginInfo>(`/api/schools/${schoolId}/logins/${userId}`),
  resetPassword: (schoolId: string, userId: string, password?: string) =>
    send<NewLogin>("POST", `/api/schools/${schoolId}/logins/${userId}/reset-password`, password ? { password } : {}),
  setLoginActive: (schoolId: string, userId: string, active: boolean) =>
    send<LoginInfo>("PUT", `/api/schools/${schoolId}/logins/${userId}/active`, { active }),
  changePassword: (current_password: string, new_password: string) =>
    send<void>("POST", "/api/me/password", { current_password, new_password }),
  staffOptions: () => get<{ key_positions: string[]; job_titles: string[] }>("/api/staff-options"),
  importKinds: (branchId: string) => get<ImportKind[]>(`/api/branches/${branchId}/imports`),
  importFile: (branchId: string, kind: string, file: File, commit: boolean) => {
    const body = new FormData();
    body.append("file", file);
    return request<ImportResult>(`/api/branches/${branchId}/imports/${kind}?commit=${commit}`, { method: "POST", body });
  },
  importTemplate: async (branchId: string, kind: string): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch(`/api/branches/${branchId}/imports/${kind}/template`, {
      headers: { Authorization: `Bearer ${getToken() ?? ""}` },
    });
    if (!res.ok) throw new ApiError(res.status, "The template couldn't be made. Please try again.");
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${kind}.xlsx`;
    return { blob: await res.blob(), filename: name };
  },
  removeStaffRole: (membershipId: string) => send<void>("DELETE", `/api/staff-roles/${membershipId}`),

  register: (kind: AttendanceKind, id: string, date: string) => get<Register>(`${registerPath(kind, id)}?date=${date}`),
  daySummary: (branchId: string, date: string) => get<DaySummary>(`/api/branches/${branchId}/attendance?date=${date}`),
  studentAttendance: (studentId: string, days = 30) =>
    get<StudentAttendance>(`/api/students/${studentId}/attendance?days=${days}`),
};

/** Today's date on this device, as YYYY-MM-DD (not UTC, so late evenings in Lagos don't jump a day). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function longDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export const SCHOOL_TYPE_LABEL: Record<SchoolType, string> = {
  day: "Day school",
  boarding: "Boarding school",
  mixed: "Day and boarding",
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  head: "Head / principal",
  bursar: "Bursar",
  teacher: "Teacher",
  house_parent: "House parent",
  support: "Support staff",
};

export function errorText(err: unknown, fallback = "Something went wrong."): string {
  return err instanceof Error ? err.message : fallback;
}
