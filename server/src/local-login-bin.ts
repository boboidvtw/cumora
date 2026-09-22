/**
 * Operator-only local sign-in for a self-hosted, single-machine deployment.
 *
 *   tsx server/src/local-login-bin.ts login     --email <email> [--name <name>]
 *   tsx server/src/local-login-bin.ts pair-code --email <email>
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

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2)
  if (command === 'login') await login(argv)
  else if (command === 'pair-code') await pairCode(argv)
  else throw new Error('usage: local-login-bin.ts login --email <email> [--name <name>] | pair-code --email <email>')
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
