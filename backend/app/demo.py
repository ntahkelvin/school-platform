"""Sample data so a new part of the platform can be tried straight away.

    python -m app.demo                          list what can be added
    python -m app.demo results                  scores, homework and report cards for one class (and half a sheet for another)
    python -m app.demo results "Jesuit" "JSS 2C"   choose the school (part of its name) and the class

On the server:  sudo bash /opt/school-platform/server/demo.sh results
It never overwrites marks someone has typed: it only fills empty ones.
"""
import random
import secrets
import sys
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.models import (
    AcademicSession, Assignment, Branch, ClassSubject, Notice, ReportCard, School, SchoolClass, Score, Student, Subject, Submission, Term,
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


def fill(db, c: SchoolClass, term: Term, school_id, full: bool, rnd: random.Random, only: int | None = None) -> list[Student]:
    from app.api.assessment import Scope, columns_of, scheme_for
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
    ability = {s.id: rnd.gauss(62, 13) for s in studs}
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
        fill_comps = names[:only] if only else names if full else names[:1] + (names[1:2] if i % 3 != 2 else [])
        for s in members:
            for col in [x for x in cols if x["key"].split(" › ")[0] in fill_comps]:
                if (s.id, col["key"]) in have:
                    continue
                pct = max(8, min(99, ability.get(s.id, 60) + bias + rnd.gauss(0, 9))) / 100
                db.add(Score(term_id=term.id, student_id=s.id, subject_id=cs.subject_id, component=col["key"], value=round(col["max"] * pct * 2) / 2, by_id=cs.teacher_user_id))
                added += 1
    db.flush()
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
    n = report_cards(db, c, term, studs, rnd)
    h = homework(db, c, term, studs, rnd)
    db.commit()
    print(f"  {c.name}: {n} report cards written and published, {h} pieces of homework set.")
    print(f"\nTry it: Scores and results page of {school.name}; open {c.name}" + (f", {other.name}" if other else "") + (f" and {third.name}" if third else "") + ".")
    if third:
        print(f"Log in as a {third.name} student to check CA2 marks against their score book (My scores tab).")
    print(f"Log in as a {c.name} student or parent to see Homework and Results.")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] not in ("results",):
        print(__doc__)
    else:
        results(*(args[1:3]))
