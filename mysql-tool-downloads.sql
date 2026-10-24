-- ==================================================================
-- DTD TOOLS — optional MySQL mirror of the customer capture table.
-- Not required (Supabase is the primary store). Only used when
-- MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE are set
-- AND this table exists.
-- ==================================================================

create table if not exists tool_downloads (
  id int auto_increment primary key,
  name varchar(120) not null,
  email varchar(200) not null,
  phone varchar(60),
  tool varchar(120),
  tool_name varchar(160),
  kind varchar(20) default 'free',
  price_usd decimal(10,2) null,
  file varchar(300),
  source varchar(20) default 'web',
  ip varchar(80),
  user_agent varchar(300),
  created_at timestamp default current_timestamp
);

create index idx_tool_downloads_created_at on tool_downloads (created_at desc);