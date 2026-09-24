```javascript
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function send(res, status, body) {
  res.status(status).json(body);
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Credenciais do Supabase não configuradas.");
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      typeof data === "string"
        ? data
        : data?.message || "Erro no Supabase."
    );

    error.status = response.status;
    throw error;
  }

  return data;
}

function clean(value, maxLength) {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return send(res, 405, {
      ok: false,
      error: "Método não permitido."
    });
  }

  try {

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const eventSlug = clean(body.eventSlug, 100);
    const eventName = clean(body.eventName, 200);
    const fullName = clean(body.fullName, 100);
    const phone = clean(body.phone, 30);
    const address = clean(body.address, 200);

    if (!eventSlug) {
      return send(res, 400, {
        ok: false,
        error: "Evento não informado."
      });
    }

    if (!eventName) {
      return send(res, 400, {
        ok: false,
        error: "Nome do evento não informado."
      });
    }

    if (fullName.length < 3) {
      return send(res, 400, {
        ok: false,
        error: "Introduza o nome completo."
      });
    }

    if (phone.length < 9) {
      return send(res, 400, {
        ok: false,
        error: "Introduza um contacto válido."
      });
    }

    if (address.length < 3) {
      return send(res, 400, {
        ok: false,
        error: "Introduza uma morada válida."
      });
    }

    const registration = {
      event_slug: eventSlug,
      event_name: eventName,
      full_name: fullName,
      phone,
      address
    };

    const data = await supabaseRequest(
      "event_registrations",
      {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify(registration)
      }
    );

    return send(res, 201, {
      ok: true,
      message: "Registo realizado com sucesso.",
      registration: Array.isArray(data)
        ? data[0] || null
        : data
    });

  } catch (error) {

    console.error(
      "EVENT REGISTRATION ERROR:",
      error
    );

    return send(res, error.status || 500, {
      ok: false,
      error:
        error.status
          ? error.message
          : "Erro interno ao realizar o registo."
    });
  }
}
```
