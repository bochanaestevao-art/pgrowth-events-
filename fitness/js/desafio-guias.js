(function(){
"use strict";
const guides = {"run-1k":["Primeiro quilómetro","Completa o primeiro quilómetro com ritmo confortável.",["Aquece caminhando durante 5 minutos.","Começa a correr devagar e mantém a respiração controlada.","Alterna corrida e caminhada se necessário.","Termina com caminhada leve."],"Não procures velocidade; concentra-te em completar a distância.","Usa calçado adequado e escolhe um percurso seguro."],"run-5k":["Desafio 5 KM","Desenvolve resistência para completar cinco quilómetros.",["Aquece durante 5 a 10 minutos.","Começa num ritmo que consigas manter.","Mantém postura relaxada e passadas naturais.","Completa e regista os 5 KM."],"Evita acelerar demasiado no início.","Aumenta a distância gradualmente e respeita a recuperação."],"run-10k":["Desafio 10 KM","Prepara o corpo para uma corrida de dez quilómetros.",["Faz aquecimento dinâmico.","Divide mentalmente a distância em partes menores.","Mantém um ritmo sustentável.","Regista a corrida depois de terminar."],"A consistência dos treinos é mais importante do que a velocidade.","Não aumentes a distância bruscamente."],"run-week25":["Semana de 25 KM","Acumula 25 quilómetros distribuídos pela semana.",["Planeia os dias de corrida e recuperação.","Distribui a distância em várias sessões.","Regista cada corrida no Run With Coach.","Acompanha o total semanal."],"Distribui os quilómetros em vez de fazer tudo num dia.","Evita sessões intensas consecutivas quando estiveres fatigado."],"run-month100":["100 KM no mês","Alcança cem quilómetros através de treinos regulares.",["Define uma meta semanal realista.","Combina corridas curtas e longas.","Regista cada actividade no Run With Coach.","Acompanha o acumulado mensal."],"Um plano regular ajuda a evitar sobrecarga.","Reserva dias de descanso e recuperação."],"end-15":["Resistência inicial","Mantém quinze minutos de actividade contínua.",["Faz aquecimento leve.","Escolhe uma actividade adequada ao teu nível.","Mantém intensidade moderada e contínua.","Regista os minutos realizados."],"Deves conseguir falar frases curtas durante o exercício.","Reduz a intensidade se sentires desconforto."],"end-30":["30 minutos sem parar","Melhora a capacidade de manter actividade durante meia hora.",["Aquece durante cinco minutos.","Escolhe corrida leve ou caminhada rápida.","Mantém ritmo estável durante trinta minutos.","Termina com recuperação gradual."],"Começa devagar para não perder energia cedo.","Adapta a duração à tua experiência."],"end-45":["Desafio 45 minutos","Desenvolve resistência numa sessão de quarenta e cinco minutos.",["Prepara o corpo com aquecimento.","Escolhe intensidade sustentável.","Mantém hidratação e ritmo controlado.","Regista o tempo efectivamente realizado."],"Controlar a intensidade ajuda a terminar bem.","Se és principiante, aumenta a duração gradualmente."],"end-5days":["Consistência de 5 dias","Cria o hábito de treinar em cinco dias diferentes.",["Escolhe cinco dias adequados à tua rotina.","Define uma actividade possível para cada dia.","Regista cada sessão concluída.","Inclui recuperação na tua semana."],"Sessões curtas também ajudam a criar consistência.","Não precisas de treinar intensamente todos os dias."],"str-push":["20 flexões","Trabalha peito, ombros e braços com técnica correcta.",["Coloca as mãos ligeiramente mais afastadas que os ombros.","Mantém o corpo alinhado.","Desce o peito de forma controlada.","Empurra o chão e regressa à posição inicial."],"Podes começar com os joelhos apoiados ou flexões inclinadas.","Evita deixar a cintura cair e não forces os pulsos."],"str-squat":["50 agachamentos","Fortalece pernas e glúteos através do agachamento.",["Coloca os pés à largura dos ombros.","Leva a anca para trás e dobra os joelhos.","Mantém o peito aberto e os pés apoiados.","Regressa à posição inicial controladamente."],"Faz séries menores e descansa quando necessário.","Os joelhos devem acompanhar a direcção dos pés."],"str-abs":["30 abdominais","Trabalha a região abdominal com movimentos controlados.",["Deita-te de costas com os joelhos dobrados.","Mantém os pés apoiados.","Eleva o tronco contraindo o abdómen.","Desce lentamente sem puxar o pescoço."],"A qualidade do movimento é mais importante que a velocidade.","Evita puxar a cabeça com as mãos."],"str-plank":["Prancha de 60 segundos","Desenvolve estabilidade abdominal e controlo corporal.",["Apoia os antebraços e as pontas dos pés.","Alinha os cotovelos com os ombros.","Mantém cabeça, costas, anca e pernas alinhadas.","Contrai o abdómen e mantém a posição."],"Começa com períodos curtos e aumenta gradualmente.","Não deixes a lombar afundar."],"ex-sets":["Três séries completas","Organiza um exercício em três séries.",["Escolhe um exercício adequado ao teu nível.","Executa a primeira série com técnica correcta.","Descansa antes da série seguinte.","Completa e regista as três séries."],"Mantém a qualidade em todas as séries.","Interrompe quando já não conseguires manter a técnica."],"ex-100":["100 repetições","Acumula cem repetições através de séries controladas.",["Escolhe um exercício seguro.","Divide as repetições em séries menores.","Descansa entre séries.","Regista apenas as repetições concluídas."],"Não precisas de fazer as cem repetições de uma só vez.","Evita movimentos rápidos e descontrolados."],"ex-4sessions":["Quatro sessões","Completa quatro sessões de exercício com consistência.",["Planeia quatro momentos de treino.","Escolhe exercícios adequados.","Faz aquecimento antes da actividade principal.","Regista cada sessão concluída."],"Distribui as sessões para permitir recuperação.","Evita sobrecarregar os mesmos músculos."],"cardio-15":["Cardio 15 minutos","Realiza quinze minutos de actividade cardiovascular.",["Escolhe caminhada rápida, bicicleta ou dança.","Faz aquecimento leve.","Mantém movimento durante quinze minutos.","Reduz gradualmente a intensidade."],"Escolhe uma actividade de que gostes.","Mantém hidratação e esforço adequado."],"cardio-30":["Cardio 30 minutos","Completa uma sessão cardiovascular de meia hora.",["Faz aquecimento progressivo.","Escolhe uma actividade sustentável.","Mantém ritmo moderado e regular.","Termina com recuperação."],"Aumenta o ritmo apenas quando estiveres preparado.","Evita mudanças bruscas de intensidade."],"cardio-3":["Três sessões de cardio","Completa três sessões cardiovasculares distintas.",["Escolhe três dias para treinar.","Define uma actividade e duração realistas.","Faz aquecimento e recuperação em cada sessão.","Regista cada sessão concluída."],"A regularidade ajuda a desenvolver resistência.","Intercala sessões exigentes com recuperação."],"cardio-120":["120 minutos semanais","Acumula cento e vinte minutos de cardio durante a semana.",["Divide os minutos em várias sessões.","Escolhe actividades adequadas ao teu nível.","Regista cada sessão realizada.","Acompanha o total semanal."],"Várias sessões curtas também ajudam a atingir a meta.","Evita concentrar todo o esforço num único dia."]};
const images = {
corrida:"corrida.svg",
resistencia:"resistencia.svg",
forca:"forca.svg",
exercicios:"exercicios.svg",
cardio:"cardio.svg"
};
function esc(value){
return String(value).replace(/[&<>"']/g,function(c){
return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
});
}
window.PGrowthChallengeGuideHtml = function(challenge,state){
const g=guides[challenge.id];
if(!g)return "";
const video="media/desafios/videos/"+challenge.id+".mp4";
return [
'<section class="detail-panel challenge-guide">',
'<span class="guide-kicker">PGROWTH FITNESS · GUIA DO ATLETA</span>',
'<h2>Como realizar este desafio</h2>',
'<p>'+esc(g[1])+'</p>',
'<img class="guide-image" src="media/desafios/'+images[challenge.category]+'" alt="Ilustração de '+esc(challenge.category)+'" loading="lazy">',
'<div class="guide-meta"><span>OBJECTIVO ACTUAL</span><strong>'+esc(state.target)+' '+esc(challenge.unit)+'</strong></div>',
'<h3>Passo a passo</h3>',
'<ol class="guide-steps">'+g[2].map(function(s){return '<li>'+esc(s)+'</li>';}).join("")+'</ol>',
'<div class="guide-tip"><strong>DICA DO COACH</strong><p>'+esc(g[3])+'</p></div>',
'<div class="guide-safety"><strong>CUIDADOS DE EXECUÇÃO</strong><p>'+esc(g[4])+'</p></div>',
'<div class="guide-video-area" id="guide-video-slot" data-video="'+video+'">',
'<div class="video-placeholder"><span class="video-symbol">▶</span><strong>Vídeo demonstrativo</strong><p>O vídeo MP4 deste desafio será adicionado aqui brevemente.</p><small>Reprodução dentro do PGrowth Fitness</small></div>',
'</div></section>'
].join("");
};
window.PGrowthChallengeGuideCheckVideo = function(){
const slot=document.getElementById("guide-video-slot");
if(!slot)return;
const url=slot.dataset.video;
const video=document.createElement("video");
video.controls=true;
video.playsInline=true;
video.preload="metadata";
video.className="guide-video-player";
const source=document.createElement("source");
source.src=url;
source.type="video/mp4";
video.appendChild(source);
video.addEventListener("error",function(){
if(slot.contains(video)){
slot.innerHTML='<div class="video-placeholder"><span class="video-symbol">▶</span><strong>Vídeo demonstrativo</strong><p>O vídeo MP4 deste desafio será adicionado aqui brevemente.</p><small>Reprodução dentro do PGrowth Fitness</small></div>';
}
});
video.addEventListener("loadedmetadata",function(){
if(!slot.contains(video))return;
});
video.load();
slot.replaceChildren(video);
};
})();