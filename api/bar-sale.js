import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const barStaffSecret = process.env.BAR_STAFF_SECRET;

const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

function sendJson(res, status, data) {
  res.status(status).json(data);
}

function getHeader(req, name) {
  const value = req.headers?.[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeShortCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

function parseBody(req) {
  if (!req.body) {
    return null;
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  try {
    return JSON.parse(req.body);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  if (
    !supabaseUrl ||
    !supabaseServiceRoleKey ||
    !barStaffSecret
  ) {
    console.error(
      "BAR API: variáveis de ambiente ausentes."
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR"
    });
  }

  const receivedSecret =
    getHeader(req, "x-bar-secret");

  if (
    !receivedSecret ||
    receivedSecret !== barStaffSecret
  ) {
    return sendJson(res, 401, {
      success: false,
      error: "UNAUTHORIZED"
    });
  }

  const body = parseBody(req);

  if (!body) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON"
    });
  }

  const eventId = String(
    body.event_id || ""
  ).trim();

  const shortCode = normalizeShortCode(
    body.short_code
  );

  const staffId = String(
    body.staff_id || ""
  ).trim();

  const items = body.items;

  if (!isValidUuid(eventId)) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_ID"
    });
  }

  if (
    !shortCode ||
    shortCode.length < 4 ||
    shortCode.length > 20
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_SHORT_CODE"
    });
  }

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
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_ITEMS"
    });
  }

  if (items.length > 50) {
    return sendJson(res, 400, {
      success: false,
      error: "TOO_MANY_ITEMS"
    });
  }

  const normalizedItems = [];

  for (const item of items) {

    if (!item || typeof item !== "object") {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_ITEM"
      });
    }

    const productId = String(
      item.product_id || ""
    ).trim();

    const quantityNumber = Number(
      item.quantity
    );

    if (!isValidUuid(productId)) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_PRODUCT_ID"
      });
    }

    if (
      !Number.isInteger(quantityNumber) ||
      quantityNumber <= 0 ||
      quantityNumber > 100
    ) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_QUANTITY"
      });
    }

    normalizedItems.push({
      product_id: productId,
      quantity: quantityNumber
    });
  }

  const seenProducts = new Set();

  for (const item of normalizedItems) {

    if (seenProducts.has(item.product_id)) {
      return sendJson(res, 400, {
        success: false,
        error: "DUPLICATE_PRODUCT"
      });
    }

    seenProducts.add(item.product_id);
  }

  try {

    const { data, error } = await supabase.rpc(
      "process_bar_sale",
      {
        p_event_id: eventId,
        p_short_code: shortCode,
        p_items: normalizedItems,
        p_staff_id: staffId
      }
    );

    if (error) {

      console.error(
        "BAR SALE RPC ERROR:",
        error
      );

      const message =
        String(error.message || "").toUpperCase();

      if (
        message.includes("EVENT_CLOSED")
      ) {
        return sendJson(res, 409, {
          success: false,
          error: "EVENT_CLOSED",
          message: "O evento está fechado."
        });
      }

      if (
        message.includes("PARTICIPANT_NOT_FOUND")
      ) {
        return sendJson(res, 404, {
          success: false,
          error: "PARTICIPANT_NOT_FOUND",
          message: "Participante não encontrado."
        });
      }

      if (
        message.includes("WALLET_NOT_FOUND")
      ) {
        return sendJson(res, 404, {
          success: false,
          error: "WALLET_NOT_FOUND",
          message: "Carteira ativa não encontrada."
        });
      }

      if (
        message.includes("PRODUCT_NOT_FOUND")
      ) {
        return sendJson(res, 404, {
          success: false,
          error: "PRODUCT_NOT_FOUND",
          message:
            "Um dos produtos não está disponível."
        });
      }

      if (
        message.includes("INSUFFICIENT_BALANCE")
      ) {

        let available = null;
        let requested = null;

        const match =
          String(error.message || "").match(
            /INSUFFICIENT_BALANCE:([^,]+),([^,\s]+)/
          );

        if (match) {
          available = Number(match[1]);
          requested = Number(match[2]);
        }

        return sendJson(res, 409, {
          success: false,
          error: "INSUFFICIENT_BALANCE",
          message:
            "Saldo insuficiente para concluir a compra.",
          balance: available,
          requested: requested
        });
      }

      return sendJson(res, 500, {
        success: false,
        error: "BAR_SALE_FAILED"
      });
    }

    if (
      !data ||
      data.success !== true
    ) {
      console.error(
        "BAR SALE INVALID RPC RESPONSE:",
        data
      );

      return sendJson(res, 500, {
        success: false,
        error: "INVALID_TRANSACTION_RESULT"
      });
    }

    return sendJson(res, 200, {
      success: true,
      transaction_id: data.transaction_id,
      participant_id: data.participant_id,
      wallet_id: data.wallet_id,
      total: data.total,
      balance_before: data.balance_before,
      balance_after: data.balance_after
    });

  } catch (error) {

    console.error(
      "BAR SALE UNEXPECTED ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,
      error: "INTERNAL_SERVER_ERROR"
    });
  }
}
