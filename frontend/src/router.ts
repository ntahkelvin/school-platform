// Tiny page router using the part of the address after "#",
// so the browser's back button works and pages can be bookmarked.
import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "school"; id: string; tab: SchoolTab }
  | { page: "branch"; id: string; tab: BranchTab }
  | { page: "student"; id: string }
  | { page: "child"; id: string }
  | { page: "class"; id: string }
  | { page: "apply"; code: string }
  | { page: "marks"; tab: "sheets" | "homework" }
  | { page: "sheet"; scope: string }
  | { page: "results"; id: string }
  | { page: "verify"; code: string }
  | { page: "check" }
  | { page: "org"; id: string }
  | { page: "board" }
  | { page: "staff" }
  | { page: "staff-record"; school: string; id: string }
  | { page: "staff-cards"; school: string; id?: string }
  | { page: "kiosk"; school: string; token: string }
  | { page: "passport"; school: string; id: string }
  | { page: "desk"; school: string; desk: string }
  | { page: "register"; kind: "school" | "night"; id: string; date: string };

export type BranchTab = "students" | "classes" | "staff" | "attendance" | "facilities";
const TABS: BranchTab[] = ["students", "classes", "staff", "attendance", "facilities"];

export type SchoolTab =
  | "overview" | "students" | "attendance" | "classes" | "staff" | "facilities"
  | "sections" | "departments" | "houses" | "grading" | "calendar" | "policies" | "imports" | "logins" | "teaching" | "staff-day" | "growth" | "operations" | "rights" | "library" | "assets" | "admissions" | "timetable" | "results";
export const SCHOOL_TABS: SchoolTab[] = [
  "overview", "students", "attendance", "classes", "staff", "facilities",
  "sections", "departments", "houses", "grading", "calendar", "policies", "imports", "logins", "teaching", "staff-day", "growth", "operations", "rights", "library", "assets", "admissions", "timetable", "results",
];

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "school" && parts[1]) {
    const tab = SCHOOL_TABS.includes(parts[2] as SchoolTab) ? (parts[2] as SchoolTab) : "overview";
    return { page: "school", id: parts[1], tab };
  }
  if (parts[0] === "student" && parts[1]) return { page: "student", id: parts[1] };
  if (parts[0] === "child" && parts[1]) return { page: "child", id: parts[1] };
  if (parts[0] === "class" && parts[1]) return { page: "class", id: parts[1] };
  if (parts[0] === "apply" && parts[1]) return { page: "apply", code: parts[1] };
  if (parts[0] === "marks") return { page: "marks", tab: parts[1] === "homework" ? "homework" : "sheets" };
  if (parts[0] === "sheet" && parts[1]) return { page: "sheet", scope: decodeURIComponent(parts[1]) };
  if (parts[0] === "results" && parts[1]) return { page: "results", id: parts[1] };
  if (parts[0] === "verify" && parts[1]) return { page: "verify", code: parts[1] };
  if (parts[0] === "check") return { page: "check" };
  if (parts[0] === "org" && parts[1]) return { page: "org", id: parts[1] };
  if (parts[0] === "board") return { page: "board" };
  if (parts[0] === "staff") return { page: "staff" };
  if (parts[0] === "staff-record" && parts[1] && parts[2]) return { page: "staff-record", school: parts[1], id: parts[2] };
  if (parts[0] === "desk" && parts[1] && parts[2]) return { page: "desk", school: parts[1], desk: parts[2] };
  if (parts[0] === "growth" && parts[1] && parts[2]) return { page: "passport", school: parts[1], id: parts[2] };
  if (parts[0] === "kiosk" && parts[1] && parts[2]) return { page: "kiosk", school: parts[1], token: parts[2] };
  if (parts[0] === "staff-cards" && parts[1]) return { page: "staff-cards", school: parts[1], id: parts[2] };
  if (parts[0] === "branch" && parts[1]) {
    const tab = TABS.includes(parts[2] as BranchTab) ? (parts[2] as BranchTab) : "students";
    return { page: "branch", id: parts[1], tab };
  }
  if ((parts[0] === "register" || parts[0] === "night-roll") && parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[2] ?? "")) {
    return { page: "register", kind: parts[0] === "register" ? "school" : "night", id: parts[1], date: parts[2] };
  }
  return { page: "home" };
}

export function href(route: Route): string {
  switch (route.page) {
    case "home":
      return "#/";
    case "school":
      return `#/school/${route.id}/${route.tab}`;
    case "student":
      return `#/student/${route.id}`;
    case "child":
      return `#/child/${route.id}`;
    case "class":
      return `#/class/${route.id}`;
    case "apply":
      return `#/apply/${route.code}`;
    case "marks":
      return `#/marks/${route.tab}`;
    case "sheet":
      return `#/sheet/${encodeURIComponent(route.scope)}`;
    case "results":
      return `#/results/${route.id}`;
    case "verify":
      return `#/verify/${route.code}`;
    case "check":
      return "#/check";
    case "org":
      return `#/org/${route.id}`;
    case "board":
      return "#/board";
    case "staff":
      return "#/staff";
    case "staff-record":
      return `#/staff-record/${route.school}/${route.id}`;
    case "staff-cards":
      return `#/staff-cards/${route.school}${route.id ? `/${route.id}` : ""}`;
    case "desk":
      return `#/desk/${route.school}/${route.desk}`;
    case "passport":
      return `#/growth/${route.school}/${route.id}`;
    case "kiosk":
      return `#/kiosk/${route.school}/${route.token}`;
    case "branch":
      return `#/branch/${route.id}/${route.tab}`;
    case "register":
      return `#/${route.kind === "school" ? "register" : "night-roll"}/${route.id}/${route.date}`;
  }
}

export function go(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
