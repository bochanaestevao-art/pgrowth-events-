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
  const sessionSecret =
    String(
      process.env.BAR_SESSION_SECRET || ""
    ).trim();

  if (!sessionSecret) {
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
      .createHmac(
        "sha256",
        sessionSecret
      )
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

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  if (items.length === 0) {
    return null;
  }

  const normalized = [];

  const productIds =
    new Set();

  for (const item of items) {
    if (
      !item ||
      typeof item !== "object"
    ) {
      return null;
    }

    const productId =
      String(
        item.product_id ||
        item.productId ||
        ""
      ).trim();

    const quantity =
      Number(item.quantity);

    if (!productId) {
      return null;
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      return null;
    }

    if (productIds.has(productId)) {
      return null;
    }

    productIds.add(productId);

    normalized.push({
      product_id: productId,
      quantity
    });
  }

  return normalized;
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    res.setHeader(
      "Allow",
      "POST"
    );

    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  const supabaseUrl =
    String(
      process.env.SUPABASE_URL || ""
    ).trim();

  const serviceRoleKey =
    String(
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      ""
    ).trim();

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    console.error(
      "BAR SALE: configuração Supabase ausente."
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR"
    });
  }

  let session;

  try {
    session =
      readBarSession(req);
  } catch (error) {
    console.error(
      "BAR SALE SESSION ERROR:",
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
      error: "NOT_AUTHENTICATED"
    });
  }

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

  const eventId =
    String(
      body.event_id ||
      body.eventId ||
      ""
    ).trim();

  const shortCode =
    String(
      body.short_code ||
      body.shortCode ||
      ""
    ).trim()
    .toUpperCase();

  const items =
    normalizeItems(body.items);

  if (!eventId) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  if (!shortCode) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_SHORT_CODE"
    });
  }

  if (!items) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_ITEMS"
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

  const staffId =
    session.staff_id;

  const { data, error } =
    await supabase.rpc(
      "process_bar_sale",
      {
        p_event_id: eventId,
        p_short_code: shortCode,
        p_items: items,
        p_staff_id: staffId
      }
    );

  if (error) {
    console.error(
      "BAR SALE RPC ERROR:",
      error.message
    );

    const message =
      String(
        error.message || ""
      );

    if (
      message.includes(
        "EVENT_CLOSED"
      )
    ) {
      return sendJson(res, 409, {
        success: false,
        error: "EVENT_CLOSED"
      });
    }

    if (
      message.includes(
        "PARTICIPANT_NOT_FOUND"
      )
    ) {
      return sendJson(res, 404, {
        success: false,
        error: "PARTICIPANT_NOT_FOUND"
      });
    }

    if (
      message.includes(
        "WALLET_NOT_FOUND"
      )
    ) {
      return sendJson(res, 404, {
        success: false,
        error: "WALLET_NOT_FOUND"
      });
    }

    if (
      message.includes(
        "PRODUCT_NOT_FOUND"
      )
    ) {
      return sendJson(res, 404, {
        success: false,
        error: "PRODUCT_NOT_FOUND"
      });
    }

    if (
      message.includes(
        "INSUFFICIENT_BALANCE"
      )
    ) {
      return sendJson(res, 409, {
        success: false,
        error: "INSUFFICIENT_BALANCE"
      });
    }

    return sendJson(res, 500, {
      success: false,
      error: "BAR_SALE_FAILED"
    });
  }

  return sendJson(res, 200, {
    success: true,
    staff_id: staffId,
    transaction_id:
      data?.transaction_id || null,
    participant_id:
      data?.participant_id || null,
    wallet_id:
      data?.wallet_id || null,
    total:
      data?.total || 0,
    balance_before:
      data?.balance_before || 0,
    balance_after:
      data?.balance_after || 0
  });
}