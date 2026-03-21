// @ts-check
import { defineConfig } from "astro/config";
import icon from "astro-icon";

import vue from "@astrojs/vue";

// https://astro.build/config
export default defineConfig({
  integrations: [vue(), icon()],
});
