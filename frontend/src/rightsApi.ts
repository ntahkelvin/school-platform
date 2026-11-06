// Rights: who may see and change what. The server decides; these helpers only hide what wouldn't work.
import { createContext, useContext } from "react";
import { api, getToken, setToken, type Me } from "./api";

export interface AreaInfo { label: string; icon: string; hint: string; change_only?: boolean }
export interface RightsMeta {
  areas: Record<string, AreaInfo>; private: Record<string, AreaInfo>; powers: Record<string, AreaInfo>;
  roles: Record<string, string>; order: string[]; defaults: Record<string, string[]>;
}
export interface RoleRow { role: string; label: string; rights: string[]; changed: string[]; people: number; editable: boolean }
export interface PersonException { user_id: string; name: string; job_title: string | null; roles: string[]; changes: { right: string; allowed: boolean }[]; editable: boolean }
export interface Grant {
  id: string; user_id: string; name: string | null; right: string; label: string; reason: string; hours: number;
  status: "waiting" | "approved" | "refused" | "ended"; at: string; decided_by: string | null; expires_at: string | null; note: string | null;
}
export interface RightsPage {
  school: { id: string; name: string; head_title: string }; can_change: boolean; can_approve: boolean; my_rights: string[];
  roles: RoleRow[]; exceptions: PersonException[]; requests: Grant[]; log: { at: string; who: string | null; action: string; what: string }[];
}
export interface PersonRights { user_id: string; name: string; job_title: string | null; roles: string[]; rights: string[]; changes: { right: string; allowed: boolean }[] }
export interface Notice { id: string; kind: string; icon: string; text: string; link: string | null; at: string; read: boolean }

const g = <T,>(p: string) => api.raw<T>("GET", p);
export const rightsApi = {
  meta: () => g<RightsMeta>("/api/rights/meta"),
  page: (sid: string) => g<RightsPage>(`/api/schools/${sid}/rights`),
  setRole: (sid: string, role: string, right: string, allowed: boolean | null) => api.raw<RightsPage>("PUT", `/api/schools/${sid}/rights/roles/${role}`, { right, allowed }),
  resetRole: (sid: string, role: string) => api.raw<RightsPage>("POST", `/api/schools/${sid}/rights/roles/${role}/reset`),
  person: (sid: string, uid: string) => g<PersonRights>(`/api/schools/${sid}/rights/people/${uid}`),
  setPerson: (sid: string, uid: string, right: string, allowed: boolean | null) => api.raw<RightsPage>("PUT", `/api/schools/${sid}/rights/people/${uid}`, { right, allowed }),
  setTitle: (sid: string, title: string) => api.raw<{ head_title: string }>("PUT", `/api/schools/${sid}/head-title`, { title }),
  ask: (sid: string, right: string, reason: string, hours: number) => api.raw<{ id: string }>("POST", `/api/schools/${sid}/access-requests`, { right, reason, hours }),
  mine: (sid: string) => g<Grant[]>(`/api/me/schools/${sid}/access-requests`),
  decide: (id: string, decision: "approve" | "refuse" | "end", hours?: number, note?: string) =>
    api.raw<Grant>("PUT", `/api/access-requests/${id}`, { decision, hours: hours ?? null, note: note || null }),
  seeAs: (sid: string, uid: string) => api.raw<{ access_token: string; name: string }>("POST", `/api/schools/${sid}/see-as/${uid}`),
  notices: () => g<{ unread: number; items: Notice[] }>("/api/me/notices"),
  readAll: () => api.raw<void>("POST", "/api/me/notices/read"),
};
let metaCache: Promise<RightsMeta> | null = null;
export const loadRightsMeta = () => (metaCache ??= rightsApi.meta().catch((e) => { metaCache = null; throw e; }));

// ---------- The logged-in person, everywhere ----------

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);

const ALL_OWNER = new Set(["school", "students", "attendance", "classes", "teaching", "results", "discipline", "staff", "staff_day", "growth", "operations", "facilities", "setup", "logins", "rights", "library"]
  .flatMap((a) => [`${a}.see`, `${a}.change`]).concat(["imports.change", "private.health", "private.safeguarding", "private.staff_pay", "power.see_as", "power.publish_results", "power.decide_discipline"]));
export function rightsIn(me: Me | null, schoolId: string): Set<string> {
  if (!me) return new Set();
  const r = me.rights?.[schoolId];
  // A school made after logging in isn't in the list yet: its owner may do everything there (the server checks).
  if (!r && !me.acting && me.memberships.some((m) => m.role === "owner")) return ALL_OWNER;
  return new Set(r ?? []);
}
export function useCan(schoolId: string) {
  const me = useMe();
  const r = rightsIn(me, schoolId);
  return (right: string) => r.has(right);
}
export function opensSchool(me: Me, schoolId: string): boolean {
  return [...rightsIn(me, schoolId)].some((r) => r.endsWith(".see"));
}
export function headTitle(me: Me | null, schoolId: string): string {
  return me?.head_titles?.[schoolId] ?? "Head of school";
}

// The page area being shown (students, setup...), so forms know whether to offer Add, Edit and Delete.
export const AreaContext = createContext<{ schoolId: string; area: string } | null>(null);
export function useCanChange(): boolean {
  const a = useContext(AreaContext);
  const me = useMe();
  if (!a || !me) return true;
  return rightsIn(me, a.schoolId).has(`${a.area}.change`);
}

// ---------- See as ----------

const REAL = "sp_real_token";
export function startSeeAs(token: string): void {
  try {
    if (!sessionStorage.getItem(REAL)) sessionStorage.setItem(REAL, getToken() ?? "");
  } catch { /* storage off: 'stop' will log out instead */ }
  setToken(token);
  window.location.hash = "";
  window.location.reload();
}
export async function stopSeeAs(): Promise<void> {
  try { await api.raw("POST", "/api/see-as/stop"); } catch { /* the token may have run out */ }
  let real = "";
  try { real = sessionStorage.getItem(REAL) ?? ""; sessionStorage.removeItem(REAL); } catch { /* ignore */ }
  setToken(real || null);
  window.location.hash = "";
  window.location.reload();
}

export const PRIVATE_KIND: Record<string, string> = { "private:health": "private.health", "private:safeguarding": "private.safeguarding", "private:staff_pay": "private.staff_pay" };

// Only someone above a role may give it (the server checks too).
export const RANK: Record<string, number> = { owner: 100, head_of_school: 90, head: 80, vice_principal: 70, it_admin: 60, bursar: 50, house_parent: 30, teacher: 30, support: 20 };
export function myRank(me: Me | null, schoolId: string): number {
  if (!me) return 0;
  return Math.max(0, ...me.memberships.filter((m) => m.role === "owner" || m.school_id === schoolId).map((m) => RANK[m.role] ?? 0));
}
export function useRoleTools(): { may: (role: string) => boolean; label: (role: string, fallback: string) => string } {
  const a = useContext(AreaContext);
  const me = useMe();
  const sid = a?.schoolId ?? "";
  const rank = myRank(me, sid);
  return {
    may: (role) => !a || rank > (RANK[role] ?? 0),
    label: (role, fallback) => (role === "head_of_school" ? headTitle(me, sid) : fallback),
  };
}
