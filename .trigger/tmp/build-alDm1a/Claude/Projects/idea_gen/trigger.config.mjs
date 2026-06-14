import {
  defineConfig
} from "../../../chunk-UZHNW3LS.mjs";
import "../../../chunk-HPZM6FUT.mjs";
import {
  init_esm
} from "../../../chunk-23OQHB7B.mjs";

// trigger.config.ts
init_esm();
var trigger_config_default = defineConfig({
  project: "proj_hrcrmffmkenhnipudamk",
  dirs: ["./src/jobs"],
  // 5 minutes — dual-model LLM calls need headroom
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1e3,
      maxTimeoutInMs: 1e4,
      factor: 2
    }
  },
  // 1GB RAM — scraper + dual LLM calls need headroom
  defaultMachinePreset: "small-2x",
  build: {}
});
var resolveEnvVars = void 0;
export {
  trigger_config_default as default,
  resolveEnvVars
};
//# sourceMappingURL=trigger.config.mjs.map
