const SUPABASE_URL = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).origin
  : "";

const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_ORIGINS = new Set([
  "https://pgrowth-events.vercel.app"
]);

function send(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

function applyCors(req, res) {
  const origin = req.headers.origin || "";

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function authenticate(req) {
  const authorization = req.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new Error("Inicie sessão para sincronizar as actividades.");
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${match[1]}`
    }
  });

  if (!response.ok) {
    throw new Error("Sessão inválida ou expirada.");
  }

  const user = await response.json();

  if (!user?.id) {
    throw new Error("Utilizador não autenticado.");
  }

  return user;
}

function validateActivity(item) {
  if (!item || typeof item !== "object") {
    throw new Error("Registo de actividade inválido.");
  }

  const id = String(item.id || "");

  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
    throw new Error("Identificador de corrida inválido.");
  }

  const distance = Number(item.distanceKm);
  const durationMs = Number(item.durationMs);
  const date = new Date(item.date);

  if (!Number.isFinite(distance) || distance <= 0 || distance > 500) {
    throw new Error("Distância da corrida inválida.");
  }

  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 86400000) {
    throw new Error("Duração da corrida inválida.");
  }

  if (!item.date || !Number.isFinite(date.getTime())) {
    throw new Error("Data da corrida inválida.");
  }

  const route = Array.isArray(item.route) ? item.route : [];

  if (route.length > 10000) {
    throw new Error("O percurso excede o limite permitido.");
  }

  const safeRoute = route.map(point => {
    if (!Array.isArray(point) || point.length < 2) {
      throw new Error("Ponto GPS inválido.");
    }

    const lat = Number(point[0]);
    const lng = Number(point[1]);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 || lat > 90 ||
      lng < -180 || lng > 180
    ) {
      throw new Error("Coordenadas GPS inválidas.");
    }

    return [lat, lng];
  });

  return {
    user_id: null,
    client_activity_id: id,
    activity_type: "RUN",
    distance_km: Number(distance.toFixed(3)),
    duration_ms: Math.round(durationMs),
    duration_seconds: Math.round(durationMs / 1000),
    pace: String(item.pace || "").slice(0, 30),
    activity_date: date.toISOString(),
    timezone: String(item.timezone || "Africa/Maputo").slice(0, 64),
    route: safeRoute
  };
}

export default async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, { error: "Método não permitido." });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY) {
    return send(res, 500, { error: "Configuração da API indisponível." });
  }

  try {
    const user = await authenticate(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const activities = body.activities;

    if (!Array.isArray(activities) || activities.length < 1 || activities.length > 25) {
      return send(res, 400, {
        error: "Envie entre 1 e 25 actividades por sincronização."
      });
    }

    const rows = activities.map(item => {
      const row = validateActivity(item);
      row.user_id = user.id;
      return row;
    });

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/fitness_athlete_activities?on_conflict=user_id,client_activity_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal"
        },
        body: JSON.stringify(rows)
      }
    );

    if (!response.ok) {
      const raw = await response.text();
      let detail = {};

      try {
        detail = raw ? JSON.parse(raw) : {};
      } catch {}

      throw new Error(
        detail.message || detail.hint || `Erro Supabase HTTP ${response.status}`
      );
    }

    return send(res, 200, {
      success: true,
      receivedCount: rows.length,
      syncedClientActivityIds: rows.map(row => row.client_activity_id)
    });

  } catch (error) {
    const message = error?.message || "Erro interno.";
    const status = /sessão|autenticado|expirada/i.test(message) ? 401 : 500;

    return send(res, status, { error: message });
  }
}
