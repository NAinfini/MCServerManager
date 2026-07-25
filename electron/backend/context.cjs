"use strict";

function createBackendContext({
  db,
  appDataDir,
  processSpawner,
  metricCollector,
  runtimeDependencies,
  portChecker,
}) {
  return {
    db,
    appDataDir,
    dependencies: {
      processSpawner,
      metricCollector,
      runtimeDependencies,
      portChecker,
    },
    runtimeState: {
      metricBaselines: new Map(),
      serverEventListeners: new Set(),
      startingServers: new Set(),
    },
  };
}

module.exports = { createBackendContext };
