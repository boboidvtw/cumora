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
