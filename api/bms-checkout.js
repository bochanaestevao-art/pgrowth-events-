import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const SITE_URL =
  process.env.SITE_URL ||
  "https://pgrowth-events.vercel.app";

const ADMIN_PASSWORD = process.env.BMS_ADMIN_PASSWORD;
const ADMIN_SECRET = process.env.BMS_ADMIN_SESSION_SECRET;
const TICKET_SECRET = process.env.TICKET_GENERATION_SECRET;

const COOKIE_NAME = "bms_checkout_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;

const CATALOG = {
  TICKET_NORMAL: {
    type: "TICKET",
    name: "Bilhete Normal",
    price: 300,
    ticketType: "NORMAL",
    ticketLot: "BMS-2026",
  },
  TICKET_VIP: {
    type: "TICKET",
    name: "Bilhete VIP",
    price: 750,
    ticketType: "VIP",
    ticketLot: "BMS-2026",
  },
  TICKET_DAY: {
    type: "TICKET",
    name: "Bilhete No Dia",
    price: 1000,
    ticketType: "NORMAL",
    ticketLot: "NO DIA",
  },
  TSHIRT_1: {
    type: "PRODUCT",
    name: "Camiseta BMS Modelo 1",
    price: 1100,
  },
  TSHIRT_2: {
    type: "PRODUCT",
    name: "Camiseta BMS Modelo 2",
    price: 1100,
  },
  TSHIRT_3: {
    type: "PRODUCT",
    name: "Camiseta BMS Modelo 3",
    price: 1100,
  },
};

function json(res, status, data) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(data));
}

function clean(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function maputoToday() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Africa/Maputo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );

  return values.year + "-" + values.month + "-" + values.day;
}

function randomReference(prefix = "BMS-2026") {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(6)
    .toString("hex")
    .toUpperCase()}`;
}

async function db(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase não configurado.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );

  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.hint || "Erro na base de dados."
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

function parseAmount(value) {
  if (!value) return null;

  let normalized = String(value)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");

  const amount = Number(normalized);

  return Number.isFinite(amount) && amount > 0
    ? amount
    : null;
}

function extractPaymentData(message, fallbackCode) {
  const text = clean(message, 5000);

  let reference = clean(fallbackCode, 120) || null;
  let amount = null;
  let paymentDate = null;
  let senderPhone = null;

  if (text) {
    const referencePatterns = [
      /(?:refer[eê]ncia|reference|transa[cç][aã]o|transaction|c[oó]digo|code|id)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-\/]{3,})/i,
      /\b(?:MPESA|EMOLA)[\s:]+([A-Z0-9][A-Z0-9\-]{4,})/i,
    ];

    for (const pattern of referencePatterns) {
      const match = text.match(pattern);
      if (match) {
        reference = match[1].trim();
        break;
      }
    }

    const amountMatch = text.match(
      /(?:MT|MZN|MZM)\s*([\d.,]+)|([\d.,]+)\s*(?:MT|MZN|MZM)/i
    );

    if (amountMatch) {
      amount = parseAmount(amountMatch[1] || amountMatch[2]);
    }

    const dateMatch = text.match(
      /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/
    );

    if (dateMatch) {
      const [, day, month, year, hour = "12", minute = "00"] =
        dateMatch;

      const date = new Date(
        `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00+02:00`
      );

      if (!Number.isNaN(date.getTime())) {
        paymentDate = date.toISOString();
      }
    }

    const phoneMatch = text.match(
      /(?:\+?258[\s-]?)?8[234567]\d{7}/
    );

    if (phoneMatch) {
      senderPhone = phoneMatch[0].replace(/[\s-]/g, "");
    }
  }

  return {
    payment_reference: reference,
    payment_amount: amount,
    payment_date: paymentDate,
    payment_sender_phone: senderPhone,
  };
}

function signSession(timestamp) {
  return crypto
    .createHmac("sha256", ADMIN_SECRET)
    .update(String(timestamp))
    .digest("hex");
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));

  return first.length === second.length &&
    crypto.timingSafeEqual(first, second);
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "")
    .split(";");

  for (const item of cookies) {
    const index = item.indexOf("=");
    if (index < 0) continue;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    if (key === name) return decodeURIComponent(value);
  }

  return "";
}

function setSessionCookie(res) {
  const timestamp = Date.now();
  const signature = signSession(timestamp);

  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/bms-checkout; Max-Age=0`,
    `${COOKIE_NAME}=${timestamp}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/api/; Max-Age=${SESSION_SECONDS}`
  ]);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/; Max-Age=0`,
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/bms-checkout; Max-Age=0`
  ]);
}

function isAdmin(req) {
  if (!ADMIN_SECRET || !ADMIN_PASSWORD) return false;

  const value = getCookie(req, COOKIE_NAME);
  const parts = value.split(".");

  if (parts.length !== 2) return false;

  const timestamp = Number(parts[0]);

  if (
    !Number.isFinite(timestamp) ||
    timestamp > Date.now() ||
    Date.now() - timestamp > SESSION_SECONDS * 1000
  ) {
    return false;
  }

  return safeEqual(parts[1], signSession(timestamp));
}

async function getOne(table, reference) {
  const rows = await db(
    `${table}?order_reference=eq.${encodeURIComponent(reference)}&select=*&limit=1`
  );

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}


async function signedCustomerPdfUrl(pdfPath) {
  if (!pdfPath) return null;

  let path = String(pdfPath).replace(/^\/+/, "");

  if (path.startsWith("tickets/")) {
    path = path.slice("tickets/".length);
  }

  if (
    !path ||
    path.split("/").some(part => !part || part === "." || part === "..") ||
    !/^[A-Za-z0-9_./-]+$/.test(path)
  ) {
    throw new Error("Ficheiro de bilhete inválido.");
  }

  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    SUPABASE_URL.replace(/\/+$/, "") +
      "/storage/v1/object/sign/tickets/" + encoded,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ expiresIn: 600 })
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.signedURL) {
    throw new Error("O PDF ainda não está disponível. Tente novamente.");
  }

  if (data.signedURL.startsWith("http")) return data.signedURL;
  if (data.signedURL.startsWith("/storage/v1/")) {
    return SUPABASE_URL.replace(/\/+$/, "") + data.signedURL;
  }

  return SUPABASE_URL.replace(/\/+$/, "") +
    "/storage/v1" +
    (data.signedURL.startsWith("/") ? "" : "/") +
    data.signedURL;
}

async function customerOrderStatus(referenceInput) {
  const reference = clean(referenceInput, 120).toUpperCase();

  if (!/^BMS-2026-\d{10,16}-[A-F0-9]{12}$/.test(reference)) {
    const error = new Error("Introduza uma referência BMS válida.");
    error.status = 400;
    throw error;
  }

  const encoded = encodeURIComponent(reference);

  const orders = await db(
    "bms_orders?order_reference=eq." + encoded +
    "&select=order_reference,payment_status,ticket_status,total_amount,created_at&limit=1"
  );

  if (!Array.isArray(orders) || !orders.length) {
    const error = new Error(
      "Não encontrámos uma encomenda com essa referência. Confirme os caracteres e tente novamente."
    );
    error.status = 404;
    throw error;
  }

  const order = orders[0];

  const [items, issuances] = await Promise.all([
    db(
      "bms_order_items?order_reference=eq." + encoded +
      "&select=id,item_type,item_name,quantity,unit_price,line_total&order=created_at.asc"
    ),
    db(
      "bms_order_issuances?order_reference=eq." + encoded +
      "&select=status,item_id,pdf_path,ticket_codes"
    )
  ]);

  const paymentStatus = String(order.payment_status || "").toUpperCase();
  const ticketStatus = String(order.ticket_status || "").toUpperCase();

  const safeItems = (Array.isArray(items) ? items : []).map(item => ({
    name: String(item.item_name || "Artigo"),
    type: String(item.item_type || ""),
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unit_price || 0),
    total: Number(item.line_total || 0)
  }));

  const issued = (Array.isArray(issuances) ? issuances : [])
    .filter(item => String(item.status || "").toUpperCase() === "ISSUED");

  const ticketCodes = paymentStatus === "APPROVED"
    ? [...new Set(issued.flatMap(item =>
        Array.isArray(item.ticket_codes)
          ? item.ticket_codes.map(code => String(code))
          : []
      ))]
    : [];

  let message = "A encomenda aguarda validação manual do pagamento.";
  const pdfFiles = [];

  if (paymentStatus === "REJECTED") {
    message = "O pagamento desta encomenda não foi aprovado. Contacte a organização BMS se precisar de esclarecimentos.";
  } else if (paymentStatus === "APPROVED") {
    if (ticketStatus === "ISSUED" && issued.length) {
      message = "Pagamento aprovado. Os bilhetes já foram emitidos.";

      const itemById = new Map(
        (Array.isArray(items) ? items : []).map(item => [
          String(item.id),
          item
        ])
      );

      for (const issuance of issued) {
        if (!issuance.pdf_path) continue;

        const viewUrl = await signedCustomerPdfUrl(issuance.pdf_path);
        const item = itemById.get(String(issuance.item_id || ""));
        const safeName = String(item?.item_name || "Bilhete BMS")
          .replace(/[^A-Za-z0-9_-]/g, "-")
          .slice(0, 60);

        const separator = viewUrl.includes("?") ? "&" : "?";
        const downloadUrl = viewUrl + separator +
          "download=" + encodeURIComponent(safeName + ".pdf");

        pdfFiles.push({
          name: String(item?.item_name || "Bilhete BMS"),
          quantity: Number(item?.quantity || 0),
          viewUrl,
          downloadUrl
        });
      }
    } else if (ticketStatus === "NOT_APPLICABLE") {
      message = "Pagamento aprovado. Esta encomenda não contém bilhetes de entrada.";
    } else {
      message = "Pagamento aprovado. A emissão dos bilhetes está em processamento.";
    }
  }

  const pdfUrl = pdfFiles.length ? pdfFiles[0].viewUrl : null;

  return {
    success: true,
    orderReference: order.order_reference,
    paymentStatus,
    ticketStatus,
    totalAmount: Number(order.total_amount || 0),
    items: safeItems,
    ticketCodes,
    pdfUrl: paymentStatus === "APPROVED" ? pdfUrl : null,
    pdfFiles: paymentStatus === "APPROVED" ? pdfFiles : [],
    message
  };
}

async function createOrder(body) {
  const fullName = clean(body.fullName, 160);
  const province = clean(body.province, 100);
  const bairro = clean(body.bairro, 120);
  const phone = clean(body.phone, 30);
  const paymentMethod = clean(body.paymentMethod, 20).toUpperCase();

  if (fullName.length < 3) {
    throw new Error("Informe o nome completo.");
  }

  if (!province) {
    throw new Error("Informe a província.");
  }

  if (!bairro) {
    throw new Error("Informe o bairro.");
  }

  if (!/^[+\d][\d\s()-]{7,19}$/.test(phone)) {
    throw new Error("Informe um contacto telefónico válido.");
  }

  if (!["MPESA", "EMOLA"].includes(paymentMethod)) {
    throw new Error("Seleccione M-Pesa ou e-Mola.");
  }

  if (!Array.isArray(body.items) || !body.items.length) {
    throw new Error("Adicione pelo menos um artigo.");
  }

  const seen = new Set();
  const items = [];
  let total = 0;

  for (const input of body.items) {
    const code = clean(input.code, 40).toUpperCase();
    const catalogItem = CATALOG[code];
    const quantity = Number(input.quantity);

    if (!catalogItem) {
      throw new Error("Existe um artigo inválido na encomenda.");
    }

    if (code === "TICKET_DAY" && maputoToday() < "2026-11-21") {
      throw new Error(
        "O Bilhete No Dia estará disponível a partir de 21/11/2026."
      );
    }

    if (seen.has(code)) {
      throw new Error("Não repita o mesmo artigo na encomenda.");
    }

    seen.add(code);

    const max = catalogItem.type === "TICKET" ? 10 : 100;

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
      throw new Error(
        catalogItem.type === "TICKET"
          ? "Cada tipo de bilhete permite até 10 unidades por encomenda."
          : "A quantidade de camisetas deve estar entre 1 e 100."
      );
    }

    let itemName = catalogItem.name;

    if (catalogItem.type === "PRODUCT") {
      const color = clean(input.color, 20).toUpperCase();
      const size = clean(input.size, 10).toUpperCase();

      if (!["PRETO", "BRANCO"].includes(color)) {
        throw new Error("Seleccione a cor da camiseta.");
      }

      if (!["M", "L", "XL", "2XL"].includes(size)) {
        throw new Error("Seleccione o tamanho da camiseta.");
      }

      itemName +=
        " — " + (color === "PRETO" ? "Preto" : "Branco") +
        " — " + size;
    }

    const lineTotal = catalogItem.price * quantity;
    total += lineTotal;

    items.push({
      item_type: catalogItem.type,
      item_code: code,
      item_name: itemName,
      quantity,
      unit_price: catalogItem.price,
      line_total: lineTotal,
    });
  }

  const paymentData = extractPaymentData(
    body.paymentMessage,
    body.transferCode
  );

  if (!paymentData.payment_reference) {
    throw new Error(
      "Informe o código de transferência ou cole o SMS de confirmação."
    );
  }

  const reference = randomReference();

  const order = {
    order_reference: reference,
    full_name: fullName,
    province,
    bairro,
    phone,
    payment_method: paymentMethod,
    ...paymentData,
    total_amount: total,
    payment_status: "PENDING",
    ticket_status: items.some((item) => item.item_type === "TICKET")
      ? "PENDING"
      : "NOT_APPLICABLE",
  };

  const inserted = await db("bms_orders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(order),
  });

  if (!Array.isArray(inserted) || !inserted.length) {
    throw new Error("Não foi possível registar a encomenda.");
  }

  try {
    await db("bms_order_items", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(
        items.map((item) => ({
          ...item,
          order_reference: reference,
        }))
      ),
    });
  } catch (error) {
    await db(
      `bms_orders?order_reference=eq.${encodeURIComponent(reference)}`,
      { method: "DELETE" }
    ).catch(() => {});
    throw error;
  }

  return {
    success: true,
    orderReference: reference,
    totalAmount: total,
    paymentStatus: "PENDING",
    message:
      "Encomenda registada. O pagamento aguarda validação administrativa.",
  };
}

async function listOrders() {
  const orders = await db(
    "bms_orders?select=*&order=created_at.desc&limit=100"
  );

  const result = [];

  for (const order of orders || []) {
    const items = await db(
      `bms_order_items?order_reference=eq.${encodeURIComponent(order.order_reference)}&select=*&order=created_at.asc`
    );

    const issuances = await db(
      `bms_order_issuances?order_reference=eq.${encodeURIComponent(order.order_reference)}&select=*`
    );

    result.push({ ...order, items, issuances });
  }

  return result;
}

async function createBridgeOrder(order, item, issuance) {
  const existing = await getOne(
    "blackout_orders",
    issuance.bridge_order_reference
  );

  if (existing) return existing;

  const catalogItem = CATALOG[item.item_code];

  const bridge = {
    order_reference: issuance.bridge_order_reference,
    full_name: order.full_name,
    phone: order.phone,
    bairro: order.bairro,
    ticket_type: catalogItem.ticketType,
    ticket_lot: catalogItem.ticketLot,
    ticket_price: Number(item.unit_price),
    quantity: Number(item.quantity),
    total_amount: Number(item.line_total),
    payment_method: order.payment_method,
    payment_status: "PAID",
    payment_reference: order.payment_reference,
    ticket_status: "PENDING",
    presence_status: "OUTSIDE",
  };

  const inserted = await db("blackout_orders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(bridge),
  });

  return Array.isArray(inserted) ? inserted[0] : inserted;
}

async function generateBmsTickets(reference) {
  if (!TICKET_SECRET) {
    throw new Error("TICKET_GENERATION_SECRET não configurado.");
  }

  const response = await fetch(
    `${SITE_URL}/api/generate-ticket`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ticket-generation-secret": TICKET_SECRET,
      },
      body: JSON.stringify({
        orderReference: reference,
        eventCode: "BMS_2026",
      }),
    }
  );

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!response.ok || !data.success) {
    throw new Error(
      data.message || "Não foi possível gerar os bilhetes."
    );
  }

  return data;
}

async function approveOrder(reference, adminNote) {
  const order = await getOne("bms_orders", reference);

  if (!order) {
    throw new Error("Encomenda não encontrada.");
  }

  if (order.payment_status === "REJECTED") {
    throw new Error("Esta encomenda já foi rejeitada.");
  }

  const items = await db(
    `bms_order_items?order_reference=eq.${encodeURIComponent(reference)}&select=*`
  );

  if (!Array.isArray(items) || !items.length) {
    throw new Error("A encomenda não contém artigos.");
  }

  await db(
    `bms_orders?order_reference=eq.${encodeURIComponent(reference)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        payment_status: "APPROVED",
        approved_at: new Date().toISOString(),
        admin_note: clean(adminNote, 500),
        updated_at: new Date().toISOString(),
      }),
    }
  );

  const ticketItems = items.filter(
    (item) => item.item_type === "TICKET"
  );

  const failures = [];
  const issued = [];

  for (const item of ticketItems) {
    try {
      let rows = await db(
        `bms_order_issuances?item_id=eq.${encodeURIComponent(item.id)}&select=*&limit=1`
      );

      let issuance = Array.isArray(rows) && rows.length
        ? rows[0]
        : null;

      if (issuance?.status === "ISSUED") {
        issued.push(issuance);
        continue;
      }

      if (!issuance) {
        const created = await db("bms_order_issuances", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            order_reference: reference,
            item_id: item.id,
            bridge_order_reference: randomReference(),
            status: "PENDING",
          }),
        });

        issuance = Array.isArray(created) ? created[0] : created;
      }

      await createBridgeOrder(order, item, issuance);

      const generated = await generateBmsTickets(
        issuance.bridge_order_reference
      );

      const patch = {
        status: "ISSUED",
        pdf_path: generated.pdfPath || null,
        ticket_codes: generated.ticketCodes || [],
        last_error: null,
        updated_at: new Date().toISOString(),
      };

      await db(
        `bms_order_issuances?id=eq.${encodeURIComponent(issuance.id)}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(patch),
        }
      );

      issued.push({ ...issuance, ...patch });
    } catch (error) {
      failures.push({
        item: item.item_name,
        message: error.message,
      });

      const rows = await db(
        `bms_order_issuances?item_id=eq.${encodeURIComponent(item.id)}&select=id&limit=1`
      ).catch(() => []);

      if (rows?.length) {
        await db(
          `bms_order_issuances?id=eq.${encodeURIComponent(rows[0].id)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              status: "FAILED",
              last_error: clean(error.message, 500),
              updated_at: new Date().toISOString(),
            }),
          }
        ).catch(() => {});
      }
    }
  }

  const finalTicketStatus =
    ticketItems.length === 0
      ? "NOT_APPLICABLE"
      : failures.length === 0
        ? "ISSUED"
        : "PENDING";

  await db(
    `bms_orders?order_reference=eq.${encodeURIComponent(reference)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        ticket_status: finalTicketStatus,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  return {
    success: failures.length === 0,
    approved: true,
    orderReference: reference,
    ticketStatus: finalTicketStatus,
    issued,
    failures,
    message: failures.length
      ? "Pagamento aprovado, mas algumas emissões precisam de nova tentativa."
      : "Pagamento aprovado e processamento concluído.",
  };
}

async function rejectOrder(reference, note) {
  const order = await getOne("bms_orders", reference);

  if (!order) {
    throw new Error("Encomenda não encontrada.");
  }

  if (order.payment_status === "APPROVED") {
    throw new Error("Uma encomenda aprovada não pode ser rejeitada.");
  }

  await db(
    `bms_orders?order_reference=eq.${encodeURIComponent(reference)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        payment_status: "REJECTED",
        admin_note: clean(note, 500),
        updated_at: new Date().toISOString(),
      }),
    }
  );

  return {
    success: true,
    orderReference: reference,
    paymentStatus: "REJECTED",
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message: "Método não permitido.",
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const operation = clean(body.operation, 50).toUpperCase();

    if (operation === "CUSTOMER_STATUS") {
      return json(res, 200, await customerOrderStatus(body.orderReference));
    }

    if (operation === "CREATE_ORDER") {
      return json(res, 201, await createOrder(body));
    }

    if (operation === "ADMIN_LOGIN") {
      if (!ADMIN_PASSWORD || !ADMIN_SECRET) {
        return json(res, 500, {
          success: false,
          message: "Autenticação administrativa não configurada.",
        });
      }

      if (!safeEqual(body.password || "", ADMIN_PASSWORD)) {
        return json(res, 401, {
          success: false,
          message: "Palavra-passe incorrecta.",
        });
      }

      setSessionCookie(res);

      return json(res, 200, {
        success: true,
        message: "Sessão administrativa iniciada.",
      });
    }

    if (operation === "ADMIN_LOGOUT") {
      clearSessionCookie(res);
      return json(res, 200, { success: true });
    }

    if (!isAdmin(req)) {
      return json(res, 401, {
        success: false,
        message: "Sessão administrativa inválida ou expirada.",
      });
    }

    if (operation === "ADMIN_STATUS") {
      return json(res, 200, { success: true, authenticated: true });
    }

    if (operation === "ADMIN_LIST") {
      return json(res, 200, {
        success: true,
        orders: await listOrders(),
      });
    }

    if (operation === "ADMIN_APPROVE") {
      const reference = clean(body.orderReference, 120);

      if (!reference) {
        return json(res, 400, {
          success: false,
          message: "Referência da encomenda em falta.",
        });
      }

      return json(
        res,
        200,
        await approveOrder(reference, body.adminNote)
      );
    }

    if (operation === "ADMIN_REJECT") {
      const reference = clean(body.orderReference, 120);

      if (!reference) {
        return json(res, 400, {
          success: false,
          message: "Referência da encomenda em falta.",
        });
      }

      return json(
        res,
        200,
        await rejectOrder(reference, body.adminNote)
      );
    }

    return json(res, 400, {
      success: false,
      message: "Operação desconhecida.",
    });
  } catch (error) {
    console.error("BMS CHECKOUT ERROR:", error);

    return json(res, error.status || 400, {
      success: false,
      message: error.message || "Erro no checkout BMS.",
    });
  }
}
