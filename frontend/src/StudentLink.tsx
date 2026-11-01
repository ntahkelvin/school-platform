import type { ReactNode } from "react";
import { href } from "./router";

/** A student's name that opens their profile, wherever it appears. */
export function StudentLink({ id, name, children }: { id: string; name?: string; children?: ReactNode }) {
  return <a className="student-link" href={href({ page: "student", id })} onClick={(e) => e.stopPropagation()}>{children ?? name}</a>;
}
