import crypto from "node:crypto";

const COOKIE_NAME = "bar_session";
const SESSION_MAX_AGE = 12 * 60 * 60;

function sendJson(res, status, data) {
  res.status(status).json(data);
}

function timingSafeEqualString(a, b) {
  const aBuffer = Buffer.from(String(a || ""));
  const bBuffer = Buffer.from(String(b || ""));

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function getHeader(req, name) {
  const value = req.headers?.[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function createSignature(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

function createSession(staffId, secret) {
  const now = Math.floor(Date.now() / 1000);

  const payload = JSON.stringify({
    staff_id: staffId,
    iat: now,
    exp: now + SESSION_MAX_AGE
  });

  const encodedPayload = Buffer
    .from(payload, "utf8")
    .toString("base64url");

  const signature = createSignature(
    encodedPayload,
    secret
  );

  return `${encodedPayload}.${signature}`;
}

function parseCookies(req) {
  const header = getHeader(req, "cookie");

  if (!header) {
    return {};
  }

  const cookies = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function readSession(req, secret) {
  const cookies = parseCookies(req);
  const session = cookies[COOKIE_NAME];

  if (!session) {
    return null;
  }

  const separator = session.lastIndexOf(".");

  if (separator <= 0) {
    return null;
  }

  const encodedPayload = session.slice(0, separator);
  const receivedSignature = session.slice(separator + 1);

  const expectedSignature = createSignature(
    encodedPayload,
    secret
  );

  if (
    !timingSafeEqualString(
      receivedSignature,
      expectedSignature
    )
  ) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer
        .from(encodedPayload, "base64url")
        .toString("utf8")
    );
  } catch {
    return null;
  }

  if (
    !payload ||
    !payload.staff_id ||
    !payload.exp
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (payload.exp <= now) {
    return null;
  }

  return payload;
}

function setSessionCookie(res, session) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(session)}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`
  );
}

export default async function handler(req, res) {
  const sessionSecret =
    String(
      process.env.BAR_SESSION_SECRET || ""
    ).trim();

  if (!sessionSecret) {
    console.error(
      "BAR SESSION: BAR_SESSION_SECRET ausente."
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR"
    });
  }

  if (req.method === "POST") {
    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return sendJson(res, 400, {
          success: false,
          error: "INVALID_JSON"
        });
      }
    }

    if (
      !body ||
      typeof body !== "object"
    ) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_JSON"
      });
    }

    const staffId =
      String(body.staff_id || "").trim();

    const staffPin =
      String(body.staff_pin || "").trim();

    const expectedPin =
      String(
        process.env.BAR_STAFF_PIN || ""
      ).trim();

    if (
      !staffId ||
      staffId.length > 100
    ) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_STAFF_ID"
      });
    }

    if (
      !staffPin ||
      !expectedPin ||
      !timingSafeEqualString(
        staffPin,
        expectedPin
      )
    ) {
      return sendJson(res, 401, {
        success: false,
        error: "INVALID_CREDENTIALS"
      });
    }

    const session =
      createSession(
        staffId,
        sessionSecret
      );

    setSessionCookie(
      res,
      session
    );

    return sendJson(res, 200, {
      success: true,
      staff_id: staffId,
      expires_in: SESSION_MAX_AGE
    });
  }

  if (req.method === "GET") {
    const session =
      readSession(
        req,
        sessionSecret
      );

    if (!session) {
      return sendJson(res, 401, {
        success: false,
        authenticated: false,
        error: "NOT_AUTHENTICATED"
      });
    }

    return sendJson(res, 200, {
      success: true,
      authenticated: true,
      staff_id: session.staff_id,
      expires_at: session.exp
    });
  }

  if (req.method === "DELETE") {
    clearSessionCookie(res);

    return sendJson(res, 200, {
      success: true
    });
  }

  res.setHeader(
    "Allow",
    "GET, POST, DELETE"
  );

  return sendJson(res, 405, {
    success: false,
    error: "METHOD_NOT_ALLOWED"
  });
}