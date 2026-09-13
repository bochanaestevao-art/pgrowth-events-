import crypto from "node:crypto";

const CHECKIN_SECRET = process.env.CHECKIN_SECRET;
const CHECKIN_STAFF_PIN = process.env.CHECKIN_STAFF_PIN;

const COOKIE_NAME = "checkin_session";
const SESSION_MAX_AGE = 60 * 60 * 12; // 12 horas

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(data));
}

function timingSafeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
}

function createSession() {
  const timestamp = Date.now().toString();

  const signature = crypto
    .createHmac("sha256", CHECKIN_SECRET)
    .update(`checkin:${timestamp}`)
    .digest("hex");

  return `${timestamp}.${signature}`;
}

function verifySession(session) {
  if (!CHECKIN_SECRET || !session) {
    return false;
  }

  const parts = String(session).split(".");

  if (parts.length !== 2) {
    return false;
  }

  const timestamp = parts[0];
  const signature = parts[1];

  if (!/^\d+$/.test(timestamp)) {
    return false;
  }

  const age = Date.now() - Number(timestamp);

  if (!Number.isFinite(age) || age < 0 || age > SESSION_MAX_AGE * 1000) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", CHECKIN_SECRET)
    .update(`checkin:${timestamp}`)
    .digest("hex");

  return timingSafeEqual(signature, expected);
}

function getCookie(req, name) {
  const header = req.headers?.cookie || "";

  const cookies = header.split(";");

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = cookie.slice(0, index).trim();
    const value = cookie.slice(index + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function setSessionCookie(res, session) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(
      session
    )}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

export default async function handler(req, res) {
  try {
    if (!CHECKIN_SECRET) {
      return sendJson(res, 500, {
        ok: false,
        error: "CHECKIN_SECRET não configurado no servidor.",
      });
    }

    if (!CHECKIN_STAFF_PIN) {
      return sendJson(res, 500, {
        ok: false,
        error: "CHECKIN_STAFF_PIN não configurado no servidor.",
      });
    }

    const method = String(req.method || "GET").toUpperCase();

    // ============================================================
    // LOGIN
    // O navegador envia apenas CHECKIN_STAFF_PIN.
    // CHECKIN_SECRET nunca é enviado pela página.
    // ============================================================
    if (method === "POST") {
      let body = req.body;

      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }

      const pin = String(body?.pin || "").trim();

      if (!pin || !timingSafeEqual(pin, CHECKIN_STAFF_PIN)) {
        return sendJson(res, 401, {
          ok: false,
          error: "Código de acesso inválido.",
        });
      }

      const session = createSession();

      setSessionCookie(res, session);

      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        expiresIn: SESSION_MAX_AGE,
      });
    }

    // ============================================================
    // VERIFICAR SESSÃO
    // ============================================================
    if (method === "GET") {
      const session = getCookie(req, COOKIE_NAME);

      if (!verifySession(session)) {
        return sendJson(res, 401, {
          ok: false,
          authenticated: false,
        });
      }

      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        expiresIn: SESSION_MAX_AGE,
      });
    }

    // ============================================================
    // LOGOUT
    // ============================================================
    if (method === "DELETE") {
      clearSessionCookie(res);

      return sendJson(res, 200, {
        ok: true,
        authenticated: false,
      });
    }

    res.setHeader("Allow", "GET, POST, DELETE");

    return sendJson(res, 405, {
      ok: false,
      error: "Método não permitido.",
    });
  } catch (error) {
    console.error("checkin-session error:", error);

    return sendJson(res, 500, {
      ok: false,
      error: "Erro interno no sistema de sessão.",
    });
  }
}