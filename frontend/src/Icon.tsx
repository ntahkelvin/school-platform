// A small set of line icons, drawn here so the app needs no icon library and works offline.
const PATHS: Record<string, string> = {
  overview: "M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10",
  students: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6",
  attendance: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M9 14.5l2 2 4-4",
  classes: "M3 21V5l9-3 9 3v16M3 21h18M9 21v-6h6v6M8 9h.01M12 9h.01M16 9h.01",
  staff: "M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
  facilities: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01",
  sections: "M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  departments: "M10 3h4v4h-4zM4 17h4v4H4zM16 17h4v4h-4zM12 7v5M6 17v-3h12v3",
  houses: "M5 21V4M5 4h11l-2 4 2 4H5",
  grading: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 13.5L7 21l5-3 5 3-1.5-7.5",
  calendar: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 18h2",
  policies: "M14 3H6v18h12V7zM14 3v4h4M9 12h6M9 16h6",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  place: "M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
  mail: "M3 5h18v14H3zM3 7l9 6 9-6",
  founded: "M12 3v4M5 10h14v11H5zM9 21v-5h6v5M3 10l9-7 9 7",
  edit: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
};

export default function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
