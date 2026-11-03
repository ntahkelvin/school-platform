"""Analysis built only from official marks: tests that a unit head or HOD has approved.

Every figure is a percentage of the marks a student could have got in the approved tests so far, so a class with
only CA1 approved can be compared with one that has every test in (60% means 12/20 or 60/100 alike).

- The school (Scores and results permission): classes, subjects across levels, grades, terms, students to help,
  top students, boys and girls, houses, teachers (CA against exam), marking quality, WAEC readiness for SS 3.
- A unit head or HOD: the same, for their own subjects only.
- One student, for staff who can see them: each subject against the class average, strengths, weak spots, trend.
- Families: the same picture, but only from published tests (parents never see unpublished marks).
"""
import uuid
from collections import defaultdict
from statistics import mean

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.access import not_found
from app.api.deps import current_user
from app.api.family import child_for
from app.api.student360 import get_student, name_of
from app.core import rights
from app.core.db import get_db
from app.models import (
    AcademicSession, Branch, ClassSubject, ComponentRelease, Department, House, School, SchoolClass, Score, ScoreBookEntry, ScoreCheck, SheetStatus,
    SheetStep, Student, StudentElective, Subject, TeachingGroup, Term, Unit, User,
)
from app.models.people import StudentStatus

router = APIRouter(prefix="/api", tags=["analysis"])
PASS, CREDIT = 40, 50


def avg(xs) -> float | None:
    xs = [x for x in xs if x is not None]
    return round(mean(xs), 1) if xs else None


def rate(xs, cut) -> int | None:
    xs = [x for x in xs if x is not None]
    return round(100 * sum(1 for x in xs if x >= cut) / len(xs)) if xs else None


# ---------- Official marks for a whole school and term ----------

class Table:
    """Every approved mark of a term, as percentages: pct[(student, subject)], comp[(student, subject, test)]."""

    def __init__(self, db: Session, school: School, term: Term, subjects: set | None = None):
        from app.api.assessment import columns_of, scheme_for
        self.term, self.school = term, school
        classes = list(db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school.id)))
        self.classes = {c.id: c for c in classes}
        studs = list(db.scalars(select(Student).where(Student.school_id == school.id, Student.status == StudentStatus.active, Student.class_id.is_not(None))))
        self.students = {s.id: s for s in studs}
        self.subjects = {x.id: x for x in db.scalars(select(Subject).where(Subject.school_id == school.id))}
        # Which sheet (scope) each student's subject belongs to.
        cs = defaultdict(dict)
        for r in db.scalars(select(ClassSubject).where(ClassSubject.class_id.in_(list(self.classes) or [uuid.uuid4()]))):
            cs[r.class_id][r.subject_id] = r
        elect = defaultdict(dict)
        for e in db.scalars(select(StudentElective).where(StudentElective.student_id.in_(list(self.students) or [uuid.uuid4()]))):
            elect[e.student_id][e.subject_id] = e.group_id
        groups = {g.id: g for g in db.scalars(select(TeachingGroup).where(TeachingGroup.id.in_([g for d in elect.values() for g in d.values() if g] or [uuid.uuid4()])))}
        self.scope_of: dict = {}
        self.teacher: dict = {}
        for s in studs:
            for sub_id, r in cs[s.class_id].items():
                if r.compulsory or (sub_id in elect[s.id] and not elect[s.id][sub_id]):
                    self.scope_of[(s.id, sub_id)] = f"class:{s.class_id}:{sub_id}"
                    self.teacher[f"class:{s.class_id}:{sub_id}"] = r.teacher_user_id
            for sub_id, gid in elect[s.id].items():
                if gid:
                    self.scope_of[(s.id, sub_id)] = f"group:{gid}"
                    self.teacher[f"group:{gid}"] = groups[gid].teacher_user_id if gid in groups else None
        if subjects is not None:
            self.scope_of = {k: v for k, v in self.scope_of.items() if k[1] in subjects}
        # Approved tests per sheet (and sheets handed in before tests were checked one by one).
        approved = defaultdict(set)
        for st in db.scalars(select(SheetStep).where(SheetStep.term_id == term.id, SheetStep.approved_at.is_not(None))):
            approved[st.scope].add(st.component)
        legacy = {x.scope for x in db.scalars(select(SheetStatus).where(SheetStatus.term_id == term.id, SheetStatus.status == "submitted"))}
        self.schemes: dict = {}
        for c in classes:
            sch = scheme_for(db, school.id, c.level)
            self.schemes[c.id] = (sch, columns_of(sch))
        raw = defaultdict(dict)
        absent = defaultdict(set)
        for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.student_id.in_(list(self.students) or [uuid.uuid4()]))):
            raw[(r.student_id, r.subject_id)][r.component] = r.value
            if r.absent:
                absent[(r.student_id, r.subject_id)].add(r.component)
        self.pct, self.comp = {}, {}
        for key, scope in self.scope_of.items():
            s = self.students[key[0]]
            sch, cols = self.schemes[s.class_id]
            ok = approved[scope] | ({c["name"] for c in sch} if scope in legacy else set())
            got = mx = 0.0
            for c in sch:
                if c["name"] not in ok:
                    continue
                keys = [x for x in cols if x["key"].split(" › ")[0] == c["name"]]
                vals = [raw[key].get(x["key"]) for x in keys]
                if all(v is None for v in vals) and not any(x["key"] in absent[key] for x in keys):
                    continue
                got_c = sum(v or 0 for v in vals)
                got, mx = got + got_c, mx + c["max"]
                self.comp[(key[0], key[1], c["name"])] = round(100 * got_c / c["max"], 1)
            if mx:
                self.pct[key] = round(100 * got / mx, 1)

    def student_avg(self, sid) -> float | None:
        return avg(v for (s, _), v in self.pct.items() if s == sid)


def visible_subjects(db: Session, user: User, school: School) -> tuple[set | None, str | None]:
    """All subjects (None) for people with Scores and results; otherwise the subjects of the units/departments this person heads."""
    if rights.has(user, school, "results.see", db) or rights.has(user, school, "power.publish_results", db):
        return None, None
    units = list(db.scalars(select(Unit).where(Unit.school_id == school.id, Unit.head_user_id == user.id)))
    depts = list(db.scalars(select(Department).where(Department.school_id == school.id, Department.head_user_id == user.id)))
    if not units and not depts:
        raise not_found("School")
    subs = {s.id for s in db.scalars(select(Subject).where(Subject.school_id == school.id, (Subject.unit_id.in_([u.id for u in units] or [uuid.uuid4()]))
                                                          | (Subject.department_id.in_([d.id for d in depts] or [uuid.uuid4()]))))}
    if not subs:                      # heads of non-teaching units (bursary, kitchen...) have no subjects to analyse
        raise not_found("School")
    return subs, ", ".join([d.name for d in depts] + [u.name for u in units if u.department_id not in {d.id for d in depts}])


@router.get("/me/analysis")
def my_analysis_access(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The schools whose results this person can analyse (for the link on their home page)."""
    from app.models import Membership
    out = []
    for sid in set(db.scalars(select(Membership.school_id).where(Membership.user_id == user.id, Membership.school_id.is_not(None)))):
        sc = db.get(School, sid)
        try:
            subs, label = visible_subjects(db, user, sc)
        except HTTPException:
            continue
        out.append({"id": str(sc.id), "name": sc.name, "scope": label or "Whole school"})
    return out


def terms_with_data(db: Session, school_id: uuid.UUID) -> list[Term]:
    ts = list(db.scalars(select(Term).join(AcademicSession, AcademicSession.id == Term.session_id).where(AcademicSession.school_id == school_id)))
    have = set(db.scalars(select(SheetStep.term_id).where(SheetStep.approved_at.is_not(None)).distinct())) | \
        set(db.scalars(select(SheetStatus.term_id).where(SheetStatus.status == "submitted").distinct()))
    return sorted([t for t in ts if t.id in have], key=lambda t: (t.session.name, t.number))


@router.get("/schools/{school_id}/analysis")
def school_analysis(school_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.academics import _level_order
    from app.api.assessment import bands_for, grade_of, need_term, term_out
    school = db.get(School, school_id)
    if not school:
        raise not_found("School")
    subs, label = visible_subjects(db, user, school)
    term = need_term(db, school.id, term_id)
    T = Table(db, school, term, subs)
    S = T.students
    by_student = defaultdict(list)
    for (sid, sub), v in T.pct.items():
        by_student[sid].append(v)
    averages = {sid: avg(v) for sid, v in by_student.items()}
    all_pct = list(T.pct.values())
    # Previous term (for change and students falling).
    terms = terms_with_data(db, school.id)
    prev = next((t for t in reversed(terms) if (t.session.name, t.number) < (term.session.name, term.number)), None)
    P = Table(db, school, prev, subs) if prev else None
    prev_avg = {sid: P.student_avg(sid) for sid in S} if P else {}
    trend = []
    for t in terms[-6:]:
        tt = T if t.id == term.id else (P if P and t.id == prev.id else Table(db, school, t, subs))
        trend.append({"term": f"{t.name.replace(' term', '')} {t.session.name}", "term_id": str(t.id), "average": avg(tt.pct.values()), "pass": rate(tt.pct.values(), PASS),
                      "students": len({s for s, _ in tt.pct})})
    # Classes
    classes = []
    for c in sorted(T.classes.values(), key=lambda c: (_level_order(c.level), c.name)):
        ks = [(sid, sub) for (sid, sub) in T.pct if S[sid].class_id == c.id]
        if not ks:
            continue
        vals = [T.pct[k] for k in ks]
        per_sub = defaultdict(list)
        for k in ks:
            per_sub[k[1]].append(T.pct[k])
        subj = sorted(((T.subjects[x].name, avg(v)) for x, v in per_sub.items()), key=lambda x: -x[1])
        classes.append({"id": str(c.id), "name": c.name, "level": c.level, "students": len({k[0] for k in ks}), "average": avg(vals), "pass": rate(vals, PASS),
                        "credit": rate(vals, CREDIT), "best": subj[0][0] if subj else None, "weakest": subj[-1][0] if len(subj) > 1 else None,
                        "previous": avg(prev_avg.get(sid) for sid in {k[0] for k in ks}) if P else None})
    # Subjects across levels (heatmap)
    levels = sorted({S[sid].school_class.level for sid, _ in T.pct if S[sid].school_class}, key=_level_order)
    cell = defaultdict(list)
    sub_all = defaultdict(list)
    for (sid, sub), v in T.pct.items():
        lv = S[sid].school_class.level if S[sid].school_class else None
        cell[(sub, lv)].append(v)
        sub_all[sub].append(v)
    subjects = sorted([{"id": str(x), "name": T.subjects[x].name, "average": avg(v), "pass": rate(v, PASS), "credit": rate(v, CREDIT), "entries": len(v),
                        "levels": {lv: avg(cell[(x, lv)]) for lv in levels if cell[(x, lv)]}} for x, v in sub_all.items()], key=lambda r: -(r["average"] or 0))
    # Grades
    bands = bands_for(db, school.id, levels[-1] if levels else None)
    grades = defaultdict(int)
    for v in all_pct:
        grades[grade_of(v, bands)[0]] += 1
    # Students to help
    risk = []
    for sid, a in averages.items():
        s = S[sid]
        fails = [T.subjects[sub].name for (x, sub), v in T.pct.items() if x == sid and v < PASS]
        why = []
        if len(fails) >= 3:
            why.append(f"Below {PASS}% in {len(fails)} subjects")
        if a is not None and a < 45:
            why.append(f"Average {a}%")
        p = prev_avg.get(sid)
        if p is not None and a is not None and p - a >= 8:
            why.append(f"Down {p - a:.0f} points on last term")
        if why:
            risk.append({"id": str(sid), "name": s.full_name, "class_name": s.school_class.name if s.school_class else None, "thumb": s.photo_thumb, "average": a,
                         "previous": p, "reasons": why, "weak": fails[:4], "score": len(fails) * 2 + (1 if a is not None and a < 45 else 0) + ((p - a) / 4 if p and a and p > a else 0)})
    risk.sort(key=lambda r: -r["score"])
    improved = sorted([{"id": str(sid), "name": S[sid].full_name, "class_name": S[sid].school_class.name if S[sid].school_class else None, "average": a, "previous": prev_avg[sid],
                        "change": round(a - prev_avg[sid], 1)} for sid, a in averages.items() if a is not None and prev_avg.get(sid) is not None and a - prev_avg[sid] >= 6],
                      key=lambda r: -r["change"])[:8]
    top = sorted([{"id": str(sid), "name": S[sid].full_name, "class_name": S[sid].school_class.name if S[sid].school_class else None, "thumb": S[sid].photo_thumb, "average": a,
                   "subjects": len(by_student[sid])} for sid, a in averages.items() if a is not None and len(by_student[sid]) >= 5], key=lambda r: -r["average"])[:10]
    # Boys and girls, houses
    gender = {g: {"average": avg(averages[sid] for sid in averages if S[sid].gender and S[sid].gender.value == g), "students": sum(1 for sid in averages if S[sid].gender and S[sid].gender.value == g)}
              for g in ("female", "male")}
    houses = []
    for h in db.scalars(select(House).where(House.school_id == school.id)):
        a = [averages[sid] for sid in averages if S[sid].house_id == h.id]
        if a:
            houses.append({"name": h.name, "colour": h.colour, "average": avg(a), "students": len(a)})
    houses.sort(key=lambda h: -(h["average"] or 0))
    # Teachers: each sheet's average, pass rate, CA against exam, and how students' score books and queries went.
    sheets = defaultdict(list)
    for key, scope in T.scope_of.items():
        if key in T.pct:
            sheets[scope].append(key)
    books = defaultdict(dict)
    for b in db.scalars(select(ScoreBookEntry).where(ScoreBookEntry.term_id == term.id)):
        books[(b.student_id, b.subject_id)][b.key] = b.value
    raw = defaultdict(dict)
    for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.student_id.in_(list({k[0] for k in T.pct}) or [uuid.uuid4()]))):
        raw[(r.student_id, r.subject_id)][r.component] = r.value
    checks = defaultdict(list)
    for c in db.scalars(select(ScoreCheck).where(ScoreCheck.term_id == term.id)):
        checks[c.scope].append(c)
    teachers = []
    for scope, keys in sheets.items():
        sub = keys[0][1]
        cls = S[keys[0][0]].school_class
        sch = T.schemes[S[keys[0][0]].class_id][0]
        exam = next((c["name"] for c in sch if "exam" in c["name"].lower()), None)
        ca = [T.comp.get((k[0], k[1], c["name"])) for k in keys for c in sch if c["name"] != exam]
        ex = [T.comp.get((k[0], k[1], exam)) for k in keys] if exam else []
        compared = [(books[k][key], raw[k].get(key)) for k in keys for key in books[k]]
        differ = sum(1 for a, b in compared if b is None or abs(a - b) > 0.01)
        cs = checks.get(scope, [])
        teachers.append({"scope": scope, "teacher": name_of(db, T.teacher.get(scope)) or "No teacher", "subject": T.subjects[sub].name,
                         "group": cls.name if scope.startswith("class") and cls else "Elective group", "students": len(keys), "average": avg(T.pct[k] for k in keys),
                         "pass": rate([T.pct[k] for k in keys], PASS), "ca": avg(ca), "exam": avg(ex), "gap": round(avg(ca) - avg(ex), 1) if avg(ca) is not None and avg(ex) is not None else None,
                         "book_compared": len(compared), "book_differ": differ, "queries": sum(1 for c in cs if c.query_text),
                         "corrected": sum(1 for c in cs if c.status in ("correcting", "corrected"))})
    teachers.sort(key=lambda r: (r["subject"], r["group"]))
    quality = defaultdict(lambda: {"compared": 0, "differ": 0, "queries": 0, "corrected": 0, "sheets": 0})
    for r in teachers:
        q = quality[r["teacher"]]
        q["compared"] += r["book_compared"]; q["differ"] += r["book_differ"]; q["queries"] += r["queries"]; q["corrected"] += r["corrected"]; q["sheets"] += 1
    quality_rows = sorted([{"teacher": k, **v, "differ_rate": round(100 * v["differ"] / v["compared"]) if v["compared"] else None} for k, v in quality.items() if v["compared"] or v["queries"]],
                          key=lambda r: -(r["differ_rate"] or 0))
    # WAEC readiness: SS 3 students with credits (50%+) in English, Mathematics and at least three others.
    waec = []
    for sid in averages:
        c = S[sid].school_class
        if not c or not c.level.upper().startswith("SS 3"):
            continue
        mine = {T.subjects[sub].name: v for (x, sub), v in T.pct.items() if x == sid}
        eng = next((v for n, v in mine.items() if n.lower().startswith("english")), None)
        mth = next((v for n, v in mine.items() if n.lower() in ("mathematics", "general mathematics")), None)
        credits = sorted([n for n, v in mine.items() if v >= CREDIT])
        others = len([n for n in credits if not n.lower().startswith("english") and n.lower() not in ("mathematics", "general mathematics")])
        ok = (eng or 0) >= CREDIT and (mth or 0) >= CREDIT and others >= 3
        waec.append({"id": str(sid), "name": S[sid].full_name, "class_name": c.name, "english": eng, "maths": mth, "credits": len(credits), "on_track": ok,
                     "short": [x for x, bad in (("English", (eng or 0) < CREDIT), ("Mathematics", (mth or 0) < CREDIT), (f"{3 - others} more credit{'s' if 3 - others != 1 else ''}", others < 3)) if bad]})
    waec.sort(key=lambda r: (r["on_track"], r["credits"]))
    return {
        "school": {"id": str(school.id), "name": school.name}, "term": term_out(term), "limited_to": label, "previous_term": f"{prev.name} {prev.session.name}" if prev else None,
        "kpis": {"students": len(averages), "average": avg(all_pct), "pass": rate(all_pct, PASS), "credit": rate(all_pct, CREDIT), "entries": len(all_pct),
                 "previous_average": avg(P.pct.values()) if P else None, "at_risk": len(risk)},
        "trend": trend, "classes": classes, "levels": levels, "subjects": subjects,
        "grades": [{"grade": g, "min": lo, "max": hi, "remark": rm, "count": grades.get(g, 0)} for g, lo, hi, rm in sorted(bands, key=lambda b: -b[1])],
        "at_risk": risk[:40], "improved": improved, "top": top, "gender": gender, "houses": houses, "teachers": teachers, "quality": quality_rows, "waec": waec,
        "pass_mark": PASS, "credit_mark": CREDIT,
    }


# ---------- One student ----------

def student_picture(rows: dict, class_avgs: dict, earlier: list[tuple[str, dict]]) -> dict:
    """rows: {subject: pct}; class_avgs: {subject: class pct}; earlier: [(term label, {subject: pct})] oldest first."""
    subjects = []
    for name, v in sorted(rows.items()):
        ca = class_avgs.get(name)
        hist = [(lab, e.get(name)) for lab, e in earlier]
        subjects.append({"subject": name, "percent": v, "class_average": ca, "vs_class": round(v - ca, 1) if ca is not None else None,
                         "history": [{"term": lab, "percent": p} for lab, p in hist if p is not None]})
    a = avg(rows.values())
    strengths = [s["subject"] for s in sorted(subjects, key=lambda s: -(s["vs_class"] or 0)) if (s["vs_class"] or 0) >= 3][:3]
    weak = [s["subject"] for s in sorted(subjects, key=lambda s: s["percent"]) if s["percent"] < CREDIT or (s["vs_class"] or 0) <= -8][:3]
    overall = [{"term": lab, "average": avg(e.values())} for lab, e in earlier if e] + ([{"term": "Now", "average": a}] if a is not None else [])
    return {"average": a, "class_average": avg(class_avgs.values()), "subjects": subjects, "strengths": strengths, "weak": weak, "overall": overall,
            "pass_mark": PASS, "credit_mark": CREDIT}


@router.get("/students/{student_id}/analysis")
def student_analysis(student_id: uuid.UUID, term_id: uuid.UUID | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.api.assessment import need_term, term_out
    s, _ = get_student(db, user, student_id)
    school = db.get(School, s.school_id)
    term = need_term(db, school.id, term_id)
    T = Table(db, school, term)
    mine = {T.subjects[sub].name: v for (x, sub), v in T.pct.items() if x == s.id}
    peers = [x for x in T.students.values() if x.class_id == s.class_id]
    class_avgs = {T.subjects[sub].name: avg(v for (x, sub2), v in T.pct.items() if sub2 == sub and T.students[x].class_id == s.class_id)
                  for (x, sub) in T.pct if x == s.id}
    earlier = []
    for t in terms_with_data(db, school.id):
        if (t.session.name, t.number) >= (term.session.name, term.number):
            continue
        E = Table(db, school, t)
        earlier.append((f"{t.name.replace(' term', '')} {t.session.name}", {E.subjects[sub].name: v for (x, sub), v in E.pct.items() if x == s.id}))
    return {"term": term_out(term), "class_size": len(peers), "source": "approved", **student_picture(mine, class_avgs, earlier[-5:])}


@router.get("/me/children/{student_id}/analysis")
def family_analysis(student_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Only published tests: the same picture a parent can already see on the Results tab, with the class averages."""
    s, _ = child_for(db, user, student_id)
    terms = defaultdict(lambda: {"mine": defaultdict(lambda: [0.0, 0.0]), "class": defaultdict(list), "label": ""})
    order = []
    for r, t in db.execute(select(ComponentRelease, Term).join(Term, Term.id == ComponentRelease.term_id).where(ComponentRelease.class_id == s.class_id)):
        snap = r.snapshot or {}
        if str(s.id) not in snap:
            continue
        x = terms[t.id]
        x["label"] = f"{t.name.replace(' term', '')} {t.session.name}"
        if (t.session.name, t.number, t.id) not in order:
            order.append((t.session.name, t.number, t.id))
        for sub, v in snap[str(s.id)].items():
            if v.get("score") is not None and v.get("max"):
                x["mine"][sub][0] += v["score"]; x["mine"][sub][1] += v["max"]
        per = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
        for sid, subs in snap.items():
            for sub, v in subs.items():
                if v.get("score") is not None and v.get("max"):
                    per[sub][sid][0] += v["score"]; per[sub][sid][1] += v["max"]
        x.setdefault("perclass", []).append(per)
    if not order:
        return {"term": None, "source": "published", "average": None, "subjects": [], "strengths": [], "weak": [], "overall": [], "class_average": None}
    order.sort()
    def pct_of(d):
        return {k: round(100 * a / b, 1) for k, (a, b) in d.items() if b}
    labelled = []
    for _, _, tid in order:
        x = terms[tid]
        cls = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
        for per in x.get("perclass", []):
            for sub, d in per.items():
                for sid, (a, b) in d.items():
                    cls[sub][sid][0] += a; cls[sub][sid][1] += b
        class_avgs = {sub: avg(100 * a / b for a, b in d.values() if b) for sub, d in cls.items()}
        labelled.append((x["label"], pct_of(x["mine"]), class_avgs))
    last = labelled[-1]
    return {"term": last[0], "source": "published", **student_picture(last[1], last[2], [(lab, m) for lab, m, _ in labelled[:-1]][-5:])}
