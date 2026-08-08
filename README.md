# D.E.V. Apps

Een startpagina voor drankspellen en andere apps van Dispuut Ebrius Vespertina.
Een statische PWA gebouwd met [Astro](https://astro.build) en [Vue 3](https://vuejs.org/), draait volledig in de browser en werkt offline na installatie.

## Apps

| App | Route | Omschrijving |
| --- | --- | --- |
| Dobbelstenen | `/apps/dobbelstenen` | Dertigen: gooi 6 stenen, vergrendel wat je wilt houden, doel boven de 30. |
| Radje draaien | `/apps/radje-draaien` | Keuzes met gewichten op een rad, met geschiedenis (opgeslagen per toestel). |
| Bakken Timer | `/apps/bakken-timer` | Houd vast om te starten, laat los zodra je drinkt, tik weer als de bak leeg is. Record en log per toestel. |
| Tellers | `/apps/tellers` | Meerdere tellers in categorieën, tellen met tikken of vasthouden, statistieken en grafieken per teller, backup via import/export (JSON). |

## Structuur

```text
src/
├── pages/            # Astro-pagina's (elke app is één route)
│   └── apps/
├── layouts/
│   └── BaseLayout.astro   # Gedeelde head/body, PWA-meta en SW-registratie
├── components/
│   ├── AppCard.astro, AppGrid.astro, AppHubHero.astro
│   ├── PwaRegister.astro
│   └── apps/<app-naam>/   # Per app: Vue-componenten + engine + types
├── data/apps.ts      # Register: verschijnt op de startpagina
└── styles/tokens.css # Design tokens (kleuren, spacing, radii)
```

## Een app toevoegen

1. Maak `src/pages/apps/<naam>.astro` met `BaseLayout` en je Vue-app als `client:only="vue"`.
2. Zet de componenten in `src/components/apps/<naam>/`; houd pure logica in een `<naam>Engine.ts` los van de Vue-componenten (die is unit-testbaar).
3. Voeg een entry toe aan `src/data/apps.ts` (naam, beschrijving, maker, route, icoon, accentkleur).
4. Schrijf tests voor de engine in `<naam>Engine.test.ts`.

## Commands

| Commando | Actie |
| --- | --- |
| `pnpm dev` | Dev-server op `localhost:4321` (PWA werkt ook in dev) |
| `pnpm build` | Productie-build naar `dist/` |
| `pnpm preview` | Preview van de build |
| `pnpm check` | Typecheck: `astro check` + `vue-tsc --noEmit` |
| `pnpm test` | Unit-tests (vitest) voor de engines |

Vereist Node >= 22 en pnpm 11 (zie `packageManager`). Bij een verse clone draait `pnpm install` de build-scripts van `esbuild` en `sharp` automatisch (geconfigureerd via `allowBuilds` in `pnpm-workspace.yaml`); volg niet de interactieve `pnpm approve-builds`-prompt.

## PWA

De PWA wordt geregistreerd via `PwaRegister.astro` (in `BaseLayout`). Icoontjes in `public/icons/` kun je opnieuw genereren met `node scripts/generate-icons.mjs` (bron: `public/logo-dev.svg`). De manifest- en service-worker-config staat in `astro.config.mjs`.
