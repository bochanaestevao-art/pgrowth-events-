const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const TICKET_GENERATION_SECRET =
  process.env.TICKET_GENERATION_SECRET;

const JOB_PROCESS_SECRET =
  process.env.JOB_PROCESS_SECRET;

const SITE_URL =
  process.env.SITE_URL ||
  "https://pgrowth-events.vercel.app";

function json(res, status, data) {
  return res.status(status).json(data);
}

async function supabaseRequest(path, options = {}) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Variáveis do Supabase não configuradas"
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
      data?.message ||
        data?.hint ||
        "Erro no Supabase"
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

function getSecretFromRequest(req) {
  const header =
    req.headers["x-job-process-secret"];

  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
}

async function claimJob(orderReference) {
  const result =
    await supabaseRequest(
      `ticket_jobs?order_reference=eq.${encodeURIComponent(
        orderReference
      )}&status=eq.PENDING&select=id,order_reference,status,attempts&limit=1`,
      {
        method: "GET",
      }
    );

  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    return null;
  }

  const job = result[0];

  const claimed =
    await supabaseRequest(
      `ticket_jobs?id=eq.${encodeURIComponent(
        job.id
      )}&status=eq.PENDING`,
      {
        method: "PATCH",
        headers: {
          Prefer:
            "return=representation",
        },
        body: JSON.stringify({
          status: "PROCESSING",
          attempts:
            Number(job.attempts || 0) + 1,
          updated_at:
            new Date().toISOString(),
          last_error: null,
        }),
      }
    );

  if (
    !Array.isArray(claimed) ||
    claimed.length === 0
  ) {
    return null;
  }

  return claimed[0];
}

async function getOrder(orderReference) {
  const result =
    await supabaseRequest(
      `blackout_orders?order_reference=eq.${encodeURIComponent(
        orderReference
      )}&select=order_reference,payment_status,ticket_status,pdf_path,ticket_code,quantity&limit=1`,
      {
        method: "GET",
      }
    );

  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    throw new Error(
      `Pedido não encontrado: ${orderReference}`
    );
  }

  return result[0];
}

async function generateTicket(orderReference) {
  if (!TICKET_GENERATION_SECRET) {
    throw new Error(
      "TICKET_GENERATION_SECRET não configurado"
    );
  }

  const response =
    await fetch(
      `${SITE_URL}/api/generate-ticket`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          "x-ticket-generation-secret":
            TICKET_GENERATION_SECRET,
        },
        body: JSON.stringify({
          orderReference,
        }),
      }
    );

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {
        raw: text,
      };
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        "Erro ao gerar bilhete"
    );
  }

  return data;
}

async function completeJob(jobId) {
  await supabaseRequest(
    `ticket_jobs?id=eq.${encodeURIComponent(
      jobId
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: "COMPLETED",
        updated_at:
          new Date().toISOString(),
        completed_at:
          new Date().toISOString(),
        last_error: null,
      }),
    }
  );
}

async function failJob(jobId, error) {
  const message =
    String(
      error?.message ||
        error ||
        "Erro desconhecido"
    ).slice(0, 1000);

  await supabaseRequest(
    `ticket_jobs?id=eq.${encodeURIComponent(
      jobId
    )}`,
    {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: "FAILED",
        updated_at:
          new Date().toISOString(),
        last_error: message,
      }),
    }
  );
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      message: "Método não permitido",
    });
  }

  if (!JOB_PROCESS_SECRET) {
    return json(res, 500, {
      success: false,
      message:
        "JOB_PROCESS_SECRET não configurado",
    });
  }

  const receivedSecret =
    getSecretFromRequest(req);

  if (
    !receivedSecret ||
    receivedSecret !== JOB_PROCESS_SECRET
  ) {
    return json(res, 401, {
      success: false,
      message: "Não autorizado",
    });
  }

  try {
    const body =
      typeof req.body === "object" &&
      req.body !== null
        ? req.body
        : {};

    const orderReference =
      typeof body.orderReference === "string"
        ? body.orderReference.trim()
        : "";

    if (!orderReference) {
      return json(res, 400, {
        success: false,
        message:
          "orderReference não informado",
      });
    }

    const job =
      await claimJob(
        orderReference
      );

    if (!job) {
      return json(res, 200, {
        success: true,
        skipped: true,
        message:
          "Nenhum trabalho PENDING disponível para este pedido.",
      });
    }

    try {
      const order =
        await getOrder(
          orderReference
        );

      const paymentStatus =
        String(
          order.payment_status || ""
        ).toUpperCase();

      const ticketStatus =
        String(
          order.ticket_status || ""
        ).toUpperCase();

      if (paymentStatus !== "PAID") {
        throw new Error(
          "O pedido ainda não está PAID."
        );
      }

      /*
       * Se o bilhete já existe,
       * não geramos novamente.
       */
      if (
        ticketStatus === "ISSUED" &&
        order.pdf_path
      ) {
        await completeJob(
          job.id
        );

        return json(res, 200, {
          success: true,
          completed: true,
          alreadyIssued: true,
          orderReference,
        });
      }

      const ticket =
        await generateTicket(
          orderReference
        );

      await completeJob(
        job.id
      );

      return json(res, 200, {
        success: true,
        completed: true,
        orderReference,
        ticket,
      });

    } catch (error) {
      console.error(
        "TICKET JOB ERROR:",
        error
      );

      await failJob(
        job.id,
        error
      );

      return json(res, 500, {
        success: false,
        message:
          "Falha ao processar o bilhete.",
      });
    }

  } catch (error) {
    console.error(
      "PROCESS TICKET JOB ERROR:",
      error
    );

    return json(res, 500, {
      success: false,
      message:
        "Erro interno ao processar a fila.",
    });
  }
}
