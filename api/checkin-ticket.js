// api/checkin-ticket.js

import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function sendJson(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");

  return res.end(JSON.stringify(data));
}

function getSecret(req) {
  return (
    req.headers["x-checkin-secret"] ||
    req.headers["X-Checkin-Secret"] ||
    ""
  );
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));

  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function supabaseRequest(path, options = {}) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Credenciais do Supabase não configuradas."
    );
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  const text = await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const error = new Error(
      "Erro ao comunicar com o Supabase."
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 405, {
        success: false,
        result: "METHOD_NOT_ALLOWED",
        message: "Método não permitido.",
      });
    }

    const expectedSecret =
      process.env.CHECKIN_SECRET;

    if (!expectedSecret) {
      console.error(
        "CHECKIN_SECRET não configurado."
      );

      return sendJson(res, 500, {
        success: false,
        result: "SERVER_CONFIG_ERROR",
        message:
          "Serviço de check-in não configurado.",
      });
    }

    const providedSecret = getSecret(req);

    if (
      !providedSecret ||
      !safeEqual(
        providedSecret,
        expectedSecret
      )
    ) {
      return sendJson(res, 401, {
        success: false,
        result: "UNAUTHORIZED",
        message: "Acesso não autorizado.",
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const ticketCode = String(
      body.ticketCode ||
        body.ticket_code ||
        body.code ||
        ""
    ).trim();

    const action = String(
      body.action ||
        body.type ||
        "ENTRY"
    )
      .trim()
      .toUpperCase();

    if (!ticketCode) {
      return sendJson(res, 400, {
        success: false,
        result: "INVALID_REQUEST",
        message:
          "Código do bilhete não informado.",
      });
    }

    if (
      action !== "ENTRY" &&
      action !== "EXIT"
    ) {
      return sendJson(res, 400, {
        success: false,
        result: "INVALID_ACTION",
        message:
          "A ação deve ser ENTRY ou EXIT.",
      });
    }

    const rpcName =
      action === "ENTRY"
        ? "blackout_register_entry"
        : "blackout_register_exit";

    const rpcResult =
      await supabaseRequest(
        `rpc/${rpcName}`,
        {
          method: "POST",
          body: JSON.stringify({
            p_ticket_code: ticketCode,
          }),
        }
      );

    const result =
      Array.isArray(rpcResult)
        ? rpcResult[0]
        : rpcResult;

    if (!result) {
      return sendJson(res, 500, {
        success: false,
        result: "EMPTY_RESULT",
        message:
          "O servidor não retornou resultado.",
      });
    }

    const httpStatus =
      result.success
    ? 200
    : result.result === "ALREADY_INSIDE"
      ? 409
      : 400;

    return sendJson(res, httpStatus, {
      success: Boolean(result.success),
      result: result.result,
      message: result.message,
      ticket: {
        ticketCode:
          result.ticket_code,
        fullName:
          result.full_name,
        ticketType:
          result.ticket_type,
        ticketLot:
          result.ticket_lot,
        quantity:
          result.quantity,
        ticketStatus:
          result.ticket_status,
        presenceStatus:
          result.presence_status,
      },
    });
  } catch (error) {
    console.error(
      "CHECKIN ERROR:",
      error
    );

    return sendJson(res, 500, {
      success: false,
      result: "SERVER_ERROR",
      message:
        "Erro interno ao processar o check-in.",
    });
  }
}