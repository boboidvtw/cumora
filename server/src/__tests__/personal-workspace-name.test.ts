import { test } from 'node:test'
import assert from 'node:assert/strict'
import { personalWorkspaceName } from '../personal-workspace.js'

test('a zh-TW deployment names a new workspace in Chinese', () => {
  assert.equal(personalWorkspaceName('boboidvtw', 'zh-TW'), 'boboidvtw 的工作區')
})

test('any other locale keeps the upstream English name', () => {
  assert.equal(personalWorkspaceName('Erika'), "Erika's workspace")
  assert.equal(personalWorkspaceName('Erika', 'en'), "Erika's workspace")
})
