export interface AppItem {
  name: string;
  description: string;
  maker: string;
  href: string;
  icon: string;
  accent: string;
}

export const apps: AppItem[] = [
  // {
  //   name: "Scorebord",
  //   description: "Houd bij wie het snelst een bak kan trekken.",
  //   maker: "Bremer",
  //   href: "/apps/scorebord",
  //   icon: "lucide:trophy",
  //   accent: "#f59e0b",
  // },
  {
    name: "Dobbelstenen",
    description: "Voor dertigen of wat anders.",
    maker: "Tiaz",
    href: "/apps/dobbelstenen",
    icon: "lucide:dice-5",
    accent: "#10b981",
  },
  {
    name: "Tellers",
    description: "Houd alles bij: biertjes, shotjes, push-ups of kilometers.",
    maker: "Jaspe",
    href: "/apps/tellers",
    icon: "lucide:tally-5",
    accent: "#38bdf8",
  },
  // {
  //   name: "Paardenracen",
  //   description: "Wie gokt op het snelste paard?",
  //   maker: "Peet",
  //   href: "/apps/paardenracen",
  //   icon: "mdi:horse",
  //   accent: "#a855f7",
  // },
  {
    name: "Radje draaien",
    description: "Maak een keuze met kans.",
    maker: "Bremer",
    href: "/apps/radje-draaien",
    icon: "lucide:loader-pinwheel",
    accent: "#fb7185",
  },
  {
    name: "Bakken Timer",
    description: "Hoe snel trek je een bak?",
    maker: "Bremer",
    href: "/apps/bakken-timer",
    icon: "lucide:beer",
    accent: "#f59e0b",
  },
];
