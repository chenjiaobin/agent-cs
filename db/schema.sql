-- v0.2（第 2 篇）：会话与消息落库
--
-- 为什么不用「一张 messages 表存纯文本」就够了？
-- 因为第 3 篇一上工具调用，DeepSeek 要求带 tools 的请求把历史轮次的
-- reasoning_content 原样回传，少一个字段直接 400。到时候再 ALTER TABLE
-- 补字段、修历史数据，比现在多留三列麻烦得多。
--
-- 表里的 reasoning_content / tool_calls / usage 三列，第 2 篇先空着，
-- 是为了给第 3、10、11 篇留位置，不是过度设计。

CREATE TABLE IF NOT EXISTS conversations (
  id          text PRIMARY KEY,
  -- 第 9 篇做多租户隔离时会用到。现在写死 'local'，但列要在，
  -- 否则到时候每一行都要回填，还得停机。
  tenant_id   text        NOT NULL DEFAULT 'local',
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id                text PRIMARY KEY,
  conversation_id   text        NOT NULL
                    REFERENCES conversations(id) ON DELETE CASCADE,
  role              text        NOT NULL
                    CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content           text        NOT NULL DEFAULT '',

  -- 思考内容。DeepSeek 开思考时和 content 同级返回，带 tools 的请求必须回传。
  reasoning_content text,

  -- 第 3 篇工具调用的入参/结果，存整段 JSON，别拆成列。
  tool_calls        jsonb,

  -- 第 10/11 篇的链路追踪与成本核算：token、模型名、结束原因。
  usage             jsonb,
  model             text,
  finish_reason     text,

  -- 关键：区分「正常说完」和「流到一半断了」。
  -- 断流时不删这行，而是标成 aborted，用户刷新后能看到半截回答和提示，
  -- 而不是以为自己的消息发丢了。
  status            text        NOT NULL DEFAULT 'done'
                    CHECK (status IN ('done', 'aborted', 'error')),

  created_at        timestamptz NOT NULL DEFAULT now()
);

-- 拉历史永远是按会话 + 时间顺序，这个索引从第一天就要有。
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at);
