#!/usr/bin/env node
/**
 * scan-i18n-leftovers — finds user-visible English that never went through t().
 *
 *   A regex grep misses most leftovers (text split across JSX lines, labels in
 *   data tables, fallbacks inside template strings), so this walks the
 *   TypeScript AST of src/**\/*.tsx and reports:
 *     jsx-text   bare text between tags
 *     attr:<x>   string props that render (placeholder, title, aria-label…)
 *     literal    prose-looking string literals outside t()/tLabel()/console/…
 *     template   prose-looking template strings outside t()
 *
 * It is a heuristic. Reviewed false positives (CSS classes, CLI commands,
 * English data tables that already have a parallel *_KEY lookup, …) live in
 * scripts/i18n-scan-allowlist.json, keyed by file + text so line drift after
 * an upstream merge doesn't resurface them. Only hits NOT in the allowlist are
 * printed, and the script exits 1 when there are any.
 *
 * Run after merging upstream:
 *   node scripts/scan-i18n-leftovers.mjs            # new hits only
 *   node scripts/scan-i18n-leftovers.mjs --all      # every hit, allowlisted too
 *   node scripts/scan-i18n-leftovers.mjs --update   # accept current hits as reviewed
 *
 * Fix real leftovers first, then --update so the remainder is recorded as
 * reviewed. --update also drops allowlist entries that no longer match.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allowlistPath = path.join(root, 'scripts', 'i18n-scan-allowlist.json')
const args = new Set(process.argv.slice(2))

// Props that render as text even when the value is a single word.
const VISIBLE_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label', 'aria-description', 'aria-placeholder', 'tooltip', 'emptyText', 'confirmLabel', 'cancelLabel', 'description', 'hint', 'heading', 'subtitle', 'message', 'text'])
// Props whose string values are identifiers, not prose.
const SKIP_ATTRS = new Set(['className', 'class', 'style', 'id', 'key', 'type', 'name', 'role', 'href', 'src', 'target', 'rel', 'variant', 'size', 'as', 'to', 'method', 'autoComplete', 'inputMode', 'mode', 'kind', 'tone', 'icon', 'data-testid', 'htmlFor', 'form', 'accept', 'enterKeyHint', 'autoCapitalize', 'spellCheck', 'dir', 'lang', 'viewBox', 'd', 'fill', 'stroke', 'xmlns', 'loading', 'decoding', 'sizes', 'srcSet', 'position', 'side', 'align', 'placement', 'color', 'width', 'height', 'pattern', 'value', 'defaultValue', 'download'])
// Calls whose string arguments are not shown to a person (or are already translated).
const NON_UI_CALLEE = /(^|\.)(t|tNow|tLabel|tr|translate|formatMessage|console\.\w+|Error|cn|clsx|classNames|setItem|getItem|addEventListener|removeEventListener|querySelector|startsWith|endsWith|includes|split|replace|test|match|fetch|http|navigate|track|emit|on|off)$/

const isProse = (s) => (/[A-Za-z]{2,}[\s.,!?:'’]+[A-Za-z]/.test(s)) || /^[A-Z][a-z]{2,}[.!?…]?$/.test(s.trim())
const isBrand = (s) => /^\s*(Cumora|GitHub|Google|OK|URL|ID|API|BYOA|Claude|Codex|Hermes|Email|LM Studio)\s*$/.test(s)
const isMessageKey = (s) => /^[a-z][\w-]*\.[\w.-]+$/.test(s)
const skipAttr = (name) => SKIP_ATTRS.has(name) || /^on[A-Z]|^data-/.test(name)

function insideNonUiContext(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && NON_UI_CALLEE.test(n.expression.getText())) return true
    if (ts.isNewExpression(n) && /Error|RegExp|URL|Date/.test(n.expression.getText())) return true
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return true
    if (ts.isJsxAttribute(n)) return skipAttr(n.name.getText())
    if (ts.isBinaryExpression(n) && /^[!=]==?$/.test(n.operatorToken.getText())) return true
    if (ts.isCaseClause(n) || ts.isElementAccessExpression(n)) return true
    if (ts.isTypeNode(n)) return true
    if (ts.isFunctionLike(n) || ts.isSourceFile(n)) return false
  }
  return false
}

const hits = []

function report(sf, node, kind, text) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
  hits.push({ file: path.relative(root, sf.fileName), line: line + 1, kind, text: text.trim().replace(/\s+/g, ' ').slice(0, 120) })
}

function scanFile(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const s = node.getText()
      if (/[A-Za-z]{2,}/.test(s) && !isBrand(s)) report(sf, node, 'jsx-text', s)
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText()
      const s = node.initializer.text
      if (!skipAttr(name) && /[A-Za-z]{2,}/.test(s) && !isBrand(s) && (VISIBLE_ATTRS.has(name) || isProse(s))) report(sf, node, `attr:${name}`, s)
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent)) {
      const s = node.text
      if (!isMessageKey(s) && isProse(s) && !isBrand(s) && !/^[\w-]+(\/[\w.-]+)+$/.test(s) && !/[{}<>=;]|^\.|https?:/.test(s) && !insideNonUiContext(node)) report(sf, node, 'literal', s)
    } else if (ts.isTemplateExpression(node) && !insideNonUiContext(node)) {
      const s = [node.head.text, ...node.templateSpans.map((x) => x.literal.text)].join(' ')
      if (isProse(s) && !/[{}<>=;]|https?:/.test(s)) report(sf, node, 'template', node.getText())
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!['locales', '__tests__', 'node_modules'].includes(e.name)) walk(p)
    } else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) {
      scanFile(p)
    }
  }
}

walk(path.join(root, 'src'))

const keyOf = (h) => `${h.file}\t${h.text}`

if (args.has('--update')) {
  const entries = [...new Set(hits.map(keyOf))].sort().map((k) => {
    const [file, text] = k.split('\t')
    return { file, text }
  })
  fs.writeFileSync(allowlistPath, JSON.stringify(entries, null, 2) + '\n')
  console.log(`wrote ${entries.length} reviewed entries to ${path.relative(root, allowlistPath)}`)
  process.exit(0)
}

const allowed = new Set(
  fs.existsSync(allowlistPath)
    ? JSON.parse(fs.readFileSync(allowlistPath, 'utf8')).map((e) => `${e.file}\t${e.text}`)
    : [],
)
const shown = args.has('--all') ? hits : hits.filter((h) => !allowed.has(keyOf(h)))
for (const h of shown) console.log(`${h.file}:${h.line}\t${h.kind}\t${JSON.stringify(h.text)}`)
console.error(`${shown.length} ${args.has('--all') ? 'hits' : 'new hits'} (${hits.length} total, ${allowed.size} allowlisted)`)
process.exit(shown.length > 0 && !args.has('--all') ? 1 : 0)
