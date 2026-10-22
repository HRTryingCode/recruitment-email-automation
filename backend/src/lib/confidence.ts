import { DECLINE_OVERRIDE_CONFIDENCE, LOW_CONFIDENCE_THRESHOLD } from './candidateState';

export type ConfidenceLabel = 'high' | 'medium' | 'low';

/**
 * Classifier confidence as a word for the inbox (U0). "low" is exactly what
 * ingestion refuses to auto-draft on; "high" is what may override a stored
 * interest state.
 */
export function confidenceLabel(confidence: number): ConfidenceLabel {
  if (confidence >= DECLINE_OVERRIDE_CONFIDENCE) return 'high';
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return 'medium';
  return 'low';
}
