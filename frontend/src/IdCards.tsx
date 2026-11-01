// Printable staff ID cards: school crest and colour, photo, name, position, staff number and a QR code.
import { useEffect, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { api, errorText, type Me } from "./api";
import { initials } from "./Dashboard";
import Icon from "./Icon";
import Layout from "./Layout";
import { Empty } from "./ui";

interface Card { user_id: string; full_name: string; title: string | null; job_title: string | null; department_name: string | null; staff_no: string | null; photo: string | null; phone: string | null; code: string }
interface Cards { school_name: string; motto: string | null; logo: string | null; colour: string | null; address: string | null; phone: string | null; cards: Card[] }

function IdCard({ c, d }: { c: Card; d: Cards }) {
  const [qr, setQr] = useState("");
  useEffect(() => { QRCode.toDataURL(c.code, { margin: 0, width: 160, errorCorrectionLevel: "M" }).then(setQr).catch(() => {}); }, [c.code]);
  return (
    <article className="id-card">
      <header className="id-head">
        <span className="id-crest">{d.logo ? <img src={d.logo} alt="" /> : <span>{initials(d.school_name)}</span>}</span>
        <span className="id-school">
          <strong>{d.school_name}</strong>
          {d.motto && <em>{d.motto}</em>}
        </span>
      </header>
      <div className="id-body">
        <span className="id-photo">{c.photo ? <img src={c.photo} alt="" /> : <Icon name="user" size={36} />}</span>
        <div className="id-text">
          <span className="id-tag">STAFF</span>
          <strong className="id-name">{[c.title, c.full_name].filter(Boolean).join(" ")}</strong>
          <span className="id-job">{c.job_title ?? "Staff"}</span>
          {c.department_name && <span className="id-dept">{c.department_name}</span>}
          <span className="id-no">{c.staff_no ?? ""}</span>
        </div>
        {qr && <img className="id-qr" src={qr} alt="" />}
      </div>
      <footer className="id-foot">If found, please return to {d.school_name}{d.phone ? ` · ${d.phone}` : ""}</footer>
    </article>
  );
}

export default function IdCardsPage({ me, onLogout, schoolId, userId }: { me: Me; onLogout: () => void; schoolId: string; userId?: string }) {
  const [data, setData] = useState<Cards | null>(null);
  const [error, setError] = useState("");
  const [onlyPhotos, setOnlyPhotos] = useState(false);
  useEffect(() => {
    api.raw<Cards>("GET", `/api/schools/${schoolId}/staff-cards${userId ? `?ids=${userId}` : ""}`).then(setData).catch((err) => setError(errorText(err)));
  }, [schoolId, userId]);
  const cards = (data?.cards ?? []).filter((c) => !onlyPhotos || c.photo);
  const missing = (data?.cards ?? []).filter((c) => !c.photo).length;
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "Staff ID cards" }]}>
      <div className="id-page" style={{ "--card": data?.colour || "#1d5e3a" } as CSSProperties}>
        <div className="id-toolbar no-print">
          <div>
            <h1>Staff ID cards</h1>
            <p className="muted small">{cards.length} cards. They print 8 to an A4 page; cut along the lines. Standard card size (85.6 × 54 mm).</p>
          </div>
          <span className="grow" />
          {missing > 0 && !userId && (
            <label className="check small"><input type="checkbox" checked={onlyPhotos} onChange={(e) => setOnlyPhotos(e.target.checked)} />Only staff with a photo ({missing} have none)</label>
          )}
          <button className="primary with-icon" onClick={() => window.print()}><Icon name="clipboard" size={16} />Print</button>
        </div>
        {error && <p className="error">{error}</p>}
        {data && cards.length === 0 && <Empty icon="staff">No cards to print.</Empty>}
        <div className="id-sheet">
          {data && cards.map((c) => <IdCard key={c.user_id} c={c} d={data} />)}
        </div>
      </div>
    </Layout>
  );
}
