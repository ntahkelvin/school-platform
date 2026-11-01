// The gate or staff-room kiosk: a phone or tablet that scans staff ID cards to sign them in and out.
// It needs no login; the secret link (#/kiosk/<school>/<token>) is its key.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import jsQR from "jsqr";
import { errorText } from "./api";
import { initials } from "./Dashboard";
import { clock, day, type Stamp } from "./dayApi";
import Icon from "./Icon";

interface Info { school_name: string; logo: string | null; colour: string | null; motto: string | null; signed_in: number; staff: number; late_after: string }
type Result = { ok: true; s: Stamp } | { ok: false; message: string };

function beep(good: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = good ? 880 : 220; o.type = "sine"; g.gain.value = 0.12;
    o.connect(g); g.connect(ctx.destination); o.start();
    if (good) o.frequency.setValueAtTime(1320, ctx.currentTime + 0.09);
    o.stop(ctx.currentTime + (good ? 0.2 : 0.35));
  } catch { /* no sound on this device */ }
}

export default function KioskPage({ schoolId, token }: { schoolId: string; token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [fatal, setFatal] = useState("");
  const [now, setNow] = useState(new Date());
  const [result, setResult] = useState<Result | null>(null);
  const [typed, setTyped] = useState("");
  const [camera, setCamera] = useState<"user" | "environment">(() => (localStorageGet("kiosk-camera") as "user" | "environment") || "user");
  const [camError, setCamError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const busy = useRef(false);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const hideTimer = useRef<number>(0);

  const loadInfo = useCallback(() => {
    day.kiosk(schoolId, token).then(setInfo).catch((e) => setFatal(errorText(e)));
  }, [schoolId, token]);
  useEffect(() => { loadInfo(); const t = setInterval(loadInfo, 60000); return () => clearInterval(t); }, [loadInfo]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const submit = useCallback(async (code: string) => {
    if (busy.current || !code.trim()) return;
    busy.current = true;
    try {
      const s = await day.scan(schoolId, token, code.trim());
      setResult({ ok: true, s }); beep(true);
      setInfo((i) => i && s.action === "in" ? { ...i, signed_in: i.signed_in + 1 } : i);
    } catch (e) {
      setResult({ ok: false, message: errorText(e) }); beep(false);
    } finally {
      busy.current = false;
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setResult(null), 4500);
    }
  }, [schoolId, token]);

  // Camera: look for a QR code a few times a second.
  useEffect(() => {
    if (fatal) return;
    let stream: MediaStream | null = null, stop = false, timer = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    setCamError("");
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: camera, width: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
        const tick = () => {
          const v = video.current;
          if (stop) return;
          if (v && v.readyState >= 2 && ctx && !busy.current) {
            const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
            canvas.width = w; canvas.height = h;
            ctx.drawImage(v, 0, 0, w, h);
            const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
            if (found?.data) {
              const t = Date.now();
              if (found.data !== last.current.code || t - last.current.at > 8000) {
                last.current = { code: found.data, at: t };
                submit(found.data);
              }
            }
          }
          timer = window.setTimeout(tick, 220);
        };
        tick();
      })
      .catch(() => setCamError("The camera isn't available. Allow camera access, or type the staff number below."));
    if (!navigator.mediaDevices) setCamError("This device can't use its camera here. Type the staff number below.");
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [camera, fatal, submit]);

  function typedSubmit(e: FormEvent) { e.preventDefault(); submit(typed); setTyped(""); }

  if (fatal) {
    return (
      <div className="kiosk kiosk-fatal"><Icon name="circle-x" size={56} /><h1>Kiosk link not working</h1><p>{fatal}</p></div>
    );
  }
  const colour = info?.colour || "#0f7a4f";
  const late = info && `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` > info.late_after;
  const s = result?.ok ? result.s : null;
  const tone = !result ? "" : !result.ok ? "bad" : s!.action === "out" ? "out" : s!.action === "already" ? "already" : s!.status === "late" ? "late" : "good";
  return (
    <div className="kiosk" style={{ "--school": colour } as CSSProperties}>
      <header className="kiosk-head">
        <span className="kiosk-crest">{info?.logo ? <img src={info.logo} alt="" /> : <span>{initials(info?.school_name ?? "")}</span>}</span>
        <span className="kiosk-school"><strong>{info?.school_name ?? "…"}</strong>{info?.motto && <em>{info.motto}</em>}</span>
        <span className="grow" />
        <span className="kiosk-clock">
          <strong>{now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</strong>
          <span>{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
        </span>
      </header>
      <main className="kiosk-main">
        <div className="kiosk-camera">
          <video ref={video} playsInline muted className={camera === "user" ? "mirror" : ""} />
          <span className="kiosk-frame" aria-hidden="true"><i /><i /><i /><i /></span>
          {camError && <p className="kiosk-cam-error">{camError}</p>}
          <button className="kiosk-flip" onClick={() => { const c = camera === "user" ? "environment" : "user"; setCamera(c); localStorageSet("kiosk-camera", c); }}>
            <Icon name="refresh" size={16} />Switch camera
          </button>
        </div>
        <aside className="kiosk-side">
          <h1>Hold your staff ID card up to the camera</h1>
          <p className="kiosk-hint">Scan once when you arrive and once when you leave.{late && <><br /><b>It's after {info?.late_after}: arrivals now count as late.</b></>}</p>
          <div className="kiosk-count">
            <strong>{info?.signed_in ?? 0}</strong><span>of {info?.staff ?? 0} staff signed in today</span>
            <span className="kiosk-meter"><i style={{ width: `${info?.staff ? Math.min(100, (info.signed_in / info.staff) * 100) : 0}%` }} /></span>
          </div>
          <form className="kiosk-type" onSubmit={typedSubmit}>
            <label htmlFor="kiosk-no"><Icon name="keyboard" size={16} />No card? Type your staff number</label>
            <div className="row">
              <input id="kiosk-no" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} placeholder="e.g. JMC/STF/014" autoComplete="off" />
              <button className="primary">Sign</button>
            </div>
          </form>
        </aside>
      </main>
      {result && (
        <div className={`kiosk-result k-${tone}`} onClick={() => setResult(null)} role="status">
          <div className="kiosk-result-card">
            {s ? (
              <>
                <span className="kiosk-photo">{s.photo ? <img src={s.photo} alt="" /> : <span>{initials(s.name)}</span>}</span>
                <span className="kiosk-badge"><Icon name={tone === "out" ? "log-out" : tone === "already" ? "check" : tone === "late" ? "timer" : "log-in"} size={22} stroke={2.4} />
                  {tone === "out" ? "Signed out" : tone === "already" ? "Already signed" : tone === "late" ? "Signed in · late" : "Signed in"}</span>
                <h2>{s.name}</h2>
                {s.job_title && <p className="kiosk-job">{s.job_title}</p>}
                <p className="kiosk-msg">{s.message}</p>
                <p className="kiosk-times">{s.time_in && <>In {clock(s.time_in)}</>}{s.time_out && <> · Out {clock(s.time_out)}</>}</p>
              </>
            ) : (
              <>
                <span className="kiosk-photo bad"><Icon name="circle-x" size={64} /></span>
                <h2>Not signed in</h2>
                <p className="kiosk-msg">{(result as { message: string }).message}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function localStorageGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
