// Tiny page router using the part of the address after "#",
// so the browser's back button works and pages can be bookmarked.
import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "school"; id: string }
  | { page: "branch"; id: string; tab: "students" | "classes" | "staff" }
  | { page: "student"; id: string };

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "school" && parts[1]) return { page: "school", id: parts[1] };
  if (parts[0] === "student" && parts[1]) return { page: "student", id: parts[1] };
  if (parts[0] === "branch" && parts[1]) {
    const tab = parts[2] === "classes" || parts[2] === "staff" ? parts[2] : "students";
    return { page: "branch", id: parts[1], tab };
  }
  return { page: "home" };
}

export function href(route: Route): string {
  switch (route.page) {
    case "home":
      return "#/";
    case "school":
      return `#/school/${route.id}`;
    case "student":
      return `#/student/${route.id}`;
    case "branch":
      return `#/branch/${route.id}/${route.tab}`;
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
