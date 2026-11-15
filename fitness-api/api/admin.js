const SUPABASE_URL = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).origin
  : "";

const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const INVITE_REDIRECT_URL = "https://" + "pgrowth-events.vercel.app" + "/fitness/convite.html";

const ALLOWED_ORIGINS = new Set([
  "https://" + "pgrowth-admin.vercel.app",
  "https://" + "pgrowth-events.vercel.app"
]);

function send(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

function cors(req, res) {
  const origin = req.headers.origin || "";

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function clean(value, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEnv() {
  return Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY);
}

async function db(table, params = {}, method = "GET", body = undefined) {
  const query = new URLSearchParams(params).toString();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`,
    {
      method,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }
  );

  const raw = await response.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    console.error("PGrowth Admin DB error:", response.status, data);
    fail("Não foi possível concluir a operação na base de dados.", 500);
  }

  return data;
}

async function authenticate(req) {
  const match = (req.headers.authorization || "")
    .match(/^Bearer\s+(.+)$/i);

  if (!match) fail("Inicie sessão para continuar.", 401);

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${match[1]}`
    }
  });

  if (!response.ok) fail("Sessão inválida ou expirada.", 401);

  const user = await response.json();

  if (!user?.id) fail("Utilizador não autenticado.", 401);

  return user;
}

async function requireAdmin(userId) {
  const rows = await db("fitness_admins", {
    select: "user_id",
    user_id: `eq.${userId}`,
    limit: "1"
  });

  if (!Array.isArray(rows) || !rows.length) {
    fail("Acesso exclusivo à administração PGrowth.", 403);
  }
}

async function authAdmin(path, method = "GET", body = undefined) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json"
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });

  const raw = await response.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    console.error("PGrowth Admin Auth error:", response.status, data);

    if (response.status === 422 || response.status === 409) {
      fail("Este email já pode estar associado a uma conta existente. Verifica antes de registar novamente.", 409);
    }

    fail("Não foi possível criar ou gerir a conta profissional.", 500);
  }

  return data;
}

async function dashboard() {
  const coaches = await db("fitness_coaches", {
    select: "id,user_id,coach_number,display_name,bio,photo_url,active,approved,created_at",
    order: "coach_number.asc"
  });

  return {
    coaches: Array.isArray(coaches) ? coaches : [],
    total: Array.isArray(coaches) ? coaches.length : 0
  };
}

async function createCoach(body) {
  const email = clean(body.email, 254).toLowerCase();
  const displayName = clean(body.displayName, 120);
  const bio = clean(body.bio, 3000);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("Introduz um endereço de email válido.");
  }

  if (displayName.length < 3) {
    fail("O nome completo deve ter pelo menos 3 caracteres.");
  }

  if (bio.length < 20) {
    fail("A apresentação profissional deve ter pelo menos 20 caracteres.");
  }

  // Criar primeiro a conta e enviar o convite individual.
  // Nenhuma palavra-passe é definida ou partilhada pela administração.
  const invited = await authAdmin(
    `/auth/v1/invite?redirect_to=${encodeURIComponent(INVITE_REDIRECT_URL)}`,
    "POST",
    {
      email,
      data: {
        full_name: displayName,
        account_type: "fitness_coach",
        pgrowth_professional: true
      }
    }
  );

  const authUser = invited?.user || invited;

  if (!authUser?.id) {
    fail("O convite foi iniciado, mas não foi possível confirmar a conta. Contacta a administração técnica.", 500);
  }

  try {
    const rows = await db("fitness_coaches", {}, "POST", {
      user_id: authUser.id,
      display_name: displayName,
      bio,
      photo_url: null,
      active: false,
      approved: false
    });

    const coach = rows?.[0];

    if (!coach) {
      fail("Não foi possível guardar o perfil profissional.", 500);
    }

    return {
      coach: {
        id: coach.id,
        coach_number: coach.coach_number,
        display_name: coach.display_name,
        email,
        active: coach.active,
        approved: coach.approved
      },
      message: "Convite enviado. O treinador deverá confirmar o email e aguardar aprovação da administração."
    };
  } catch (error) {
    // Evitar deixar uma conta Auth órfã se o perfil não for criado.
    try {
      await authAdmin(`/auth/v1/admin/users/${authUser.id}`, "DELETE");
    } catch (cleanupError) {
      console.error("PGrowth Admin: falha na limpeza da conta Auth.", cleanupError);
    }

    throw error;
  }
}

async function updateCoach(body) {
  const coachId = clean(body.coachId, 80);

  if (!coachId) fail("Treinador não identificado.");

  const current = await db("fitness_coaches", {
    select: "id,active,approved",
    id: `eq.${coachId}`,
    limit: "1"
  });

  if (!current?.length) fail("Treinador não encontrado.", 404);

  const existing = current[0];
  const changes = {};

  if (typeof body.displayName === "string") {
    const name = clean(body.displayName, 120);
    if (name.length < 3) fail("O nome deve ter pelo menos 3 caracteres.");
    changes.display_name = name;
  }

  if (typeof body.bio === "string") {
    const bio = clean(body.bio, 3000);
    if (bio.length < 20) fail("A apresentação deve ter pelo menos 20 caracteres.");
    changes.bio = bio;
  }

  if (typeof body.photoUrl === "string") {
    const photoUrl = clean(body.photoUrl, 1000);

    if (photoUrl && !/^https:\/\/[^\s]+$/i.test(photoUrl)) {
      fail("O endereço da fotografia deve começar por https://.");
    }

    changes.photo_url = photoUrl || null;
  }

  const approved = typeof body.approved === "boolean"
    ? body.approved
    : existing.approved;

  const active = typeof body.active === "boolean"
    ? body.active
    : existing.active;

  if (active && !approved) {
    fail("É necessário aprovar o treinador antes de activar o acesso.");
  }

  if (typeof body.approved === "boolean") {
    changes.approved = approved;
  }

  if (typeof body.active === "boolean") {
    changes.active = active;
  }

  // Suspender acesso não elimina conta, atribuições ou histórico.
  if (!approved) {
    changes.active = false;
  }

  if (!Object.keys(changes).length) {
    fail("Não foram indicadas alterações.");
  }

  const updated = await db("fitness_coaches", {
    id: `eq.${coachId}`
  }, "PATCH", changes);

  return {
    coach: updated?.[0] || null,
    message: "Perfil profissional actualizado."
  };
}


const CHALLENGE_BUCKET = "fitness-challenge-videos";

async function adminStorage(path, method = "POST", body = undefined) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    throw Object.assign(
      new Error(data?.message || data?.error || "Erro no armazenamento dos vídeos."),
      { status: response.status }
    );
  }
  return data;
}

async function adminChallengeDb(path, method = "GET", body = undefined, prefer = "") {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    throw Object.assign(
      new Error(data?.message || data?.hint || "Erro no catálogo de desafios."),
      { status: response.status }
    );
  }
  return data;
}

async function challengeCatalog() {
  return await adminChallengeDb(
    "fitness_challenge_catalog?select=*&order=sort_order.asc"
  );
}

async function challengeSave(body) {
  const id = clean(body.id, 70);
  const category = clean(body.category, 40);
  const title = clean(body.title, 120);
  const description = clean(body.description, 1000);
  const unit = clean(body.unit, 30);
  const kind = clean(body.kind, 30);
  const symbol = clean(body.symbol, 30);
  const target = Number(body.target);
  const sortOrder = Number(body.sort_order || 0);

  if (!/^[a-z0-9-]{2,70}$/.test(id)) fail("Identificador inválido.");
  if (!category || !title || !unit || !kind) fail("Preenche os campos obrigatórios.");
  if (!Number.isFinite(target) || target <= 0) fail("A meta padrão deve ser superior a zero.");
  if (!Array.isArray(body.guide_steps) || body.guide_steps.length > 30) {
    fail("A lista de instruções é inválida.");
  }

  const previous = await adminChallengeDb(
    `fitness_challenge_catalog?id=eq.${encodeURIComponent(id)}&select=video_path,guide_steps,guide_tip,guide_safety&limit=1`
  );
  const old = previous?.[0] || {};
  const oldVideo = old.video_path || null;

  const record = {
    id, category, title, description, target, unit, kind, symbol,
    guide_steps: body.guide_steps.map(x => clean(x, 500)).filter(Boolean).length
      ? body.guide_steps.map(x => clean(x, 500)).filter(Boolean)
      : (old.guide_steps || []),
    guide_tip: clean(body.guide_tip, 1000) || old.guide_tip || '',
    guide_safety: clean(body.guide_safety, 1000) || old.guide_safety || '',
    video_path: body.video_path ? clean(body.video_path, 500) : null,
    active: body.active !== false,
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    updated_at: new Date().toISOString()
  };

  const saved = await adminChallengeDb(
    "fitness_challenge_catalog?on_conflict=id",
    "POST",
    record,
    "resolution=merge-duplicates,return=representation"
  );

  if (oldVideo && oldVideo !== record.video_path) {
    try {
      await adminStorage(`object/${CHALLENGE_BUCKET}`, "DELETE", {
        prefixes: [oldVideo]
      });
    } catch (error) {
      console.error("Vídeo antigo não removido:", error.message);
    }
  }

  return { challenge: saved?.[0] || record, message: "Desafio guardado." };
}

async function challengeArchive(body) {
  const id = clean(body.id, 70);
  if (!id) fail("Desafio não indicado.");
  const rows = await adminChallengeDb(
    `fitness_challenge_catalog?id=eq.${encodeURIComponent(id)}`,
    "PATCH",
    { active: false, updated_at: new Date().toISOString() },
    "return=representation"
  );
  return { challenge: rows?.[0] || null, message: "Desafio arquivado." };
}

async function challengeUploadUrl(body) {
  const id = clean(body.id, 70);
  if (!/^[a-z0-9-]{2,70}$/.test(id)) fail("Desafio inválido.");

  const rows = await adminChallengeDb(
    `fitness_challenge_catalog?id=eq.${encodeURIComponent(id)}&select=id&limit=1`
  );
  if (!rows?.length) fail("Desafio não encontrado.", 404);

  const path = `${id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.mp4`;
  const result = await adminStorage(
    `object/upload/sign/${CHALLENGE_BUCKET}/${path}`,
    "POST",
    { upsert: true }
  );

  if (!result?.token) fail("Não foi possível criar a autorização de carregamento.", 502);

  return {
    path,
    uploadUrl: `${SUPABASE_URL}/storage/v1/object/upload/sign/${CHALLENGE_BUCKET}/${path}?token=${encodeURIComponent(result.token)}`
  };
}

async function challengeVideoRemove(body) {
  const id = clean(body.id, 70);
  const rows = await adminChallengeDb(
    `fitness_challenge_catalog?id=eq.${encodeURIComponent(id)}&select=video_path&limit=1`
  );
  if (!rows?.length) fail("Desafio não encontrado.", 404);

  const path = rows[0].video_path;
  if (path) {
    await adminStorage(`object/${CHALLENGE_BUCKET}`, "DELETE", {
      prefixes: [path]
    });
  }

  await adminChallengeDb(
    `fitness_challenge_catalog?id=eq.${encodeURIComponent(id)}`,
    "PATCH",
    { video_path: null, updated_at: new Date().toISOString() },
    "return=minimal"
  );

  return { success: true, message: "Vídeo removido." };
}


export default async function handler(req, res) {
  cors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!validEnv()) {
    return send(res, 500, {
      error: "Configuração do Supabase incompleta no servidor."
    });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return send(res, 405, { error: "Método não permitido." });
  }

  try {
    const url = new URL(req.url, "https://localhost");

    const body = req.method === "POST" &&
      req.body && typeof req.body === "object"
      ? req.body
      : {};

    const action = req.method === "GET"
      ? url.searchParams.get("action")
      : body.action;

    const user = await authenticate(req);
    await requireAdmin(user.id);

    if (req.method === "GET" && action === "dashboard") {
      return send(res, 200, await dashboard());
    }

    if (req.method === "POST" && action === "create-coach") {
      return send(res, 201, await createCoach(body));
    }

    if (req.method === "POST" && action === "update-coach") {
      return send(res, 200, await updateCoach(body));
    }


    if (req.method === "GET" && action === "challenge-list") {
      return send(res, 200, { challenges: await challengeCatalog() });
    }

    if (req.method === "POST" && action === "challenge-save") {
      return send(res, 200, await challengeSave(body));
    }

    if (req.method === "POST" && action === "challenge-archive") {
      return send(res, 200, await challengeArchive(body));
    }

    if (req.method === "POST" && action === "challenge-video-upload-url") {
      return send(res, 200, await challengeUploadUrl(body));
    }

    if (req.method === "POST" && action === "challenge-video-remove") {
      return send(res, 200, await challengeVideoRemove(body));
    }

    fail("Operação não reconhecida.", 404);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;

    if (status >= 500) {
      console.error("PGrowth Admin:", error);
    }

    return send(res, status, {
      error: status >= 500
        ? "Ocorreu um erro no serviço PGrowth Admin."
        : error.message
    });
  }
}
