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
    AcademicSession, Assignment, Branch, ClassSubject, Notice, ReportCard, School, SchoolClass, Score, SheetStatus, Student, Subject, Submission, Term,
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


def fill(db, c: SchoolClass, term: Term, school_id, full: bool, rnd: random.Random) -> list[Student]:
    from app.api.assessment import Scope, columns_of, scheme_for
    studs = list(db.scalars(select(Student).where(Student.class_id == c.id, Student.status == StudentStatus.active)))
    ability = {s.id: rnd.gauss(62, 13) for s in studs}
    cols = columns_of(scheme_for(db, school_id, c.level))
    added = 0
    for i, cs in enumerate(db.scalars(select(ClassSubject).where(ClassSubject.class_id == c.id))):
        sc = Scope(db, f"class:{c.id}:{cs.subject_id}")
        members = sc.students()
        if not members:
            continue
        have = {(r.student_id, r.component) for r in db.scalars(select(Score).where(Score.term_id == term.id, Score.subject_id == cs.subject_id,
                                                                                    Score.student_id.in_([s.id for s in members])))}
        bias = rnd.gauss(0, 6)
        upto = len(cols) if full else (0 if i % 4 == 0 else 1 if i % 3 else 2)
        for s in members:
            for col in cols[:upto]:
                if (s.id, col["key"]) in have:
                    continue
                pct = max(8, min(99, ability.get(s.id, 60) + bias + rnd.gauss(0, 9))) / 100
                db.add(Score(term_id=term.id, student_id=s.id, subject_id=cs.subject_id, component=col["key"], value=round(col["max"] * pct * 2) / 2, by_id=cs.teacher_user_id))
                added += 1
        if full and not db.scalar(select(SheetStatus.id).where(SheetStatus.term_id == term.id, SheetStatus.scope == sc.key)):
            db.add(SheetStatus(term_id=term.id, scope=sc.key, status="submitted", by_id=cs.teacher_user_id))
    db.flush()
    print(f"  {c.name}: {added} marks added ({'every CA and exam, handed in' if full else 'about half the sheet, not handed in'}).")
    return studs


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
    if other:
        fill(db, other, term, school.id, False, rnd)
    db.flush()
    n = report_cards(db, c, term, studs, rnd)
    h = homework(db, c, term, studs, rnd)
    db.commit()
    print(f"  {c.name}: {n} report cards written and published, {h} pieces of homework set.")
    print(f"\nTry it: Scores and results page of {school.name}; open {c.name}" + (f" and {other.name}" if other else "") + ".")
    print(f"Log in as a {c.name} student or parent to see Homework and Results.")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] not in ("results",):
        print(__doc__)
    else:
        results(*(args[1:3]))
