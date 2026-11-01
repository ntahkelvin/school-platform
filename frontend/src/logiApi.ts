// Kitchen, store and transport.
import { api } from "./api";
import type { Insight } from "./growthApi";
import type { Hue } from "./look";
import type { Person, StudentCard } from "./opsApi";

export interface LogiMeta {
  meals: Record<string, string>; leftover: Record<string, string>; categories: Record<string, Record<string, string>>;
  check_items: Record<string, string>; trip_kinds: Record<string, string>; service_kinds: Record<string, string>;
}
export interface HeadCount { boarders: number; boarders_out: number; sick_bay: number; dining_boarders: number; day_students: number; day_present: number; day_source: string }
export interface MealDay {
  meal: string; label: string; expected: number; cook_for: number; made_of: string[]; sick_bay_trays: number; dishes: string | null; notes: string | null;
  served: number | null; leftover: string | null; rating: number | null; service_notes: string | null;
}
export interface Diet extends StudentCard { allergies: string | null; diet: string | null }
export interface KitchenDay { date: string; count: HeadCount; meals: MealDay[]; diets: Diet[]; can_edit: boolean; settings: { meals: string[]; day_students_lunch: boolean; staff_meals: number }; insights: Insight[] }
export interface Menu { week: string; meals: string[]; can_edit: boolean; plan: { on_date: string; meal: string; dishes: string; notes: string | null }[] }
export interface Item {
  id: string; store: string; name: string; category: string; category_label: string; unit: string; quantity: number; reorder_level: number; unit_cost: number | null;
  value: number; location: string | null; notes: string | null; used_30: number; days_left: number | null; status: "ok" | "low" | "out"; last_move: string | null;
}
export interface ItemIn { store: string; name: string; category: string; unit: string; quantity: number; reorder_level: number; unit_cost: number | null; location: string | null; notes: string | null }
export interface Stock { store: string; categories: Record<string, string>; items: Item[]; value: number; insights: Insight[] }
export interface Move { id: string; kind: "in" | "out" | "count"; quantity: number; balance: number; unit_cost: number | null; supplier: string | null; issued_to: string | null; note: string | null; by: string | null; at: string }
export interface Shopping { store: string; items: { id: string; name: string; category: string; unit: string; have: number; used_30: number; buy: number; unit_cost: number | null; cost: number | null }[]; total: number; priced: boolean }
export interface Paper { label: string; date: string | null; days: number | null }
export interface Vehicle {
  id: string; name: string; kind: string; plate_number: string | null; capacity: number | null; driver_name: string | null; driver_phone: string | null; odometer_km: number | null;
  papers: Record<"insurance_expiry" | "roadworthiness_expiry" | "licence_expiry", Paper>; service_every_km: number | null; last_service_km: number | null;
  since_service_km: number | null; service_due: boolean; check: { all_ok: boolean; items: Record<string, boolean>; notes: string | null } | null;
  efficiency: number[]; efficiency_avg: number | null; fuel_month: number; service_month: number;
  open_trip: { id: string; purpose: string; destination: string | null; started_at: string } | null;
}
export interface Fleet { vehicles: Vehicle[]; check_items: Record<string, string>; insights: Insight[] }
export interface Stop { name: string; morning: string | null; afternoon: string | null }
export interface Route {
  id: string; name: string; vehicle_id: string | null; vehicle_name: string | null; stops: Stop[]; driver: Person | null; attendant: Person | null;
  riders: (StudentCard & { stop: string | null })[]; today: Record<string, { boarded: number; all_off: boolean; started_at: string | null }>;
}
export interface Register { route: Route; date: string; run: string; boarded: string[]; started_at: string | null; all_off_at: string | null; notes: string | null }
export interface LogiOverview {
  meals: { label: string; expected: number; dishes: string | null }[]; diets: number; store: { items: number; low: number; value: number }; food: { items: number; low: number; value: number };
  fleet: { vehicles: number; checked: number; out: number; fuel_month: number }; insights: Insight[];
}

const g = <T,>(p: string) => api.raw<T>("GET", p);
export const logi = {
  meta: () => g<LogiMeta>("/api/logistics/meta"),
  overview: (sid: string) => g<LogiOverview>(`/api/schools/${sid}/logistics/overview`),
  kitchenDay: (sid: string, date?: string) => g<KitchenDay>(`/api/schools/${sid}/kitchen/day${date ? `?date=${date}` : ""}`),
  saveKitchenSettings: (sid: string, s: { meals: string[]; day_students_lunch: boolean; staff_meals: number }) => api.raw("PUT", `/api/schools/${sid}/kitchen/settings`, s),
  menu: (sid: string, week: string) => g<Menu>(`/api/schools/${sid}/kitchen/menu?week=${week}`),
  setMenu: (sid: string, body: { on_date: string; meal: string; dishes: string; notes?: string | null }) => api.raw("PUT", `/api/schools/${sid}/kitchen/menu`, body),
  copyMenu: (sid: string, from_week: string, to_week: string) => api.raw<{ copied: number }>("POST", `/api/schools/${sid}/kitchen/menu/copy`, { from_week, to_week }),
  service: (sid: string, body: { on_date: string; meal: string; served: number; leftover: string; rating: number | null; notes: string | null }) => api.raw("PUT", `/api/schools/${sid}/kitchen/service`, body),
  stock: (sid: string, store: string) => g<Stock>(`/api/schools/${sid}/stock?store=${store}`),
  addItem: (sid: string, i: ItemIn) => api.raw<Item>("POST", `/api/schools/${sid}/stock`, i),
  editItem: (id: string, i: ItemIn) => api.raw<Item>("PUT", `/api/stock/${id}`, i),
  removeItem: (id: string) => api.raw<void>("DELETE", `/api/stock/${id}`),
  move: (id: string, body: { kind: string; quantity: number; unit_cost?: number | null; supplier?: string | null; issued_to?: string | null; note?: string | null }) => api.raw<Item>("POST", `/api/stock/${id}/move`, body),
  moves: (id: string) => g<Move[]>(`/api/stock/${id}/moves`),
  issue: (sid: string, body: { store: string; lines: { item_id: string; quantity: number }[]; issued_to: string; note: string | null; ticket_id: string | null }) =>
    api.raw<{ issued: string[] }>("POST", `/api/schools/${sid}/stock/issue`, body),
  shopping: (sid: string, store: string) => g<Shopping>(`/api/schools/${sid}/stock/shopping?store=${store}`),
  fleet: (sid: string) => g<Fleet>(`/api/schools/${sid}/fleet`),
  papers: (vid: string, body: Partial<{ odometer_km: number | null; insurance_expiry: string | null; roadworthiness_expiry: string | null; licence_expiry: string | null; service_every_km: number | null; last_service_km: number | null }>) =>
    api.raw<Vehicle>("PUT", `/api/vehicles/${vid}/papers`, body),
  check: (vid: string, body: { items: Record<string, boolean>; odometer: number | null; notes: string | null }) => api.raw<Vehicle>("POST", `/api/vehicles/${vid}/checks`, body),
  startTrip: (vid: string, body: { kind: string; purpose: string; destination: string | null; passengers: number | null; odometer_start: number | null }) => api.raw<Vehicle>("POST", `/api/vehicles/${vid}/trips`, body),
  endTrip: (tid: string, body: { odometer_end: number | null; notes: string | null }) => api.raw<Vehicle>("PUT", `/api/trips/${tid}/end`, body),
  fuel: (vid: string, body: { on_date: string; litres: number; cost: number; odometer: number | null; station: string | null }) => api.raw<Vehicle>("POST", `/api/vehicles/${vid}/fuel`, body),
  serviceLog: (vid: string, body: { on_date: string; kind: string; description: string; cost: number | null; odometer: number | null; garage: string | null }) => api.raw<Vehicle>("POST", `/api/vehicles/${vid}/services`, body),
  history: (vid: string) => g<{ vehicle: Vehicle; events: { at: string; kind: string; title: string; detail: string }[] }>(`/api/vehicles/${vid}/history`),
  routes: (sid: string) => g<Route[]>(`/api/schools/${sid}/routes`),
  addRoute: (sid: string, r: { name: string; vehicle_id: string | null; stops: Stop[]; driver_id: string | null; attendant_id: string | null }) => api.raw<Route>("POST", `/api/schools/${sid}/routes`, r),
  editRoute: (id: string, r: { name: string; vehicle_id: string | null; stops: Stop[]; driver_id: string | null; attendant_id: string | null }) => api.raw<Route>("PUT", `/api/routes/${id}`, r),
  removeRoute: (id: string) => api.raw<void>("DELETE", `/api/routes/${id}`),
  setRiders: (id: string, riders: { student_id: string; stop: string | null }[]) => api.raw<Route>("PUT", `/api/routes/${id}/riders`, { riders }),
  register: (id: string, run: string) => g<Register>(`/api/routes/${id}/register?run=${run}`),
  saveRegister: (id: string, body: { run: string; boarded: string[]; all_off: boolean; notes: string | null }) => api.raw<Register>("PUT", `/api/routes/${id}/register`, body),
};
let metaCache: Promise<LogiMeta> | null = null;
export const loadLogiMeta = () => (metaCache ??= logi.meta().catch((e) => { metaCache = null; throw e; }));

export const MEAL_LOOK: Record<string, { icon: string; hue: Hue; emoji: string }> = {
  breakfast: { icon: "sun", hue: "amber", emoji: "🍳" }, lunch: { icon: "utensils", hue: "orange", emoji: "🍛" },
  supper: { icon: "moon", hue: "indigo", emoji: "🍲" }, snack: { icon: "coffee", hue: "pink", emoji: "🍪" },
};
export const LEFT_LOOK: Record<string, Hue> = { none: "green", little: "teal", some: "amber", lots: "red" };
export const CAT_LOOK: Record<string, { icon: string; hue: Hue }> = {
  stationery: { icon: "pen-tool", hue: "blue" }, cleaning: { icon: "sparkle", hue: "teal" }, maintenance: { icon: "wrench", hue: "orange" }, ict: { icon: "laptop", hue: "indigo" },
  sports: { icon: "trophy", hue: "green" }, uniform: { icon: "shirt", hue: "violet" }, toiletries: { icon: "waves", hue: "sky" }, other: { icon: "shapes", hue: "slate" },
  grains: { icon: "sprout", hue: "amber" }, protein: { icon: "soup", hue: "rose" }, vegetables: { icon: "leaf", hue: "green" }, oil: { icon: "flask", hue: "orange" },
  drinks: { icon: "coffee", hue: "cyan" }, fuel: { icon: "flame", hue: "red" },
};
export const naira = (n: number | null | undefined) => (n == null ? "–" : `₦${Math.round(n).toLocaleString()}`);
export const units = (q: number, unit: string) => {
  const plural = q !== 1 && !unit.endsWith("s") && !["kg", "g"].includes(unit);
  return `${Number.isInteger(q) ? q : q.toFixed(1)} ${unit}${plural ? (/(x|ch|sh)$/.test(unit) ? "es" : "s") : ""}`;
};
