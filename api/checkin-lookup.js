"use strict";

const crypto = require("crypto");

function getSecret() {
  return String(process.env.CHECKIN_SECRET || "").trim();
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));

  if (aa.length !== bb.length) return false;

  return crypto.timingSafeEqual(aa, bb);
}

function getCookie(req, name) {
  const header = req.headers && req.headers.cookie;

  if (!header) return "";

  for (const item of header.split(";")) {
    const index = item.indexOf("=");

    if (index === -1) continue;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return "";
}

function verifySession(token, secret) {
  if (!token || !secret) return false;

  const parts = String(token).split(".");

  if (parts.length !== 2) return false;

  const timestamp = parts[0];
  const signature = parts[1];

  if (!/^\d+$/.test(timestamp)) return false;

  const age = Date.now() - Number(timestamp);

  if (age < 0 || age > 12 * 60 * 60 * 1000) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update("CHECKIN_SESSION:" + timestamp)
    .digest("hex");

  return safeEqual(signature, expected);
}

function isAuthenticated(req) {
  const secret = getSecret();

  const token = getCookie(req, "checkin_session");

  return verifySession(token, secret);
}

function getSupabaseConfig() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  return {
    url: String(url).replace(/\/+$/, ""),
    key: String(key)
  };
}

async function supabaseRequest(path, options = {}) {
  const { url, key } = getSupabaseConfig();

  if (!url || !key) {
    throw new Error("Configuração do Supabase não encontrada.");
  }

  const response = await fetch(url + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const detail =
      data &&
      typeof data === "object" &&
      (data.message || data.error || data.hint);

    throw new Error(
      detail || "Erro ao consultar o Supabase."
    );
  }

  return data;
}

function cleanCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      success: false,
      message: "Método não permitido."
    });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({
      success: false,
      result: "UNAUTHORIZED",
      message: "Sessão de check-in não autorizada."
    });
  }

  const code = cleanCode(
    req.query &&
      (req.query.code ||
        req.query.ticketCode ||
        req.query.ticket_code)
  );

  if (!code) {
    return res.status(400).json({
      success: false,
      result: "MISSING_CODE",
      message: "Código do bilhete não informado."
    });
  }

  try {
    const encodedCode = encodeURIComponent(code);

    const tickets = await supabaseRequest(
      "blackout_order_tickets?select=id,order_reference,ticket_code,ticket_number,ticket_type,ticket_lot,ticket_price,ticket_status,presence_status,created_at&ticket_code=eq." +
        encodedCode +
        "&limit=1"
    );

    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(404).json({
        success: false,
        result: "TICKET_NOT_FOUND",
        message: "Bilhete não encontrado."
      });
    }

    const ticket = tickets[0];

    const orderReference = String(ticket.order_reference || "");

    if (!orderReference) {
      return res.status(409).json({
        success: false,
        result: "ORDER_NOT_FOUND",
        message: "O bilhete não possui pedido associado."
      });
    }

    const orders = await supabaseRequest(
      "blackout_orders?select=order_reference,full_name,payment_status,quantity&order_reference=eq." +
        encodeURIComponent(orderReference) +
        "&limit=1"
    );

    const order =
      Array.isArray(orders) && orders.length
        ? orders[0]
        : null;

    if (!order) {
      return res.status(404).json({
        success: false,
        result: "ORDER_NOT_FOUND",
        message: "Pedido associado ao bilhete não encontrado."
      });
    }

    const paymentStatus =
      String(order.payment_status || "").toUpperCase();

    const ticketStatus =
      String(ticket.ticket_status || "").toUpperCase();

    const presenceStatus =
      String(ticket.presence_status || "").toUpperCase();

    let validity = "VALID";

    if (paymentStatus !== "PAID") {
      validity = "PAYMENT_NOT_CONFIRMED";
    } else if (ticketStatus === "CANCELLED") {
      validity = "CANCELLED";
    }

    let recommendedAction = null;

    if (validity === "VALID") {
      if (presenceStatus === "INSIDE") {
        recommendedAction = "EXIT";
      } else {
        recommendedAction = "ENTRY";
      }
    }

    return res.status(200).json({
      success: true,
      result: "TICKET_FOUND",
      validity,
      recommendedAction,
      ticket: {
        ticketCode: ticket.ticket_code,
        ticketNumber: Number(ticket.ticket_number || 0),
        fullName: order.full_name || "",
        ticketType: ticket.ticket_type || "",
        ticketLot: ticket.ticket_lot || "",
        ticketPrice: Number(ticket.ticket_price || 0),
        quantity: Number(order.quantity || 1),
        paymentStatus,
        ticketStatus,
        presenceStatus
      }
    });
  } catch (error) {
    console.error("CHECKIN LOOKUP ERROR:", error);

    return res.status(500).json({
      success: false,
      result: "SERVER_ERROR",
      message: "Erro interno ao consultar o bilhete."
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};