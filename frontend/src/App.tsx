import { useEffect, useState } from "react";
import { api, ApiError, getToken, setToken, type Me } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import SchoolPage from "./SchoolPage";
import StudentPage from "./StudentPage";
import RegisterPage from "./RegisterPage";
import OrgPage from "./OrgPage";
import BoardView from "./BoardView";
import { ChoosePassword } from "./Logins";
import StaffHome from "./StaffHome";
import StaffRecordPage from "./StaffRecord";
import IdCardsPage from "./IdCards";
import KioskPage from "./Kiosk";
import PassportPage from "./Passport";
import { DeskPage } from "./Operations";
import { go, useRoute, type BranchTab } from "./router";
import { cache, isNetworkError } from "./offline";
import { MeContext, opensSchool, stopSeeAs } from "./rightsApi";
import { ChildPage, FamilyHomePage } from "./Family";
import { ApplyPage } from "./Apply";
import ClassPage from "./ClassPage";
import { MarksPage, ResultsPage, SheetPage, VerifyPage } from "./Assessment";

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(Boolean(getToken()));
  const route = useRoute();

  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then((m) => {
        cache.set("me", m);
        setMe(m);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setToken(null);
        // No internet: carry on as the last person who logged in on this device.
        else if (isNetworkError(err)) setMe(cache.get<Me>("me"));
      })
      .finally(() => setChecking(false));
  }, []);

  function logout() {
    setToken(null);
    cache.set("me", null);
    setMe(null);
    window.location.hash = "";
  }

  // The gate kiosk works without anyone logged in.
  if (route.page === "kiosk") return <KioskPage schoolId={route.school} token={route.token} />;
  // The admissions form is public: families apply without a login.
  if (route.page === "apply") return <ApplyPage code={route.code} />;
  // Anyone can check a printed report card is genuine (the QR code on the card).
  if (route.page === "verify") return <VerifyPage code={route.code} />;
  if (checking) return <div className="center muted">Loading…</div>;
  if (!me) return <Login onLoggedIn={setMe} />;

  if (me.must_change_password && !me.acting)
    return <ChoosePassword me={me} onLogout={logout} onDone={() => setMe({ ...me, must_change_password: false })} />;

  const common = { me, onLogout: me.acting ? () => void stopSeeAs() : logout };
  const pick = () => {
  // Board members who don't run a school only ever see the read-only board view.
  const isOwner = me.memberships.some((m) => m.role === "owner");
  const isBoard = me.memberships.some((m) => m.role === "board_member");
  const STAFF = ["head_of_school", "head", "vice_principal", "it_admin", "bursar", "teacher", "house_parent", "support"];
  const isStaff = me.memberships.some((m) => STAFF.includes(m.role));
  // Anyone with a 'see' right in a school can open that school's pages (which pages: their rights decide).
  const runs = new Set(Object.keys(me.rights ?? {}).filter((sid) => opensSchool(me, sid)));
  if (route.page === "child") return <ChildPage key={route.id} {...common} studentId={route.id} />;
  if (!isOwner && !isStaff && isBoard) return <BoardView {...common} />;
  // Parents and students: their own family portal.
  if (!isOwner && !isStaff && me.memberships.some((m) => m.role === "parent" || m.role === "student")) return <FamilyHomePage {...common} />;
  if (!isOwner && isStaff) {
    // Staff: their own portal; principals, vice principals and the IT team can also open their school's pages.
    if (route.page === "school" && runs.has(route.id)) return <SchoolPage key={route.id} {...common} schoolId={route.id} tab={route.tab} />;
    if (route.page === "register") return <RegisterPage key={`${route.kind}${route.id}${route.date}`} {...common} kind={route.kind} id={route.id} date={route.date} />;
    // Any member of staff can open a student's profile; the server shows only what their link to the student allows.
    if (route.page === "student") return <StudentPage key={route.id} {...common} studentId={route.id} />;
    if (route.page === "class") return <ClassPage key={route.id} {...common} classId={route.id} />;
    if (route.page === "marks") return <MarksPage key={route.tab} {...common} tab={route.tab} />;
    if (route.page === "sheet") return <SheetPage key={route.scope} {...common} scope={route.scope} />;
    if (route.page === "results") return <ResultsPage key={route.id} {...common} classId={route.id} />;
    if (route.page === "board" && isBoard) return <BoardView {...common} />;
    if (route.page === "staff-record") return <StaffRecordPage key={route.id} {...common} schoolId={route.school} userId={route.id} />;
    if (route.page === "staff-cards") return <IdCardsPage key={`${route.school}${route.id}`} {...common} schoolId={route.school} userId={route.id} />;
    if (route.page === "passport") return <PassportPage key={route.id} {...common} schoolId={route.school} userId={route.id} />;
    if (route.page === "desk") return <DeskPage key={route.desk} {...common} schoolId={route.school} desk={route.desk} />;
    return <StaffHome {...common} />;
  }
  switch (route.page) {
    case "org":
      return <OrgPage key={route.id} {...common} orgId={route.id} />;
    case "board":
      return <BoardView {...common} />;
    case "school":
      return <SchoolPage key={route.id} {...common} schoolId={route.id} tab={route.tab} />;
    case "branch":
      // Old links to a "branch": send them to its school's page instead.
      return <BranchRedirect branchId={route.id} tab={route.tab} />;
    case "register":
      return <RegisterPage key={`${route.kind}${route.id}${route.date}`} {...common} kind={route.kind} id={route.id} date={route.date} />;
    case "student":
      return <StudentPage key={route.id} {...common} studentId={route.id} />;
    case "class":
      return <ClassPage key={route.id} {...common} classId={route.id} />;
    case "marks":
      return <MarksPage key={route.tab} {...common} tab={route.tab} />;
    case "sheet":
      return <SheetPage key={route.scope} {...common} scope={route.scope} />;
    case "results":
      return <ResultsPage key={route.id} {...common} classId={route.id} />;
    case "staff":
      return <StaffHome {...common} />;
    case "staff-record":
      return <StaffRecordPage key={route.id} {...common} schoolId={route.school} userId={route.id} />;
    case "staff-cards":
      return <IdCardsPage key={`${route.school}${route.id}`} {...common} schoolId={route.school} userId={route.id} />;
    case "desk":
      return <DeskPage key={route.desk} {...common} schoolId={route.school} desk={route.desk} />;
    case "passport":
      return <PassportPage key={route.id} {...common} schoolId={route.school} userId={route.id} />;
    default:
      return <Dashboard {...common} />;
  }
  };
  return <MeContext.Provider value={me}>{pick()}</MeContext.Provider>;
}

function BranchRedirect({ branchId, tab }: { branchId: string; tab: BranchTab }) {
  useEffect(() => {
    api.branch(branchId)
      .then((b) => go({ page: "school", id: b.school_id, tab }))
      .catch(() => go({ page: "home" }));
  }, [branchId, tab]);
  return <div className="center muted">Loading…</div>;
}
