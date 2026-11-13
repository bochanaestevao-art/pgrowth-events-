const SUPABASE_URL = process.env.SUPABASE_URL
  ? new URL(process.env.SUPABASE_URL).origin : "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ORIGIN = "https:" + "/" + "/" + "pgrowth-events.vercel.app";

function send(res, status, data) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

function cors(req, res) {
  if (req.headers.origin === ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ORIGIN);
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
    console.error("CT GULERA Premium DB error:", response.status, data);
    fail("Não foi possível concluir a operação na base de dados.", 500);
  }
  return data;
}

async function authenticate(req) {
  const match = (req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
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

async function isAdmin(userId) {
  const rows = await db("fitness_admins", {
    select: "user_id",
    user_id: `eq.${userId}`,
    limit: "1"
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function getCoach(userId) {
  const rows = await db("fitness_coaches", {
    select: "id,user_id,display_name,active",
    user_id: `eq.${userId}`,
    active: "eq.true",
    limit: "1"
  });
  return rows?.[0] || null;
}

async function hasActivePass(userId) {
  const rows = await db("fitness_athlete_passes", {
    select: "id,status,valid_from,valid_until",
    user_id: `eq.${userId}`,
    status: "eq.ACTIVE",
    valid_until: `gt.${new Date().toISOString()}`,
    order: "valid_until.desc",
    limit: "1"
  });
  return rows?.[0] || null;
}


async function authAdminUsers() {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
    {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`
      }
    }
  );

  if (!response.ok) {
    console.error("CT GULERA Premium Auth Admin error:", response.status);
    fail("Não foi possível consultar as contas de utilizadores.", 500);
  }

  const data = await response.json();
  return Array.isArray(data.users) ? data.users : [];
}

function publicUser(user) {
  const metadata = user.user_metadata || {};
  const name = metadata.full_name || metadata.name ||
    metadata.display_name || metadata.nome ||
    (user.email ? user.email.split("@")[0] : "Utilizador");

  return { id: user.id, name: clean(name, 120) || "Utilizador" };
}

async function canManageAthlete(user, athleteId, admin, coach) {
  if (admin) return true;
  if (!coach) return false;

  const rows = await db("fitness_coach_athletes", {
    select: "id",
    coach_id: `eq.${coach.id}`,
    athlete_id: `eq.${athleteId}`,
    active: "eq.true",
    limit: "1"
  });
  return Boolean(rows?.length);
}

async function requireAthleteAccess(user, athleteId, admin, coach) {
  if (!athleteId) fail("Atleta não identificado.");
  if (user.id === athleteId) {
    const pass = await hasActivePass(user.id);
    if (!pass) fail("O Passe Completo não está activo. O histórico continua guardado.", 403);
    return pass;
  }
  if (await canManageAthlete(user, athleteId, admin, coach)) return null;
  fail("Não tem autorização para consultar este atleta.", 403);
}

function automaticReply(message) {
  const value = message.toLowerCase();

  if (/dieta|aliment|nutri|comida/.test(value)) {
    return "A nutrição deve respeitar os teus objectivos e necessidades individuais. Consulta o plano elaborado pelo profissional responsável ou pede acompanhamento ao treinador.";
  }
  if (/dor|lesão|lesionado|lesionada|tontura|peito|falta de ar/.test(value)) {
    return "A tua segurança vem primeiro. Interrompe o exercício se sentires dor ou sintomas preocupantes. Procura avaliação de um profissional de saúde. Posso encaminhar a tua questão ao treinador.";
  }
  if (/descanso|recuper|sono/.test(value)) {
    return "A recuperação faz parte do treino. Respeita o descanso, mantém uma rotina de sono adequada e evita aumentar a carga de forma brusca. Para orientação individual, fala com o treinador.";
  }
  if (/treino|corrida|ritmo|distância|velocidade/.test(value)) {
    return "A evolução deve ser gradual e consistente. Segue o plano atribuído pelo teu treinador e adapta o esforço à tua condição física. Posso encaminhar a tua pergunta para acompanhamento humano.";
  }
  return "Olá! Sou o CT GULERA. Posso ajudar com orientações gerais de treino e recuperação. Para uma recomendação individual, selecciona a opção de acompanhamento humano e a tua mensagem será encaminhada ao treinador.";
}

async function insertMessage(athleteId, senderId, senderRole, message, questionId = null) {
  const rows = await db("fitness_premium_messages", {}, "POST", {
    athlete_id: athleteId,
    sender_id: senderId,
    sender_role: senderRole,
    message,
    related_question_id: questionId
  });
  return rows?.[0] || null;
}

async function overview(user, admin, coach, pass) {
  if (admin || coach) {
    return {
      role: admin ? "ADMIN" : "COACH",
      activePass: pass,
      assignments: [],
      nutritionPlans: [],
      workoutPlans: [],
      tips: [],
      messages: [],
      announcements: [],
      questions: [],
      checkins: []
    };
  }
  if (!pass && !admin && !coach) {
    fail("O Passe Completo não está activo.", 403);
  }

  const athleteId = user.id;
  const [assignments, tips, messages, announcements, questions, checkins] =
    await Promise.all([
      db("fitness_plan_assignments", {
        select: "*",
        athlete_id: `eq.${athleteId}`,
        active: "eq.true",
        order: "assigned_at.desc"
      }),
      db("fitness_coach_tips", {
        select: "id,title,category,content,created_at",
        status: "eq.PUBLISHED",
        order: "created_at.desc",
        limit: "30"
      }),
      db("fitness_premium_messages", {
        select: "id,sender_id,sender_role,message,related_question_id,read_at,created_at",
        athlete_id: `eq.${athleteId}`,
        order: "created_at.asc",
        limit: "200"
      }),
      db("fitness_premium_announcements", {
        select: "id,title,message,created_at",
        active: "eq.true",
        order: "created_at.desc",
        limit: "30"
      }),
      db("fitness_athlete_questions", {
        select: "*",
        athlete_id: `eq.${athleteId}`,
        order: "created_at.desc",
        limit: "50"
      }),
      db("fitness_athlete_checkins", {
        select: "*",
        athlete_id: `eq.${athleteId}`,
        order: "recorded_at.desc",
        limit: "100"
      })
    ]);

  const nutritionIds = assignments
    .map(x => x.nutrition_plan_id).filter(Boolean);
  const workoutIds = assignments
    .map(x => x.workout_plan_id).filter(Boolean);

  const [nutritionPlans, workoutPlans] = await Promise.all([
    nutritionIds.length
      ? db("fitness_nutrition_plans", {
          select: "id,title,description,content,created_at",
          id: `in.(${nutritionIds.join(",")})`,
          status: "eq.PUBLISHED"
        })
      : Promise.resolve([]),
    workoutIds.length
      ? db("fitness_workout_plans", {
          select: "id,title,description,content,created_at",
          id: `in.(${workoutIds.join(",")})`,
          status: "eq.PUBLISHED"
        })
      : Promise.resolve([])
  ]);

  return {
    role: admin ? "ADMIN" : coach ? "COACH" : "ATHLETE",
    activePass: pass,
    assignments,
    nutritionPlans,
    workoutPlans,
    tips,
    messages,
    announcements,
    questions,
    checkins
  };
}

export default async function handler(req, res) {
  cors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return send(res, 500, { error: "Configuração do Supabase incompleta." });
  }
  if (!["GET", "POST"].includes(req.method)) {
    return send(res, 405, { error: "Método não permitido." });
  }

  try {
    const user = await authenticate(req);
    const admin = await isAdmin(user.id);
    const coach = admin ? null : await getCoach(user.id);
    const body = req.method === "POST" && req.body && typeof req.body === "object"
      ? req.body : {};
    const url = new URL(req.url, "https:" + "/" + "/" + "localhost");
    const action = req.method === "GET"
      ? url.searchParams.get("action") : body.action;

    if (req.method === "GET" && action === "overview") {
      const pass = await hasActivePass(user.id);
      return send(res, 200, await overview(user, admin, coach, pass));
    }

    if (req.method === "GET" && action === "coach-athletes") {
      if (!admin && !coach) fail("Acesso reservado ao treinador ou administrador.", 403);

      const params = {
        select: "id,coach_id,athlete_id,active,assigned_at",
        active: "eq.true",
        order: "assigned_at.desc"
      };
      if (!admin) params.coach_id = `eq.${coach.id}`;

      const assignments = await db("fitness_coach_athletes", params);
      const authUsers = await authAdminUsers();
      const userMap = new Map(authUsers.map(item => [item.id, publicUser(item)]));
      const enriched = assignments.map(item => ({
        ...item,
        athlete_name: userMap.get(item.athlete_id)?.name || "Atleta"
      }));
      return send(res, 200, { assignments: enriched });
    }

    if (req.method === "GET" && action === "management-data") {
      if (!admin && !coach) {
        fail("Acesso reservado ao treinador ou administrador.", 403);
      }

      const planFilter = admin ? {} : { coach_id: `eq.${coach.id}` };
      const tipFilter = admin ? {} : { created_by: `eq.${user.id}` };

      const [nutritionPlans, workoutPlans, tips, coaches, authUsers, activePasses] = await Promise.all([
        db("fitness_nutrition_plans", {
          select: "id,coach_id,title,description,content,status,created_at",
          ...planFilter,
          order: "created_at.desc",
          limit: "200"
        }),
        db("fitness_workout_plans", {
          select: "id,coach_id,title,description,content,status,created_at",
          ...planFilter,
          order: "created_at.desc",
          limit: "200"
        }),
        db("fitness_coach_tips", {
          select: "id,title,category,content,status,created_at,created_by",
          ...tipFilter,
          order: "created_at.desc",
          limit: "200"
        }),
        admin
          ? db("fitness_coaches", {
              select: "id,user_id,display_name,active,created_at",
              order: "created_at.desc",
              limit: "200"
            })
          : Promise.resolve([]),
        admin ? authAdminUsers() : Promise.resolve([]),
        admin ? db("fitness_athlete_passes", {
          select: "user_id",
          status: "eq.ACTIVE",
          valid_until: `gt.${new Date().toISOString()}`,
          limit: "1000"
        }) : Promise.resolve([])
      ]);

      const users = admin ? authUsers.map(publicUser) : [];
      const activeIds = new Set((activePasses || []).map(item => item.user_id));
      const athletes = users.filter(item => activeIds.has(item.id));

      return send(res, 200, {
        nutritionPlans,
        workoutPlans,
        tips,
        coaches,
        users,
        athletes
      });
    }

    if (req.method === "GET" && action === "athlete-history") {
      const athleteId = clean(url.searchParams.get("athleteId"), 80);
      await requireAthleteAccess(user, athleteId, admin, coach);

      const [messages, questions, checkins, assignments] = await Promise.all([
        db("fitness_premium_messages", {
          select: "*",
          athlete_id: `eq.${athleteId}`,
          order: "created_at.asc",
          limit: "300"
        }),
        db("fitness_athlete_questions", {
          select: "*",
          athlete_id: `eq.${athleteId}`,
          order: "created_at.desc"
        }),
        db("fitness_athlete_checkins", {
          select: "*",
          athlete_id: `eq.${athleteId}`,
          order: "recorded_at.desc"
        }),
        db("fitness_plan_assignments", {
          select: "*",
          athlete_id: `eq.${athleteId}`,
          order: "assigned_at.desc"
        })
      ]);
      return send(res, 200, { messages, questions, checkins, assignments });
    }

    if (req.method !== "POST") fail("Operação não reconhecida.", 400);

    if (action === "message") {
      const message = clean(body.message, 3000);
      if (message.length < 1) fail("Escreve a tua mensagem.");
      const pass = await hasActivePass(user.id);
      if (!pass) fail("O Passe Completo não está activo.", 403);

      const sent = await insertMessage(user.id, user.id, "ATHLETE", message);
      const reply = automaticReply(message);
      const automatic = await insertMessage(user.id, null, "CT_GULERA", reply);
      return send(res, 201, { message: sent, automaticReply: automatic });
    }

    if (action === "ask-coach") {
      const subject = clean(body.subject, 160);
      const question = clean(body.question, 3000);
      if (subject.length < 3 || question.length < 5) {
        fail("Indica o assunto e escreve uma pergunta válida.");
      }
      const pass = await hasActivePass(user.id);
      if (!pass) fail("O Passe Completo não está activo.", 403);

      const rows = await db("fitness_athlete_questions", {}, "POST", {
        athlete_id: user.id,
        subject,
        question,
        status: "OPEN"
      });
      const item = rows?.[0];
      await insertMessage(user.id, user.id, "ATHLETE", question, item?.id);
      return send(res, 201, { question: item });
    }

    if (action === "coach-message") {
      if (!admin && !coach) fail("Acesso reservado ao treinador.", 403);
      const athleteId = clean(body.athleteId, 80);
      const message = clean(body.message, 3000);
      if (message.length < 1) fail("Escreve a mensagem.");
      if (!(await canManageAthlete(user, athleteId, admin, coach))) {
        fail("Este atleta não está atribuído a este treinador.", 403);
      }
      const saved = await insertMessage(
        athleteId, user.id, admin ? "ADMIN" : "COACH", message
      );
      return send(res, 201, { message: saved });
    }

    if (action === "reply-question") {
      if (!admin && !coach) fail("Acesso reservado ao treinador.", 403);
      const questionId = clean(body.questionId, 80);
      const reply = clean(body.reply, 3000);
      if (reply.length < 1) fail("Escreve a resposta.");

      const questions = await db("fitness_athlete_questions", {
        select: "id,athlete_id",
        id: `eq.${questionId}`,
        limit: "1"
      });
      const question = questions?.[0];
      if (!question) fail("Pergunta não encontrada.", 404);
      if (!(await canManageAthlete(user, question.athlete_id, admin, coach))) {
        fail("Não tens autorização para responder a esta pergunta.", 403);
      }

      const coachId = coach?.id || null;
      const replies = await db("fitness_coach_replies", {}, "POST", {
        question_id: questionId,
        coach_id: coachId,
        sender_id: user.id,
        reply
      });
      await db("fitness_athlete_questions", {
        id: `eq.${questionId}`
      }, "PATCH", { status: "ANSWERED", updated_at: new Date().toISOString() });
      const saved = await insertMessage(
        question.athlete_id, user.id, admin ? "ADMIN" : "COACH", reply, questionId
      );
      return send(res, 201, { reply: replies?.[0], message: saved });
    }

    if (action === "checkin") {
      const pass = await hasActivePass(user.id);
      if (!pass) fail("O Passe Completo não está activo.", 403);

      const weight = body.weightKg === "" || body.weightKg == null
        ? null : Number(body.weightKg);
      const height = body.heightCm === "" || body.heightCm == null
        ? null : Number(body.heightCm);
      const energy = body.energyLevel === "" || body.energyLevel == null
        ? null : Number(body.energyLevel);

      if (weight !== null && (!Number.isFinite(weight) || weight < 20 || weight > 350)) {
        fail("Peso inválido.");
      }
      if (height !== null && (!Number.isFinite(height) || height < 80 || height > 250)) {
        fail("Altura inválida.");
      }
      if (energy !== null && (!Number.isInteger(energy) || energy < 1 || energy > 10)) {
        fail("Nível de energia deve estar entre 1 e 10.");
      }

      const rows = await db("fitness_athlete_checkins", {}, "POST", {
        athlete_id: user.id,
        weight_kg: weight,
        height_cm: height,
        energy_level: energy,
        mood: clean(body.mood, 80) || null,
        notes: clean(body.notes, 2000) || null
      });
      return send(res, 201, { checkin: rows?.[0] });
    }

    if (action === "manage-coach") {
      if (!admin) fail("Só o administrador pode gerir treinadores.", 403);

      const coachUserId = clean(body.userId, 80);
      const displayName = clean(body.displayName, 120);
      const active = body.active !== false;

      if (!coachUserId) fail("Indica o ID de utilizador do treinador.");
      if (active && displayName.length < 3) {
        fail("O nome do treinador deve ter pelo menos 3 caracteres.");
      }

      const existing = await db("fitness_coaches", {
        select: "id,user_id",
        user_id: `eq.${coachUserId}`,
        limit: "1"
      });

      let rows;
      if (existing?.length) {
        rows = await db("fitness_coaches", {
          id: `eq.${existing[0].id}`
        }, "PATCH", {
          display_name: displayName || undefined,
          active
        });
      } else {
        if (!active) fail("Este treinador ainda não está registado.", 404);
        rows = await db("fitness_coaches", {}, "POST", {
          user_id: coachUserId,
          display_name: displayName,
          active: true
        });
      }

      return send(res, 200, { coach: rows?.[0] || null });
    }

    if (action === "save-content") {
      if (!admin && !coach) fail("Acesso reservado ao treinador.", 403);
      const type = clean(body.type, 20);
      const title = clean(body.title, 160);
      const description = clean(body.description, 1000);
      const status = clean(body.status, 20) || "DRAFT";
      if (title.length < 3) fail("O título deve ter pelo menos 3 caracteres.");
      if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) fail("Estado inválido.");

      const table = type === "nutrition" ? "fitness_nutrition_plans"
        : type === "workout" ? "fitness_workout_plans" : null;
      if (!table) fail("Tipo de plano inválido.");

      const rows = await db(table, {}, "POST", {
        coach_id: coach?.id || null,
        title,
        description,
        content: body.content && typeof body.content === "object" ? body.content : {},
        status,
        created_by: user.id
      });
      return send(res, 201, { plan: rows?.[0] });
    }

    if (action === "publish-tip") {
      if (!admin && !coach) fail("Acesso reservado ao treinador.", 403);
      const title = clean(body.title, 160);
      const content = clean(body.content, 4000);
      const category = clean(body.category, 80);
      const status = clean(body.status, 20) || "DRAFT";
      if (title.length < 3 || content.length < 5) fail("Preenche o título e o conteúdo.");
      if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) fail("Estado inválido.");

      const rows = await db("fitness_coach_tips", {}, "POST", {
        title, content, category, status, created_by: user.id
      });
      return send(res, 201, { tip: rows?.[0] });
    }

    if (action === "assign-plan") {
      if (!admin && !coach) fail("Acesso reservado ao treinador.", 403);
      const athleteId = clean(body.athleteId, 80);
      const type = clean(body.type, 20);
      const planId = clean(body.planId, 80);
      if (!(await canManageAthlete(user, athleteId, admin, coach))) {
        fail("Este atleta não está atribuído a este treinador.", 403);
      }
      if (!["nutrition", "workout"].includes(type) || !planId) {
        fail("Plano inválido.");
      }

      const table = type === "nutrition"
        ? "fitness_nutrition_plans" : "fitness_workout_plans";
      const plans = await db(table, {
        select: "id",
        id: `eq.${planId}`,
        status: "eq.PUBLISHED",
        limit: "1"
      });
      if (!plans?.length) fail("O plano não existe ou não está publicado.", 404);

      const rows = await db("fitness_plan_assignments", {}, "POST", {
        athlete_id: athleteId,
        coach_id: coach?.id || null,
        nutrition_plan_id: type === "nutrition" ? planId : null,
        workout_plan_id: type === "workout" ? planId : null,
        notes: clean(body.notes, 1000),
        active: true
      });
      return send(res, 201, { assignment: rows?.[0] });
    }

    if (action === "assign-coach") {
      if (!admin) fail("Só o administrador pode atribuir treinadores.", 403);
      const athleteId = clean(body.athleteId, 80);
      const coachUserId = clean(body.coachUserId, 80);
      if (!athleteId || !coachUserId) fail("Atleta ou treinador não identificado.");

      const coaches = await db("fitness_coaches", {
        select: "id",
        user_id: `eq.${coachUserId}`,
        active: "eq.true",
        limit: "1"
      });
      if (!coaches?.length) fail("Treinador não encontrado ou inactivo.", 404);

      const existing = await db("fitness_coach_athletes", {
        select: "id",
        athlete_id: `eq.${athleteId}`,
        active: "eq.true"
      });
      for (const item of existing || []) {
        await db("fitness_coach_athletes", { id: `eq.${item.id}` }, "PATCH", {
          active: false,
          ended_at: new Date().toISOString()
        });
      }

      const rows = await db("fitness_coach_athletes", {}, "POST", {
        coach_id: coaches[0].id,
        athlete_id: athleteId,
        active: true
      });
      return send(res, 201, { assignment: rows?.[0] });
    }

    if (action === "broadcast") {
      if (!admin) fail("Só o administrador pode enviar avisos gerais.", 403);
      const title = clean(body.title, 160);
      const message = clean(body.message, 3000);
      if (title.length < 3 || message.length < 3) fail("Preenche o título e a mensagem.");

      const rows = await db("fitness_premium_announcements", {}, "POST", {
        title, message, created_by: user.id, active: true
      });
      return send(res, 201, { announcement: rows?.[0] });
    }

    if (action === "mark-read") {
      const messageId = clean(body.messageId, 80);
      if (!messageId) fail("Mensagem não identificada.");
      const rows = await db("fitness_premium_messages", {
        select: "id",
        id: `eq.${messageId}`,
        athlete_id: `eq.${user.id}`,
        sender_role: "neq.ATHLETE",
        limit: "1"
      });
      if (!rows?.length) fail("Mensagem não encontrada.", 404);
      const updated = await db("fitness_premium_messages", {
        id: `eq.${messageId}`,
        athlete_id: `eq.${user.id}`
      }, "PATCH", { read_at: new Date().toISOString() });
      return send(res, 200, { message: updated?.[0] || null });
    }

    fail("Operação não reconhecida.", 404);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("CT GULERA Premium:", error);
    return send(res, status, {
      error: status === 500
        ? "Ocorreu um erro no serviço Premium."
        : error.message
    });
  }
}
