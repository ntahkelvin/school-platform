// Talking to the backend about the school's structure.
import { request } from "./api";

const get = <T,>(path: string) => request<T>(path);
const send = <T,>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface Profile {
  id: string;
  name: string;
  motto: string | null;
  logo: string | null;
  address: string | null;
  state: string | null;
  lga: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  founded_year: number | null;
  colour: string | null;
  approval_number: string | null;
  waec_centre_no: string | null;
  neco_centre_no: string | null;
}
export interface PersonOption {
  id: string;
  full_name: string;
  roles: string[];
}
export interface Band {
  grade: string;
  min_score: number;
  max_score: number;
  remark: string;
}
export interface Scale {
  id: string;
  name: string;
  bands: Band[];
}
export interface Part {
  name: string;
  max_score: number;
}
export interface Component {
  name: string;
  max_score: number;
  parts: Part[];
}
export interface Scheme {
  id: string;
  name: string;
  components: Component[];
}
export interface Section {
  id: string;
  name: string;
  position: number;
  levels: string[];
  head_user_id: string | null;
  head_name: string | null;
  grading_scale_id: string | null;
  assessment_scheme_id: string | null;
}
export interface Room {
  id: string;
  name: string;
}
export interface Bed {
  id: string;
  label: string;
  room_id: string | null;
  student_id: string | null;
  student_name: string | null;
  student_class: string | null;
  student_admission_no: string | null;
  student_gender: "male" | "female" | null;
}
export interface Hostel {
  id: string;
  name: string;
  gender: "boys" | "girls" | "mixed";
  house_parent_user_id: string | null;
  house_parent_name: string | null;
  notes: string | null;
  rooms: Room[];
  beds: Bed[];
}
export interface SetupCounts {
  sections: number;
  departments: number;
  subjects: number;
  houses: number;
  clubs: number;
  grading_scales: number;
  assessment_schemes: number;
  periods: number;
  events: number;
  policies: number;
  profile_complete: boolean;
}

/** A simple record with an id; the rest of its fields depend on the kind of record. */
export type Item = { id: string } & Record<string, unknown>;

/** Standard list/add/edit/delete calls for one kind of record. */
export function records(parent: "school" | "branch", parentId: string, path: string) {
  const base = parent === "school" ? `/api/schools/${parentId}/${path}` : `/api/branches/${parentId}/${path}`;
  return {
    list: () => get<Item[]>(base),
    add: (data: Record<string, unknown>) => send<Item>("POST", base, data),
    update: (id: string, data: Record<string, unknown>) => send<Item>("PATCH", `/api/${path}/${id}`, data),
    remove: (id: string) => send<void>("DELETE", `/api/${path}/${id}`),
  };
}

export const structure = {
  profile: (schoolId: string) => get<Profile>(`/api/schools/${schoolId}/profile`),
  saveProfile: (schoolId: string, data: Partial<Profile>) => send<Profile>("PUT", `/api/schools/${schoolId}/profile`, data),
  staffOptions: (schoolId: string) => get<PersonOption[]>(`/api/schools/${schoolId}/staff-options`),
  counts: (schoolId: string) => get<SetupCounts>(`/api/schools/${schoolId}/setup-counts`),

  gradingPresets: () => get<Record<string, Band[]>>("/api/grading-presets"),
  scales: (schoolId: string) => get<Scale[]>(`/api/schools/${schoolId}/grading-scales`),
  addScale: (schoolId: string, name: string, bands: Band[]) =>
    send<Scale>("POST", `/api/schools/${schoolId}/grading-scales`, { name, bands }),
  saveScale: (id: string, name: string, bands: Band[]) => send<Scale>("PUT", `/api/grading-scales/${id}`, { name, bands }),
  deleteScale: (id: string) => send<void>("DELETE", `/api/grading-scales/${id}`),

  assessmentPresets: () => get<Record<string, Component[]>>("/api/assessment-presets"),
  schemes: (schoolId: string) => get<Scheme[]>(`/api/schools/${schoolId}/assessment-schemes`),
  addScheme: (schoolId: string, name: string, components: Component[]) =>
    send<Scheme>("POST", `/api/schools/${schoolId}/assessment-schemes`, { name, components }),
  saveScheme: (id: string, name: string, components: Component[]) =>
    send<Scheme>("PUT", `/api/assessment-schemes/${id}`, { name, components }),
  deleteScheme: (id: string) => send<void>("DELETE", `/api/assessment-schemes/${id}`),

  addStandardSections: (schoolId: string, names: string[]) =>
    send<Section[]>("POST", `/api/schools/${schoolId}/sections/add-standard`, { names }),
  addStandardDepartments: (schoolId: string) => send<Item[]>("POST", `/api/schools/${schoolId}/departments/add-standard`),
  assignBed: (bedId: string, studentId: string | null) =>
    send<Hostel>("PUT", `/api/beds/${bedId}/student`, { student_id: studentId }),
  setSubjectDepartment: (subjectId: string, departmentId: string | null) =>
    send<void>("PUT", `/api/subjects/${subjectId}/department`, { department_id: departmentId }),

  addRoom: (hostelId: string, name: string) => send<Hostel>("POST", `/api/hostels/${hostelId}/rooms`, { name }),
  renameRoom: (roomId: string, name: string) => send<Hostel>("PATCH", `/api/hostel-rooms/${roomId}`, { name }),
  deleteRoom: (roomId: string) => send<Hostel>("DELETE", `/api/hostel-rooms/${roomId}`),
  addBeds: (hostelId: string, count: number, roomId: string | null, bunks: boolean) =>
    send<Hostel>("POST", `/api/hostels/${hostelId}/beds`, { count, room_id: roomId, bunks }),
  deleteBed: (bedId: string) => send<Hostel>("DELETE", `/api/beds/${bedId}`),

  starterOptions: () => get<{ sections: string[]; grading: string[]; assessment: string[] }>("/api/starter-options"),
  applyStarter: (schoolId: string, data: StarterChoices) =>
    send<{ added: string[] }>("POST", `/api/schools/${schoolId}/starter`, data),
};

export interface StarterChoices {
  sections: string[];
  secondary_grading: string | null;
  primary_grading: string | null;
  assessment: string | null;
  departments: boolean;
  subjects: boolean;
  calendar: boolean;
  facilities: boolean;
  hostels: boolean;
}

// ---- Labels shown on screen for the fixed choices ----

export const DEPARTMENT_KIND = { academic: "Academic", non_academic: "Non-academic" };
export const CLUB_KIND = { club: "Club", society: "Society", sports_team: "Sports team", uniformed: "Uniformed group" };
export const PERIOD_KIND = { lesson: "Lesson", break: "Break", assembly: "Assembly", prep: "Prep (study)", other: "Other" };
export const HOSTEL_GENDER = { boys: "Boys", girls: "Girls", mixed: "Mixed" };
export const VEHICLE_KIND = { bus: "Bus", van: "Van", car: "Car", other: "Other" };
export const EVENT_CATEGORY = {
  resumption: "Resumption", midterm_break: "Mid-term break", holiday: "Holiday", exams: "Exams",
  pta_meeting: "PTA meeting", visiting_day: "Visiting day", sports: "Sports / inter-house", excursion: "Excursion",
  open_day: "Open day", graduation: "Graduation / prize giving", religious: "Religious", cultural: "Cultural day",
  other: "Other",
};
export const FACILITY_KIND = {
  classroom: "Classroom", laboratory: "Laboratory", ict_lab: "ICT / computer lab", library: "Library", hall: "Hall",
  sick_bay: "Sick bay / clinic", kitchen: "Kitchen", dining_hall: "Dining hall", sports_field: "Sports field / court",
  staff_room: "Staff room", office: "Office", chapel_mosque: "Chapel / mosque", store: "Store", workshop: "Workshop",
  tuck_shop: "Tuck shop", other: "Other",
};
export const POLICY_CATEGORIES = ["General", "Academic", "Discipline", "Uniform", "Boarding", "Visiting", "Health", "Fees", "Safety"];

export function optionsOf(labels: Record<string, string>): { value: string; label: string }[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}
