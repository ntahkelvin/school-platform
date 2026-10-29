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
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  // facilities
  laboratory: "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10",
  ict_lab: "M3 4h18v12H3zM8 20h8M12 16v4",
  library: "M4 4h5v16H4zM9 4h5v16H9zM14.5 4.5l4.8-1 2.7 15.5-4.8 1z",
  classroom: "M3 4h18v11H3zM7 21l2-6M17 21l-2-6M8 9h5",
  hall: "M3 21h18M4 21V10l8-6 8 6v11M8 21v-6h8v6M12 10h.01",
  sick_bay: "M4 5h16v14H4zM12 8v8M8 12h8",
  kitchen: "M4 11h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6zM9 7c0-1 1-1.5 1-2.5M13 7c0-1 1-1.5 1-2.5M2 11h2M20 11h2",
  dining_hall: "M5 3v8a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10",
  sports_field: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7l4 3-1.5 5h-5L8 10zM12 3v4M21 10l-5 0M3 10h5M7 20l2.5-5M17 20l-2.5-5",
  staff_room: "M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2M12 20v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2",
  office: "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
  chapel_mosque: "M12 2v5M10 4h4M6 21V11l6-4 6 4v10M3 21h18M10 21v-4a2 2 0 0 1 4 0v4",
  store: "M3 8l9-5 9 5v12H3zM3 8h18M8 20v-7h8v7",
  workshop: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z",
  tuck_shop: "M4 9l1.5-5h13L20 9M4 9h16v11H4zM4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M10 20v-5h4v5",
  other: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12h.01M12 12h.01M16 12h.01",
  bed: "M3 18V7M3 13h18v5M21 18v-3a3 3 0 0 0-3-3h-8v1M6.5 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  bus: "M5 17V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11zM5 11h14M8 21v-4M16 21v-4M8 14h.01M16 14h.01",
  hostel: "M3 21V9l9-6 9 6v12M3 21h18M8 21v-5h8v5M7 11h2M15 11h2",
  department: "M4 21V8l8-5 8 5v13M9 21v-6h6v6M4 21h16",
  club: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  event: "M4 5h16v16H4zM4 10h16M8 3v4M16 3v4M12 14v4M10 16h4",
  book: "M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h8",
};

export default function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}
