import type { MessageKey } from '@/lib/i18n'

type T = (key: MessageKey, vars?: Record<string, string | number>) => string

/** Fixed `{ error }` strings from server/src/api (router, admin-router,
 *  shipping-router) that a person can trigger from the UI. The server stays
 *  English — agents and API clients read the same bodies — so the text is
 *  matched here instead. A message that isn't listed, or one upstream
 *  rewords, is shown as sent. */
const EXACT: Record<string, MessageKey> = {
  'authentication required': 'apierr.authRequired',
  'internal server error': 'apierr.internal',
  'request entity too large': 'apierr.tooLarge',
  'not found': 'apierr.notFound',
  'conversation not found': 'apierr.conversationNotFound',
  'message not found': 'apierr.messageNotFound',
  'user not found': 'apierr.userNotFound',
  'account already deleted or not found': 'apierr.accountGone',
  'not a member': 'apierr.notMemberBare',
  'not a member of this conversation': 'apierr.notMember',
  'not a member of this thread': 'apierr.notMemberThread',
  'nothing to update': 'apierr.nothingToUpdate',
  'name required': 'apierr.nameRequired',
  'title required': 'apierr.titleRequired',
  'body required': 'apierr.bodyRequired',
  'empty message': 'apierr.emptyMessage',
  'emoji required': 'apierr.emojiRequired',
  'invalid email': 'apierr.invalidEmail',
  'waitlisted': 'apierr.waitlisted',
  'suspended': 'apierr.suspended',
  'that email is already a member of this workspace': 'apierr.alreadyMember',
  'invitation not found': 'apierr.inviteNotFound',
  'invitation revoked': 'apierr.inviteRevoked',
  'invitation expired': 'apierr.inviteExpired',
  'invitation already used': 'apierr.inviteUsed',
  'cannot DM yourself': 'apierr.dmSelf',
  'cannot leave a direct conversation': 'apierr.leaveDirect',
  'only members can add others': 'apierr.onlyMembersAdd',
  'pick at least one teammate': 'apierr.pickTeammate',
  'membership changed; add cancelled': 'apierr.membershipChanged',
  'membership changed; leave cancelled': 'apierr.membershipChangedLeave',
  'already off-boarded': 'apierr.alreadyOffboarded',
  'agent is not off-boarded': 'apierr.notOffboarded',
  'systemPrompt required (at least 10 chars — describe the agent\'s style)': 'apierr.systemPromptRequired',
  'until must be in the future': 'apierr.untilPast',
  'invalid until timestamp': 'apierr.untilInvalid',
  'invalid model id': 'apierr.invalidModelId',
  'no email address available for your account in this workspace': 'apierr.noEmailAddress',
  'no other recipients to reply to': 'apierr.noReplyRecipients',
  'to, subject, body required': 'apierr.emailFieldsRequired',
  'email replies require a body (attachments-only sends not supported here yet)': 'apierr.emailReplyBody',
  'cannot demote yourself': 'apierr.demoteSelf',
  'no settings to update': 'apierr.noSettings',
  'shipping feature not found': 'apierr.shipNotFound',
  'archived features are immutable': 'apierr.shipArchived',
  'problem, desired outcome, and contract summary are required before contract': 'apierr.shipNeedContract',
  'at least one builder is required before building': 'apierr.shipNeedBuilder',
  'at least one invariant is required before building': 'apierr.shipNeedInvariant',
  'every required invariant needs a required verification square': 'apierr.shipInvariantUncovered',
  'every required verification square needs an owner': 'apierr.shipSquareOwner',
  'ready requires passed user-path, trace-coverage, and release-note squares': 'apierr.shipReadyNeeds',
  'watching requires a successful production release': 'apierr.shipWatchingNeeds',
  'learned requires a passed production readback': 'apierr.shipLearnedNeeds',
  'learned is blocked by failing regressions': 'apierr.shipLearnedBlocked',
  'this action requires an owner or admin of the workspace': 'apierr.wsOwnerOrAdminRequired',
  'only workspace owners and admins can perform this action': 'apierr.wsOwnerOrAdminOnly',
  'role must be member or admin': 'apierr.wsRoleInvalid',
  'only the workspace owner can change member roles': 'apierr.wsOnlyOwnerChangesRoles',
  'workspace member not found': 'apierr.wsMemberNotFound',
  'workspace ownership cannot be changed here': 'apierr.wsOwnershipFixed',
  'use a dedicated leave-workspace flow to remove yourself': 'apierr.wsRemoveSelf',
  'only owners and admins can remove workspace members': 'apierr.wsOnlyAdminsRemove',
  'the workspace owner cannot be removed': 'apierr.wsOwnerNotRemovable',
  'admins can remove regular members only': 'apierr.wsAdminsRemoveMembersOnly',
  'only the workspace owner can delete it': 'apierr.wsOnlyOwnerDeletes',
  'type the workspace name exactly to confirm deletion': 'apierr.wsConfirmName',
  'you cannot delete your only workspace': 'apierr.wsLastWorkspace',
  'only the workspace owner can invite another admin': 'apierr.wsOnlyOwnerInvitesAdmin',
  'workspace not found': 'apierr.wsNotFound',
  'not a member of this company': 'apierr.wsNotMember',
  'no company memberships — create or join one': 'apierr.wsNone',
  'developer tools are not enabled': 'apierr.devToolsOff',
  'invalid or revoked device token': 'apierr.deviceTokenInvalid',
  'computer not found': 'apierr.computerNotFound',
  'computer not found or not re-pairable': 'apierr.computerNotRepairable',
  'computer not found or not revocable': 'apierr.computerNotRevocable',
  'engine is not installed on this computer': 'apierr.engineNotInstalled',
  'invalid pairing token': 'apierr.pairingTokenInvalid',
  'agent not assigned to this computer': 'apierr.agentNotOnComputer',
  'Free tier agents run on your own computer. Upgrade to Pro to use Cumora Cloud.': 'apierr.noCloud',
  'invalid computer, agent, engine, or provider profile for this company': 'apierr.computerSetupInvalid',
  'avatar generation is only for agents': 'apierr.avatarAgentsOnly',
  'image API returned no image': 'apierr.imageApiEmpty',
  'only group chats can be renamed': 'apierr.renameGroupsOnly',
  'unknown or inactive participant': 'apierr.participantUnknown',
  'participant is no longer active in this workspace': 'apierr.participantInactive',
  'every member must be an active participant in this workspace': 'apierr.membersMustBeActive',
  'conversation changed; retry the email reply': 'apierr.emailReplyRetry',
  'query too long (max 200 chars)': 'apierr.queryTooLong',
  'agent not found': 'apierr.agentNotFound',
  'file not found': 'apierr.fileNotFound',
  'column not found': 'apierr.columnNotFound',
  'event not found': 'apierr.eventNotFound',
  'title cannot be empty': 'apierr.titleEmpty',
  'only the creator or an owner can delete': 'apierr.onlyCreatorDeletes',
  'assigneeId not found in this workspace': 'apierr.assigneeNotFound',
  'agent_task events require an assigneeId': 'apierr.agentTaskNeedsAssignee',
  'unknown project': 'apierr.projectNotFound',
  'unknown email message': 'apierr.emailNotFound',
}

/** The fixed messages this module recognises (for tests). */
export const KNOWN_API_ERRORS = Object.keys(EXACT)

/** Templated messages: the pattern's groups become the key's variables. */
const PATTERNS: Array<[RegExp, MessageKey, string[]]> = [
  [/^this invitation is reserved for (.+) — sign in with that email to accept$/, 'apierr.inviteReserved', ['email']],
  [/^unresolved recipient: (.+)$/, 'apierr.unresolvedRecipient', ['who']],
  [/^unresolved cc: (.+)$/, 'apierr.unresolvedRecipient', ['who']],
  [/^unknown participant: (.+)$/, 'apierr.unknownParticipant', ['who']],
  [/^mime not allowed: (.+)$/, 'apierr.mimeNotAllowed', ['mime']],
  [/^size out of range \(got (\d+), max (\d+)\)$/, 'apierr.sizeOutOfRange', ['got', 'max']],
  [/^image generation failed: ([\s\S]+)$/, 'apierr.imageGenFailed', ['error']],
  [/^(\d+) required verification square\(s\) are not passed$/, 'apierr.shipSquaresNotPassed', ['n']],
  [/^(\w+) oauth not configured$/, 'apierr.oauthNotConfigured', ['provider']],
]

/** Translate a server error message where its text is known; anything
 *  unrecognised is returned unchanged. */
export function localizeApiError(text: string, t: T): string {
  const key = EXACT[text.trim()]
  if (key) return t(key)
  for (const [re, patternKey, names] of PATTERNS) {
    const m = re.exec(text.trim())
    if (!m) continue
    const vars: Record<string, string> = {}
    names.forEach((name, i) => { vars[name] = m[i + 1] })
    return t(patternKey, vars)
  }
  return text
}
