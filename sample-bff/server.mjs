/**
 * Sample tenant backend — mints session JWTs only.
 *
 *   POST /api/chat/session
 *   POST /api/chat/demo/ensure-dm
 *   POST /api/chat/demo/ensure-group
 *   GET  /api/chat/health
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const PORT = Number(process.env.PORT ?? 4400);
const API_URL = process.env.SENDSAR_API_URL?.replace(/\/$/, "");
const API_KEY = process.env.SENDSAR_API_KEY?.trim();

if (!API_URL || !API_KEY) {
  console.error(
    "[sample-bff] Set SENDSAR_API_URL and SENDSAR_API_KEY in sample-bff/.env",
  );
  process.exit(1);
}

function tenantHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
    ...extra,
  };
}

async function gatewayJson(path, init = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: tenantHeaders(init.headers),
  });
}

function participantDto(id, username) {
  return { id, username: username || id, appCode: "demo" };
}

const app = express();
app.use(express.json());

app.get("/api/chat/health", (_req, res) => {
  res.json({ ok: true, apiUrl: API_URL });
});

app.post("/api/chat/session", async (req, res) => {
  const { chatUserId, displayName, seedUsers } = req.body ?? {};
  if (!chatUserId || !displayName) {
    res.status(400).json({ error: "chatUserId and displayName are required" });
    return;
  }

  try {
    if (Array.isArray(seedUsers)) {
      await Promise.all(
        seedUsers.map((user) =>
          gatewayJson("/users", {
            method: "POST",
            body: JSON.stringify(
              participantDto(user.chatUserId, user.displayName),
            ),
          }),
        ),
      );
    }

    const upsertRes = await gatewayJson("/users", {
      method: "POST",
      body: JSON.stringify(participantDto(chatUserId, displayName)),
    });
    if (!upsertRes.ok) {
      const detail = await upsertRes.text();
      res
        .status(502)
        .json({ error: `Upsert user failed: ${upsertRes.status} ${detail}` });
      return;
    }

    const [tokenRes, settingsRes] = await Promise.all([
      gatewayJson("/auth/token", {
        method: "POST",
        body: JSON.stringify({ userId: chatUserId }),
      }),
      gatewayJson("/tenant/settings"),
    ]);

    if (!tokenRes.ok) {
      const detail = await tokenRes.text();
      res
        .status(502)
        .json({ error: `Mint token failed: ${tokenRes.status} ${detail}` });
      return;
    }

    const { token, expiresAt } = await tokenRes.json();

    let chatSettings;
    if (settingsRes.ok) {
      const settingsBody = await settingsRes.json();
      chatSettings = settingsBody.chat;
    }

    res.json({
      token,
      expiresAt,
      apiUrl: API_URL,
      chatUserId,
      displayName,
      chatSettings,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Session failed",
    });
  }
});

app.post("/api/chat/demo/ensure-dm", async (req, res) => {
  const { selfId, peerId, members } = req.body ?? {};
  if (!selfId || !peerId) {
    res.status(400).json({ error: "selfId and peerId are required" });
    return;
  }

  try {
    const externalId = `dm:${[selfId, peerId].sort().join(":")}`;
    const listRes = await gatewayJson(
      `/chat/rooms?externalId=${encodeURIComponent(externalId)}`,
    );
    if (!listRes.ok) {
      res.status(502).json({ error: `List rooms failed: ${listRes.status}` });
      return;
    }

    const listed = await listRes.json();
    if (listed.rooms?.[0]?.id) {
      res.json({ roomId: listed.rooms[0].id });
      return;
    }

    const nameMap = new Map(
      Array.isArray(members)
        ? members.map((m) => [m.chatUserId ?? m.id, m.displayName ?? m.username])
        : [],
    );

    // DMs intentionally omit room.name so each side resolves the peer label
    // from the user directory / externalId.
    const createRes = await gatewayJson("/chat/rooms", {
      method: "POST",
      body: JSON.stringify({
        externalId,
        customType: "demo_dm",
        participants: [selfId, peerId].map((id) =>
          participantDto(id, nameMap.get(id) ?? id),
        ),
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      res
        .status(502)
        .json({ error: `Create room failed: ${createRes.status} ${detail}` });
      return;
    }

    const created = await createRes.json();
    res.json({ roomId: created.id });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Ensure DM failed",
    });
  }
});

app.post("/api/chat/demo/ensure-group", async (req, res) => {
  const { selfId, name, memberIds, members } = req.body ?? {};
  if (!selfId || !name?.trim()) {
    res.status(400).json({ error: "selfId and name are required" });
    return;
  }

  const ids = Array.isArray(memberIds) ? [...new Set(memberIds)] : [];
  if (!ids.includes(selfId)) {
    ids.unshift(selfId);
  }
  if (ids.length < 2) {
    res.status(400).json({ error: "Select at least one other member" });
    return;
  }

  const nameMap = new Map(
    Array.isArray(members)
      ? members.map((m) => [m.chatUserId ?? m.id, m.displayName ?? m.username])
      : [],
  );

  try {
    const createRes = await gatewayJson("/chat/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        customType: "demo_group",
        participants: ids.map((id) =>
          participantDto(id, nameMap.get(id) ?? id),
        ),
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      res
        .status(502)
        .json({ error: `Create group failed: ${createRes.status} ${detail}` });
      return;
    }

    const created = await createRes.json();
    res.json({ roomId: created.id });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Ensure group failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`[sample-bff] http://localhost:${PORT}`);
  console.log(`[sample-bff] gateway for browser → ${API_URL}`);
});
