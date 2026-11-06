"""Sample data so a new part of the platform can be tried straight away.

    python -m app.demo                          list what can be added
    python -m app.demo results                  scores, homework and report cards for one class (and half a sheet for another)
    python -m app.demo results "Jesuit" "JSS 2C"   choose the school (part of its name) and the class
    python -m app.demo discipline "Jesuit"        discipline reports at every stage: POD, principal, house master, detention, suspension

On the server:  sudo bash /opt/school-platform/server/demo.sh results
It never overwrites marks someone has typed: it only fills empty ones.
"""
import random
import secrets
import sys
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models import (
    AcademicSession, Assignment, Branch, ClassSubject, ConductEntry, Notice, ReportCard, School, SchoolClass, Score, Student, Subject, Submission, Term,
)
from app.models.people import StudentStatus


def term_now(db, school) -> Term:
    from app.api.records import academic_year, current_term
    t = current_term(db, school.id)
    if t:
        if not t.starts_on or not t.ends_on:
            t.starts_on, t.ends_on = t.starts_on or date.today() - timedelta(days=50), t.ends_on or date.today() + timedelta(days=40)
        return t
    name = academic_year(date.today())
    ses = db.scalar(select(AcademicSession).where(AcademicSession.school_id == school.id, AcademicSession.name == name))
    y = int(name[:4])
    dates = [(date(y, 9, 14), date(y, 12, 11)), (date(y + 1, 1, 11), date(y + 1, 4, 2)), (date(y + 1, 4, 26), date(y + 1, 7, 23))]
    if not ses:
        ses = AcademicSession(school_id=school.id, name=name, terms=[Term(number=n + 1, name=["First term", "Second term", "Third term"][n], starts_on=a, ends_on=z)
                                                                     for n, (a, z) in enumerate(dates)])
        db.add(ses)
        db.flush()
    today = date.today()
    pick = next((t for t in ses.terms if t.starts_on and t.starts_on <= today <= (t.ends_on or today)), ses.terms[0])
    pick.is_current = True
    print(f"  Set {pick.name} {name} as the current term.")
    return pick


def skill(student_id, subject_id, step: int) -> float:
    """A student's steady ability in a subject (so marks are believable across terms), drifting a little each term."""
    base = random.Random(str(student_id)).gauss(63, 10)
    drift = random.Random(str(student_id) + "d").gauss(0, 2.6)
    return base + drift * step + random.Random(f"{student_id}{subject_id}").gauss(0, 7)


def fill(db, c: SchoolClass, term: Term, school_id, full: bool, rnd: random.Random, only: int | None = None, step: int = 3, quiet: bool = False) -> list[Student]:
    from app.api.assessment import Scope, columns_of, scheme_for
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
    scheme = scheme_for(db, school_id, c.level)
    names = [x["name"] for x in scheme]
    cols = columns_of(scheme)
    added = 0
    for i, cs in enumerate(db.scalars(select(ClassSubject).where(ClassSubject.class_id == c.id))):
        sc = Scope(db, f"class:{c.id}:{cs.subject_id}")
        members = sc.students()
        if not members:
            continue
        have = {(r.student_id, r.component) for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.subject_id == cs.subject_id,
                                                                                    Score.student_id.in_([s.id for s in members])))}
        bias = rnd.gauss(0, 6)
        generous = random.Random(str(cs.teacher_user_id)).random() < .12      # a few teachers mark CA far more kindly than the exam
        fill_comps = names[:only] if only else names if full else names[:1] + (names[1:2] if i % 3 != 2 else [])
        for s in members:
            for col in [x for x in cols if x["key"].split(" › ")[0] in fill_comps]:
                if (s.id, col["key"]) in have:
                    continue
                kind = 12 if generous and "exam" not in col["key"].lower() else 0
                pct = max(8, min(99, skill(s.id, cs.subject_id, step) + bias / 2 + kind + rnd.gauss(0, 6))) / 100
                if random.Random(f"{s.id}{col['key']}{term.id}").random() < (.004 if "exam" in col["key"].lower() else .012):      # missed the test (ill, away for a match...)
                    db.add(Score(term_id=term.id, student_id=s.id, subject_id=cs.subject_id, component=col["key"], value=None, absent=True, by_id=cs.teacher_user_id))
                else:
                    db.add(Score(term_id=term.id, student_id=s.id, subject_id=cs.subject_id, component=col["key"], value=round(col["max"] * pct * 2) / 2, by_id=cs.teacher_user_id))
                added += 1
    db.flush()
    if not quiet:
        print(f"  {c.name}: {added} marks added ({' and '.join(names[:only]) + ' for every subject' if only else 'every CA and exam' if full else 'CA1 for every subject and CA2 for two in three'}).")
    return studs


def checks_and_padlocks(db, school, term: Term, full_class: SchoolClass, half_class: SchoolClass | None, rnd: random.Random) -> None:
    """Deadlines, a teacher given extra time, and every test somewhere on its way: typing, with a head, sent back, approved, published and locked."""
    from app.api.assessment import Scope, class_subjects, scheme_for
    from app.api.checks import chain, get_step, log, snapshot
    from app.models import AssessmentWindow, ComponentRelease, ResultSettings, SheetStep, User, WindowOpening
    now = datetime.now(timezone.utc)
    names = [x["name"] for x in scheme_for(db, school.id, full_class.level)]
    if not db.scalar(select(ResultSettings).where(ResultSettings.school_id == school.id)):
        db.add(ResultSettings(school_id=school.id, checks=1, confirm_days=5))
    closes = {0: now - timedelta(days=10), 1: now + timedelta(days=3), 2: now + timedelta(days=35)}
    for i, comp in enumerate(names):
        if not db.scalar(select(AssessmentWindow).where(AssessmentWindow.term_id == term.id, AssessmentWindow.component == comp)):
            db.add(AssessmentWindow(school_id=school.id, term_id=term.id, component=comp, closes_at=closes.get(i, now + timedelta(days=35))))

    def mark(st, sc, action, by_id, note=None, days=0):
        u = db.get(User, by_id) if by_id else None
        st.history = [*(st.history or []), {"at": (now - timedelta(days=days)).isoformat(), "by": u.full_name if u else "The principal", "action": action, "note": note}]

    def step(key, comp, state, days=8):
        st = get_step(db, term.id, key, comp, make=True)
        if st.history:                      # already on its way (the command was run before)
            return st
        sc = Scope(db, key)
        ch = chain(db, school, sc.subject, sc.teacher_id)
        mark(st, sc, "Handed in", sc.teacher_id, None, days)
        if state == "approved":
            mark(st, sc, "Approved", ch[0] if ch else None, None, days - 1)
            st.status, st.waiting_for_id, st.approved_at = "approved", None, now - timedelta(days=days - 1)
        elif state == "submitted":
            st.status, st.waiting_for_id = "submitted", (ch[0] if ch else None)
        elif state == "returned":
            mark(st, sc, "Sent back", ch[0] if ch else None, "Two marks look wrong. Please check the scripts.", days - 1)
            studs = sc.students()
            st.status, st.row_notes = "returned", {str(studs[0].id): "The script shows 14, not 41?", str(studs[-1].id): "Missing a mark"} if len(studs) > 1 else {}
        return st

    def publish(c, comp):
        r = db.scalar(select(ComponentRelease).where(ComponentRelease.term_id == term.id, ComponentRelease.class_id == c.id, ComponentRelease.component == comp))
        if r:
            return
        snap, _ = snapshot(db, c, term, comp)
        db.add(ComponentRelease(term_id=term.id, class_id=c.id, component=comp, locked=True, published_at=now - timedelta(days=5), snapshot=snap,
                                history=[{"at": now.isoformat(), "by": "Sample data", "action": "Published", "note": None}]))

    full_studs = list(db.scalars(select(Student).where(Student.class_id == full_class.id, Student.status == StudentStatus.active)))
    for _, keys in class_subjects(db, full_class, full_studs):
        for k in keys:
            for comp in names:
                step(k, comp, "approved")
    db.flush()
    for comp in names:
        publish(full_class, comp)
    print(f"  {full_class.name}: every test approved, published and locked.")
    if half_class:
        studs = list(db.scalars(select(Student).where(Student.class_id == half_class.id, Student.status == StudentStatus.active)))
        keys = [k for _, ks in class_subjects(db, half_class, studs) for k in ks]
        for k in keys:
            step(k, names[0], "approved", 14)
        db.flush()
        publish(half_class, names[0])
        if len(names) > 1:
            ids = [x.id for x in studs]
            with_ca2 = [k for k in keys if db.scalar(select(Score.id).where(Score.term_id == term.id, Score.subject_id == Scope(db, k).subject.id, Score.student_id.in_(ids),
                                                                            Score.component.like(names[1] + "%")).limit(1))]
            for i, k in enumerate(with_ca2):
                state = ["approved", "submitted", "approved", "submitted", "returned", "approved", "draft", "approved"][i % 8]
                if state != "draft":
                    step(k, names[1], state, 2)
            t = next((Scope(db, k).teacher_id for k in keys if Scope(db, k).teacher_id), None)
            if t and not db.scalar(select(WindowOpening.id).where(WindowOpening.term_id == term.id, WindowOpening.teacher_id == t)):
                db.add(WindowOpening(school_id=school.id, term_id=term.id, component=names[0], teacher_id=t, until=now + timedelta(days=2), reason="Was on leave when CA1 closed"))
        print(f"  {half_class.name}: {names[0]} approved and published; {names[1] if len(names) > 1 else ''} at every step (approved, with heads, one sent back, typing).")



SCRIPT = ("data:image/svg+xml;utf8," + """<svg xmlns='http://www.w3.org/2000/svg' width='600' height='420' viewBox='0 0 600 420'>
<rect width='600' height='420' fill='#fffdf5'/>""" + "".join(f"<line x1='0' y1='{y}' x2='600' y2='{y}' stroke='#c7d2fe' stroke-width='1'/>" for y in range(60, 420, 30)) + """
<line x1='60' y1='0' x2='60' y2='420' stroke='#fca5a5' stroke-width='2'/>
<text x='80' y='50' font-family='Comic Sans MS, cursive' font-size='24' fill='#1e3a8a'>CA2 test (sample)</text>
<text x='80' y='110' font-family='Comic Sans MS, cursive' font-size='20' fill='#1e3a8a'>1. ...   2. ...   3. ...   4. ...</text>
<circle cx='470' cy='120' r='62' fill='none' stroke='#dc2626' stroke-width='5'/>
<text x='470' y='138' text-anchor='middle' font-family='Comic Sans MS, cursive' font-size='46' fill='#dc2626'>15/20</text>
</svg>""").replace("#", "%23").replace("\n", "")


def student_checks(db, school, term: Term, c: SchoolClass, comp: str, rnd: random.Random) -> None:
    """Students of the class checking an approved test: most write their scores in, some confirm, and a few queries at each step."""
    from app.api.assessment import Scope, class_subjects
    from app.api.checks import get_step
    from app.models import ScoreBookEntry, ScoreCheck
    now = datetime.now(timezone.utc)
    studs = sorted(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)), key=lambda s: (s.last_name, s.first_name))
    approved = [k for _, ks in class_subjects(db, c, studs) for k in ks if (st := get_step(db, term.id, k, comp)) and st.approved_at]
    if not approved or db.scalar(select(ScoreCheck.id).where(ScoreCheck.term_id == term.id, ScoreCheck.scope.in_(approved)).limit(1)):
        return
    def official(s, sc):
        r = db.scalar(select(Score).where(Score.term_id == term.id, Score.student_id == s.id, Score.subject_id == sc.subject.id, Score.component == comp))
        return r.value if r else None
    stories = 0
    for i, s in enumerate(studs):
        for j, k in enumerate(approved):
            sc = Scope(db, k)
            v = official(s, sc)
            if v is None:
                continue
            roll = rnd.random()
            if roll < .65:
                db.add(ScoreBookEntry(term_id=term.id, student_id=s.id, subject_id=sc.subject.id, key=comp, value=v))
            elif roll < .72:
                db.add(ScoreBookEntry(term_id=term.id, student_id=s.id, subject_id=sc.subject.id, key=comp, value=min(20, v + 3)))
            if roll > .9:
                db.add(ScoreCheck(term_id=term.id, student_id=s.id, subject_id=sc.subject.id, component=comp, scope=k, status="confirmed",
                                  history=[{"at": now.isoformat(), "by": s.full_name, "action": "Confirmed", "note": None}]))
    db.flush()
    # A few queries, one at each step, on the first students (so they are easy to find).
    teacher = lambda k: (db.get(User, Scope(db, k).teacher_id).full_name if Scope(db, k).teacher_id else "The teacher")  # noqa: E731
    from app.models import User
    plan = [("queried", "My script shows {c}, not {v}. Please check question 3.", None),
            ("answered", "I think question 4 deserved full marks.", "Question 4 was worth half marks because the working was missing. 12 is correct."),
            ("escalated", "My friend wrote the same answer and got the marks.", "Your answer to question 2 was incomplete, so the mark stays.")]
    for (state, text, reply), s, k in zip(plan, studs, approved):
        sc = Scope(db, k)
        v = official(s, sc)
        if v is None:
            continue
        db.execute(ScoreBookEntry.__table__.delete().where(ScoreBookEntry.term_id == term.id, ScoreBookEntry.student_id == s.id, ScoreBookEntry.subject_id == sc.subject.id))
        db.execute(ScoreCheck.__table__.delete().where(ScoreCheck.term_id == term.id, ScoreCheck.student_id == s.id, ScoreCheck.subject_id == sc.subject.id))
        text = text.format(c=f"{min(20, v + 3):g}", v=f"{v:g}")
        db.add(ScoreBookEntry(term_id=term.id, student_id=s.id, subject_id=sc.subject.id, key=comp, value=min(20, v + 3), photo=SCRIPT if state == "queried" else None))
        h = [{"at": (now - timedelta(hours=20)).isoformat(), "by": s.full_name, "action": "Queried", "note": text}]
        if reply:
            h.append({"at": (now - timedelta(hours=8)).isoformat(), "by": teacher(k), "action": "Kept the mark", "note": reply})
        if state == "escalated":
            h.append({"at": (now - timedelta(hours=2)).isoformat(), "by": s.full_name, "action": "Asked the head to look", "note": "I still think it deserves the marks."})
        db.add(ScoreCheck(term_id=term.id, student_id=s.id, subject_id=sc.subject.id, component=comp, scope=k, status=state, query_text=text, claimed=min(20, v + 3),
                          query_photo=SCRIPT if state == "queried" else None, reply=reply, answered_at=now - timedelta(hours=8) if reply else None, history=h))
        stories += 1
    print(f"  {c.name}: students wrote {comp} marks in their score books; {stories} queries (one with the teacher, one answered, one with the head).")


def students_checking(db, school, term: Term, c: SchoolClass, rnd: random.Random) -> None:
    """A class whose CA1 is published and CA2 fully approved a day ago: students are checking CA2, some queries open."""
    from app.api.assessment import Scope, class_subjects, scheme_for
    from app.api.checks import chain, get_step, snapshot
    from app.models import ComponentRelease, User
    now = datetime.now(timezone.utc)
    names = [x["name"] for x in scheme_for(db, school.id, c.level)]
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
    for _, keys in class_subjects(db, c, studs):
        for k in keys:
            sc = Scope(db, k)
            ch = chain(db, school, sc.subject, sc.teacher_id)
            checker = db.get(User, ch[0]).full_name if ch else "The principal"
            teacher = db.get(User, sc.teacher_id).full_name if sc.teacher_id else "The teacher"
            for comp, ago in zip(names[:2], (12, 1)):
                st = get_step(db, term.id, k, comp, make=True)
                if st.history:
                    continue
                st.status, st.approved_at = "approved", now - timedelta(days=ago)
                st.history = [{"at": (now - timedelta(days=ago + 1)).isoformat(), "by": teacher, "action": "Handed in", "note": None},
                              {"at": (now - timedelta(days=ago)).isoformat(), "by": checker, "action": "Approved", "note": None}]
    db.flush()
    if not db.scalar(select(ComponentRelease.id).where(ComponentRelease.term_id == term.id, ComponentRelease.class_id == c.id, ComponentRelease.component == names[0])):
        snap, _ = snapshot(db, c, term, names[0])
        db.add(ComponentRelease(term_id=term.id, class_id=c.id, component=names[0], locked=True, published_at=now - timedelta(days=8), snapshot=snap, history=[]))
    print(f"  {c.name}: {names[0]} published; {names[1]} approved yesterday for every subject, so students are checking it now.")
    db.flush()
    student_checks(db, school, term, c, names[1], rnd)


def approve_all(db, school, term: Term, c: SchoolClass, names: list[str], when: datetime, publish: bool) -> None:
    """Every test named, on every sheet of the class: handed in, approved (and published to families)."""
    from app.api.assessment import class_subjects
    from app.api.checks import get_step, snapshot
    from app.models import ComponentRelease
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
    for _, keys in class_subjects(db, c, studs):
        for k in keys:
            for comp in names:
                st = get_step(db, term.id, k, comp, make=True)
                if st.history:
                    continue
                st.status, st.approved_at = "approved", when
                st.history = [{"at": when.isoformat(), "by": "Sample data", "action": "Approved", "note": None}]
    db.flush()
    if publish:
        for comp in names:
            if not db.scalar(select(ComponentRelease.id).where(ComponentRelease.term_id == term.id, ComponentRelease.class_id == c.id, ComponentRelease.component == comp)):
                snap, _ = snapshot(db, c, term, comp)
                db.add(ComponentRelease(term_id=term.id, class_id=c.id, component=comp, locked=True, published_at=when, snapshot=snap, history=[]))
        db.flush()


def history(db, school, term: Term, classes: list[SchoolClass], rnd: random.Random) -> None:
    """Last session's three terms for these classes (all tests approved and published), so trends have something to show."""
    from app.api.assessment import scheme_for
    y = int(term.session.name[:4]) - 1
    name = f"{y}/{y + 1}"
    ses = db.scalar(select(AcademicSession).where(AcademicSession.school_id == school.id, AcademicSession.name == name))
    if not ses:
        dates = [(date(y, 9, 15), date(y, 12, 12)), (date(y + 1, 1, 12), date(y + 1, 4, 3)), (date(y + 1, 4, 27), date(y + 1, 7, 24))]
        ses = AcademicSession(school_id=school.id, name=name, terms=[Term(number=n + 1, name=["First term", "Second term", "Third term"][n], starts_on=a, ends_on=z)
                                                                     for n, (a, z) in enumerate(dates)])
        db.add(ses)
        db.flush()
    for i, t in enumerate(sorted(ses.terms, key=lambda t: t.number)):
        when = datetime.combine(t.ends_on or date(y + 1, 7, 1), datetime.min.time(), tzinfo=timezone.utc)
        for c in classes:
            names = [x["name"] for x in scheme_for(db, school.id, c.level)]
            fill(db, c, t, school.id, True, rnd, step=i, quiet=True)
            approve_all(db, school, t, c, names, when, True)
    print(f"  {name}: three terms of marks for {', '.join(c.name for c in classes)} (approved and published), for trends.")


def whole_school(db, school, term: Term, skip: set, rnd: random.Random) -> None:
    """CA1 approved in every other class (and every test in SS 3), so the school-wide view is full."""
    from app.api.academics import _level_order
    from app.api.assessment import scheme_for
    classes = sorted(db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school.id)), key=lambda c: (_level_order(c.level), c.name))
    n = 0
    fresh = next((c for c in classes if c.id not in skip), None)       # one class left empty, to try typing a fresh sheet
    for c in classes:
        if c.id in skip or (fresh and c.id == fresh.id) or not db.scalar(select(Student.id).where(Student.class_id == c.id, Student.status == StudentStatus.active).limit(1)):
            continue
        names = [x["name"] for x in scheme_for(db, school.id, c.level)]
        final = c.level.upper().startswith("SS 3")
        use = names if final else names[:1]
        fill(db, c, term, school.id, final, rnd, only=None if final else 1, quiet=True)
        approve_all(db, school, term, c, use, datetime.now(timezone.utc) - timedelta(days=20), False)
        n += 1
    print(f"  {n} other classes: CA1 approved (SS 3: every test), so the analysis covers the whole school. {fresh.name if fresh else ''} is left empty to try typing.")


def report_cards(db, c: SchoolClass, term: Term, studs: list[Student], rnd: random.Random) -> int:
    from app.api.assessment import TRAITS, card_data, compute_class, family_of, suggest_comment
    d = compute_class(db, c, term)
    n = 0
    for s in studs:
        rc = db.scalar(select(ReportCard).where(ReportCard.term_id == term.id, ReportCard.student_id == s.id))
        if rc and rc.status == "published":
            continue
        if not rc:
            rc = ReportCard(term_id=term.id, student_id=s.id, class_id=c.id, traits={})
            db.add(rc)
        rc.traits = rc.traits or {t: max(2, min(5, int(round(rnd.gauss(3.6, .8))))) for g in TRAITS.values() for t in g}
        card = card_data(db, s, term, d, rc)
        rc.teacher_comment = rc.teacher_comment or suggest_comment(card, "teacher", rnd.randint(0, 999))
        rc.principal_comment = rc.principal_comment or suggest_comment(card, "principal", rnd.randint(0, 999))
        if d["summary"][s.id]["average"] is None:
            continue
        rc.snapshot = card_data(db, s, term, d, rc)
        rc.code = rc.code or secrets.token_hex(4).upper()
        rc.snapshot["code"] = rc.code
        rc.status, rc.published_at = "published", datetime.now(timezone.utc)
        for uid in family_of(s):
            db.add(Notice(user_id=uid, school_id=c_school(db, c), kind="info", icon="award", text=f"{s.first_name}'s {term.name} report card is ready.", link=f"#/child/{s.id}"))
        n += 1
    return n


def c_school(db, c):
    return db.get(Branch, c.branch_id).school_id


HOMEWORK = [
    (("Mathematics",), "homework", "Simple equations: exercise 4B, questions 1 to 10", "Show all your working. Number each answer.", -9, -2, 10, "marked"),
    (("English Language", "English"), "homework", "Write a letter to your friend about your mid-term break", "Informal letter, 250 to 300 words. Address and date at the top right.", -8, -1, 20, "marked"),
    (("Basic Science", "Biology", "Physics"), "project", "Make a model of the water cycle", "Use cardboard, cotton wool and paint. Label every stage. Bring it to the lab.", -6, 9, 20, "todo"),
    (("Social Studies", "Civic Education", "Government"), "homework", "List five ways to show good citizenship", None, -3, 2, 10, "handed_in"),
    (("Computer Studies", "Basic Technology", "Data Processing"), "classwork", "Parts of a computer: label the diagram", "Use the diagram on page 12 of your textbook.", -4, -1, 10, "late"),
    (("French", "Yoruba", "Igbo", "Hausa", "Literature in English"), "homework", "Learn the new vocabulary list", "Short test on Friday.", -1, 3, None, "todo"),
]
FEED = ["Excellent work, well done!", "Good, but show your working.", "Neat and correct.", "Check your spelling.", "Very good effort.", "Some careless mistakes. Read the question again."]


def homework(db, c: SchoolClass, term: Term, studs: list[Student], rnd: random.Random) -> int:
    css = {db.get(Subject, cs.subject_id).name: cs for cs in db.scalars(select(ClassSubject).where(ClassSubject.class_id == c.id, ClassSubject.compulsory.is_(True)))}
    if not css:
        return 0
    today, n = date.today(), 0
    for names, kind, title, ins, set_ago, due_in, mx, state in HOMEWORK:
        cs = next((css[x] for x in names if x in css), None) or rnd.choice(list(css.values()))
        if db.scalar(select(Assignment.id).where(Assignment.class_id == c.id, Assignment.title == title)):
            continue
        a = Assignment(school_id=c_school(db, c), class_id=c.id, subject_id=cs.subject_id, term_id=term.id, teacher_id=cs.teacher_user_id, kind=kind, title=title, instructions=ins,
                       set_on=today + timedelta(days=set_ago), due_on=today + timedelta(days=due_in), max_score=mx, online=kind != "project")
        db.add(a)
        db.flush()
        n += 1
        for s in studs:
            r = rnd.random()
            if state == "marked":
                if r < .08:
                    db.add(Submission(assignment_id=a.id, student_id=s.id, status="missing", score=0))
                    continue
                db.add(Submission(assignment_id=a.id, student_id=s.id, status="marked", score=max(1, min(mx, round(mx * max(.3, min(1, rnd.gauss(.72, .17)))))),
                                  feedback=rnd.choice(FEED), handed_in_at=datetime.combine(a.due_on, datetime.min.time(), tzinfo=timezone.utc) - timedelta(hours=rnd.randint(2, 40)),
                                  marked_at=datetime.now(timezone.utc), marked_by_id=a.teacher_id))
            elif state in ("handed_in", "late") and r < (.6 if state == "handed_in" else .45):
                db.add(Submission(assignment_id=a.id, student_id=s.id, status="handed_in", text="1. Obey the laws of the country\n2. Pay taxes\n3. Respect the flag\n4. Vote\n5. Keep the environment clean",
                                  handed_in_at=datetime.now(timezone.utc) - timedelta(hours=rnd.randint(1, 50))))
    return n


def rules_and_blocks(db, school, term: Term) -> None:
    """The school's result rules (year-group position, Honours and Merits, probation, missed tests), and JMC-style weighted
    blocks with grade words for the senior classes, so both ways of adding up scores can be tried side by side."""
    from app.api.structure import GRADING_PRESETS, WEIGHTED_PRESETS, make_components, preset_components
    from app.models import AssessmentScheme, GradeBand, GradingScale, ResultSettings, Section
    stg = db.scalar(select(ResultSettings).where(ResultSettings.school_id == school.id))
    if not stg:
        stg = ResultSettings(school_id=school.id, checks=1, confirm_days=5)
        db.add(stg)
    if not stg.awards:
        stg.absent_rule, stg.rank_by = "substitute", "level"
        stg.awards = [{"name": "Honours", "min": 75, "top": None}, {"name": "Merits", "min": 68, "top": None}]
        stg.probation = {"line": 50, "fails": 3, "drop": 10}
    print("  Rules: position across the whole year group; Honours from 75%, Merits from 68%; probation below 50% or failing 3 subjects; a missed test uses the next score of its kind.")
    senior = [x for x in db.scalars(select(Section).where(Section.school_id == school.id)) if any(str(lv).upper().startswith("SS") for lv in (x.levels or []))]
    if not senior:
        ss = sorted({c.level for c in db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school.id))
                     if c.level and c.level.upper().startswith("SS")})
        if not ss:
            return
        # The junior classes keep the usual CA1 20 + CA2 20 + Exam 60, in a section of their own.
        js = sorted({c.level for c in db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school.id))
                     if c.level and not c.level.upper().startswith("SS")})
        std = db.scalar(select(AssessmentScheme).where(AssessmentScheme.school_id == school.id).order_by(AssessmentScheme.created_at))
        if not std:
            std = AssessmentScheme(school_id=school.id, name="Standard", method="add", components=make_components(preset_components("CA1, CA2 and exam (20 + 20 + 60)")))
            db.add(std)
            db.flush()
        waec = db.scalar(select(GradingScale).where(GradingScale.school_id == school.id).order_by(GradingScale.created_at))
        if not waec:
            waec = GradingScale(school_id=school.id, name="WAEC", bands=[GradeBand(grade=g, min_score=lo, max_score=hi, remark=r) for g, lo, hi, r in GRADING_PRESETS["WAEC (A1 to F9)"]])
            db.add(waec)
            db.flush()
        if js and not db.scalar(select(Section.id).where(Section.school_id == school.id, Section.name == "Junior Secondary")):
            db.add(Section(school_id=school.id, name="Junior Secondary", position=1, levels=js, assessment_scheme_id=std.id, grading_scale_id=waec.id))
        senior = [Section(school_id=school.id, name="Senior Secondary", position=2, levels=ss)]
        db.add(senior[0])
    levels = [lv for x in senior for lv in (x.levels or [])]
    marked = db.scalar(select(Score.id).join(Student, Student.id == Score.student_id).join(SchoolClass, SchoolClass.id == Student.class_id).where(
        Score.term_id == term.id, SchoolClass.level.in_(levels)).limit(1))
    if marked:
        return                                         # never change the way a section adds up once marks are in
    key = next(iter(WEIGHTED_PRESETS))
    sch = db.scalar(select(AssessmentScheme).where(AssessmentScheme.school_id == school.id, AssessmentScheme.name == "Senior: weighted blocks"))
    if not sch:
        sch = AssessmentScheme(school_id=school.id, name="Senior: weighted blocks", method="weighted", components=make_components(preset_components(key)))
        db.add(sch)
    words = "Words (Excellent to Fail)"
    sc = db.scalar(select(GradingScale).where(GradingScale.school_id == school.id, GradingScale.name == words))
    if not sc:
        sc = GradingScale(school_id=school.id, name=words, bands=[GradeBand(grade=g, min_score=lo, max_score=hi, remark=r) for g, lo, hi, r in GRADING_PRESETS[words]])
        db.add(sc)
    db.flush()
    for x in senior:
        x.assessment_scheme_id, x.grading_scale_id = sch.id, sc.id
    db.flush()
    print(f"  {', '.join(x.name for x in senior)}: three weighted blocks (20% CE + 20% CE + 60% CA/Exam, each out of 100), averaged; grades in words (Excellent to Fail).")


def probation_demo(db, school, term: Term, c: SchoolClass) -> None:
    """Scan for students who are failing, and show a case at every stage."""
    from app.api.probation import log, scan
    from app.models import ProbationCase
    r = scan(db, school, term, why="sample data")
    cases = list(db.scalars(select(ProbationCase).where(ProbationCase.term_id == term.id, ProbationCase.school_id == school.id).order_by(ProbationCase.average)))
    mine = [x for x in cases if db.get(Student, x.student_id).class_id == c.id] + [x for x in cases if db.get(Student, x.student_id).class_id != c.id]
    today = datetime.now(timezone.utc).date()
    for i, case in enumerate(mine[:3]):
        if case.plan:
            continue
        s = db.get(Student, case.student_id)
        weak = [w["subject"] for w in case.weak[:2]] or ["Mathematics"]
        form = next((m for m in case.team if m["role"] == "Form teacher"), None)
        case.plan = (f"1. Extra lessons in {' and '.join(weak)}: Tuesday and Thursday, 3:15 to 4:00 pm.\n"
                     f"2. The form teacher checks {s.first_name}'s homework diary every morning.\n"
                     f"3. At home: one hour of quiet study every evening; a parent signs the diary.\n"
                     f"4. {s.first_name} sits in front in {weak[0]} and asks one question each lesson.")
        case.status, case.review_on = ("review" if i == 0 else "plan"), today + timedelta(days=21)
        case.actions = [{"id": secrets.token_hex(4), "what": f"Extra {weak[0]} lessons, Tue and Thu after school", "who": next((m["name"] for m in case.team if m["role"].startswith(weak[0])), "Subject teacher"),
                         "due": None, "done": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat() if i == 0 else None, "by": "Sample data"},
                        {"id": secrets.token_hex(4), "what": "Daily homework diary check", "who": form["name"] if form else "Form teacher", "due": None, "done": None, "by": "Sample data"},
                        {"id": secrets.token_hex(4), "what": "Meet the parents", "who": form["name"] if form else "Form teacher", "due": (today + timedelta(days=7)).isoformat(), "done": None, "by": "Sample data"}]
        log(case, "Sample data", "Wrote the support plan")
        if i == 0:
            case.meetings = [{"id": secrets.token_hex(4), "on": today.isoformat(), "with": f"{s.first_name}, the mother and the form teacher",
                              "notes": f"{s.first_name} has been unwell and fell behind. Agreed: extra lessons, diary checks, no phone on school nights. Review in three weeks.", "by": "Sample data"}]
            if case.family_told:
                g = next(iter(s.guardians), None)
                if g:
                    case.parent_ack_at, case.parent_ack_by, case.parent_note = datetime.now(timezone.utc) - timedelta(days=2), g.user_id, "Thank you. We will sign the diary every night."
                    log(case, "Parent", "Parent acknowledged the plan")
    db.flush()
    print(f"  Probation: {len(cases)} students flagged ({r['families_told']} families told, as their marks are published); three cases have a plan, one has a meeting and a parent's signature.")


def results(school_part: str | None = None, class_name: str | None = None) -> None:
    from app.api.academics import _level_order
    rnd = random.Random(7)
    db = SessionLocal()
    schools = list(db.scalars(select(School).order_by(School.name)))
    def roll(s):
        return db.scalar(select(func.count()).select_from(Student).where(Student.school_id == s.id, Student.status == StudentStatus.active)) or 0
    matching = [s for s in schools if not school_part or school_part.lower() in s.name.lower()] or schools
    school = max(matching, key=roll, default=None)
    if not school or not roll(school):
        print("No school with students yet. Add students first.")
        return
    print(f"School: {school.name}")
    term = term_now(db, school)
    rules_and_blocks(db, school, term)
    db.flush()
    classes = sorted(db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school.id)), key=lambda c: (_level_order(c.level), c.name))
    def size(c):
        return db.scalar(select(func.count()).select_from(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)) or 0
    def has_subjects(c):
        return bool(db.scalar(select(ClassSubject.id).where(ClassSubject.class_id == c.id)))
    c = next((x for x in classes if class_name and x.name.lower() == class_name.lower()), None) or next((x for x in classes if size(x) >= 5 and has_subjects(x)), None)
    if not c:
        print("No class has both students and subjects yet. Give a class its subjects on the Teaching page first.")
        return
    studs = fill(db, c, term, school.id, True, rnd)
    other = next((x for x in classes if x.level == c.level and x.id != c.id and size(x) and has_subjects(x)), None)
    third = next((x for x in classes if x.level == c.level and x.id not in (c.id, other.id if other else None) and size(x) and has_subjects(x)), None)
    if third:
        fill(db, third, term, school.id, False, rnd, only=2)
    if other:
        fill(db, other, term, school.id, False, rnd)
    db.flush()
    checks_and_padlocks(db, school, term, c, other, rnd)
    if third:
        db.flush()
        students_checking(db, school, term, third, rnd)
    db.flush()
    history(db, school, term, [x for x in (c, other, third) if x], rnd)
    whole_school(db, school, term, {x.id for x in (c, other, third) if x}, rnd)
    db.flush()
    n = report_cards(db, c, term, studs, rnd)
    h = homework(db, c, term, studs, rnd)
    db.flush()
    probation_demo(db, school, term, c)
    db.commit()
    print(f"  {c.name}: {n} report cards written and published, {h} pieces of homework set.")
    print(f"\nTry it: Scores and results page of {school.name}; open {c.name}" + (f", {other.name}" if other else "") + (f" and {third.name}" if third else "") + ".")
    if third:
        print(f"Log in as a {third.name} student to check CA2 marks against their score book (My scores tab).")
    print(f"Log in as a {c.name} student or parent to see Homework and Results.")


def discipline(school_part: str | None = None, class_name: str | None = None) -> None:
    """Discipline cases at every stage, so the POD, the principal, a house master, a form teacher and a parent each have something to see."""
    from app.api import discipline as dp
    from app.models import DisciplineCase, Membership, Role
    db = SessionLocal()
    schools = list(db.scalars(select(School).order_by(School.name)))
    def roll(s):
        return db.scalar(select(func.count()).select_from(Student).where(Student.school_id == s.id, Student.status == StudentStatus.active)) or 0
    matching = [s for s in schools if not school_part or school_part.lower() in s.name.lower()] or schools
    school = max(matching, key=roll, default=None)
    if not school or not roll(school):
        print("No school with students yet.")
        return
    print(f"School: {school.name}")
    if db.scalar(select(DisciplineCase.id).where(DisciplineCase.school_id == school.id).limit(1)):
        print("  This school already has discipline cases: nothing added.")
        return
    st = dp.settings(db, school.id)
    vps = sorted(dp.rights.school_roles_users(db, school.id, {"vice_principal"}), key=str)
    teachers = sorted(dp.rights.school_roles_users(db, school.id, {"teacher"}), key=str)
    head = next(iter(sorted(dp.deciders(db, school), key=str)), None)
    if not vps or not teachers:
        print("  Needs a vice principal (to be the POD) and teachers.")
        return
    st.pod_user_ids = [str(vps[0])]
    db.add(st)
    db.flush()
    classes = {c.name: c for c in db.scalars(select(SchoolClass).join(Branch, Branch.id == SchoolClass.branch_id).where(Branch.school_id == school.id))}
    def kids(name, n):
        c = classes.get(name) or next(iter(classes.values()))
        return list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active).order_by(Student.last_name, Student.first_name)))[:n]
    jss = kids(class_name or "JSS 2C", 12)
    ss1, ss2 = kids("SS 1A", 6), kids("SS 2A", 6)
    boarders = [s for s in [*ss1, *ss2, *jss] if dp.house_master(db, s)]
    t = lambda d=0, h=10: datetime.now(timezone.utc).replace(hour=h, minute=0, second=0, microsecond=0) + timedelta(days=d)
    today = datetime.now(timezone.utc).date()
    offs = {o["key"]: o for o in st.offences}
    pod_name, head_name = dp.name_of(db, vps[0]), dp.name_of(db, head) or "The principal"
    n = 0
    def case(s, key, status, days, details, by, place=None, group=None, statements=(), rec=None, decision=None, actions=(), extra=""):
        nonlocal n
        o = offs[key]
        x = DisciplineCase(id=uuid.uuid4(), created_at=t(days, 12), school_id=school.id, number=dp.next_number(db, school.id), student_id=s.id if s else None, group=group,
                           offence=o["key"], offence_name=o["name"], level=o["level"], occurred_at=t(days, 11), place=place, details=details,
                           reported_by_id=by, reporter_kind="staff", status=status, statements=[], actions=[], history=[], recommendation=rec)
        db.add(x)
        db.flush()
        dp.log(x, dp.name_of(db, by) or "Staff", "Reported" + extra)
        x.statements = [{"id": secrets.token_hex(4), "who": w, "text": tx, "at": t(days + 1, 9).isoformat(), "by": pod_name} for w, tx in statements]
        for w, _ in statements:
            dp.log(x, pod_name, f"Took a statement from {w}")
        if rec:
            dp.log(x, pod_name, "Sent to the principal with a recommendation")
        if decision:
            x.status, x.decision, x.decided_by_id, x.decided_at = "decided", decision, head, t(days + 2, 12)
            x.actions = [{"id": secrets.token_hex(4), "label": dp.KINDS[a["kind"]], "name": None, "points": None, "on": None, "until": None, "at": None,
                          "note": None, "in_school": None, "done": None, **a} for a in actions]
            dp.log(x, head_name, "Decided: " + "; ".join(dp.say(a) for a in x.actions))
            for a in x.actions:
                if a["kind"] == "demerit":
                    db.add(ConductEntry(school_id=school.id, student_id=s.id, house_id=s.house_id, kind="demerit", category="discipline", points=-a["points"],
                                        note=f"Case #{x.number}: {x.offence_name}", by_id=head))
        # Put the history on the days things happened.
        stamps = [t(days, 12)] + [t(days + 1, 9)] * len(statements) + ([t(days + 1, 15)] if rec else []) + ([t(days + 2, 12)] if decision else [])
        x.history = [{**h, "at": stamps[min(i, len(stamps) - 1)].isoformat()} for i, h in enumerate(x.history)]
        n += 1
        return x
    d = lambda k: (today + timedelta(days=k)).isoformat()
    T1, T2, T3 = teachers[0], teachers[1 % len(teachers)], teachers[2 % len(teachers)]
    # 1-2. A fight, two students: with the principal, the POD's recommendation in.
    g = secrets.token_hex(4)
    a, b = jss[1], jss[4]
    for me, other in ((a, b), (b, a)):
        case(me, "fighting", "principal", -3, f"{a.first_name} and {b.first_name} fought at the back of the class after break. {a.first_name} was pushed into a desk; no one was badly hurt.",
             T1, "JSS 2 block, classroom", g,
             [(f"{me.first_name} (the student)", f"{other.first_name} took my pen and would not give it back, so I pushed them and they hit me back."),
              ("Class captain", "They were shouting at each other and then started fighting. We separated them before the teacher came.")],
             rec=f"Both students fought. I recommend 5 demerit points each, manual work on the compound for three days, and counselling. {me.first_name} has no earlier case.")
    # 3. A phone: decided, parents invited (families see it).
    p = jss[0]
    case(p, "phone", "decided", -6, f"A phone was found in {p.first_name}'s bag during the morning bag check.", T2, "Morning assembly", statements=[
         (f"{p.first_name} (the student)", "It is my brother's old phone. I only used it to call home.")],
         decision="The phone stays with the school until a parent collects it. Loss of outing for this term, 4 demerit points, and the parents are invited.",
         actions=[{"kind": "punishment", "name": "Loss of privileges (outing, visiting day, TV)"}, {"kind": "demerit", "points": 4},
                  {"kind": "invite_parents", "on": d(3), "at": "10:00", "note": "Come to the POD's office to collect the phone."}])
    # 4. Lateness: with the POD (minor, the POD may deal with it).
    case(jss[7], "late", "pod", -1, f"{jss[7].first_name} came to school at 8:25 for the third time this week.", T3, "School gate")
    # 5. Boarding: out of bounds, with the house master first.
    if boarders:
        bo = boarders[0]
        case(bo, "bounds", "house", 0, f"{bo.first_name} was found behind the girls' hostel during prep.", T1, "Behind the hostel, 8:40 pm",
             extra=" (goes to the house master first)")
    # 6. Stealing: suspended now (SS 1), parents came.
    if ss1:
        th = ss1[2 % len(ss1)]
        case(th, "stealing", "decided", -5, f"Provisions and ₦3,500 went missing from a locker. They were found in {th.first_name}'s bag.", T2, "SS 1 classroom lockers", statements=[
             (f"{th.first_name} (the student)", "I took them. I am sorry."), ("Class prefect", "We found the items when the bags were checked.")],
             rec="Suspension for one week, return of the items, and counselling.",
             decision="Suspended for one week. The items are returned and the parents pay back the money. Counselling when back.",
             actions=[{"kind": "suspension", "on": d(-3), "until": d(4)}, {"kind": "invite_parents", "on": d(-3), "at": "12:00", "done": t(-3, 13).isoformat()},
                      {"kind": "counselling", "name": "With the school counsellor, weekly for a month"}])
    # 7. Discipline probation: SS 2 bullying.
    if ss2:
        bu = ss2[1 % len(ss2)]
        case(bu, "bullying", "decided", -12, f"{bu.first_name} has been taking junior students' provisions and making them do washing for them.", T3, "Hostel", statements=[
             ("Two JSS 1 students", "Our provisions are taken every Sunday and we are told not to report.")],
             rec="Discipline probation for the rest of the term, apology to the juniors, and counselling.",
             decision="Discipline probation until the end of term. Any further offence means suspension.",
             actions=[{"kind": "probation", "on": d(-9), "until": d(45)}, {"kind": "punishment", "name": "Letter of apology", "done": t(-8, 12).isoformat()},
                      {"kind": "counselling", "name": "Weekly with the guidance counsellor"}])
    # 8. Detention coming up (decided by the POD).
    dd = jss[9 % len(jss)]
    case(dd, "noise", "decided", -2, f"{dd.first_name} kept disturbing the class during the Mathematics lesson after two warnings.", T1, "Classroom",
         decision="Detention on Friday after school.", actions=[{"kind": "detention", "on": d((4 - today.weekday()) % 7 or 7), "at": "14:15"}, {"kind": "demerit", "points": 1}])
    # 9. Dropped.
    x = case(jss[10 % len(jss)], "damage", "dismissed", -8, "A broken window in the JSS 2 block. A student said this student did it.", T2, "JSS 2 block")
    x.decision = "Not proven: the window was broken by the wind (the latch was already loose). Reported to maintenance."
    dp.log(x, pod_name, "Dropped: " + x.decision)
    # 10. A student's tip, in confidence.
    tipper = ss1[0] if ss1 else jss[11 % len(jss)]
    tp = DisciplineCase(id=uuid.uuid4(), school_id=school.id, number=dp.next_number(db, school.id), student_id=None, about="Some SS 2 boys in the hostel",
                        offence="tip", offence_name="Told by a student", level="minor", occurred_at=t(-1, 21), place="Hostel, after lights out",
                        details="Some SS 2 boys go out through the back fence at night after lights out and come back before the morning bell.",
                        reported_by_id=tipper.user_id, reporter_kind="student", status="tip", statements=[], actions=[], history=[])
    db.add(tp)
    db.flush()
    dp.log(tp, "A student", "Told the POD in confidence")
    n += 1
    # 11. The ladder: demerits this term reach the detention line.
    lad = jss[6 % len(jss)]
    for cat, pts in (("late", -1), ("uniform", -1), ("homework", -1), ("noise", -1), ("disrespect", -2), ("phone", -2), ("bounds", -2)):
        db.add(ConductEntry(school_id=school.id, student_id=lad.id, house_id=lad.house_id, kind="demerit", category=cat, points=pts, by_id=T1))
    db.flush()
    lc = dp.ladder_check(db, lad, "Sample data")
    db.commit()
    print(f"  POD: {pod_name}. Principal: {head_name}. {n + (1 if lc else 0)} cases:")
    print(f"   - with the principal: a fight between {a.full_name} and {b.full_name} (the POD's recommendation is in)")
    print(f"   - decided: {p.full_name} (phone; parents invited in 3 days)" + (f", {th.full_name} (suspended this week)" if ss1 else "")
          + (f", {bu.full_name} (discipline probation)" if ss2 else "") + f", {dd.full_name} (detention on Friday)")
    print(f"   - with the POD: {jss[7].full_name} (lateness)" + (f"; with the house master: {bo.full_name} (out of bounds)" if boarders else "")
          + "; a student's tip about the SS 2 boys" + (f"; {lad.full_name} reached 10 demerit points (opened by itself)" if lc else ""))


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] not in ("results", "discipline"):
        print(__doc__)
    elif args[0] == "discipline":
        discipline(*(args[1:3]))
    else:
        results(*(args[1:3]))
