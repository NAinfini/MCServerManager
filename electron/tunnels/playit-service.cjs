"use strict";

/* Backend glue for the playit agent: per-server share settings, the agent
   settings, and the hooks that tie the agent to a server's process lifecycle. */

const { codedError } = require("../provisioning/contracts.cjs");
const { createPlayitAgent, DOWNLOAD_URL } = require("./playit.cjs");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS server_share_settings (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  public_address TEXT,
  start_tunnel_with_server INTEGER NOT NULL DEFAULT 0 CHECK (start_tunnel_with_server IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playit_agent_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  exe_path TEXT,
  stop_when_idle INTEGER NOT NULL DEFAULT 1 CHECK (stop_when_idle IN (0, 1))
);
`;

const ADDRESS_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/* Friends paste what playit shows them, which is often wrapped in a scheme or
   padded with spaces. Keep only host[:port]. */
function normalizePublicAddress(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!cleaned) return null;
  const port = /:(\d+)$/.exec(cleaned)?.[1];
  if (
    cleaned.length > 255 ||
    !ADDRESS_PATTERN.test(cleaned) ||
    (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
  ) {
    throw codedError(
      "PLAYIT_ADDRESS_INVALID",
      "public address must look like name.joinmc.link or host:port",
    );
  }
  return cleaned;
}

function createPlayitService({
  db,
  nowIso,
  notifyDrop = () => {},
  onStatusChange = () => {},
  isServerRunning = () => false,
  agentOptions = {},
}) {
  db.exec(SCHEMA);

  const readAgentSettings = () => {
    const row = db
      .prepare("SELECT exe_path, stop_when_idle FROM playit_agent_settings WHERE id = 1")
      .get();
    return {
      exePath: row?.exe_path ?? null,
      stopWhenIdle: row ? row.stop_when_idle !== 0 : true,
    };
  };
  const readShare = (serverId) => {
    const row = db
      .prepare("SELECT * FROM server_share_settings WHERE server_id = ?")
      .get(serverId);
    return {
      serverId,
      publicAddress: row?.public_address ?? null,
      startTunnelWithServer: row ? row.start_tunnel_with_server !== 0 : false,
    };
  };

  const agent = createPlayitAgent({
    ...agentOptions,
    getSettings: readAgentSettings,
    onChange: onStatusChange,
    onDrop: ({ serverIds, exitCode, lastError }) => {
      for (const serverId of serverIds) {
        try {
          notifyDrop(serverId, { exitCode, lastError });
        } catch {
          // A failed notification must never stop the agent restarting.
        }
      }
    },
  });

  function requireId(value) {
    const id = typeof value === "string" ? value.trim() : "";
    if (!id) throw codedError("SERVER_ID_REQUIRED", "server id is required");
    return id;
  }

  return {
    commands: {
      get_playit_status: () => agent.status(),
      retry_playit_agent: () => agent.retry(),
      save_playit_settings: (args) => {
        const input = args?.input ?? {};
        const current = readAgentSettings();
        const stopWhenIdle =
          typeof input.stopWhenIdle === "boolean"
            ? input.stopWhenIdle
            : current.stopWhenIdle;
        db.prepare(
          `INSERT INTO playit_agent_settings (id, exe_path, stop_when_idle)
           VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET exe_path = excluded.exe_path,
             stop_when_idle = excluded.stop_when_idle`,
        ).run(current.exePath, stopWhenIdle ? 1 : 0);
        return agent.status();
      },
      get_server_share_settings: (args) =>
        readShare(requireId(args?.serverId ?? args?.input?.serverId)),
      save_server_share_settings: (args) => {
        const input = args?.input ?? {};
        const serverId = requireId(input.serverId);
        const current = readShare(serverId);
        const publicAddress =
          input.publicAddress === undefined
            ? current.publicAddress
            : normalizePublicAddress(input.publicAddress);
        const startTunnelWithServer =
          typeof input.startTunnelWithServer === "boolean"
            ? input.startTunnelWithServer
            : current.startTunnelWithServer;
        db.prepare(
          `INSERT INTO server_share_settings
             (server_id, public_address, start_tunnel_with_server, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(server_id) DO UPDATE SET
             public_address = excluded.public_address,
             start_tunnel_with_server = excluded.start_tunnel_with_server,
             updated_at = excluded.updated_at`,
        ).run(serverId, publicAddress, startTunnelWithServer ? 1 : 0, nowIso());
        // Toggling while the server is already up takes effect immediately.
        if (isServerRunning(serverId)) {
          if (startTunnelWithServer) agent.acquire(serverId);
          else agent.release(serverId);
        }
        return readShare(serverId);
      },
    },
    serverStarted(serverId) {
      if (readShare(serverId).startTunnelWithServer) agent.acquire(serverId);
    },
    serverStopped(serverId) {
      agent.release(serverId);
    },
    dispose() {
      agent.dispose();
    },
    downloadUrl: DOWNLOAD_URL,
  };
}

module.exports = { createPlayitService, normalizePublicAddress };
