// A box to scan a QR code with the camera or type a number, and a sheet that prints on its own.
import jsQR from "jsqr";
import QRCode from "qrcode";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

export function beep(good: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator(); const gain = ctx.createGain();
    o.frequency.value = good ? 880 : 220; gain.gain.value = 0.08;
    o.connect(gain); gain.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (good ? 0.12 : 0.3));
  } catch { /* no sound */ }
}

/** Type or scan. A barcode/QR gun types and presses Enter, so it works here too. */
export function ScanBox({ onCode, placeholder, busy = false, autoFocus = true, label = "Scan or type" }: {
  onCode: (code: string) => void; placeholder: string; busy?: boolean; autoFocus?: boolean; label?: string;
}) {
  const [typed, setTyped] = useState("");
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!busy && autoFocus) input.current?.focus(); }, [busy, autoFocus]);
  const submit = (e: FormEvent) => { e.preventDefault(); if (typed.trim()) { onCode(typed.trim()); setTyped(""); } };
  return (
    <div className="scan-box">
      <form className="scan-row" onSubmit={submit}>
        <Icon name="scan" size={20} />
        <input ref={input} aria-label={label} placeholder={placeholder} value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} autoComplete="off" />
        <button className="primary" disabled={busy || !typed.trim()}>Go</button>
        <button type="button" className={`with-icon${camera ? " on" : ""}`} onClick={() => setCamera(!camera)} aria-pressed={camera}><Icon name="scan-qr" size={16} />{camera ? "Camera off" : "Camera"}</button>
      </form>
      {camera && <Camera onCode={(c) => { onCode(c); }} paused={busy} />}
    </div>
  );
}

function Camera({ onCode, paused }: { onCode: (c: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const last = useRef({ code: "", at: 0 });
  const pausedRef = useRef(paused);
  const cb = useRef(onCode);
  pausedRef.current = paused;
  cb.current = onCode;
  const [error, setError] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null, stop = false, timer = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!navigator.mediaDevices) { setError("This device can't use its camera here. Type the number instead."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 960 } }, audio: false }).then((s) => {
      if (stop) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s;
      if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      const tick = () => {
        if (stop) return;
        const v = video.current;
        if (v && v.readyState >= 2 && ctx && !pausedRef.current) {
          const w = 480, h = Math.round((v.videoHeight / v.videoWidth) * w) || 360;
          canvas.width = w; canvas.height = h; ctx.drawImage(v, 0, 0, w, h);
          const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          const t = Date.now();
          if (found?.data && (found.data !== last.current.code || t - last.current.at > 5000)) {
            last.current = { code: found.data, at: t };
            beep(true);
            cb.current(found.data);
          }
        }
        timer = window.setTimeout(tick, 220);
      };
      tick();
    }).catch(() => setError("The camera isn't available. Allow camera access, or type the number."));
    return () => { stop = true; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return error ? <p className="error small">{error}</p> : <div className="scan-camera"><video ref={video} muted playsInline /><span className="scan-frame" /></div>;
}

export function Qr({ text, size = 120 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(text, { margin: 0, width: size * 2, errorCorrectionLevel: "M" }).then(setSrc).catch(() => {}); }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt="" /> : <span className="qr" style={{ width: size, height: size }} />;
}

/** Shown in a window on screen; when printed, only this sheet comes out. */
export function PrintSheet({ title, onClose, note, children }: { title: string; onClose: () => void; note?: string; children: ReactNode }) {
  useEffect(() => {
    document.body.classList.add("print-mode");
    return () => document.body.classList.remove("print-mode");
  }, []);
  return createPortal(
    <div className="print-wrap" role="dialog" aria-label={title}>
      <div className="print-bar no-print">
        <strong>{title}</strong>{note && <span className="muted small">{note}</span>}<span className="grow" />
        <button className="primary with-icon" onClick={() => window.print()}><Icon name="clipboard" size={16} />Print</button>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="print-sheet">{children}</div>
    </div>,
    document.body,
  );
}
