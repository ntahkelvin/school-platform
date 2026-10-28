// Organisations, boards and the board view.
import { request, type NewLogin } from "./api";

const get = <T,>(path: string) => request<T>(path);
const send = <T,>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export interface Organisation {
  id: string;
  name: string;
  logo: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}
export interface BoardMember {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  position: string;
  term_start: string | null;
  term_end: string | null;
}
export interface Board {
  id: string;
  name: string;
  school_id: string | null;
  members: BoardMember[];
}
export interface MemberInput {
  full_name: string;
  phone: string;
  email: string;
  position: string;
  term_start: string | null;
  term_end: string | null;
}
export interface SchoolSummary {
  id: string;
  name: string;
  logo: string | null;
  motto: string | null;
  school_type: string;
  branches: number;
  students: number;
  boys: number;
  girls: number;
  boarders: number;
  by_section: Record<string, number>;
  staff_total: number;
  staff: { role: string; count: number }[];
  attendance_rate_30d: number | null;
  upcoming: { title: string; category: string; starts_on: string; ends_on: string | null }[];
  boards: Board[];
}
export interface OrganisationSummary {
  id: string;
  name: string;
  logo: string | null;
  is_owner: boolean;
  boards: Board[];
  schools: SchoolSummary[];
  totals: { schools: number; students: number; boarders: number; staff: number };
}

export type BoardScope = { kind: "org"; id: string } | { kind: "school"; id: string };
const scopePath = (s: BoardScope) => (s.kind === "org" ? `/api/groups/${s.id}/boards` : `/api/schools/${s.id}/boards`);

export const org = {
  create: (name: string) => send<Organisation>("POST", "/api/groups", { name }),
  profile: (id: string) => get<Organisation>(`/api/groups/${id}/profile`),
  saveProfile: (id: string, data: Partial<Organisation>) => send<Organisation>("PUT", `/api/groups/${id}/profile`, data),
  deleteSchool: (schoolId: string, confirmName: string) =>
    send<void>("DELETE", `/api/schools/${schoolId}`, { confirm_name: confirmName }),
  deleteOrganisation: (id: string) => send<void>("DELETE", `/api/groups/${id}`),
  moveSchool: (schoolId: string, groupId: string) => send<void>("POST", `/api/schools/${schoolId}/move`, { group_id: groupId }),
  makeSchool: (branchId: string, name: string, copySetup: boolean) =>
    send<{ school_id: string; copied: string[] }>("POST", `/api/branches/${branchId}/make-school`, { name, copy_setup: copySetup }),

  positions: () => get<string[]>("/api/board-positions"),
  boards: (scope: BoardScope) => get<Board[]>(scopePath(scope)),
  addBoard: (scope: BoardScope, name: string) => send<Board>("POST", scopePath(scope), { name }),
  renameBoard: (id: string, name: string) => send<Board>("PATCH", `/api/boards/${id}`, { name }),
  deleteBoard: (id: string) => send<void>("DELETE", `/api/boards/${id}`),
  addMember: (boardId: string, m: MemberInput) =>
    send<{ board: Board; new_login: NewLogin | null }>("POST", `/api/boards/${boardId}/members`, m),
  updateMember: (id: string, position: string, term_start: string | null, term_end: string | null) =>
    send<Board>("PATCH", `/api/board-members/${id}`, { position, term_start, term_end }),
  removeMember: (id: string) => send<Board>("DELETE", `/api/board-members/${id}`),

  overview: () => get<OrganisationSummary[]>("/api/board/overview"),
};
