import { PGlite } from '@electric-sql/pglite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 全项目唯一的数据库出口，地位等同于 lib/ai/model.ts。
 *
 * v0.2 用 PGlite（WASM 版 Postgres）而不是真 Postgres，原因很实际：
 * 教学仓库要能做到「clone 下来不装 Docker 就能跑」。真 Postgres 需要
 * docker-compose 或本地装服务，很多读者第一步就卡死在这里。
 * PGlite 跑的是真 Postgres 的 SQL 引擎，建表语句、jsonb、索引、事务
 * 全部一致，第 5 篇还能挂 vector 扩展，所以这不是「先凑合再重写」。
 *
 * 边界（第 13 篇会处理）：PGlite 是单进程嵌入式，不能多实例共享，
 * 上线必须换成真 Postgres。届时只改这个文件，业务层一行不动——
 * 这就是第一天就收口的意义。
 */

const DATA_DIR = process.env.PGLITE_DATA_DIR ?? join(process.cwd(), '.data', 'pg')

// Next.js dev 模式会热重载模块，不用 globalThis 存的话，
// 每次改代码都会新建一个 PGlite 实例去抢同一个数据目录，直接报错。
declare global {
  // eslint-disable-next-line no-var
  var __agentDb: Promise<PGlite> | undefined
}

async function init(): Promise<PGlite> {
  // 真实踩过的坑：PGlite 只创建路径的最后一层（pg），
  // 不会递归建父目录。全新 clone 下来 .data 不存在，
  // 第一次请求直接 ENOENT: mkdir '.data/pg'。
  // 所以这里必须先 recursive 建好父目录，不然「零安装」就是假的。
  mkdirSync(dirname(DATA_DIR), { recursive: true })

  const db = new PGlite(DATA_DIR)
  await db.waitReady

  // 每次启动都执行一遍 CREATE TABLE IF NOT EXISTS。
  // 教学项目不做 migration 工具，等第 9 篇 schema 稳定了再引入。
  const schema = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8')
  await db.exec(schema)
  return db
}

export function getDb(): Promise<PGlite> {
  if (!globalThis.__agentDb) {
    globalThis.__agentDb = init().catch((err) => {
      // 第二个坑：单例缓存的是 Promise。第一次初始化若抛错，
      // 这个 rejected Promise 会永远挂在 globalThis 上，
      // 之后每个请求都直接失败——哪怕你已经把 bug 修好了。
      // 所以失败时必须把缓存清空，让下一次请求能重新初始化。
      globalThis.__agentDb = undefined
      throw err
    })
  }
  return globalThis.__agentDb
}
