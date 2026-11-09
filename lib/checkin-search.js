import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const CHECKIN_SECRET = process.env.CHECKIN_SECRET;

const COOKIE_NAME = "checkin_session";
const SESSION_MAX_AGE = 60 * 60 * 12;

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
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return null;
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

  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > SESSION_MAX_AGE * 1000
  ) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", CHECKIN_SECRET)
    .update(`checkin:${timestamp}`)
    .digest("hex");

  return timingSafeEqual(signature, expected);
}

function isAuthenticated(req) {
  const session = getCookie(req, COOKIE_NAME);

  return verifySession(session);
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeIlike(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

async function supabaseFetch(path, options = {}) {
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

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return {
    response,
    data,
  };
}

export default async function handler(req, res) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return sendJson(res, 500, {
        ok: false,
        error:
          "Configuração do Supabase não encontrada no servidor.",
      });
    }

    if (!CHECKIN_SECRET) {
      return sendJson(res, 500, {
        ok: false,
        error:
          "CHECKIN_SECRET não configurado no servidor.",
      });
    }

    if (!isAuthenticated(req)) {
      return sendJson(res, 401, {
        ok: false,
        authenticated: false,
        error: "Sessão não autenticada.",
      });
    }

    const method = String(req.method || "GET")
      .toUpperCase();

    if (method !== "GET" && method !== "POST") {
      res.setHeader("Allow", "GET, POST");

      return sendJson(res, 405, {
        ok: false,
        error: "Método não permitido.",
      });
    }

    let search = "";

    if (method === "GET") {
      search = normalizeSearch(
        req.query?.search ||
        req.query?.q ||
        ""
      );
    } else {
      let body = req.body;

      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }

      search = normalizeSearch(
        body?.search ||
        body?.q ||
        ""
      );
    }

    if (!search) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "Introduza o nome ou telefone do comprador.",
      });
    }

    if (search.length < 3) {
      return sendJson(res, 400, {
        ok: false,
        error:
          "Introduza pelo menos 3 caracteres.",
      });
    }

    if (search.length > 100) {
      return sendJson(res, 400, {
        ok: false,
        error: "Pesquisa demasiado longa.",
      });
    }

    const safeSearch = escapeIlike(search);

    /*
     * ============================================================
     * 1. PESQUISAR COMPRADORES
     *
     * Nome: pesquisa parcial.
     * Telefone: pesquisa parcial.
     *
     * payment_status = PAID:
     * só mostramos compras efetivamente pagas.
     * ============================================================
     */

    const orFilter =
      `(full_name.ilike.*${safeSearch}*,phone.ilike.*${safeSearch}*)`;

    const ordersPath =
      `blackout_orders?select=` +
      [
        "order_reference",
        "full_name",
        "phone",
        "bairro",
        "ticket_type",
        "ticket_lot",
        "ticket_price",
        "quantity",
        "total_amount",
        "payment_method",
        "payment_status",
        "ticket_code",
        "ticket_status",
        "presence_status",
        "created_at",
        "paid_at",
      ].join(",") +
      `&payment_status=eq.PAID` +
      `&or=${encodeURIComponent(orFilter)}` +
      `&order=created_at.desc` +
      `&limit=20`;

    const {
      response: ordersResponse,
      data: ordersData,
    } = await supabaseFetch(ordersPath);

    if (!ordersResponse.ok) {
      console.error(
        "checkin-search orders error:",
        ordersData
      );

      return sendJson(res, 500, {
        ok: false,
        error:
          "Não foi possível pesquisar os compradores.",
      });
    }

    const orders = Array.isArray(ordersData)
      ? ordersData
      : [];

    if (orders.length === 0) {
      return sendJson(res, 200, {
        ok: true,
        count: 0,
        results: [],
        message:
          "Nenhum comprador pago foi encontrado.",
      });
    }

    /*
     * ============================================================
     * 2. BUSCAR OS BILHETES INDIVIDUAIS
     *
     * A compra pode ter vários tickets.
     * Cada ticket possui o seu próprio estado.
     * ============================================================
     */

    const references = [
      ...new Set(
        orders
          .map(order =>
            String(order.order_reference || "").trim()
          )
          .filter(Boolean)
      ),
    ];

    const ticketsByOrder = new Map();

    if (references.length > 0) {
      const orderFilter =
        `(${references.map(ref =>
          `"${String(ref).replace(/"/g, '\\"')}"`
        ).join(",")})`;

      const ticketsPath =
        `blackout_order_tickets?select=` +
        [
          "id",
          "order_reference",
          "ticket_code",
          "ticket_number",
          "ticket_type",
          "ticket_lot",
          "ticket_price",
          "ticket_status",
          "presence_status",
          "created_at",
        ].join(",") +
        `&order_reference=in.${encodeURIComponent(
          orderFilter
        )}` +
        `&order=ticket_number.asc`;

      const {
        response: ticketsResponse,
        data: ticketsData,
      } = await supabaseFetch(ticketsPath);

      if (!ticketsResponse.ok) {
        console.error(
          "checkin-search tickets error:",
          ticketsData
        );

        return sendJson(res, 500, {
          ok: false,
          error:
            "Não foi possível carregar os bilhetes.",
        });
      }

      const tickets = Array.isArray(ticketsData)
        ? ticketsData
        : [];

      for (const ticket of tickets) {
        const ref = String(
          ticket.order_reference || ""
        ).trim();

        if (!ticketsByOrder.has(ref)) {
          ticketsByOrder.set(ref, []);
        }

        ticketsByOrder
          .get(ref)
          .push(ticket);
      }
    }

    /*
     * ============================================================
     * 3. MONTAR RESULTADO FINAL
     * ============================================================
     */

    const results = orders.map(order => {
      const orderReference = String(
        order.order_reference || ""
      ).trim();

      const tickets =
        ticketsByOrder.get(orderReference) || [];

      return {
        orderReference,

        buyer: {
          fullName: order.full_name || "",
          phone: order.phone || "",
          bairro: order.bairro || "",
        },

        purchase: {
          ticketType: order.ticket_type || "",
          ticketLot: order.ticket_lot || "",
          ticketPrice: order.ticket_price ?? null,
          quantity: Number(order.quantity || 0),
          totalAmount: order.total_amount ?? null,
          paymentMethod: order.payment_method || "",
          paymentStatus: order.payment_status || "",
          createdAt: order.created_at || null,
          paidAt: order.paid_at || null,
        },

        tickets: tickets.map(ticket => ({
          id: ticket.id,

          ticketCode: ticket.ticket_code || "",

          ticketNumber:
            Number(ticket.ticket_number || 0),

          ticketType:
            ticket.ticket_type || "",

          ticketLot:
            ticket.ticket_lot || "",

          ticketPrice:
            ticket.ticket_price ?? null,

          ticketStatus:
            ticket.ticket_status || "",

          presenceStatus:
            ticket.presence_status || "OUTSIDE",

          createdAt:
            ticket.created_at || null,

          /*
           * O sistema decide automaticamente
           * qual operação pode ser feita.
           */
          nextAction:
            ticket.presence_status === "INSIDE"
              ? "EXIT"
              : "ENTRY",

          nextActionLabel:
            ticket.presence_status === "INSIDE"
              ? "SAÍDA"
              : "ENTRADA",
        })),
      };
    });

    return sendJson(res, 200, {
      ok: true,
      count: results.length,
      results,
    });

  } catch (error) {
    console.error(
      "checkin-search error:",
      error
    );

    return sendJson(res, 500, {
      ok: false,
      error:
        "Erro interno ao pesquisar o comprador.",
    });
  }
}