const SUPABASE_URL =
  String(process.env.SUPABASE_URL || "").trim();

const SUPABASE_SERVICE_ROLE_KEY =
  String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function sendJson(res, status, data) {
  res.status(status).json(data);
}

async function supabaseRequest(path, options) {
  const requestOptions = options || {};

  const response = await fetch(
    SUPABASE_URL + "/rest/v1/" + path,
    {
      ...requestOptions,
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        ...(requestOptions.headers || {})
      }
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

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED"
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "EVENT REGISTRATION: configuração do Supabase ausente."
    );

    return sendJson(res, 500, {
      success: false,
      error: "SERVER_CONFIGURATION_ERROR"
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

  if (!body || typeof body !== "object") {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON"
    });
  }

  const eventSlug =
    String(body.eventSlug || "").trim();

  const eventName =
    String(body.eventName || "").trim();

  const fullName =
    String(body.fullName || "").trim();

  const phone =
    String(body.phone || "").trim();

  const address =
    String(body.address || "").trim();

  if (!eventSlug || eventSlug.length > 100) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT"
    });
  }

  if (!eventName || eventName.length > 200) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_EVENT_NAME"
    });
  }

  if (!fullName || fullName.length > 200) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_FULL_NAME"
    });
  }

  if (!phone || phone.length > 50) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_PHONE"
    });
  }

  if (!address || address.length > 500) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_ADDRESS"
    });
  }

  try {
    const result = await supabaseRequest(
      "event_registrations",
      {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          event_slug: eventSlug,
          event_name: eventName,
          full_name: fullName,
          phone: phone,
          address: address
        })
      }
    );

    if (!result.ok) {
      console.error(
        "EVENT REGISTRATION: Supabase recusou o registo. HTTP " +
          result.status
      );

      return sendJson(res, 500, {
        success: false,
        error: "REGISTRATION_FAILED"
      });
    }

    const registration =
      Array.isArray(result.data)
        ? result.data[0]
        : result.data;

    return sendJson(res, 200, {
      success: true,
      registration: registration
    });

  } catch (error) {
    console.error(
      "EVENT REGISTRATION: erro inesperado.",
      error
    );

    return sendJson(res, 500, {
      success: false,
      error: "REGISTRATION_FAILED"
    });
  }
}
