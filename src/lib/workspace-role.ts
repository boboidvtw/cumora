import type { MessageKey } from '@/lib/i18n'

const ROLE_KEY: Record<string, MessageKey> = {
  owner: 'workspace.roleOwner',
  admin: 'workspace.roleAdmin',
  member: 'workspace.roleMember',
}

/** A workspace member role for display. Unknown roles pass through as is,
 *  so a new server-side role shows its own name rather than "member". */
export function workspaceRoleLabel(t: (key: MessageKey) => string, role: string): string {
  const key = ROLE_KEY[role]
  return key ? t(key) : role
}
