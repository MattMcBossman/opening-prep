const MAX_MANAGEMENT_NAME_LENGTH = 100

export function validateManagementName(value: string, existingNames: string[], currentName?: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return 'Enter a name.'
  if (trimmed.length > MAX_MANAGEMENT_NAME_LENGTH) return `Use ${MAX_MANAGEMENT_NAME_LENGTH} characters or fewer.`
  const duplicate = existingNames.some((name) => name !== currentName && name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
  return duplicate ? `“${trimmed}” is already in use.` : null
}
