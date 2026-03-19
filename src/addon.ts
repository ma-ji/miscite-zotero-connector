import { createZToolkit } from "./modules/utils";
import * as hooks from "./hooks";

export class Addon {
  data = {
    alive: true,
    initialized: false,
    env: __env__,
    ztoolkit: createZToolkit(),
    syncTimer: null as number | null,
  };

  hooks = {
    onStartup: hooks.onStartup,
    onMainWindowLoad: hooks.onMainWindowLoad,
    onMainWindowUnload: hooks.onMainWindowUnload,
    onShutdown: hooks.onShutdown,
  };
}
