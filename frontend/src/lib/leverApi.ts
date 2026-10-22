// F3 "Add to Lever" + Gem connection API calls. Kept out of lib/api.ts so the
// many component tests that mock lib/api don't need to know about them.
import { api, type LeverOpportunity, type LeverState, type Candidate } from './api';

export interface LeverPosting {
  id: string;
  title: string;
  team: string | null;
  location: string | null;
  state: string;
}

export interface LeverStage {
  id: string;
  text: string;
}

export interface LeverMe {
  configured: boolean;
  createEnabled: boolean;
  appEmail: string | null;
  leverUser: { id: string; name: string | null } | null;
}

export type GemLookupStatus = 'FOUND' | 'NOT_FOUND' | 'NOT_CONNECTED' | 'NEEDS_REAUTH' | 'UNAVAILABLE';

export interface LeverPrefill {
  candidateId: string | null;
  name: string | null;
  email: string;
  headline: string | null;
  location: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  resume: { available: boolean; source: string | null; filename: string | null };
  suggestedPostingId: string | null;
  stageId: string | null;
  stageName: string;
  origin: 'sourced';
  sources: string[];
  tags: string[];
  note: string;
  existing: LeverOpportunity[];
  existingState: LeverState;
  gem: { status: GemLookupStatus; message?: string };
  createEnabled: boolean;
}

export interface CreateLeverBody {
  name: string;
  headline: string | null;
  location: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  postingId: string;
  stageId: string | null;
  tags: string[];
  sources: string[];
  note: string | null;
  includeResume: boolean;
  idempotencyKey: string;
}

export interface CreateLeverResult {
  opportunityId: string;
  leverUrl: string;
  postingId: string;
  postingTitle: string | null;
  stageName: string | null;
  resumeAttached: boolean;
  noteAdded: boolean;
  duplicateRequest?: boolean;
  candidate?: Candidate;
}

/** Who/what Add to Lever targets: a known candidate row, or any email. */
export type LeverTarget = { candidateId: string } | { email: string };

type Ok<T> = { success: boolean; data: T };

export async function fetchLeverMe(): Promise<LeverMe> {
  const res = await api.get('/lever/me');
  return (res.data as Ok<LeverMe>).data;
}

export async function fetchLeverPostings(): Promise<{ postings: LeverPosting[]; stages: LeverStage[]; defaultStageId: string | null }> {
  const res = await api.get('/lever/postings');
  return (res.data as Ok<{ postings: LeverPosting[]; stages: LeverStage[]; defaultStageId: string | null }>).data;
}

export async function fetchLeverPrefill(target: LeverTarget): Promise<LeverPrefill> {
  const res =
    'candidateId' in target
      ? await api.get(`/candidates/${encodeURIComponent(target.candidateId)}/lever/prefill`)
      : await api.get('/lookup/lever-prefill', { params: { email: target.email } });
  return (res.data as Ok<LeverPrefill>).data;
}

export async function createLeverOpportunity(target: LeverTarget, body: CreateLeverBody): Promise<CreateLeverResult> {
  const res =
    'candidateId' in target
      ? await api.post(`/candidates/${encodeURIComponent(target.candidateId)}/lever`, body)
      : await api.post('/lookup/lever', { ...body, email: target.email });
  return (res.data as Ok<CreateLeverResult>).data;
}

export type GemConnectionState = 'NOT_CONNECTED' | 'PENDING' | 'OK' | 'NEEDS_REAUTH';

export async function fetchGemStatus(): Promise<{ status: GemConnectionState; lastError: string | null }> {
  const res = await api.get('/integrations/gem/status');
  return (res.data as Ok<{ status: GemConnectionState; lastError: string | null }>).data;
}

export async function startGemConnect(): Promise<string> {
  const res = await api.get('/integrations/gem/connect');
  return (res.data as Ok<{ authUrl: string }>).data.authUrl;
}

export async function disconnectGem(): Promise<void> {
  await api.delete('/integrations/gem');
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
