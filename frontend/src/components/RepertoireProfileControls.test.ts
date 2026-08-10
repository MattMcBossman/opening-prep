import { describe, expect, it } from 'vitest'
import { validateManagementName } from '../lib/managementValidation'

describe('validateManagementName', () => {
  it('requires a visible name', () => {
    expect(validateManagementName('   ', [])).toBe('Enter a name.')
  })

  it('rejects duplicate names without case sensitivity', () => {
    expect(validateManagementName(' tournament ', ['Tournament'])).toBe('“tournament” is already in use.')
  })

  it('allows an unchanged current name and trims valid names', () => {
    expect(validateManagementName('Tournament', ['Tournament'], 'Tournament')).toBeNull()
    expect(validateManagementName('  Blitz  ', ['Tournament'])).toBeNull()
  })

  it('enforces the API-compatible length limit', () => {
    expect(validateManagementName('x'.repeat(101), [])).toBe('Use 100 characters or fewer.')
  })
})
