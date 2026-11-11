(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const dock = $("coach-avatar-dock");
  if (!dock) return;

  const title = $("coach-avatar-title");
  const message = $("coach-avatar-text");
  const muteButton = $("coach-avatar-mute");

  const distanceEl = $("distance");
  const durationEl = $("duration");
  const paceEl = $("pace");

  const startButton = $("start-run");
  const pauseButton = $("pause-run");
  const finishButton = $("finish-run");

  let piperSession = null;
  let piperPromise = null;
  let audio = new Audio();
  let audioUrl = null;
  let speechToken = 0;

  let muted = false;
  let speaking = false;
  let lastSpeech = 0;
  let lastMotivation = 0;
  let nextMilestone = 1;
  let lastPhrase = "";
  let runStarted = false;

  const technique = [
    [
      "TÉCNICA",
      "Mantém o tronco direito, mas descontraído. Olha em frente e evita inclinar demasiado o corpo."
    ],
    [
      "A TUA POSTURA",
      "Mantém os ombros relaxados e os braços a acompanhar naturalmente o movimento das pernas."
    ],
    [
      "CONTROLA A PASSADA",
      "Procura uma passada natural e confortável. Evita esticar demasiado as pernas à tua frente."
    ],
    [
      "RESPIRAÇÃO",
      "Respira de forma natural e regular. Não forces a respiração. Encontra um padrão confortável."
    ],
    [
      "ECONOMIZA ENERGIA",
      "Mantém as mãos descontraídas e evita tensionar os punhos. Corre com movimentos leves."
    ],
    [
      "CONTROLO DO RITMO",
      "Não precisas de acelerar para provar nada. A consistência é mais importante do que a velocidade."
    ],
    [
      "TÉCNICA DE BRAÇOS",
      "Deixa os braços acompanharem a corrida junto ao corpo, sem cruzar excessivamente à frente do peito."
    ],
    [
      "CORRIDA INTELIGENTE",
      "Escuta o teu corpo. Uma corrida bem controlada hoje ajuda-te a treinar melhor amanhã."
    ],
    [
      "CONCENTRAÇÃO",
      "Mantém o olhar alguns metros à frente e presta atenção ao piso e ao trânsito à tua volta."
    ],
    [
      "PASSADA NATURAL",
      "Não forces uma cadência específica. Procura movimentos suaves, estáveis e adequados ao teu corpo."
    ]
  ];

  const motivation = [
    [
      "ACREDITA EM TI",
      "Cada passo conta. Não compares o teu percurso com o de outra pessoa. Concentra-te na tua evolução."
    ],
    [
      "CONTINUA FIRME",
      "A disciplina constrói resultados. Mantém a calma, controla o esforço e continua com determinação."
    ],
    [
      "ESTÁS NO CAMINHO",
      "O progresso não acontece de uma só vez. Cada treino é uma oportunidade para ficares mais forte."
    ],
    [
      "FORÇA, ATLETA",
      "Não precisas de correr depressa. Precisas de encontrar um ritmo que consigas sustentar com qualidade."
    ],
    [
      "SUPERA-TE",
      "Hoje estás a construir a resistência de amanhã. Valoriza cada quilómetro e cada pequena conquista."
    ],
    [
      "MENTE FORTE",
      "Mantém o foco no próximo passo. Divide o percurso em pequenas metas e avança com confiança."
    ],
    [
      "A TUA EVOLUÇÃO",
      "O importante é treinares com regularidade e respeitares o teu corpo. Continua a construir a tua história."
    ],
    [
      "NÃO DESISTAS DE TI",
      "Há dias mais fáceis e dias mais difíceis. O segredo é saber adaptar o esforço e manter a consistência."
    ]
  ];

  const recovery = [
    [
      "RECUPERAÇÃO",
      "Se terminares o treino, reduz gradualmente o esforço e caminha alguns minutos. Dá tempo ao corpo para recuperar."
    ],
    [
      "HIDRATAÇÃO",
      "Lembra-te de beber água de acordo com a duração do exercício, o calor e as necessidades do teu corpo."
    ],
    [
      "RESPEITA OS LIMITES",
      "Se sentires dor, tonturas ou falta de ar fora do normal, pára o exercício e procura ajuda adequada."
    ]
  ];

  function setMessage(heading, text) {
    if (title) title.textContent = heading;
    if (message) message.textContent = text;
  }

  async function loadPiper() {
    if (piperSession) return piperSession;

    if (!piperPromise) {
      piperPromise = import("../assets/ct-gulera-voice/ct-gulera-piper.js")
        .then(({ TtsSession }) => {
          return TtsSession.create({
            voiceId: "pt_PT-tugão-medium"
          });
        })
        .then(session => {
          piperSession = session;
          return session;
        })
        .catch(error => {
          piperPromise = null;
          throw error;
        });
    }

    return piperPromise;
  }

  function stopSpeech() {
    speechToken++;

    audio.onended = null;
    audio.onerror = null;

    audio.pause();
    audio.removeAttribute("src");
    audio.load();

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }

    speaking = false;
    dock.classList.remove("is-speaking");
  }

  async function speak(heading, text, force = false) {
    setMessage(heading, text);

    if (muted) return;

    if (!force && Date.now() - lastSpeech < 12000) return;

    stopSpeech();

    const currentToken = ++speechToken;

    speaking = true;
    dock.classList.add("is-speaking");
    lastSpeech = Date.now();

    try {
      const session = await loadPiper();

      if (muted || currentToken !== speechToken) return;

      const wav = await session.predict(text);

      if (muted || currentToken !== speechToken) return;

      audioUrl = URL.createObjectURL(wav);
      audio.src = audioUrl;

      audio.onended = () => {
        if (currentToken !== speechToken) return;

        speaking = false;
        dock.classList.remove("is-speaking");

        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          audioUrl = null;
        }
      };

      audio.onerror = () => {
        if (currentToken !== speechToken) return;

        speaking = false;
        dock.classList.remove("is-speaking");
        console.error("CT GULERA: erro na reprodução do áudio.");
      };

      await audio.play();

    } catch (error) {
      if (currentToken !== speechToken) return;

      speaking = false;
      dock.classList.remove("is-speaking");

      console.error("CT GULERA Piper:", error);
      setMessage(
        heading,
        "Não foi possível activar a voz do treinador. Verifica a ligação e tenta novamente."
      );
    }
  }

  function readStats() {
    const distanceText = distanceEl
      ? distanceEl.textContent.trim()
      : "0";

    const durationText = durationEl
      ? durationEl.textContent.trim()
      : "00:00:00";

    const paceText = paceEl
      ? paceEl.textContent.trim()
      : "--:--";

    const distance = parseFloat(
      distanceText.replace(",", ".")
    ) || 0;

    const durationParts = durationText.split(":").map(Number);

    let durationSeconds = 0;

    if (durationParts.length === 3) {
      durationSeconds =
        durationParts[0] * 3600 +
        durationParts[1] * 60 +
        durationParts[2];
    }

    const paceMatch = paceText.match(/(\d{1,2}):(\d{2})/);

    const paceSeconds = paceMatch
      ? Number(paceMatch[1]) * 60 + Number(paceMatch[2])
      : 0;

    return {
      distance,
      durationText,
      durationSeconds,
      paceSeconds,
      paceText
    };
  }

  function choosePhrase(list) {
    if (list.length === 1) return list[0];

    let selected;

    do {
      selected = list[Math.floor(Math.random() * list.length)];
    } while (selected[1] === lastPhrase);

    lastPhrase = selected[1];
    return selected;
  }

  function activeRun() {
    return Boolean(
      startButton &&
      pauseButton &&
      startButton.disabled &&
      /PAUSAR/i.test(pauseButton.textContent)
    );
  }

  function milestoneMessage(km) {
    const wholeKm = Math.floor(km);

    if (wholeKm < 1) return;

    const heading = wholeKm === 1
      ? "PRIMEIRO QUILÓMETRO!"
      : `META DOS ${wholeKm} KM!`;

    speak(
      heading,
      `Muito bem! Já percorreste ${wholeKm} quilómetro${wholeKm > 1 ? "s" : ""}. Reconhece esta conquista. Mantém a técnica e controla o esforço.`
    );

    nextMilestone = wholeKm < 5
      ? wholeKm + 1
      : wholeKm + 5;

    lastMotivation = Date.now();
  }

  function coachDuringRun() {
    if (!activeRun() || speaking || muted) return;

    const stats = readStats();

    if (stats.distance >= nextMilestone && stats.distance >= 1) {
      milestoneMessage(stats.distance);
      return;
    }

    if (Date.now() - lastMotivation < 100000) return;

    lastMotivation = Date.now();

    if (stats.durationSeconds >= 1200 &&
        Math.random() < 0.25) {
      const phrase = choosePhrase(recovery);
      speak(phrase[0], phrase[1]);
      return;
    }

    if (stats.distance >= 0.25 &&
        stats.paceSeconds > 0) {
      const paceMinutes = Math.floor(stats.paceSeconds / 60);
      const paceSeconds = stats.paceSeconds % 60;

      const paceText =
        `${paceMinutes} minutos e ${paceSeconds} segundos por quilómetro`;

      if (Math.random() < 0.35) {
        speak(
          "ACOMPANHAMENTO DO TEU RITMO",
          `O teu ritmo médio registado é de ${paceText}. Usa este dado como referência, não como pressão. Mantém um esforço confortável.`
        );
        return;
      }
    }

    const list = Math.random() < 0.55
      ? technique
      : motivation;

    const phrase = choosePhrase(list);
    speak(phrase[0], phrase[1]);
  }

  if (muteButton) {
    muteButton.addEventListener("click", () => {
      muted = !muted;

      if (muted) {
        stopSpeech();
      }

      muteButton.textContent = muted
        ? "ACTIVAR VOZ"
        : "SILENCIAR VOZ";

      muteButton.setAttribute(
        "aria-pressed",
        String(muted)
      );

      if (!muted) {
        speak(
          "CT GULERA",
          "A minha voz está activa. Vamos continuar a evoluir juntos!",
          true
        );
      } else {
        setMessage(
          "CT GULERA",
          "Voz desactivada. Continuo aqui contigo."
        );
      }
    });
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.id === "start-run") {
      if (button.disabled) return;

      runStarted = true;
      nextMilestone = 1;
      lastMotivation = Date.now();

      speak(
        "VAMOS COMEÇAR!",
        "Atleta, estamos juntos! Começa com alguns minutos de ritmo leve. Deixa o corpo aquecer, mantém os ombros relaxados e encontra uma passada natural.",
        true
      );
    }

    if (button.id === "pause-run") {
      const wasRunning = /PAUSAR/i.test(button.textContent);

      if (wasRunning) {
        speak(
          "HORA DE RECUPERAR",
          "Boa decisão. Recupera a respiração, relaxa os músculos e bebe água se precisares. Retoma apenas quando estiveres preparado.",
          true
        );
      } else if (runStarted) {
        lastMotivation = Date.now();

        speak(
          "VAMOS RETOMAR!",
          "Regressa gradualmente ao movimento. Começa devagar e volta a encontrar o teu ritmo confortável.",
          true
        );
      }
    }

    if (button.id === "finish-run") {
      const stats = readStats();

      speak(
        "CORRIDA CONCLUÍDA!",
        `Excelente trabalho! Os dados registam ${stats.distance.toFixed(2)} quilómetros em ${stats.durationText}. Caminha um pouco para recuperar, hidrata-te e valoriza o esforço que fizeste.`,
        true
      );

      runStarted = false;
    }
  }, true);

  window.setInterval(coachDuringRun, 5000);

  setMessage(
    "CT GULERA · TEU TREINADOR",
    "Estou aqui para te orientar. Vamos trabalhar técnica, resistência e motivação, um passo de cada vez."
  );
})();
