create table if not exists public.fitness_challenge_catalog (
  id text primary key,
  category text not null,
  title text not null,
  description text not null default '',
  target numeric not null default 1,
  unit text not null,
  kind text not null default 'manual',
  symbol text not null default '',
  guide_steps jsonb not null default '[]'::jsonb,
  guide_tip text not null default '',
  guide_safety text not null default '',
  video_path text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fitness_challenge_catalog enable row level security;

insert into public.fitness_challenge_catalog
(id,category,title,description,target,unit,kind,symbol,sort_order)
values
('run-1k','corrida','Primeiro quilómetro','Completa uma corrida de pelo menos 1 quilómetro.',1,'km','run-best','1 KM',1),
('run-5k','corrida','Desafio 5 KM','Completa uma corrida de 5 quilómetros.',5,'km','run-best','5 KM',2),
('run-10k','corrida','Desafio 10 KM','Completa uma corrida de 10 quilómetros.',10,'km','run-best','10 KM',3),
('run-week25','corrida','Semana de 25 KM','Acumula 25 quilómetros numa semana.',25,'km','run-week','25 KM',4),
('run-month100','corrida','100 KM no mês','Acumula 100 quilómetros durante o mês.',100,'km','run-month','100 KM',5),
('end-15','resistencia','Resistência inicial','Completa 15 minutos de actividade contínua.',15,'min','manual','15 MIN',6),
('end-30','resistencia','30 minutos sem parar','Regista uma sessão contínua de 30 minutos.',30,'min','manual','30 MIN',7),
('end-45','resistencia','Desafio 45 minutos','Acumula 45 minutos de resistência.',45,'min','manual','45 MIN',8),
('end-5days','resistencia','Consistência de 5 dias','Regista cinco sessões de treino em dias diferentes.',5,'sessões','manual','5 DIAS',9),
('str-push','forca','20 flexões','Completa 20 flexões com técnica adequada.',20,'reps','manual','PUSH',10),
('str-squat','forca','50 agachamentos','Completa 50 agachamentos.',50,'reps','manual','SQUAT',11),
('str-abs','forca','30 abdominais','Completa 30 repetições de abdominais.',30,'reps','manual','ABS',12),
('str-plank','forca','Prancha de 60 segundos','Mantém a posição de prancha durante 60 segundos.',60,'seg','manual','PLANK',13),
('ex-sets','exercicios','Três séries completas','Regista três séries de um exercício.',3,'séries','manual','3 SET',14),
('ex-100','exercicios','100 repetições','Acumula 100 repetições de exercícios.',100,'reps','manual','100',15),
('ex-4sessions','exercicios','Quatro sessões','Completa quatro sessões de exercício.',4,'sessões','manual','4X',16),
('cardio-15','cardio','Cardio 15 minutos','Regista 15 minutos de actividade cardiovascular.',15,'min','manual','15 MIN',17),
('cardio-30','cardio','Cardio 30 minutos','Regista 30 minutos de actividade cardiovascular.',30,'min','manual','30 MIN',18),
('cardio-3','cardio','Três sessões de cardio','Completa três sessões de cardio.',3,'sessões','manual','3X',19),
('cardio-120','cardio','120 minutos semanais','Acumula 120 minutos de cardio.',120,'min','manual','120',20)
on conflict (id) do nothing;

insert into storage.buckets
(id,name,public,file_size_limit,allowed_mime_types)
values (
  'fitness-challenge-videos',
  'fitness-challenge-videos',
  false,
  524288000,
  array['video/mp4']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 524288000,
  allowed_mime_types = array['video/mp4'];
