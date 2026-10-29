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
import { go, useRoute, type BranchTab } from "./router";
import { cache, isNetworkError } from "./offline";

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

  if (checking) return <div className="center muted">Loading…</div>;
  if (!me) return <Login onLoggedIn={setMe} />;

  if (me.must_change_password)
    return <ChoosePassword me={me} onLogout={logout} onDone={() => setMe({ ...me, must_change_password: false })} />;

  const common = { me, onLogout: logout };
  // Board members who don't run a school only ever see the read-only board view.
  const isOwner = me.memberships.some((m) => m.role === "owner");
  const isBoard = me.memberships.some((m) => m.role === "board_member");
  if (!isOwner && isBoard) return <BoardView {...common} />;
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
    default:
      return <Dashboard {...common} />;
  }
}

function BranchRedirect({ branchId, tab }: { branchId: string; tab: BranchTab }) {
  useEffect(() => {
    api.branch(branchId)
      .then((b) => go({ page: "school", id: b.school_id, tab }))
      .catch(() => go({ page: "home" }));
  }, [branchId, tab]);
  return <div className="center muted">Loading…</div>;
}
