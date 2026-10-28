import { useEffect, useState } from "react";
import { api, ApiError, getToken, setToken, type Me } from "./api";
import Login from "./Login";
import Dashboard from "./Dashboard";
import SchoolPage from "./SchoolPage";
import BranchPage from "./BranchPage";
import StudentPage from "./StudentPage";
import RegisterPage from "./RegisterPage";
import { useRoute } from "./router";
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

  const common = { me, onLogout: logout };
  switch (route.page) {
    case "school":
      return <SchoolPage key={route.id} {...common} schoolId={route.id} />;
    case "branch":
      return <BranchPage key={route.id} {...common} branchId={route.id} tab={route.tab} />;
    case "register":
      return <RegisterPage key={`${route.kind}${route.id}${route.date}`} {...common} kind={route.kind} id={route.id} date={route.date} />;
    case "student":
      return <StudentPage key={route.id} {...common} studentId={route.id} />;
    default:
      return <Dashboard {...common} />;
  }
}
