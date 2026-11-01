// Staff quality and growth: observations, appraisals, training, mentoring, kudos, wellbeing, strengths, workload.
import { api } from "./api";
import type { Hue } from "./look";

export interface Card { user_id: string; name: string; job_title: string | null; photo: string | null; department_name: string | null; teaching: boolean }
export interface Criterion { key: string; label: string; icon: string; hint: string }
export interface Meta {
  criteria: Criterion[]; professional: Criterion[]; levels: Record<string, string>; cpd_kinds: Record<string, string>;
  badges: Record<string, string>; skills: Record<string, string[]>;
}
export interface Observation {
  id: string; teacher: Card; observer_id: string | null; observer: string; subject_id: string | null; subject_name: string | null;
  class_label: string | null; on_date: string; kind: "formal" | "drop_in" | "peer"; focus: string | null; scores: Record<string, number>;
  average: number | null; strengths: string | null; next_steps: string | null; status: "planned" | "draft" | "shared" | "acknowledged";
  teacher_comment: string | null; shared_at: string | null; can_edit: boolean; can_acknowledge: boolean;
}
export interface ObsIn {
  teacher_id: string; subject_id: string | null; class_label: string | null; on_date: string; kind: string; focus: string | null;
  scores: Record<string, number>; strengths: string | null; next_steps: string | null; status: "planned" | "draft" | "shared";
}
export interface Goal { title: string; measure: string | null; due: string | null; progress: number }
export interface Appraisal {
  id: string; person: Card; appraiser_id: string | null; appraiser: string; period_label: string; due_on: string | null;
  status: "self" | "review" | "sign" | "done"; self_scores: Record<string, number>; self_comment: string | null;
  scores: Record<string, number>; appraiser_comment: string | null; overall: number | null; goals: Goal[]; staff_comment: string | null;
  staff_signed_at: string | null; appraiser_signed_at: string | null; role: "staff" | "appraiser" | "manager" | "viewer";
  can_self: boolean; can_review: boolean; can_sign: boolean; can_goals: boolean;
}
export interface Cpd {
  id: string; person: Card; title: string; provider: string | null; kind: string; kind_label: string; on_date: string; hours: number;
  notes: string | null; impact: string | null; verified: boolean; verified_by: string | null; can_edit: boolean;
}
export interface CpdIn { title: string; provider: string | null; kind: string; on_date: string; hours: number; notes: string | null; impact: string | null; user_ids?: string[] }
export interface Mentoring {
  id: string; mentor: Card; mentee: Card; focus: string; started_on: string; status: "active" | "ended";
  meetings: { date: string; note: string; by: string }[]; can_log: boolean; can_end: boolean;
}
export interface Kudos { id: string; from: Card | null; to: Card; badge: string; badge_label: string; message: string; created_at: string; cheers: number; cheered: boolean; can_delete: boolean }
export interface PulseAnswer { week_start: string; mood: number; workload: number; supported: number; wants_chat: boolean; note: string | null }
export interface MyPulse { week_start: string; this_week: PulseAnswer | null; history: PulseAnswer[] }
export interface WellWeek { week_start: string; answers: number; shown: boolean; mood: number | null; workload: number | null; supported: number | null; moods: Record<string, number> }
export interface Wellbeing { staff: number; min_group: number; weeks: WellWeek[]; by_group: { name: string; answers: number; mood: number; workload: number }[]; chats: { person: Card; week_start: string }[] }
export interface StrengthPerson extends Card { id: string; endorsements: number; endorsed: boolean; mine: boolean }
export interface StrengthMap { catalog: Record<string, string[]>; skills: { skill: string; group: string; people: StrengthPerson[] }[]; people_with_none: Card[] }
export interface LoadRow extends Card { classes: number; groups: number; form: number; duties: number; lead: number; mentoring: number; points: number; level: "over" | "high" | "ok" | "light" }
export interface Insight { kind: "strength" | "grow" | "tip" | "alert"; icon: string; text: string; people?: Card[]; matches?: (Card & { score: number; same_department: boolean })[]; area?: string }
export interface Passport {
  person: Card & { staff_no: string | null; years: number | null; unit_name: string | null }; is_me: boolean;
  criteria: Criterion[]; averages: Record<string, number>; school_averages: Record<string, number>; observations: number;
  trend: { date: string; average: number }[]; cpd: { hours: number; target: number; records: number };
  attendance: { rate: number | null; late: number; days: number };
  kudos: { received: number; given: number; badges: Record<string, number>; recent: Kudos[] };
  notes: Record<string, number>;
  appraisal: { id: string; period_label: string; status: string; overall: number | null; goals: Goal[] } | null;
  mentoring: Mentoring[]; strengths: { id: string; skill: string; endorsements: number; endorsed: boolean }[];
  workload: { points: number; classes?: number; groups?: number; form?: number; duties?: number; lead?: number; mentoring?: number }; workload_limit: number;
  insights: Insight[]; timeline: { date: string; kind: string; title: string; detail: string | null }[];
}
export interface Overview {
  staff: number; teachers: number; observations: { this_year: number; observed: number; planned: number; drafts: number };
  criteria: Criterion[]; school_averages: Record<string, number>; cpd: { hours: number; met: number; target: number };
  appraisals: { period: string | null; counts: Record<string, number>; total: number };
  kudos: { month: number; top: (Card & { count: number })[] }; workload: { over: number; limit: number };
  wellbeing: { latest: WellWeek | null; weeks: WellWeek[] }; mentoring: number; insights: Insight[];
}
export interface MyGrowth {
  observations_to_sign: number; observations_to_finish: number;
  appraisal: { id: string; period_label: string; status: string; staff_signed: boolean; goals: Goal[] } | null;
  appraisals_to_review: number; cpd_hours: number; cpd_target: number; kudos: number; pulse_done: boolean; can_observe: boolean; mentoring: Mentoring[];
}
export interface PersonRow extends Card { visible: boolean; observation_average?: number | null; cpd_hours?: number; kudos?: number }
export interface GrowthSettings { cpd_target_hours: number; workload_limit: number; observations_per_term: number }

const g = <T,>(p: string) => api.raw<T>("GET", p);
export const grow = {
  meta: () => g<Meta>("/api/growth/meta"),
  settings: (sid: string) => g<GrowthSettings>(`/api/schools/${sid}/growth/settings`),
  saveSettings: (sid: string, s: GrowthSettings) => api.raw<GrowthSettings>("PUT", `/api/schools/${sid}/growth/settings`, s),
  overview: (sid: string) => g<Overview>(`/api/schools/${sid}/growth/overview`),
  people: (sid: string) => g<{ cpd_target: number; people: PersonRow[] }>(`/api/schools/${sid}/growth/people`),
  passport: (sid: string, uid: string) => g<Passport>(`/api/schools/${sid}/growth/people/${uid}`),
  me: (sid: string) => g<MyGrowth>(`/api/me/schools/${sid}/growth`),
  observations: (sid: string, teacher?: string) => g<Observation[]>(`/api/schools/${sid}/observations${teacher ? `?teacher=${teacher}` : ""}`),
  addObservation: (sid: string, o: ObsIn) => api.raw<Observation>("POST", `/api/schools/${sid}/observations`, o),
  editObservation: (id: string, o: ObsIn) => api.raw<Observation>("PUT", `/api/observations/${id}`, o),
  acknowledge: (id: string, comment: string | null) => api.raw<Observation>("PUT", `/api/observations/${id}/acknowledge`, { comment }),
  removeObservation: (id: string) => api.raw<void>("DELETE", `/api/observations/${id}`),
  appraisals: (sid: string, period?: string) => g<{ periods: string[]; appraisals: Appraisal[] }>(`/api/schools/${sid}/appraisals${period ? `?period=${encodeURIComponent(period)}` : ""}`),
  appraisal: (id: string) => g<Appraisal>(`/api/appraisals/${id}`),
  startAppraisals: (sid: string, body: { period_label: string; due_on: string | null }) => api.raw<{ started: number; already: number }>("POST", `/api/schools/${sid}/appraisals/start`, body),
  selfReview: (id: string, body: { self_scores: Record<string, number>; self_comment: string | null; goals: Goal[]; submit: boolean }) => api.raw<Appraisal>("PUT", `/api/appraisals/${id}/self`, body),
  review: (id: string, body: { scores: Record<string, number>; appraiser_comment: string | null; overall: number | null; goals: Goal[]; submit: boolean }) => api.raw<Appraisal>("PUT", `/api/appraisals/${id}/review`, body),
  sign: (id: string, comment: string | null) => api.raw<Appraisal>("PUT", `/api/appraisals/${id}/sign`, { comment }),
  goals: (id: string, goals: Goal[]) => api.raw<Appraisal>("PUT", `/api/appraisals/${id}/goals`, { goals }),
  setAppraiser: (id: string, appraiser_id: string) => api.raw<Appraisal>("PUT", `/api/appraisals/${id}/appraiser`, { appraiser_id }),
  cpd: (sid: string, person?: string) => g<Cpd[]>(`/api/schools/${sid}/cpd${person ? `?person=${person}` : ""}`),
  addCpd: (sid: string, c: CpdIn) => api.raw<{ added: number }>("POST", `/api/schools/${sid}/cpd`, c),
  editCpd: (id: string, c: CpdIn) => api.raw<Cpd>("PUT", `/api/cpd/${id}`, c),
  verifyCpd: (id: string) => api.raw<Cpd>("PUT", `/api/cpd/${id}/verify`, {}),
  removeCpd: (id: string) => api.raw<void>("DELETE", `/api/cpd/${id}`),
  mentoring: (sid: string) => g<Mentoring[]>(`/api/schools/${sid}/mentoring`),
  addMentoring: (sid: string, body: { mentor_id: string; mentee_id: string; focus: string }) => api.raw<Mentoring>("POST", `/api/schools/${sid}/mentoring`, body),
  addMeeting: (id: string, on_date: string, note: string) => api.raw<Mentoring>("POST", `/api/mentoring/${id}/meetings`, { on_date, note }),
  endMentoring: (id: string) => api.raw<Mentoring>("PUT", `/api/mentoring/${id}/end`, {}),
  kudos: (sid: string, person?: string, limit = 60) => g<Kudos[]>(`/api/schools/${sid}/kudos?limit=${limit}${person ? `&person=${person}` : ""}`),
  giveKudos: (sid: string, body: { to_id: string; badge: string; message: string }) => api.raw<Kudos>("POST", `/api/schools/${sid}/kudos`, body),
  cheer: (id: string) => api.raw<Kudos>("POST", `/api/kudos/${id}/cheer`, {}),
  removeKudos: (id: string) => api.raw<void>("DELETE", `/api/kudos/${id}`),
  myPulse: (sid: string) => g<MyPulse>(`/api/me/schools/${sid}/pulse`),
  savePulse: (sid: string, p: Omit<PulseAnswer, "week_start">) => api.raw<MyPulse>("PUT", `/api/me/schools/${sid}/pulse`, p),
  wellbeing: (sid: string) => g<Wellbeing>(`/api/schools/${sid}/wellbeing`),
  strengths: (sid: string) => g<StrengthMap>(`/api/schools/${sid}/strengths`),
  addStrength: (sid: string, skill: string, user_id?: string) => api.raw<{ skill: string }>("POST", `/api/schools/${sid}/strengths`, { skill, user_id }),
  endorse: (id: string) => api.raw<{ endorsements: number; endorsed: boolean }>("POST", `/api/strengths/${id}/endorse`, {}),
  removeStrength: (id: string) => api.raw<void>("DELETE", `/api/strengths/${id}`),
  workload: (sid: string) => g<{ limit: number; average: number; rows: LoadRow[] }>(`/api/schools/${sid}/workload`),
};

let metaCache: Promise<Meta> | null = null;
export const loadMeta = () => (metaCache ??= grow.meta().catch((e) => { metaCache = null; throw e; }));

export const LEVEL_LOOK: Record<number, { label: string; hue: Hue; short: string }> = {
  1: { label: "Needs support", hue: "red", short: "1" }, 2: { label: "Developing", hue: "amber", short: "2" },
  3: { label: "Good", hue: "green", short: "3" }, 4: { label: "Outstanding", hue: "violet", short: "4" },
};
export const levelOf = (v: number | null | undefined) => (v == null ? null : LEVEL_LOOK[Math.max(1, Math.min(4, Math.round(v)))]);
export const BADGE_LOOK: Record<string, { icon: string; hue: Hue; emoji: string }> = {
  above_beyond: { icon: "rocket", hue: "violet", emoji: "🚀" }, great_lesson: { icon: "presentation", hue: "blue", emoji: "🎓" },
  team_player: { icon: "handshake", hue: "teal", emoji: "🤝" }, student_champion: { icon: "students", hue: "pink", emoji: "🏆" },
  innovator: { icon: "lightbulb", hue: "amber", emoji: "💡" }, reliable: { icon: "shield-check", hue: "indigo", emoji: "🛡️" },
  mentor: { icon: "sprout", hue: "green", emoji: "🌱" }, kind_heart: { icon: "heart", hue: "rose", emoji: "❤️" },
  spirit: { icon: "party", hue: "orange", emoji: "🎉" },
};
export const CPD_LOOK: Record<string, { icon: string; hue: Hue }> = {
  workshop: { icon: "hammer", hue: "orange" }, course: { icon: "graduation-cap", hue: "indigo" }, conference: { icon: "mic", hue: "violet" },
  in_school: { icon: "school", hue: "green" }, online: { icon: "laptop", hue: "sky" }, peer: { icon: "eye", hue: "teal" },
  mentoring: { icon: "handshake", hue: "pink" }, reading: { icon: "book", hue: "amber" }, exam_marking: { icon: "clipboard", hue: "rose" }, other: { icon: "star", hue: "slate" },
};
export const OBS_STATUS: Record<string, { label: string; hue: Hue; icon: string }> = {
  planned: { label: "Planned", hue: "sky", icon: "calendar-days" }, draft: { label: "Draft", hue: "slate", icon: "edit" },
  shared: { label: "Shared, waiting to sign", hue: "amber", icon: "send" }, acknowledged: { label: "Signed", hue: "green", icon: "circle-check" },
};
export const OBS_KIND: Record<string, string> = { formal: "Formal observation", drop_in: "Drop-in (learning walk)", peer: "Peer observation" };
export const APP_STATUS: Record<string, { label: string; hue: Hue; icon: string; step: number }> = {
  self: { label: "Self-review", hue: "sky", icon: "user", step: 1 }, review: { label: "Appraiser's review", hue: "amber", icon: "clipboard-list", step: 2 },
  sign: { label: "Ready to sign", hue: "violet", icon: "pen-tool", step: 3 }, done: { label: "Complete", hue: "green", icon: "circle-check", step: 4 },
};
export const MOOD = [
  { v: 1, emoji: "😞", label: "Struggling", hue: "red" as Hue }, { v: 2, emoji: "😕", label: "Not great", hue: "orange" as Hue },
  { v: 3, emoji: "😐", label: "Okay", hue: "amber" as Hue }, { v: 4, emoji: "🙂", label: "Good", hue: "lime" as Hue },
  { v: 5, emoji: "😄", label: "Great", hue: "green" as Hue },
];
export const INSIGHT_HUE: Record<string, Hue> = { strength: "green", grow: "violet", tip: "sky", alert: "rose" };
export const SKILL_GROUP_LOOK: Record<string, { icon: string; hue: Hue }> = {
  Teaching: { icon: "presentation", hue: "blue" }, Technology: { icon: "laptop", hue: "cyan" }, "Care and guidance": { icon: "hand-heart", hue: "pink" },
  "Clubs and sport": { icon: "trophy", hue: "orange" }, "School life": { icon: "party", hue: "violet" }, Languages: { icon: "languages", hue: "teal" },
  Other: { icon: "star", hue: "slate" },
};
export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
