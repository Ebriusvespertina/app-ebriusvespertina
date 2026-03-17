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
    icon: "🏆",
    accent: "#f59e0b",
  },
  {
    name: "Dobbelstenen",
    description: "Voor dertigen of wat anders.",
    maker: "Niemand",
    href: "/apps/dobbelstenen",
    icon: "🎲",
    accent: "#10b981",
  },
  {
    name: "Paardenracen",
    description: "Wie gokt op het snelste paard?",
    maker: "Peet",
    href: "/apps/paardenracen",
    icon: "🐴",
    accent: "#a855f7",
  },
  {
    name: "Radje draaien",
    description: "Maak een keuze met kans.",
    maker: "Holland Casino",
    href: "/apps/radje-draaien",
    icon: "🎡",
    accent: "#fb7185",
  },
  {
    name: "Slotmachine",
    description: "Gok met een slotmachine.",
    maker: "Holland Casino",
    href: "/apps/slotmachine",
    icon: "🎰",
    accent: "#3b82f6",
  },
];
