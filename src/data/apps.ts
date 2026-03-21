export interface AppItem {
  name: string;
  description: string;
  maker: string;
  href: string;
  icon: string;
  accent: string;
}

export const apps: AppItem[] = [
  {
    name: "Scorebord",
    description: "Houd bij wie het snelst een bak kan trekken.",
    maker: "Iemand",
    href: "/apps/scorebord",
    icon: "lucide:trophy",
    accent: "#f59e0b",
  },
  {
    name: "Dobbelstenen",
    description: "Voor dertigen of wat anders.",
    maker: "Niemand",
    href: "/apps/dobbelstenen",
    icon: "lucide:dice-5",
    accent: "#10b981",
  },
  {
    name: "Paardenracen",
    description: "Wie gokt op het snelste paard?",
    maker: "Peet",
    href: "/apps/paardenracen",
    icon: "mdi:horse",
    accent: "#a855f7",
  },
  {
    name: "Radje draaien",
    description: "Maak een keuze met kans.",
    maker: "Holland Casino",
    href: "/apps/radje-draaien",
    icon: "lucide:loader-pinwheel",
    accent: "#fb7185",
  },
];
