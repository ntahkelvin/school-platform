// Picks an icon and a colour for things in a school, from their type or their name,
// so every list is colourful and easy to scan. Colours are names of CSS hues in styles.css.
export type Hue =
  | "blue" | "sky" | "cyan" | "teal" | "green" | "lime" | "amber" | "orange" | "red" | "rose" | "pink"
  | "fuchsia" | "violet" | "indigo" | "slate";
export interface Look { icon: string; hue: Hue }

const HUES: Hue[] = ["blue", "violet", "pink", "orange", "teal", "amber", "indigo", "rose", "cyan", "green", "fuchsia", "sky", "lime", "red"];

/** A steady colour for any text: the same name always gets the same colour. */
export function hueOf(text: string): Hue {
  let h = 0;
  for (const ch of text.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

/** First rule whose words appear in the text wins. */
function byWords(text: string, rules: [RegExp, string, Hue][], fallback: Look): Look {
  const t = text.toLowerCase();
  for (const [re, icon, hue] of rules) if (re.test(t)) return { icon, hue };
  return fallback;
}

export const TAB_LOOK: Record<string, Look> = {
  overview: { icon: "overview", hue: "blue" },
  students: { icon: "students", hue: "violet" },
  attendance: { icon: "attendance", hue: "green" },
  classes: { icon: "classes", hue: "orange" },
  staff: { icon: "staff", hue: "cyan" },
  facilities: { icon: "facilities", hue: "teal" },
  sections: { icon: "sections", hue: "indigo" },
  departments: { icon: "departments", hue: "sky" },
  houses: { icon: "houses", hue: "rose" },
  grading: { icon: "grading", hue: "amber" },
  calendar: { icon: "calendar", hue: "pink" },
  policies: { icon: "policies", hue: "slate" },
  imports: { icon: "layers", hue: "teal" },
  logins: { icon: "shield-check", hue: "indigo" },
  teaching: { icon: "presentation", hue: "fuchsia" },
  "staff-day": { icon: "staff-day", hue: "green" },
  growth: { icon: "growth", hue: "lime" },
  operations: { icon: "wrench", hue: "orange" },
};

export const FACILITY_LOOK: Record<string, Look> = {
  classroom: { icon: "classroom", hue: "sky" },
  laboratory: { icon: "laboratory", hue: "violet" },
  ict_lab: { icon: "ict_lab", hue: "blue" },
  library: { icon: "library", hue: "amber" },
  hall: { icon: "hall", hue: "indigo" },
  sick_bay: { icon: "sick_bay", hue: "red" },
  kitchen: { icon: "kitchen", hue: "orange" },
  dining_hall: { icon: "dining_hall", hue: "rose" },
  sports_field: { icon: "sports_field", hue: "green" },
  staff_room: { icon: "staff_room", hue: "teal" },
  office: { icon: "office", hue: "slate" },
  chapel_mosque: { icon: "chapel_mosque", hue: "fuchsia" },
  store: { icon: "store", hue: "lime" },
  workshop: { icon: "workshop", hue: "cyan" },
  tuck_shop: { icon: "tuck_shop", hue: "pink" },
  other: { icon: "other", hue: "slate" },
};

const SUBJECT_RULES: [RegExp, string, Hue][] = [
  [/further math|mathemat|maths|arithmetic|numeracy|quantitative/, "sigma", "blue"],
  [/physics/, "atom", "indigo"],
  [/chemistry/, "flask", "violet"],
  [/biology|basic science|science/, "microscope", "green"],
  [/agric|farm/, "sprout", "lime"],
  [/computer|ict|data processing|coding|digital|information tech/, "laptop", "cyan"],
  [/english|literature|reading|phonics|verbal/, "book-text", "rose"],
  [/french|igbo|yoruba|hausa|arabic|language/, "languages", "pink"],
  [/economics|commerce|account|business|financial|book.?keeping|marketing|store/, "coins", "amber"],
  [/government|civic|citizenship|social stud|security/, "landmark", "sky"],
  [/history/, "scroll", "orange"],
  [/geography/, "earth", "teal"],
  [/christian|crs|crk|islamic|irs|irk|religio|moral/, "church", "fuchsia"],
  [/fine art|creative|art|craft|drawing|cultural/, "palette", "pink"],
  [/music/, "music", "rose"],
  [/physical|health|phe|sport/, "dumbbell", "red"],
  [/technical|technology|tech|electric|metal|wood|building|auto/, "wrench", "orange"],
  [/home economics|food|catering|nutrition/, "cooking-pot", "orange"],
  [/vocational|entrepreneur|trade/, "briefcase", "slate"],
];
export function subjectLook(name: string): Look {
  return byWords(name, SUBJECT_RULES, { icon: "book", hue: hueOf(name) });
}

export function departmentLook(name: string, kind?: string): Look {
  return byWords(name, [
    [/science/, "flask", "violet"],
    [/math/, "sigma", "blue"],
    [/english|language/, "languages", "rose"],
    [/art|humanit|social/, "palette", "pink"],
    [/commerc|business|account(?!ing office)/, "coins", "amber"],
    [/technical|vocation|technolog/, "wrench", "orange"],
    [/nursery|primary|early/, "blocks", "teal"],
    [/ict|computer/, "laptop", "cyan"],
    [/admin|office|registry/, "briefcase", "slate"],
    [/bursar|finance|accounts/, "banknote", "green"],
    [/security|gate/, "shield-check", "indigo"],
    [/boarding|hostel/, "bed", "violet"],
    [/kitchen|catering|food/, "cooking-pot", "orange"],
    [/medical|health|clinic|sick/, "stethoscope", "red"],
    [/maintenance|works|estate|cleaning/, "hammer", "cyan"],
    [/transport|driver/, "bus", "amber"],
    [/library/, "library", "amber"],
    [/sport|games/, "trophy", "green"],
    [/chaplain|religio|pastoral/, "church", "fuchsia"],
    [/guidance|counsel|welfare/, "handshake", "pink"],
  ], kind === "non_academic" ? { icon: "building", hue: hueOf(name) } : { icon: "book", hue: hueOf(name) });
}

export function clubLook(name: string, kind?: string): Look {
  const byKind: Record<string, Look> = {
    club: { icon: "star", hue: "amber" }, society: { icon: "users", hue: "violet" },
    sports_team: { icon: "trophy", hue: "green" }, uniformed: { icon: "shield", hue: "indigo" },
  };
  return byWords(name, [
    [/ict|computer|coding|robot|tech/, "cpu", "cyan"],
    [/jet|science|stem|math/, "rocket", "indigo"],
    [/chess/, "crown", "amber"],
    [/debate|literary|public speak/, "mic", "violet"],
    [/drama|theatre|theater|cultural/, "drama", "pink"],
    [/music|choir|band/, "music", "rose"],
    [/basket|volley|handball/, "volleyball", "orange"],
    [/football|soccer|athlet|sport|track/, "trophy", "green"],
    [/red cross|first aid|health/, "heart-pulse", "red"],
    [/scout|guide|brigade|cadet|man o|uniform/, "tent", "lime"],
    [/art|craft|paint/, "palette", "pink"],
    [/press|journal|writer|magazine/, "pen-tool", "slate"],
    [/photo|media/, "camera", "sky"],
    [/environment|green|eco|garden/, "leaf", "green"],
    [/farmer|agric/, "tractor", "lime"],
    [/french|language/, "languages", "pink"],
    [/swim/, "waves", "sky"],
    [/game/, "gamepad", "fuchsia"],
  ], byKind[kind ?? ""] ?? { icon: "star", hue: hueOf(name) });
}

export const EVENT_LOOK: Record<string, Look> = {
  resumption: { icon: "school", hue: "green" },
  midterm_break: { icon: "sun", hue: "amber" },
  holiday: { icon: "plane", hue: "sky" },
  exams: { icon: "notebook", hue: "red" },
  pta_meeting: { icon: "users", hue: "violet" },
  visiting_day: { icon: "handshake", hue: "pink" },
  sports: { icon: "trophy", hue: "lime" },
  excursion: { icon: "bus", hue: "cyan" },
  open_day: { icon: "sparkle", hue: "fuchsia" },
  graduation: { icon: "graduation-cap", hue: "indigo" },
  religious: { icon: "church", hue: "fuchsia" },
  cultural: { icon: "drama", hue: "rose" },
  other: { icon: "calendar-days", hue: "slate" },
};

export const PERIOD_LOOK: Record<string, Look> = {
  lesson: { icon: "book", hue: "blue" },
  break: { icon: "coffee", hue: "amber" },
  assembly: { icon: "megaphone", hue: "violet" },
  prep: { icon: "notebook", hue: "teal" },
  other: { icon: "clock", hue: "slate" },
};

export const POLICY_LOOK: Record<string, Look> = {
  General: { icon: "scroll", hue: "slate" },
  Academic: { icon: "book", hue: "blue" },
  Discipline: { icon: "gavel", hue: "red" },
  Uniform: { icon: "shirt", hue: "indigo" },
  Boarding: { icon: "bed", hue: "violet" },
  Visiting: { icon: "handshake", hue: "pink" },
  Health: { icon: "stethoscope", hue: "rose" },
  Fees: { icon: "banknote", hue: "green" },
  Safety: { icon: "shield-check", hue: "amber" },
};

export const STAGE_LOOK: Record<string, Look> = {
  Nursery: { icon: "baby", hue: "pink" },
  Primary: { icon: "blocks", hue: "orange" },
  "Junior Secondary": { icon: "book", hue: "blue" },
  "Senior Secondary": { icon: "graduation-cap", hue: "violet" },
  Other: { icon: "school", hue: "slate" },
};
export function stageOf(level: string): string {
  return /^(creche|pre-nursery|nursery|kg)/i.test(level) ? "Nursery" : /^primary/i.test(level) ? "Primary"
    : /^jss/i.test(level) ? "Junior Secondary" : /^ss/i.test(level) ? "Senior Secondary" : "Other";
}
export function sectionLook(name: string, levels: string[]): Look {
  const fromName = byWords(name, [
    [/nursery|creche|kg|early/, "baby", "pink"],
    [/primary|basic/, "blocks", "orange"],
    [/junior/, "book", "blue"],
    [/senior/, "graduation-cap", "violet"],
  ], { icon: "", hue: "slate" });
  if (fromName.icon) return fromName;
  return levels[0] ? STAGE_LOOK[stageOf(levels[0])] : { icon: "layers", hue: hueOf(name) };
}

export const ROLE_HUE: Record<string, Hue> = {
  owner: "indigo", head: "violet", it_admin: "teal", vice_principal: "fuchsia", teacher: "blue", class_teacher: "sky", bursar: "green",
  accountant: "green", secretary: "slate", house_parent: "pink", nurse: "red", librarian: "amber", security: "indigo",
  cook: "orange", driver: "amber", cleaner: "teal", board_member: "rose",
};

export const HOSTEL_LOOK: Record<string, Look> = {
  boys: { icon: "boys", hue: "blue" },
  girls: { icon: "girls", hue: "pink" },
  mixed: { icon: "hostel", hue: "violet" },
};
