import axios from 'axios';
import { getToken, clearToken, clearUser, type User } from './auth';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Inject Bearer token on every request if available
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear auth state and bounce to /login — but skip /auth/* routes
// because login/signup pages display their own error messages. The current
// page rides along as ?next= so the recruiter lands back where they were;
// unsaved draft edits survive in sessionStorage (useDraftEditor).
export function handleAuthError(error: unknown): Promise<never> {
  const err = error as { response?: { status?: number }; config?: { url?: string } } | null;
  const status = err?.response?.status;
  const url: string | undefined = err?.config?.url;
  if (status === 401 && url && !url.startsWith('/auth/')) {
    clearToken();
    clearUser();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      const here = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    }
  }
  return Promise.reject(error);
}

api.interceptors.response.use((response) => response, handleAuthError);

export type { User };

// Types
export interface Mailbox {
  id: string;
  provider: 'GMAIL' | 'OUTLOOK' | 'IMAP';
  emailAddress: string;
  displayName?: string;
  isActive: boolean;
  watchExpiry?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { threads: number; messages: number };
}

export type ReplyStatus = 'NEW' | 'AWAITING_REPLY' | 'REPLIED';

export interface Candidate extends LeverCandidateFields {
  id: string;
  name: string;
  email: string;
  company?: string;
  title?: string;
  role?: string | null;
  status:
    | 'PENDING'
    | 'INTERESTED'
    | 'NOT_INTERESTED'
    | 'NEUTRAL'
    | 'REPLIED'
    | 'NEEDS_REVIEW'
    | 'IGNORED';
  source?: string;
  notes?: string;
  mailboxId?: string;
  mailbox?: Pick<Mailbox, 'id' | 'emailAddress' | 'provider'>;
  threads?: EmailThread[];
  repliedAt?: string | null;
  /** Candidate's latest message; awaiting reply = this > lastOutboundAt. */
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  replyStatus?: ReplyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface EmailThread {
  id: string;
  candidateId?: string;
  candidate?: Pick<Candidate, 'id' | 'name' | 'email' | 'status' | 'role'>;
  mailboxId: string;
  mailbox?: Pick<Mailbox, 'id' | 'emailAddress' | 'provider'>;
  externalThreadId: string;
  subject: string;
  lastMessageAt: string;
  createdAt: string;
  messages?: EmailMessage[];
  drafts?: EmailDraft[];
  _count?: { messages: number; drafts: number };
}

export interface EmailMessage {
  id: string;
  threadId: string;
  mailboxId: string;
  externalMessageId: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  receivedAt: string;
  headers: Record<string, string>;
  createdAt: string;
}

export interface OriginalMessage {
  id: string;
  fromAddress: string;
  fromName: string | null;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string;
}

export interface EmailDraft {
  id: string;
  threadId: string;
  thread?: EmailThread;
  inReplyToMessageId?: string;
  referencesHeader?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  classification: 'INTERESTED' | 'NOT_INTERESTED' | 'NEUTRAL';
  confidence: number;
  /** APPROVED is the deprecated two-step flow; SCHEDULED/SENDING/FAILED are the U0 one-step send. */
  status: DraftStatus;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
  originalMessage?: OriginalMessage | null;
  /** Address createDraft will CC (null when none) — served by the API. */
  ccAddress?: string | null;
  /** Stored CC choice: null = default (pre-F4), '' = "No CC". Use ccAddress for display. */
  ccEmail?: string | null;
  /** PENDING drafts move to the Expired bucket after this (createdAt + 21d). */
  expiresAt?: string;
  // ── U0 inbox ──
  /** One-step send fires at this time unless undone (status SCHEDULED). */
  scheduledSendAt?: string | null;
  sentByUserId?: string | null;
  /** Why the last send failed (status FAILED). */
  sendError?: string | null;
  snoozedUntil?: string | null;
  /** Set when a snooze ran out: show the draft as unread. */
  returnedFromSnoozeAt?: string | null;
  dismissReason?: DismissReason | null;
  dismissNote?: string | null;
  /** The model's text; bodyText holds edits. null = unknown (pre-U0 drafts). */
  aiBodyText?: string | null;
  editedAt?: string | null;
  editedByUserId?: string | null;
  hasEdits?: boolean;
  classificationReason?: string | null;
  /** Exact quote from the candidate's latest message backing the label. */
  evidenceQuote?: string | null;
  confidenceLabel?: ConfidenceLabel;
  /** Other users with this draft open (GET /drafts/:id). */
  presence?: DraftPresenceEntry[];
  /** Regenerate only: true when the edited body was kept and only aiBodyText changed. */
  keptEdits?: boolean;
}

export type DraftStatus = 'PENDING' | 'APPROVED' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'FAILED' | 'DISCARDED';
export type ConfidenceLabel = 'high' | 'medium' | 'low';
export type DismissReason = 'wrong_label' | 'spam' | 'already_handled' | 'not_needed' | 'other';
export type PresenceMode = 'viewing' | 'editing';

export interface DraftPresenceEntry {
  userId: string;
  name: string;
  mode: PresenceMode;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: { connected: boolean; latencyMs?: number };
  claude: { available: boolean };
  mailboxes: Array<{
    id: string;
    emailAddress: string;
    provider: string;
    isActive: boolean;
    watchExpiry?: string;
  }>;
  recentLogs: Array<{
    id: string;
    event: string;
    level: string;
    createdAt: string;
    details: unknown;
  }>;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: { total: number; page: number; limit: number };
}

interface SingleResponse<T> {
  success: boolean;
  data: T;
}

// Candidates
export type CandidateSortColumn =
  | 'name'
  | 'email'
  | 'company'
  | 'role'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'lastInboundAt'
  | 'mailbox'
  | 'lever'
  | 'lastActivity';

export async function fetchCandidates(filters?: {
  status?: string;
  replyStatus?: ReplyStatus;
  lever?: 'IN' | 'NOT_IN';
  mailboxId?: string;
  page?: number;
  limit?: number;
  includeIgnored?: boolean;
  search?: string;
  sort?: CandidateSortColumn;
  dir?: 'asc' | 'desc';
}): Promise<PaginatedResponse<Candidate>> {
  const res = await api.get('/candidates', { params: filters });
  return res.data as PaginatedResponse<Candidate>;
}

export interface CandidateCounts {
  candidates: number;
  awaitingReply: number;
  needsReview: number;
  pendingDrafts: number;
  byMailbox: Array<{
    mailboxId: string | null;
    candidates: number;
    awaitingReply: number;
    needsReview: number;
    pendingDrafts: number;
  }>;
}

/** Server-side pipeline counts for the dashboard (M18). */
export async function fetchCandidateCounts(filters?: {
  mailboxId?: string;
}): Promise<SingleResponse<CandidateCounts>> {
  const res = await api.get('/candidates/counts', { params: filters });
  return res.data as SingleResponse<CandidateCounts>;
}

export async function fetchCandidate(id: string): Promise<SingleResponse<Candidate>> {
  const res = await api.get(`/candidates/${id}`);
  return res.data as SingleResponse<Candidate>;
}

export async function updateCandidate(
  id: string,
  data: Partial<Candidate> & { repliedAt?: null }
): Promise<SingleResponse<Candidate>> {
  const res = await api.patch(`/candidates/${id}`, data);
  return res.data as SingleResponse<Candidate>;
}

export async function clearRepliedAt(id: string): Promise<SingleResponse<Candidate>> {
  const res = await api.patch(`/candidates/${id}`, { repliedAt: null });
  return res.data as SingleResponse<Candidate>;
}

export async function ignoreCandidate(id: string): Promise<SingleResponse<Candidate>> {
  const res = await api.post(`/candidates/${id}/ignore`);
  return res.data as SingleResponse<Candidate>;
}

export async function unignoreCandidate(id: string): Promise<SingleResponse<Candidate>> {
  const res = await api.post(`/candidates/${id}/unignore`);
  return res.data as SingleResponse<Candidate>;
}

/** R3 bulk status change; IGNORED also discards live drafts server-side. */
export async function bulkUpdateCandidates(
  ids: string[],
  status: Candidate['status']
): Promise<SingleResponse<{ updated: number; draftsDiscarded: number }>> {
  const res = await api.post('/candidates/bulk', { ids, status });
  return res.data as SingleResponse<{ updated: number; draftsDiscarded: number }>;
}

// Mailboxes
export async function fetchMailboxes(): Promise<SingleResponse<Mailbox[]>> {
  const res = await api.get('/mailboxes');
  return res.data as SingleResponse<Mailbox[]>;
}

export async function addGmailMailbox(): Promise<{ success: boolean; data: { authUrl: string } }> {
  const res = await api.post('/mailboxes/gmail/auth');
  return res.data as { success: boolean; data: { authUrl: string } };
}

export async function deleteMailbox(id: string): Promise<{ success: boolean; message: string }> {
  const res = await api.delete(`/mailboxes/${id}`);
  return res.data as { success: boolean; message: string };
}

export interface ResyncResult {
  messagesSeen: number;
  messagesStored: number;
}

export async function resyncMailbox(id: string): Promise<{ success: boolean; data: ResyncResult }> {
  const res = await api.post(`/mailboxes/${id}/resync`);
  return res.data as { success: boolean; data: ResyncResult };
}

export async function reclassifyMailbox(id: string): Promise<{ success: boolean; data: { threadsFound: number; threadsClassified: number } }> {
  const res = await api.post(`/mailboxes/${id}/reclassify`);
  return res.data as { success: boolean; data: { threadsFound: number; threadsClassified: number } };
}

export async function fetchMailboxSignatureHtml(id: string): Promise<{ signatureHtml: string | null }> {
  const res = await api.get(`/mailboxes/${id}/signature`);
  return (res.data as { success: boolean; data: { signatureHtml: string | null } }).data;
}

// Threads
export async function fetchThreads(filters?: {
  mailboxId?: string;
  candidateId?: string;
  page?: number;
  limit?: number;
}): Promise<PaginatedResponse<EmailThread>> {
  const res = await api.get('/emails/threads', { params: filters });
  return res.data as PaginatedResponse<EmailThread>;
}

export async function fetchMessages(
  threadId: string
): Promise<SingleResponse<EmailThread>> {
  const res = await api.get(`/emails/threads/${threadId}/messages`);
  return res.data as SingleResponse<EmailThread>;
}

// Drafts
export async function fetchDrafts(filters?: {
  status?: string;
  mailboxId?: string;
  page?: number;
  limit?: number;
  includeReplied?: boolean;
  expired?: boolean;
}): Promise<PaginatedResponse<EmailDraft>> {
  const res = await api.get('/drafts', { params: filters });
  return res.data as PaginatedResponse<EmailDraft>;
}

export async function fetchDraft(id: string): Promise<SingleResponse<EmailDraft>> {
  const res = await api.get(`/drafts/${id}`);
  return res.data as SingleResponse<EmailDraft>;
}

export interface CcChange {
  ccAddress: string | null;
  firstName: string | null;
  /** 'not_found' = the loop-in sentence was reworded; the recruiter must rename by hand. */
  loopIn: 'updated' | 'not_found' | 'not_handoff';
  handoffWithoutCc: boolean;
}

export async function updateDraft(
  id: string,
  data: { bodyText?: string; bodyHtml?: string | null; subject?: string; ccEmail?: string | null; override?: boolean }
): Promise<SingleResponse<EmailDraft> & { ccChange?: CcChange }> {
  const res = await api.patch(`/drafts/${id}`, data);
  return res.data as SingleResponse<EmailDraft> & { ccChange?: CcChange };
}

/** Someone a draft can CC; `email: null` is the "No CC" choice. */
export interface CcOption {
  email: string | null;
  name: string;
  firstName: string | null;
}

export async function fetchDraftCcOptions(draftId?: string): Promise<{ success: boolean; data: CcOption[] }> {
  const res = await api.get('/drafts/cc-options', { params: draftId ? { draftId } : undefined });
  return res.data as { success: boolean; data: CcOption[] };
}

export async function approveDraft(id: string): Promise<{ success: boolean; message: string }> {
  const res = await api.post(`/drafts/${id}/approve`);
  return res.data as { success: boolean; message: string };
}

export async function discardDraft(id: string): Promise<{ success: boolean; message: string }> {
  const res = await api.post(`/drafts/${id}/discard`);
  return res.data as { success: boolean; message: string };
}

/** Legacy send of an APPROVED draft (deprecated with approveDraft; use scheduleSendDraft). */
export async function sendDraft(id: string): Promise<{ success: boolean; message: string }> {
  const res = await api.post(`/drafts/${id}/send`);
  return res.data as { success: boolean; message: string };
}

/**
 * Regenerate. Edited drafts keep their body unless keepEdits is false; the
 * new model text is always in aiBodyText.
 */
export async function regenerateDraft(
  id: string,
  opts: { keepEdits?: boolean; override?: boolean } = {}
): Promise<SingleResponse<EmailDraft>> {
  const res = await api.post(`/drafts/${id}/regenerate`, opts);
  return res.data as SingleResponse<EmailDraft>;
}

// ── U0 inbox ─────────────────────────────────────────────────────────────
// Actions on a draft someone else is editing fail with 423 and
// `{ lockedBy: name }` unless `override: true` is passed.

export interface ScheduledSend {
  id: string;
  status: 'SCHEDULED';
  scheduledSendAt: string;
  undoSeconds: number;
}

/** One-step send: saves edits, sends after `undoSeconds` (default 10, max 30) unless undone. */
export async function scheduleSendDraft(
  id: string,
  opts: { undoSeconds?: number; bodyText?: string; ccEmail?: string | null; override?: boolean } = {}
): Promise<SingleResponse<ScheduledSend> & { ccChange?: CcChange }> {
  const res = await api.post(`/drafts/${id}/send`, opts);
  return res.data as SingleResponse<ScheduledSend> & { ccChange?: CcChange };
}

/** Cancel a scheduled send; 409 "Already sent" once it started. */
export async function undoSendDraft(
  id: string,
  opts: { override?: boolean } = {}
): Promise<SingleResponse<{ id: string; status: 'PENDING' }>> {
  const res = await api.post(`/drafts/${id}/undo-send`, opts);
  return res.data as SingleResponse<{ id: string; status: 'PENDING' }>;
}

export async function dismissDraft(
  id: string,
  opts: { reason?: DismissReason; note?: string; override?: boolean } = {}
): Promise<SingleResponse<{ id: string; status: 'DISCARDED' }>> {
  const res = await api.post(`/drafts/${id}/dismiss`, opts);
  return res.data as SingleResponse<{ id: string; status: 'DISCARDED' }>;
}

/** Hide from the inbox until `until` (ISO, future, ≤ 30 days). */
export async function snoozeDraft(id: string, until: string): Promise<SingleResponse<{ id: string; snoozedUntil: string }>> {
  const res = await api.post(`/drafts/${id}/snooze`, { until });
  return res.data as SingleResponse<{ id: string; snoozedUntil: string }>;
}

export async function unsnoozeDraft(id: string): Promise<SingleResponse<{ id: string; snoozedUntil: null }>> {
  const res = await api.post(`/drafts/${id}/unsnooze`, {});
  return res.data as SingleResponse<{ id: string; snoozedUntil: null }>;
}

/** Heartbeat every ~15s while a draft is open; returns who else is on it. */
export async function heartbeatDraftPresence(
  id: string,
  mode: PresenceMode
): Promise<SingleResponse<{ presence: DraftPresenceEntry[] }>> {
  const res = await api.post(`/drafts/${id}/presence`, { mode });
  return res.data as SingleResponse<{ presence: DraftPresenceEntry[] }>;
}

export async function clearDraftPresence(id: string): Promise<{ success: boolean }> {
  const res = await api.delete(`/drafts/${id}/presence`);
  return res.data as { success: boolean };
}

export interface BatchSendResult {
  scheduled: string[];
  skipped: Array<{
    id: string;
    reason: 'not_found' | 'locked' | 'not_pending' | 'not_batchable' | 'no_candidate';
    lockedBy?: string;
  }>;
  scheduledSendAt: string;
  undoSeconds: number;
}

/** Batch one-step send for Not interested drafts (≤ 50). */
export async function batchSendDrafts(draftIds: string[], undoSeconds?: number): Promise<SingleResponse<BatchSendResult>> {
  const res = await api.post('/drafts/batch-send', { draftIds, undoSeconds });
  return res.data as SingleResponse<BatchSendResult>;
}

export type InboxView = 'needs_review' | 'interested' | 'not_interested' | 'snoozed' | 'sent_today';

export interface InboxItem {
  kind: 'draft' | 'candidate';
  id: string;
  view: InboxView;
  sortAt: string;
  ageMs: number;
  draft: {
    id: string;
    threadId: string;
    status: DraftStatus;
    subject: string;
    preview: string;
    classification: string;
    confidence: number;
    confidenceLabel: ConfidenceLabel;
    classificationReason: string | null;
    evidenceQuote: string | null;
    hasEdits: boolean;
    editedAt: string | null;
    snoozedUntil: string | null;
    returnedFromSnoozeAt: string | null;
    scheduledSendAt: string | null;
    sentAt: string | null;
    sendError: string | null;
    ccAddress: string | null;
    createdAt: string;
  } | null;
  candidate: {
    id: string;
    name: string;
    email: string;
    role: string | null;
    status: string;
    leverState: string | null;
    leverStage: string | null;
    leverPostingTitle: string | null;
    leverOpportunityId: string | null;
  } | null;
  mailbox: { id: string; emailAddress: string; displayName: string | null } | null;
  presence: DraftPresenceEntry[];
}

export interface InboxPage {
  items: InboxItem[];
  counts: Record<InboxView, number>;
  /** Items per role in this view, ignoring the role filter; role null = unknown. */
  roleCounts?: Array<{ role: string | null; count: number }>;
  nextCursor: string | null;
}

/** The inbox queue; poll ~15s. `order: 'oldest'` = oldest waiting first. */
export async function fetchInbox(params: {
  view?: InboxView;
  mailboxId?: string;
  order?: 'newest' | 'oldest';
  cursor?: string;
  /** Repeated ?role= (titles can contain commas); '__none__' = role unknown. */
  role?: string[];
} = {}): Promise<SingleResponse<InboxPage>> {
  const { role, ...rest } = params;
  if (!role?.length) {
    const res = await api.get('/inbox', { params: rest });
    return res.data as SingleResponse<InboxPage>;
  }
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) if (v) qs.set(k, v);
  for (const r of role) qs.append('role', r);
  const res = await api.get('/inbox', { params: qs });
  return res.data as SingleResponse<InboxPage>;
}

/** GET /api/today — the R4 Today page summary (backend today.service). */
export interface TodaySummary {
  generatedAt: string;
  views: { needs_review: number; interested: number; not_interested: number };
  sentToday: number;
  oldestWaitingAt: string | null;
  draftsExpiringSoon: number;
  mailboxes: Array<{ mailboxId: string; waiting: number; sentToday: number; lastReceivedAt: string | null }>;
  /** addedToday / addedThisWeek are team-wide even with a mailbox filter. */
  lever: { interestedNotInLever: number; addedToday: number; addedThisWeek: number };
  /** 14 ET days, oldest first, ending today. */
  series: Array<{ day: string; received: number; sent: number }>;
}

export async function fetchToday(params: { mailboxId?: string }): Promise<SingleResponse<TodaySummary>> {
  const res = await api.get('/today', { params });
  return res.data as SingleResponse<TodaySummary>;
}

export type SavedViewScope = 'candidates' | 'inbox';

export interface SavedView {
  id: string;
  /** null = team-shared (admins edit). */
  userId: string | null;
  name: string;
  scope: SavedViewScope;
  filters: Record<string, unknown>;
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSavedViews(scope?: SavedViewScope): Promise<SingleResponse<SavedView[]>> {
  const res = await api.get('/views', { params: scope ? { scope } : undefined });
  return res.data as SingleResponse<SavedView[]>;
}

export async function createSavedView(data: {
  name: string;
  scope: SavedViewScope;
  filters: Record<string, unknown>;
  shared?: boolean;
}): Promise<SingleResponse<SavedView>> {
  const res = await api.post('/views', data);
  return res.data as SingleResponse<SavedView>;
}

export async function updateSavedView(
  id: string,
  data: { name?: string; filters?: Record<string, unknown> }
): Promise<SingleResponse<SavedView>> {
  const res = await api.patch(`/views/${id}`, data);
  return res.data as SingleResponse<SavedView>;
}

export async function deleteSavedView(id: string): Promise<{ success: boolean }> {
  const res = await api.delete(`/views/${id}`);
  return res.data as { success: boolean };
}

/** Rewrite the current body following `notes` (also the inbox's "Regenerate with instruction"). */
export async function dictateDraft(
  id: string,
  notes: string,
  opts: { override?: boolean } = {}
): Promise<SingleResponse<EmailDraft>> {
  const res = await api.post(`/drafts/${id}/dictate`, { notes, ...opts });
  return res.data as SingleResponse<EmailDraft>;
}

// Threads
/**
 * Generate a draft for a thread. `classification` is a recruiter's triage
 * decision (M17) and replaces the server's re-classification.
 */
export async function generateDraftForThread(
  threadId: string,
  classification?: 'INTERESTED' | 'NOT_INTERESTED' | 'NEUTRAL'
): Promise<SingleResponse<EmailDraft>> {
  const res = await api.post(
    `/emails/threads/${threadId}/draft`,
    classification ? { classification } : undefined
  );
  return res.data as SingleResponse<EmailDraft>;
}

// Health
export async function fetchHealth(): Promise<SingleResponse<HealthStatus>> {
  const res = await api.get('/health');
  return res.data as SingleResponse<HealthStatus>;
}

// Sync-health (per-mailbox observability for dashboard / debug)
export interface MailboxSyncHealth {
  mailboxId: string;
  emailAddress: string;
  displayName: string | null;
  isActive: boolean;
  /** "OK" | "NEEDS_REAUTH" (OAuth grant revoked/expired — human must reconnect). */
  authStatus: string;
  lastAuthError: string | null;
  lastAuthErrorAt: string | null;
  watchExpiry: string | null;
  watchExpiresInHours: number | null;
  lastSyncedMessageAt: string | null;
  lastReconciliationAt: string | null;
  lastReconciliationFoundMissing: number;
  lastReconcileError: string | null;
  consecutiveReconcileFailures: number;
  // Counts are null when `error` is true (backend could not compute them).
  messagesLast24h: number | null;
  totalMessages: number | null;
  totalCandidates: number | null;
  pendingDrafts: number | null;
  candidatesNeedsReview: number | null;
  webhookErrorsLast24h: number;
  lastWebhookError: string | null;
  error: boolean;
}

export async function fetchSyncHealth(): Promise<SingleResponse<MailboxSyncHealth[]>> {
  const res = await api.get('/internal/sync-health');  // maps to /api/internal/sync-health
  return res.data as SingleResponse<MailboxSyncHealth[]>;
}

export async function debugDrafts(): Promise<{ success: boolean; data: { total: number; byStatus: Record<string, unknown[]> } }> {
  const res = await api.get('/internal/debug/drafts');
  return res.data as { success: boolean; data: { total: number; byStatus: Record<string, unknown[]> } };
}

export async function debugMailbox(email: string): Promise<{ success: boolean; data: unknown }> {
  const res = await api.get('/internal/debug/mailbox', { params: { email } });
  return res.data as { success: boolean; data: unknown };
}

export async function debugCandidate(email: string): Promise<{ success: boolean; data: unknown }> {
  const res = await api.get('/internal/debug/candidate', { params: { email } });
  return res.data as { success: boolean; data: unknown };
}

// Auth
interface AuthResponse {
  token: string;
  user: User;
}

export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  const res = await api.post('/auth/google', { idToken });
  const body = res.data as SingleResponse<AuthResponse>;
  return body.data;
}

export async function getMe(): Promise<User> {
  const res = await api.get('/auth/me');
  const body = res.data as SingleResponse<{ user: User }>;
  return body.data.user;
}

// ── Sender coverage (audit H2) ───────────────────────────────────────────
export interface UnmonitoredSender {
  emailAddress: string;
  displayName: string | null;
  sources: string[];
  expectedSends30d: number | null;
}

export interface QuietMailbox {
  mailboxId: string;
  emailAddress: string;
  outbound30d: number;
  expectedAddresses: string[];
  expectedSends30d: number | null;
}

export interface SenderCoverageReport {
  generatedAt: string;
  windowDays: number;
  expectedSenderCount: number;
  unmonitored: UnmonitoredSender[];
  quietMailboxes: QuietMailbox[];
  mailboxes: Array<{
    id: string;
    emailAddress: string;
    displayName: string | null;
    sendAsAddresses: string[];
    sendAsSyncedAt: string | null;
    authStatus: string;
    outbound30d: number;
  }>;
}

export interface ExpectedSender {
  id: string;
  emailAddress: string;
  displayName: string | null;
  source: string;
  expectedSends30d: number | null;
  notes: string | null;
  isActive: boolean;
}

export async function fetchSenderCoverage(): Promise<SingleResponse<SenderCoverageReport>> {
  const res = await api.get('/coverage');
  return res.data as SingleResponse<SenderCoverageReport>;
}

/** Admin-only (403 for recruiters). */
export async function fetchExpectedSenders(): Promise<SingleResponse<ExpectedSender[]>> {
  const res = await api.get('/coverage/expected-senders');
  return res.data as SingleResponse<ExpectedSender[]>;
}

export async function upsertExpectedSender(data: {
  emailAddress: string;
  displayName?: string | null;
  expectedSends30d?: number | null;
  notes?: string | null;
}): Promise<SingleResponse<ExpectedSender>> {
  const res = await api.post('/coverage/expected-senders', data);
  return res.data as SingleResponse<ExpectedSender>;
}

export async function deleteExpectedSender(id: string): Promise<{ success: boolean }> {
  const res = await api.delete(`/coverage/expected-senders/${id}`);
  return res.data as { success: boolean };
}

// Global lookup (F1) — "do we know this email?"
export type LookupVerdict =
  | 'CANDIDATE'
  | 'CONTACTED_NO_REPLY'
  | 'REPLIED_NOT_CANDIDATE'
  | 'UNKNOWN';

export type LookupSkipReason = 'NOT_RECRUITING' | 'NO_ROLE' | 'FILTERED';

type MailboxRef = { id: string; emailAddress: string };

/**
 * Per-integration status keyed by integration name; each key is absent when
 * that integration is not configured. See backend routes/lookup.ts.
 */
export interface LookupIntegrationsData {
  lever?: LeverLookupIntegration;
}

export interface LookupResult {
  email: string;
  verdict: LookupVerdict;
  summary: string;
  candidate: {
    id: string;
    name: string;
    email: string;
    status: string;
    role: string | null;
    company: string | null;
    title: string | null;
    mailbox: MailboxRef | null;
    firstMailbox: MailboxRef | null;
    repliedAt: string | null;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
    createdAt: string;
  } | null;
  messages: {
    inbound: number;
    outbound: number;
    firstAt: string | null;
    lastAt: string | null;
    latestSubject: string | null;
    latestThreadId: string | null;
    mailboxes: MailboxRef[];
    truncated: boolean;
  };
  drafts: {
    total: number;
    byStatus: Record<string, number>;
    latest: { id: string; status: string; threadId: string; createdAt: string } | null;
  };
  skipped: {
    reasons: LookupSkipReason[];
    lastSkippedAt: string | null;
    windowDays: number;
  };
  integrations: LookupIntegrationsData;
}

export async function fetchLookup(email: string): Promise<SingleResponse<LookupResult>> {
  const res = await api.get('/lookup', { params: { email } });
  return res.data as SingleResponse<LookupResult>;
}

// ── Lever status (F2, read-only) ─────────────────────────────────────────
export type LeverState = 'ACTIVE' | 'ARCHIVED' | 'HIRED' | 'NOT_FOUND' | 'ERROR';

/** Cached Lever columns on a Candidate row, refreshed every 3h by cron. */
export interface LeverCandidateFields {
  leverState?: LeverState | null;
  leverOpportunityId?: string | null;
  leverPostingTitle?: string | null;
  leverStage?: string | null;
  leverArchivedReason?: string | null;
  leverCheckedAt?: string | null;
  leverError?: string | null;
}

export interface LeverOpportunity {
  id: string;
  /** Posting of the opportunity (F3 "already in Lever for this job" check). */
  postingId?: string | null;
  postingTitle: string | null;
  stage: string | null;
  archived: boolean;
  hired: boolean;
  archivedReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  leverUrl: string;
}

/** `integrations.lever` in GET /api/lookup (absent when Lever is unconfigured). */
export interface LeverLookupIntegration {
  status: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  state: LeverState;
  message?: string;
  primary: LeverOpportunity | null;
  opportunities: LeverOpportunity[];
  opportunityCount: number;
  checkedAt: string;
}

/** On-demand Lever re-check for one candidate. */
export async function refreshCandidateLever(
  id: string
): Promise<SingleResponse<{ candidate: Candidate; lever: { state: LeverState } }>> {
  const res = await api.post(`/candidates/${id}/lever/refresh`);
  return res.data as SingleResponse<{ candidate: Candidate; lever: { state: LeverState } }>;
}
