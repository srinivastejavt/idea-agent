import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_hrcrmffmkenhnipudamk",
  dirs: ["./src/jobs"],
  maxDuration: 300,  // 5 minutes — dual-model LLM calls need headroom
  build: {
    // Keep large packages external so esbuild doesn't inline them — reduces bundle from ~14MB
    external: ["googleapis", "ws", "@supabase/supabase-js"],
  },
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
  defaultMachinePreset: "medium-2x",  // 4GB RAM — scraper (20+ sources) + dual LLM calls
});
