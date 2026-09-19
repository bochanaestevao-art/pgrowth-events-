import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const COOKIE_NAME = "bar_session";

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function getHeader(req, name) {
  const value = req.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value || "";
}

function timingSafeEqualString(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");

  if (aa.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(aa, bb);
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

    const key = part
      .slice(0, index)
      .trim();

    const value = part
      .slice(index + 1)
      .trim();

    if (!key) {
      continue;
    }

    try {
      cookies[key] =
        decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function readBarSession(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];

  if (!raw) {
    return null;
  }

  const separator = raw.lastIndexOf(".");

  if (separator <= 0) {
    return null;
  }

  const payload = raw.slice(0, separator);
  const receivedSignature =
    raw.slice(separator + 1);

  const secret =
    process.env.BAR_SESSION_SECRET;

  if (!secret) {
    return null;
  }

  const expectedSignature =
    crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

  if (
    !timingSafeEqualString(
      receivedSignature,
      expectedSignature
    )
  ) {
    return null;
  }

  let data;

  try {
    data = JSON.parse(
      Buffer
        .from(payload, "base64url")
        .toString("utf8")
    );
  } catch {
    return null;
  }

  if (!data || typeof data !== "object") {
  if (!data.exp) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (Number(data.exp) <= now) {
    return null;
  }
  }

  return data;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function normalizeItems(items) {
  if (!Array.isArray(items)) {
    return null;
  }

  if (items.length < 1) {
    return null;
  }

  if (items.length > 100) {
    return null;
  }

  const normalized = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return null;
    }

    const productId =
      String(item.product_id || "").trim();

    const quantity =
      Number(item.quantity);

    if (!isUuid(productId)) {
      return null;
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    ) {
      return null;
    }

    normalized.push({
      product_id: productId,
      quantity
    });
  }

  return normalized;
}

async function handleGet(req, res) {
  const session =
    readBarSession(req);

  if (!session) {
    return sendJson(res, 401, {
      success: false,
      error: "UNAUTHORIZED"
    });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    console.error(
      "BAR DATA: missing Supabase environment variables"
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIG_ERROR"
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

  const url =
    new URL(
      req.url || "/api/bar-sale",
      "https://localhost"
    );

  const eventId =
    String(
      url.searchParams.get("event_id") || ""
    ).trim();

  const shortCode =
    String(
      url.searchParams.get("short_code") || ""
    ).trim()
    .toUpperCase();

  if (!isUuid(eventId)) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  const {
    data: event,
    error: eventError
  } = await supabase
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
      error: "EVENT_CLOSED"
    });
  }

  const {
    data: products,
    error: productsError
  } = await supabase
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
    const {
      data: participantRow,
      error: participantError
    } = await supabase
      .from("event_participants")
      .select(
        "id,full_name,phone,short_code,status"
      )
      .eq("event_id", eventId)
      .eq("short_code", shortCode)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (participantError) {
      console.error(
        "BAR DATA PARTICIPANT ERROR:",
        participantError.message
      );

      return sendJson(res, 500, {
        success: false,
        error: "PARTICIPANT_LOOKUP_FAILED"
      });
    }

    if (!participantRow) {
      return sendJson(res, 404, {
        success: false,
        error: "PARTICIPANT_NOT_FOUND"
      });
    }

    const {
      data: wallet,
      error: walletError
    } = await supabase
      .from("wallet_accounts")
      .select(
        "id,balance,status"
      )
      .eq("event_id", eventId)
      .eq(
        "participant_id",
        participantRow.id
      )
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

    if (!wallet) {
      return sendJson(res, 404, {
        success: false,
        error: "WALLET_NOT_FOUND"
      });
    }

    participant = {
      id: participantRow.id,
      full_name:
        participantRow.full_name,
      phone:
        participantRow.phone,
      short_code:
        participantRow.short_code,
      wallet_id:
        wallet.id,
      balance:
        Number(wallet.balance || 0),
      wallet_status:
        wallet.status
    };
  }

  return sendJson(res, 200, {
    success: true,
    staff_id:
      session.staff_id,
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      currency: event.currency
    },
    participant,
    products:
      (products || []).map(
        product => ({
          id: product.id,
          name: product.name,
          category:
            product.category,
          price:
            Number(product.price || 0),
          status:
            product.status
        })
      )
  });
}

async function handlePost(req, res) {
  const session =
    readBarSession(req);

  if (!session) {
    return sendJson(res, 401, {
      success: false,
      error: "UNAUTHORIZED"
    });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL;

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    console.error(
      "BAR SALE: missing Supabase environment variables"
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIG_ERROR"
    });
  }

  let body;

  try {
    if (
      req.body &&
      typeof req.body === "object"
    ) {
      body = req.body;
    } else {
      const chunks = [];

      for await (const chunk of req) {
        chunks.push(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk)
        );
      }

      const raw =
        Buffer
          .concat(chunks)
          .toString("utf8");

      body = raw
        ? JSON.parse(raw)
        : null;
    }
  } catch (error) {
    console.error(
      "BAR SALE BODY ERROR:",
      error.message
    );

    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON"
    });
  }

  if (
    !body ||
    typeof body !== "object"
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_BODY"
    });
  }

      const operation =
      String(
        body.operation || "SALE"
      ).trim().toUpperCase();

    if (
      operation !== "SALE" &&
      operation !== "TOPUP"
    ) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_OPERATION"
      });
    }

const eventId =
    String(
      body.event_id || ""
    ).trim();

  const shortCode =
    String(
      body.short_code || ""
    ).trim()
    .toUpperCase();

  const items =
    operation === "TOPUP"
      ? []
      : normalizeItems(body.items);

  if (!isUuid(eventId)) {
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

  if (operation !== "TOPUP" && !items) {
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

  if (operation === "TOPUP") {
    const amount = Number(body.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_TOPUP_AMOUNT"
      });
    }

    const {
      data,
      error
    } = await supabase.rpc(
      "process_wallet_topup",
      {
        p_event_id: eventId,
        p_short_code: shortCode,
        p_amount: amount,
        p_payment_reference:
          body.payment_reference || null,
        p_staff_id: staffId,
        p_description:
          body.description || null,
        p_payment_id:
          body.payment_id || null,
        p_payment_method:
          body.payment_method || "CASH"
      }
    );

    if (error) {
      const message =
        String(error.message || "").toLowerCase();

      if (message.includes("event")) {
        return sendJson(res, 400, {
          success: false,
          error: "EVENT_CLOSED"
        });
      }

      if (
        message.includes("participant") ||
        message.includes("short code")
      ) {
        return sendJson(res, 404, {
          success: false,
          error: "PARTICIPANT_NOT_FOUND"
        });
      }

      if (message.includes("wallet")) {
        return sendJson(res, 404, {
          success: false,
          error: "WALLET_NOT_FOUND"
        });
      }

      if (
        message.includes("minimum") ||
        message.includes("maximum") ||
        message.includes("topup")
      ) {
        return sendJson(res, 400, {
          success: false,
          error: "TOPUP_NOT_ALLOWED"
        });
      }

      return sendJson(res, 500, {
        success: false,
        error: "TOPUP_FAILED",
        detail: error.message
      });
    }

    return sendJson(res, 200, {
      success: true,
      operation: "TOPUP",
      ...data
    });
  }

  const {
    data,
    error
  } = await supabase.rpc(
    "process_bar_sale",
    {
      p_event_id:
        eventId,
      p_short_code:
        shortCode,
      p_items:
        items,
      p_staff_id:
        staffId
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
    staff_id:
      staffId,
    transaction_id:
      data?.transaction_id || null,
    participant_id:
      data?.participant_id || null,
    wallet_id:
      data?.wallet_id || null,
    total:
      Number(data?.total || 0),
    balance_before:
      Number(data?.balance_before || 0),
    balance_after:
      Number(data?.balance_after || 0)
  });
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return handleGet(req, res);
  }

  if (req.method === "POST") {
    return handlePost(req, res);
  }

  res.setHeader(
    "Allow",
    "GET, POST"
  );

  return sendJson(res, 405, {
    success: false,
    error: "METHOD_NOT_ALLOWED"
  });
}
