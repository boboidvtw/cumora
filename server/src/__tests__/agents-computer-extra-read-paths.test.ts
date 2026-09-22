/**
 * `CUMORA_AGENT_READ_PATHS` — the self-hosting escape hatch that lets an agent
 * read a real project tree instead of only its own home.
 *
 * It widens a SANDBOX boundary, so the parsing has to stay fail-closed: a typo,
 * a file, a relative path or a deleted directory must widen nothing at all
 * rather than fall back to something broader. These pin that, and that the
 * default (unset) still yields no extra access.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, it } from 'node:test'
import { extraAgentReadPaths, secretReadDenyRules } from '../agents/computer/engine.js'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'cumora-read-paths-')))
const projects = join(root, 'Projects')
const file = join(root, 'notes.txt')
writeFileSync(file, 'x')
const { mkdirSync } = await import('node:fs')
mkdirSync(projects)

describe('extraAgentReadPaths', () => {
  it('is empty when the variable is unset or blank', () => {
    assert.deepEqual(extraAgentReadPaths({}), [])
    assert.deepEqual(extraAgentReadPaths({ CUMORA_AGENT_READ_PATHS: '   ' }), [])
  })

  it('keeps existing absolute directories, resolved to their real path', () => {
    assert.deepEqual(extraAgentReadPaths({ CUMORA_AGENT_READ_PATHS: projects }), [projects])
  })

  it('drops relative paths, missing paths and plain files', () => {
    const env = {
      CUMORA_AGENT_READ_PATHS: ['Projects', join(root, 'nope'), file, projects].join(delimiter),
    }
    assert.deepEqual(extraAgentReadPaths(env), [projects])
  })

  it('de-duplicates, including through a symlink to the same directory', () => {
    const link = join(root, 'link-to-projects')
    symlinkSync(projects, link)
    const env = { CUMORA_AGENT_READ_PATHS: [projects, link, projects].join(delimiter) }
    assert.deepEqual(extraAgentReadPaths(env), [projects])
  })
})

describe('secretReadDenyRules', () => {
  it('denies each secret glob by absolute path, not only relative to the workspace', () => {
    // A one-slash rule is workspace-relative: claude 2.1.270 still reads
    // /Users/me/project/.env through it. The two-slash form is the one that
    // blocks, and an --add-dir project tree is exactly where that matters.
    for (const rule of ['Read(**/.env)', 'Read(//**/.env)', 'Read(//**/.ssh/**)', 'Edit(//**/.env.*)']) {
      assert.ok(secretReadDenyRules().includes(rule), rule)
    }
    assert.ok(!secretReadDenyRules().some((r) => /^Read\(\/\*\*/.test(r)), 'no single-slash absolute rules')
  })
})
