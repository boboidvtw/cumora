import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translate, type MessageKey } from '../src/lib/i18n.ts'
import { workspaceRoleLabel } from '../src/lib/workspace-role.ts'

const zh = (key: MessageKey) => translate('zh-TW', key)

// The workspace switcher printed the raw role ("owner") under each workspace.
test('workspace roles show translated', () => {
  assert.equal(workspaceRoleLabel(zh, 'owner'), '所有者')
  assert.equal(workspaceRoleLabel(zh, 'admin'), '管理員')
  assert.equal(workspaceRoleLabel(zh, 'member'), '成員')
})

test('an unknown role is shown as is rather than mislabeled', () => {
  assert.equal(workspaceRoleLabel(zh, 'guest'), 'guest')
})
