// Icons come from the Lucide set (bundled into the app, so they still work offline).
// Screens ask for an icon by a short name; this file maps names to drawings.
import {
  Anchor, Apple, Atom, Award, Baby, Banknote, BedDouble, BedSingle, Bell, Bike, Blocks, BookMarked, BookOpen, BookText, Bot,
  Brain, Briefcase, Brush, Building2, Bus, Calculator, CalendarCheck, CalendarDays, CalendarPlus, Camera, Car, Castle,
  ChartColumn, Church, ClipboardCheck, Clock, Code, Coffee, Coins, CookingPot, Cpu, Crown, Dna, Drama, Dumbbell, Earth,
  Feather, Flag, FlaskConical, Footprints, Gamepad2, Gavel, Gem, Globe, GraduationCap, HandHeart, Hammer, HeartHandshake,
  HeartPulse, Hotel, House, Landmark, Languages, Laptop, Layers, LayoutGrid, Leaf, Library, Lightbulb, Mail, Map, MapPin,
  Medal, Megaphone, Mic, Microscope, Monitor, Moon, Mountain, Music, Network, NotebookPen, Palette, PartyPopper, Pencil,
  PenTool, Phone, Pi, Plane, Plus, Presentation, Puzzle, Rocket, Scale, School, ScrollText, Search, Shapes, Shield,
  Armchair, House as HouseIcon, ChevronDown, ChevronUp, IdCard, Info, KeyRound, Printer, Trees, Download, List as ListIcon, ArrowRight, ArrowUpRight, Lock, ShieldCheck, Shirt, ShoppingBag, Sigma, Snowflake, Soup, Sparkles, Sprout, Star, Stethoscope, Store, Sun, Swords, Tent,
  Theater, Tractor, Trash2, TrendingUp, Trophy, UserPlus, UserRound, Users, UtensilsCrossed, Volleyball, Wallet,
  Warehouse, Waves, Wrench, X, Zap, LogIn, LogOut, ScanLine, ScanQrCode, ClipboardList, FileText, Check, Undo2, Keyboard,
  Delete, CalendarX, Hourglass, Timer, Send, RefreshCw, Link, Copy, ChevronLeft, ChevronRight, UserCheck, UserX, Umbrella,
  Locate, Smartphone, CircleCheck, CircleX, TreePalm, Inbox, Settings, CalendarRange, History, Eye, Heart, Target, Gauge, MessageCircle,
  Flame, Quote, ThumbsUp, TriangleAlert, LifeBuoy, Folder, type LucideIcon,
} from "lucide-react";

import { createLucideIcon } from "lucide-react";

// Male and female signs, drawn in the same style as the rest of the set.
const Mars = createLucideIcon("Mars", [
  ["circle", { cx: "10", cy: "14", r: "6", key: "m1" }], ["path", { d: "M14.3 9.7 21 3M15 3h6v6", key: "m2" }],
]);
const Venus = createLucideIcon("Venus", [
  ["circle", { cx: "12", cy: "9", r: "6", key: "v1" }], ["path", { d: "M12 15v7M9 19h6", key: "v2" }],
]);

const ICONS: Record<string, LucideIcon> = {
  "alert-triangle": TriangleAlert, "life-buoy": LifeBuoy, folder: Folder, "file-text": FileText, x: X,
  // school menu
  overview: House, students: Users, attendance: CalendarCheck, classes: School, staff: UserRound,
  facilities: Building2, sections: Layers, departments: Network, houses: Flag, grading: Award,
  calendar: CalendarDays, policies: ScrollText,
  // general
  phone: Phone, place: MapPin, globe: Globe, mail: Mail, founded: Landmark, edit: Pencil, sparkle: Sparkles,
  trash: Trash2, plus: Plus, close: X, search: Search, bed: BedDouble, bus: Bus, car: Car, hostel: Hotel,
  department: Building2, club: Star, bell: Bell, event: CalendarPlus, book: BookOpen, clock: Clock, moon: Moon,
  "user-plus": UserPlus, boys: Mars, girls: Venus, gem: Gem,
  // facility kinds
  classroom: Presentation, laboratory: FlaskConical, ict_lab: Monitor, library: Library, hall: Landmark,
  sick_bay: HeartPulse, kitchen: CookingPot, dining_hall: UtensilsCrossed, sports_field: Trophy, staff_room: Coffee,
  office: Briefcase, chapel_mosque: Church, store: Warehouse, workshop: Wrench, tuck_shop: Store, other: Shapes,
  // everything the pickers in look.ts can choose
  anchor: Anchor, apple: Apple, atom: Atom, award: Award, baby: Baby, banknote: Banknote, "bed-single": BedSingle,
  bike: Bike, blocks: Blocks, "book-marked": BookMarked, "book-text": BookText, bot: Bot, brain: Brain, brush: Brush,
  building: Building2, calculator: Calculator, camera: Camera, castle: Castle, chart: ChartColumn, church: Church,
  clipboard: ClipboardCheck, code: Code, coffee: Coffee, coins: Coins, "cooking-pot": CookingPot, cpu: Cpu, crown: Crown,
  dna: Dna, drama: Drama, dumbbell: Dumbbell, earth: Earth, feather: Feather, flag: Flag, flask: FlaskConical,
  footprints: Footprints, gamepad: Gamepad2, gavel: Gavel, "graduation-cap": GraduationCap, "hand-heart": HandHeart,
  hammer: Hammer, handshake: HeartHandshake, "heart-pulse": HeartPulse, landmark: Landmark, languages: Languages,
  laptop: Laptop, grid: LayoutGrid, leaf: Leaf, lightbulb: Lightbulb, map: Map, medal: Medal, megaphone: Megaphone,
  mic: Mic, microscope: Microscope, monitor: Monitor, mountain: Mountain, music: Music, notebook: NotebookPen,
  palette: Palette, party: PartyPopper, "pen-tool": PenTool, pi: Pi, plane: Plane, presentation: Presentation,
  puzzle: Puzzle, rocket: Rocket, scale: Scale, scroll: ScrollText, shapes: Shapes, shield: Shield,
  "shield-check": ShieldCheck, shirt: Shirt, "shopping-bag": ShoppingBag, sigma: Sigma, snowflake: Snowflake, soup: Soup,
  sprout: Sprout, star: Star, stethoscope: Stethoscope, sun: Sun, swords: Swords, tent: Tent, theater: Theater,
  tractor: Tractor, trending: TrendingUp, trophy: Trophy, users: Users, utensils: UtensilsCrossed, volleyball: Volleyball,
  wallet: Wallet, waves: Waves, wrench: Wrench, zap: Zap, "calendar-check": CalendarCheck, "calendar-days": CalendarDays,
  layers: Layers, network: Network, house: House, user: UserRound, hotel: Hotel, school: School, briefcase: Briefcase,
  "log-in": LogIn, "log-out": LogOut, scan: ScanLine, "scan-qr": ScanQrCode, "clipboard-list": ClipboardList, file: FileText,
  check: Check, undo: Undo2, keyboard: Keyboard, backspace: Delete, "calendar-x": CalendarX, hourglass: Hourglass, timer: Timer,
  send: Send, refresh: RefreshCw, link: Link, copy: Copy, "chevron-left": ChevronLeft, "chevron-right": ChevronRight,
  "user-check": UserCheck, "user-x": UserX, umbrella: Umbrella, locate: Locate, smartphone: Smartphone, "circle-check": CircleCheck,
  "circle-x": CircleX, "palm-tree": TreePalm, inbox: Inbox, settings: Settings, "calendar-range": CalendarRange, history: History,
  "staff-day": UserCheck, eye: Eye, heart: Heart, target: Target, gauge: Gauge, message: MessageCircle, flame: Flame, quote: Quote,
  "thumbs-up": ThumbsUp, growth: Sprout, operations: Wrench, key: KeyRound, lock: Lock, "chevron-up": ChevronUp, "chevron-down": ChevronDown, "id-card": IdCard, info: Info, armchair: Armchair, home: HouseIcon, printer: Printer, trees: Trees, download: Download, list: ListIcon, "arrow-right": ArrowRight, "arrow-up-right": ArrowUpRight,
};

export default function Icon({ name, size = 18, stroke = 1.9 }: { name: string; size?: number; stroke?: number }) {
  const Drawing = ICONS[name] ?? Shapes;
  return <Drawing className="icon" size={size} strokeWidth={stroke} aria-hidden="true" />;
}
