-- Supabase > SQL Editor 에 붙여넣고 Run

create table if not exists rules (
  id bigint generated always as identity primary key,
  name text not null,
  topic text not null,
  include text[] not null default '{}',
  exclude text[] not null default '{}',
  tags text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists bids (
  key text primary key,                 -- 공고번호-차수
  bid_no text,
  bid_ord text,
  title text not null,
  org text,
  demand_org text,
  price bigint,
  posted_at timestamptz,
  close_at timestamptz,
  url text,
  matched_rules text[] not null default '{}',
  keywords text[] not null default '{}',
  notified_rule_ids bigint[] not null default '{}',
  status text not null default 'new' check (status in ('new','review','join','pass')),
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bids_created_idx on bids (created_at desc);

create table if not exists runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  fetched int, matched int, sent int, failed int,
  error text,
  duration_ms int
);

-- 외부(익명) 접근 차단: 사이트 서버만 service_role 키로 접근
alter table rules enable row level security;
alter table bids  enable row level security;
alter table runs  enable row level security;

-- 예시 규칙 (사이트에서 수정 가능, 토픽 이름은 꼭 바꾸세요)
insert into rules (name, topic, include, exclude) values
 ('이러닝·영상 콘텐츠', 'bid-elearning-change-me-7k2q9',
  array['이러닝','e-러닝','영상 콘텐츠','동영상','콘텐츠 제작','콘텐츠 개발','교수설계'],
  array['CCTV','유지보수','영상정보처리기기']),
 ('AI·교육 운영', 'bid-aiedu-change-me-3m8x1',
  array['AI 교육','인공지능 교육','디지털 교육','교육 운영','연수 운영','교육과정 개발'],
  array['급식','청소']);

-- v10: 첨부파일 목록
alter table bids add column if not exists files jsonb not null default '[]';

-- v13: AI 공고 분석
alter table bids add column if not exists analysis jsonb;
alter table bids add column if not exists analyzed_at timestamptz;
