/**
 * AGENT_OUTPUT_SCRIPT=zh-TW pins agent writes to Traditional Chinese at the
 * CLI. Chat, email and card comments were covered first; documents, boards,
 * columns, cards and calendar events reach the same people, so they go
 * through the same pin. Strings used to LOCATE text (doc replace --find,
 * replace-block --anchor) are not converted up front, but fall back to the
 * converted form on a miss, so an agent quoting its own Simplified draft
 * still finds the Traditional text that was stored.
 */
import { test, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../db/pool.js'
import { env } from '../env.js'
import { ensureSchemaOnce, resetAllTables, seedCompanyWithAgent, teardownAll } from './_helpers.js'
import { runCli } from '../agents/cli.js'

const original = env.AGENT_OUTPUT_SCRIPT
const mutableEnv = env as { AGENT_OUTPUT_SCRIPT: string }

before(async () => { await ensureSchemaOnce() })
beforeEach(async () => {
  await resetAllTables()
  mutableEnv.AGENT_OUTPUT_SCRIPT = 'zh-TW'
})
after(async () => {
  mutableEnv.AGENT_OUTPUT_SCRIPT = original
  await teardownAll()
})

async function cli(args: string[]): Promise<{ text: string; sideEffects?: Array<Record<string, unknown>> }> {
  const res = await runCli(args)
  assert.equal(res.ok, true, `${args.slice(2, 4).join(' ')} failed: ${res.text}`)
  return res
}

async function docText(documentId: string): Promise<string> {
  const { evictDocumentRoom, readDocumentText } = await import('../documents/rooms.js')
  evictDocumentRoom(documentId)
  return String(await readDocumentText(documentId, 'x'))
}

test('[integration] boards, columns and cards are stored in Traditional Chinese', async () => {
  const { agentId } = await seedCompanyWithAgent()
  const as = ['--as', agentId]

  const board = await cli([...as, 'kanban', 'create', '运维看板', '--description', '这是说明'])
  const boardId = String(board.sideEffects?.[0]?.boardId)
  const column = await cli([...as, 'kanban', 'add-column', boardId, '待处理'])
  const columnId = String(column.sideEffects?.[0]?.columnId)
  const card = await cli([...as, 'card', 'add', boardId, '检查软件', '--column', columnId, '--description', '内存不足'])
  const cardId = String(card.sideEffects?.[0]?.cardId)

  const created = await pool.query<{ b: string; bd: string; c: string; t: string; d: string }>(
    `SELECT b.title AS b, b.description AS bd, col.title AS c, card.title AS t, card.description AS d
       FROM boards b JOIN board_columns col ON col.id = $2 JOIN board_cards card ON card.id = $3
      WHERE b.id = $1`, [boardId, columnId, cardId],
  )
  assert.deepEqual(created.rows[0], { b: '運維看板', bd: '這是說明', c: '待處理', t: '檢查軟體', d: '記憶體不足' })

  await cli([...as, 'kanban', 'rename', boardId, '--title', '发布看板', '--description', '新的说明'])
  await cli([...as, 'kanban', 'edit-column', boardId, columnId, '--title', '进行中'])
  await cli([...as, 'card', 'edit', cardId, '--title', '更新视频', '--description', '上传失败'])

  const edited = await pool.query<{ b: string; bd: string; c: string; t: string; d: string }>(
    `SELECT b.title AS b, b.description AS bd, col.title AS c, card.title AS t, card.description AS d
       FROM boards b JOIN board_columns col ON col.id = $2 JOIN board_cards card ON card.id = $3
      WHERE b.id = $1`, [boardId, columnId, cardId],
  )
  assert.deepEqual(edited.rows[0], { b: '釋出看板', bd: '新的說明', c: '進行中', t: '更新影片', d: '上傳失敗' })
})

test('[integration] calendar event titles and descriptions are stored in Traditional Chinese', async () => {
  const { agentId } = await seedCompanyWithAgent()
  const as = ['--as', agentId]

  const created = await cli([...as, 'calendar', 'create', '周会准备', '--at', '2026-06-01T10:00:00.000Z', '--assignee', agentId, '--prompt', '准备周会'])
  const eventId = String(created.sideEffects?.[0]?.calendarEventId)
  await cli([...as, 'calendar', 'update', eventId, '--description', '记得带资料'])

  const first = await pool.query<{ title: string; description: string; agent_prompt: string }>(
    `SELECT title, description, agent_prompt FROM calendar_events WHERE id = $1`, [eventId],
  )
  // The prompt is an instruction to an agent, not text for people: left as written.
  assert.deepEqual(first.rows[0], { title: '週會準備', description: '記得帶資料', agent_prompt: '准备周会' })

  await cli([...as, 'calendar', 'update', eventId, '--title', '项目复盘'])
  const renamed = await pool.query<{ title: string }>(`SELECT title FROM calendar_events WHERE id = $1`, [eventId])
  assert.equal(renamed.rows[0].title, '專案復盤')
})

test('[integration] document text is stored in Traditional Chinese, and edits still find it', async () => {
  const { agentId } = await seedCompanyWithAgent()
  const as = ['--as', agentId]

  const created = await cli([...as, 'doc', 'create', '会议记录', '--body', '我们讨论了软件。'])
  const docId = (created.text.match(/doc_[0-9a-f]+/) ?? [])[0]
  assert.ok(docId, created.text)
  await cli([...as, 'doc', 'append', docId, '下一步：上传视频。'])
  await cli([...as, 'doc', 'prepend', docId, '摘要：内存不足。'])

  const title = await pool.query<{ title: string }>(`SELECT title FROM documents WHERE id = $1`, [docId])
  assert.equal(title.rows[0].title, '會議記錄')
  let text = await docText(docId)
  for (const s of ['我們討論了軟體。', '下一步：上傳影片。', '摘要：記憶體不足。']) assert.ok(text.includes(s), text)

  // --find quotes the agent's own Simplified draft; the stored text is Traditional.
  await cli([...as, 'doc', 'replace', docId, '--find', '我们讨论了软件', '--replace', '我们决定换软件'])
  // --anchor likewise.
  await cli([...as, 'doc', 'replace-block', docId, '--anchor', '上传视频', '下一步：发布新版本。'])
  await cli([...as, 'doc', 'rename', docId, '周会纪要'])

  text = await docText(docId)
  assert.ok(text.includes('我們決定換軟體'), text)
  assert.ok(text.includes('下一步：釋出新版本。'), text)
  assert.ok(!text.includes('上傳影片'), text)
  const renamed = await pool.query<{ title: string }>(`SELECT title FROM documents WHERE id = $1`, [docId])
  assert.equal(renamed.rows[0].title, '週會紀要')
})

test('[integration] with the pin off, agent text is stored exactly as written', async () => {
  mutableEnv.AGENT_OUTPUT_SCRIPT = ''
  const { agentId } = await seedCompanyWithAgent()
  const board = await cli(['--as', agentId, 'kanban', 'create', '运维看板'])
  const boardId = String(board.sideEffects?.[0]?.boardId)
  const { rows } = await pool.query<{ title: string }>(`SELECT title FROM boards WHERE id = $1`, [boardId])
  assert.equal(rows[0].title, '运维看板')
})
