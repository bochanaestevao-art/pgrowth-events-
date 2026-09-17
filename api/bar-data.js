import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const COOKIE_NAME = "bar_session";

function sendJson(res, status, data) {
  return res.status(status).json(data);
}

function getHeader(req, name) {
  const value = req.headers?.[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function timingSafeEqualString(a, b) {
  const aBuffer = Buffer.from(String(a || ""));
  const bBuffer = Buffer.from(String(b || ""));

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
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

function readBarSession(req) {
  const secret =
    String(
      process.env.BAR_SESSION_SECRET || ""
    ).trim();

  if (!secret) {
    throw new Error(
      "BAR_SESSION_SECRET_MISSING"
    );
  }

  const cookies = parseCookies(req);
  const session = cookies[COOKIE_NAME];

  if (!session) {
    return null;
  }

  const separator = session.lastIndexOf(".");

  if (separator <= 0) {
    return null;
  }

  const encodedPayload =
    session.slice(0, separator);

  const receivedSignature =
    session.slice(separator + 1);

  const expectedSignature =
    crypto
      .createHmac("sha256", secret)
      .update(encodedPayload)
      .digest("hex");

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
        .from(
          encodedPayload,
          "base64url"
        )
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

  const now =
    Math.floor(Date.now() / 1000);

  if (payload.exp <= now) {
    return null;
  }

  return payload;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  let session;

  try {
    session = readBarSession(req);
  } catch (error) {
    console.error(
      "BAR DATA SESSION ERROR:",
      error.message
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR"
    });
  }

  if (!session) {
    return sendJson(res, 401, {
      success: false,
      authenticated: false,
      error: "NOT_AUTHENTICATED"
    });
  }

  const supabaseUrl =
    String(
      process.env.SUPABASE_URL || ""
    ).trim();

  const serviceRoleKey =
    String(
      process.env.SUPABASE_SERVICE_ROLE_KEY || ""
    ).trim();

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR"
    });
  }

  const eventId =
    String(
      req.query?.event_id ||
      req.query?.eventId ||
      ""
    ).trim();

  const shortCode =
    String(
      req.query?.short_code ||
      req.query?.shortCode ||
      ""
    ).trim()
    .toUpperCase();

  if (!isUuid(eventId)) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  const supabase =
    createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

  const { data: event, error: eventError } =
    await supabase
      .from("events")
      .select(
        "id,name,status,currency"
      )
      .eq("id", eventId)
      .maybeSingle();

  if (eventError) {
    console.error(
      "BAR DATA EVENT ERROR:",
      eventError.message
    );

    return sendJson(res, 500, {
      success: false,
      error: "EVENT_LOOKUP_FAILED"
    });
  }

  if (!event) {
    return sendJson(res, 404, {
      success: false,
      error: "EVENT_NOT_FOUND"
    });
  }

  if (event.status !== "OPEN") {
    return sendJson(res, 409, {
      success: false,
      error: "EVENT_CLOSED",
      event: {
        id: event.id,
        name: event.name,
        status: event.status,
        currency: event.currency
      }
    });
  }

  const { data: products, error: productsError } =
    await supabase
      .from("bar_products")
      .select(
        "id,name,category,price,status"
      )
      .eq("event_id", eventId)
      .eq("status", "ACTIVE")
      .order("category", {
        ascending: true
      })
      .order("name", {
        ascending: true
      });

  if (productsError) {
    console.error(
      "BAR DATA PRODUCTS ERROR:",
      productsError.message
    );

    return sendJson(res, 500, {
      success: false,
      error: "PRODUCT_LOOKUP_FAILED"
    });
  }

  let participant = null;

  if (shortCode) {
    const { data, error } =
      await supabase
        .from("event_participants")
        .select(
          "id,full_name,phone,short_code,status"
        )
        .eq("event_id", eventId)
        .eq("short_code", shortCode)
        .eq("status", "ACTIVE")
        .maybeSingle();

    if (error) {
      console.error(
        "BAR DATA PARTICIPANT ERROR:",
        error.message
      );

      return sendJson(res, 500, {
        success: false,
        error: "PARTICIPANT_LOOKUP_FAILED"
      });
    }

    if (data) {
      const { data: wallet, error: walletError } =
        await supabase
          .from("wallet_accounts")
          .select(
            "id,balance,status"
          )
          .eq("event_id", eventId)
          .eq("participant_id", data.id)
          .maybeSingle();

      if (walletError) {
        console.error(
          "BAR DATA WALLET ERROR:",
          walletError.message
        );

        return sendJson(res, 500, {
          success: false,
          error: "WALLET_LOOKUP_FAILED"
        });
      }

      participant = {
        id: data.id,
        full_name: data.full_name,
        phone: data.phone,
        short_code: data.short_code,
        wallet_id: wallet?.id || null,
        balance: Number(
          wallet?.balance || 0
        ),
        wallet_status:
          wallet?.status || null
      };
    }
  }

  return sendJson(res, 200, {
    success: true,
    staff_id: session.staff_id,
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      currency: event.currency || "MZN"
    },
    participant,
    products: products || []
  });
}