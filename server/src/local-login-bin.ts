/**
 * Operator-only local sign-in for a self-hosted, single-machine deployment.
 *
 *   tsx server/src/local-login-bin.ts login        --email <email> [--name <name>]
 *   tsx server/src/local-login-bin.ts pair-code    --email <email>
 *   tsx server/src/local-login-bin.ts set-language --email <email> [--language <text>]
 *   tsx server/src/local-login-bin.ts create-agent --email <email> --name <name>
 *       [--role <role>] [--bio <bio>] --prompt-file <path> [--engine <id>]
 *   tsx server/src/local-login-bin.ts set-persona  --email <email> --agent <id>
 *       [--role <role>] [--bio <bio>] --prompt-file <path>
 *
 * `login` finds or creates the user through the same find-or-create path the
 * OAuth callback uses (a new user gets a personal workspace, and an email on
 * CUMORA_ADMIN_EMAILS is an admin), mints a session and prints the sign-in URL
 * — AUTH_DONE_URL with `#token=…` — on stdout. `pair-code` prints the company's
 * persistent computer pairing token for that user's first workspace.
 *
 * Why this is not an auth bypass: it is not reachable over HTTP. Running it
 * needs a shell inside the server container, i.e. the DATABASE_URL and
 * AGENT_RUNTIME_SECRET already, which is full control of the deployment. The
 * identity is recorded as provider `local`; a later GitHub / Google sign-in
 * with the same verified email links onto the same user (oauth.ts Path B).
 *
 * stdout carries only the secret-bearing result so a wrapper can hand it
 * straight to `open` / the daemon without echoing it; diagnostics go to stderr.
 * Several server modules log from their top level (storage mode, env
 * warnings), so console output is pointed at stderr BEFORE they load — hence
 * the dynamic imports below instead of static ones.
 */
console.log = console.error
console.info = console.error
console.warn = console.error

// No static imports, so mark this as a module for top-level await.
export {}

const { pool } = await import('./db/pool.js')
const { redis, sub } = await import('./redis.js')
const { env } = await import('./env.js')
const { audit, createSession } = await import('./auth.js')
const { doneUrl, findOrCreateUserByProfile } = await import('./oauth.js')
const { issuePairingCode } = await import('./agents/computer/registry.js')
const { invalidatePersonaCache } = await import('./agents/personas.js')

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1]!
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : null
}

function requireEmail(argv: string[]): string {
  const email = flag(argv, 'email')?.trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('--email <address> is required')
  }
  return email
}

async function login(argv: string[]): Promise<void> {
  const email = requireEmail(argv)
  const displayName = flag(argv, 'name')?.trim() || email.split('@')[0]!
  const result = await findOrCreateUserByProfile('local', {
    providerId: email,
    email,
    displayName,
    avatarUrl: null,
  })
  const { token } = await createSession(result.userId, { ua: 'cumora-local-login' })
  await audit({
    kind: 'login',
    userId: result.userId,
    companyId: result.companyId,
    userAgent: 'cumora-local-login',
    detail: { provider: 'local', email: result.email },
  })
  console.error(`[local-login] signed in ${result.email} (${result.userId}) · workspace ${result.companyId ?? '(none)'}`)
  process.stdout.write(`${doneUrl(env.AUTH_DONE_URL, token, result.companyId)}\n`)
}

async function pairCode(argv: string[]): Promise<void> {
  const email = requireEmail(argv)
  const { rows } = await pool.query<{ user_id: string; company_id: string }>(
    `SELECT u.id AS user_id, cm.company_id
       FROM users u
       JOIN company_members cm ON cm.user_id = u.id AND cm.role IN ('owner', 'admin')
      WHERE LOWER(u.email) = $1
      ORDER BY cm.joined_at ASC
      LIMIT 1`,
    [email],
  )
  const row = rows[0]
  if (!row) throw new Error(`no workspace owned by ${email} — run \`login\` first`)
  const { code } = await issuePairingCode({ companyId: row.company_id, ownerUserId: row.user_id })
  console.error(`[local-login] pairing token for workspace ${row.company_id}`)
  process.stdout.write(`${code}\n`)
}

/** The workspace this operator owns or administers, oldest membership first. */
async function ownedWorkspace(email: string): Promise<{ userId: string; companyId: string }> {
  const { rows } = await pool.query<{ user_id: string; company_id: string }>(
    `SELECT u.id AS user_id, cm.company_id
       FROM users u
       JOIN company_members cm ON cm.user_id = u.id AND cm.role IN ('owner', 'admin')
      WHERE LOWER(u.email) = $1
      ORDER BY cm.joined_at ASC
      LIMIT 1`,
    [email],
  )
  const row = rows[0]
  if (!row) throw new Error(`no workspace owned by ${email} — run \`login\` first`)
  return { userId: row.user_id, companyId: row.company_id }
}

const LANGUAGE_BEGIN = '<!-- cumora:language -->'
const LANGUAGE_END = '<!-- /cumora:language -->'
const DEFAULT_LANGUAGE_RULE =
  '語言：跟這個團隊說話一律用繁體中文，台灣用語（軟體、資料、設定、帳號、影片）。' +
  '不要用簡體字，也不要用中國大陸的說法。對方用英文寫時才用英文回。'

/** Pin the reply language of every agent in the workspace.
 *
 *  Why here and not in the prompt rules: the BYOA daemon ships its own copy of
 *  AGENT_VOICE_RULES (it is published to npm as `cumora`), so a rule edit in
 *  this repo does not reach an agent running on the packaged daemon. The
 *  persona does — participants.system_prompt is served from here, and the
 *  daemon rewrites the agent's CLAUDE.md / AGENTS.md from it on every start.
 *
 *  Idempotent: the block between the markers is replaced, not appended. */
async function setLanguage(argv: string[]): Promise<void> {
  const email = requireEmail(argv)
  const rule = flag(argv, 'language')?.trim() || DEFAULT_LANGUAGE_RULE
  const { companyId } = await ownedWorkspace(email)
  const block = `${LANGUAGE_BEGIN}\n${rule}\n${LANGUAGE_END}`
  const { rows } = await pool.query<{ id: string; name: string }>(
    `UPDATE participants
        SET system_prompt = TRIM(BOTH E'\n' FROM
              CASE
                WHEN POSITION($2 IN COALESCE(system_prompt, '')) > 0
                  THEN LEFT(system_prompt, POSITION($2 IN system_prompt) - 1)
                ELSE COALESCE(system_prompt, '')
              END) || E'\n\n' || $3
      WHERE company_id = $1 AND kind = 'agent' AND departed_at IS NULL
      RETURNING id, name`,
    [companyId, LANGUAGE_BEGIN, block],
  )
  for (const row of rows) invalidatePersonaCache(row.id)
  console.error(`[local-login] language pinned for ${rows.length} agent(s) in ${companyId}: ${rows.map((r) => r.name).join(', ')}`)
  process.stdout.write(`${rows.length}\n`)
}

/** Create an agent on this workspace's own paired computer.
 *
 *  Goes through the server's own `POST /api/agents` rather than writing the
 *  rows here: that endpoint also joins #all-hands, seeds IDENTITY.md / SOUL.md,
 *  opens the 1:1 conversation and kicks off the portrait. A session is minted
 *  for the operator, used in-process, and deleted again — it never leaves this
 *  process. */
/** Run one authenticated call as the operator. The session lives only for the
 *  duration of the call and is deleted afterwards, so nothing leaks to disk. */
async function asOperator<T>(
  userId: string,
  companyId: string,
  run: (request: (path: string, init: RequestInit) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const ua = 'cumora-local-admin-cli'
  const { token } = await createSession(userId, { ua })
  try {
    return await run(async (path, init) => {
      const res = await fetch(`http://127.0.0.1:${env.PORT}${path}`, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'x-company-id': companyId,
        },
      })
      const payload = await res.json().catch(() => ({})) as { error?: string } & Record<string, unknown>
      if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} ${res.status}: ${payload.error ?? '(no detail)'}`)
      return payload
    })
  } finally {
    await pool.query(`DELETE FROM sessions WHERE user_id = $1 AND user_agent = $2`, [userId, ua])
  }
}

/** Rewrite an existing agent's persona (style, role, bio) from a file.
 *  PUT /api/agents/:id also invalidates the persona cache, and the daemon
 *  rebuilds that agent's runner when its system prompt changes. Re-run
 *  `set-language` afterwards: this replaces the whole prompt, language block
 *  included. */
async function setPersona(argv: string[]): Promise<void> {
  const email = requireEmail(argv)
  const agentId = flag(argv, 'agent')?.trim()
  if (!agentId) throw new Error('--agent <id> is required')
  const promptFile = flag(argv, 'prompt-file')
  const prompt = promptFile
    ? await (await import('node:fs/promises')).readFile(promptFile, 'utf8')
    : flag(argv, 'prompt') ?? ''
  if (prompt.trim().length < 10) throw new Error('--prompt-file <path> (or --prompt) is required')
  const { userId, companyId } = await ownedWorkspace(email)
  await asOperator(userId, companyId, (request) => request(`/api/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      systemPrompt: prompt.trim(),
      role: flag(argv, 'role')?.trim() || undefined,
      bio: flag(argv, 'bio')?.trim() || undefined,
    }),
  }))
  console.error(`[local-login] persona updated for ${agentId}`)
  process.stdout.write(`${agentId}\n`)
}

async function createAgent(argv: string[]): Promise<void> {
  const email = requireEmail(argv)
  const name = flag(argv, 'name')?.trim()
  if (!name) throw new Error('--name <name> is required')
  const promptFile = flag(argv, 'prompt-file')
  const prompt = promptFile
    ? await (await import('node:fs/promises')).readFile(promptFile, 'utf8')
    : flag(argv, 'prompt') ?? ''
  if (prompt.trim().length < 10) throw new Error('--prompt-file <path> (or --prompt) is required')
  const { userId, companyId } = await ownedWorkspace(email)

  // Free tier can only place agents on a paired computer, never Cumora Cloud.
  const { rows: computers } = await pool.query<{ id: string; name: string; status: string }>(
    `SELECT id, name, status FROM computers
      WHERE company_id = $1 AND kind IN ('local', 'vps')
      ORDER BY (status = 'online') DESC, last_seen_at DESC NULLS LAST
      LIMIT 1`,
    [companyId],
  )
  const computer = computers[0]
  if (!computer) throw new Error('no paired computer in this workspace — run ./pair.sh first')

  const created = await asOperator(userId, companyId, (request) => request('/api/agents', {
    method: 'POST',
    body: JSON.stringify({
      name,
      role: flag(argv, 'role')?.trim() || undefined,
      bio: flag(argv, 'bio')?.trim() || undefined,
      systemPrompt: prompt.trim(),
      computerId: computer.id,
      engine: flag(argv, 'engine')?.trim() || undefined,
      inherit: !flag(argv, 'engine'),
    }),
  })) as { id?: string }
  console.error(`[local-login] created agent ${created.id} (${name}) on ${computer.name} [${computer.status}]`)
  process.stdout.write(`${created.id ?? ''}\n`)
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2)
  if (command === 'login') await login(argv)
  else if (command === 'pair-code') await pairCode(argv)
  else if (command === 'set-language') await setLanguage(argv)
  else if (command === 'create-agent') await createAgent(argv)
  else if (command === 'set-persona') await setPersona(argv)
  else throw new Error('usage: local-login-bin.ts login --email <email> [--name <name>] | pair-code --email <email> | set-language --email <email> [--language <text>] | create-agent --email <email> --name <name> --prompt-file <path> | set-persona --email <email> --agent <id> --prompt-file <path>')
}

let exitCode = 0
try {
  await main()
} catch (e) {
  console.error(`[local-login] ${e instanceof Error ? e.message : String(e)}`)
  exitCode = 1
} finally {
  try { await pool.end() } catch { /* ignore */ }
  try { redis.disconnect() } catch { /* ignore */ }
  try { sub.disconnect() } catch { /* ignore */ }
}
process.exit(exitCode)
