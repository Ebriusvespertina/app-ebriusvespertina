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
  //   maker: "Henkie",
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
    name: "Timing",
    description: "Twee spelers, één telefoon. Tik op het juiste moment: reflex, skill check of op gevoel.",
    maker: "Henkie",
    href: "/apps/timing",
    icon: "mdi:gesture-tap",
    accent: "#34d399",
  },
  {
    name: "Pong",
    description: "Twee spelers, één telefoon. Boven tegen onder, tik om te bewegen.",
    maker: "Henkie",
    href: "/apps/pong",
    icon: "mdi:table-tennis",
    accent: "#f472b6",
  },
  {
    name: "Touwtrekken",
    description: "Twee spelers, één telefoon. Tik zo snel mogelijk in jouw helft om de knoop naar jouw kant te trekken.",
    maker: "Henkie",
    href: "/apps/touwtrekken",
    icon: "mdi:handshake",
    accent: "#f87171",
  },
  {
    name: "Tellers",
    description: "Houd alles bij: biertjes, shotjes, push-ups of kilometers.",
    maker: "Henkie",
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
    maker: "Henkie",
    href: "/apps/radje-draaien",
    icon: "lucide:loader-pinwheel",
    accent: "#fb7185",
  },
  {
    name: "Bakken Timer",
    description: "Hoe snel trek je een bak?",
    maker: "Henkie",
    href: "/apps/bakken-timer",
    icon: "lucide:beer",
    accent: "#f59e0b",
  },
];
