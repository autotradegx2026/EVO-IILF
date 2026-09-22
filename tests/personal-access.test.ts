import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPersonalAccount, PERSONAL_ACCOUNT_EMAIL } from '../lib/supabase/personal-access'

test('personal workspace permits the configured email with case-insensitive matching', () => {
  assert.equal(isPersonalAccount(PERSONAL_ACCOUNT_EMAIL), true)
  assert.equal(isPersonalAccount(PERSONAL_ACCOUNT_EMAIL.toUpperCase()), true)
})

test('personal workspace rejects missing identities, other accounts, and email aliases', () => {
  for (const email of [undefined, null, '', 'admin@grindx.io', 'autotradegx2026+other@gmail.com', 'autotradegx2026@gmail.com.attacker.example']) {
    assert.equal(isPersonalAccount(email), false)
  }
})
