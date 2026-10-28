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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");

  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail[0]?.msg ?? message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export type SchoolType = "day" | "boarding" | "mixed";

export interface Branch {
  id: string;
  name: string;
  address: string | null;
  has_boarding: boolean;
}

export interface School {
  id: string;
  name: string;
  school_type: SchoolType;
  branches: Branch[];
}

export interface Group {
  id: string;
  name: string;
  schools: School[];
}

export interface Me {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  memberships: { role: string; group_id: string; school_id: string | null; branch_id: string | null }[];
}

export const api = {
  async login(identifier: string, password: string): Promise<void> {
    const body = new URLSearchParams({ username: identifier, password });
    const res = await request<{ access_token: string }>("/api/auth/login", { method: "POST", body });
    setToken(res.access_token);
  },
  me: () => request<Me>("/api/me"),
  groups: () => request<Group[]>("/api/groups"),
  addSchool: (groupId: string, name: string, school_type: SchoolType) =>
    request<School>(`/api/groups/${groupId}/schools`, {
      method: "POST",
      body: JSON.stringify({ name, school_type }),
    }),
  addBranch: (schoolId: string, name: string, address: string, has_boarding: boolean) =>
    request<Branch>(`/api/schools/${schoolId}/branches`, {
      method: "POST",
      body: JSON.stringify({ name, address, has_boarding }),
    }),
};
