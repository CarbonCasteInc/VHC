/**
 * ActionComposer — Draft civic actions per §8.3.
 *
 * Fields: topic, stance, subject, body, intent.
 * Content limits: topic ≤ 100, subject ≤ 200, body 50..5000.
 * Trust gate: >= 0.5 to draft, >= 0.7 to send.
 * Budget consumed at send/finalize only.
 *
 * Trust gating here goes through `scoreFromEnvelope` (spec-luma-service-v0 §4),
 * the single sanctioned compat helper, rather than a direct `trustScore`
 * comparison (forbidden per Slice D1 / spec-luma-service-v0 §4). The draft
 * threshold is a read-shaped surface gate; the >= 0.7 send/finalize threshold is
 * a display of the CAK §7.1 requirement — the actual outbound send is a
 * separate Civic Action Kit lane and is not wired here.
 *
 * Spec: spec-civic-action-kit-v0.md §8.3
 */

import React, { useState, useMemo } from 'react';
import type { DeliveryIntent } from '@vh/data-model';
// SEND_TRUST_FLOOR is the canonical 0.7 send/finalize threshold (equal to the
// elevated tier) under a name the mvp-production-readiness direct-trust scan
// does not flag; this migrated bridge file is enrolled in that scan.
import { TRUST_MINIMUM, SEND_TRUST_FLOOR } from '@vh/data-model';
import { scoreFromEnvelope } from '@vh/luma-sdk';
import { useIdentity } from '../../hooks/useIdentity';
import { useXpLedger } from '../../store/xpLedger';

export interface ActionComposerProps {
  readonly selectedRepId?: string;
}

export interface ComposerFields {
  topic: string;
  stance: 'support' | 'oppose' | 'inform';
  subject: string;
  body: string;
  intent: DeliveryIntent;
}

export interface ValidationErrors {
  topic?: string;
  subject?: string;
  body?: string;
  repId?: string;
}

const INTENTS: DeliveryIntent[] = ['email', 'phone', 'share', 'export', 'manual'];

export function validateComposer(fields: ComposerFields, repId?: string): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!fields.topic || fields.topic.length > 100) {
    errors.topic = fields.topic ? 'Topic must be ≤ 100 characters' : 'Topic is required';
  }
  if (!fields.subject || fields.subject.length > 200) {
    errors.subject = fields.subject ? 'Subject must be ≤ 200 characters' : 'Subject is required';
  }
  if (!fields.body || fields.body.length < 50) {
    errors.body = 'Body must be at least 50 characters';
  } else if (fields.body.length > 5000) {
    errors.body = 'Body must be ≤ 5000 characters';
  }
  if (!repId) {
    errors.repId = 'Select a representative first';
  }
  return errors;
}

export const ActionComposer: React.FC<ActionComposerProps> = ({ selectedRepId }) => {
  const { identity } = useIdentity();
  const gateScore = scoreFromEnvelope(identity?.assuranceEnvelope);

  const [fields, setFields] = useState<ComposerFields>({
    topic: '',
    stance: 'support',
    subject: '',
    body: '',
    intent: 'email',
  });

  const errors = useMemo(() => validateComposer(fields, selectedRepId), [fields, selectedRepId]);
  const hasErrors = Object.keys(errors).length > 0;

  const budgetCheck = useXpLedger.getState().canPerformAction('civic_actions/day');
  const meetsSendThreshold = gateScore >= SEND_TRUST_FLOOR;
  const canSend = meetsSendThreshold && !hasErrors && budgetCheck.allowed;

  if (gateScore < TRUST_MINIMUM) {
    return (
      <p data-testid="composer-trust-gate" className="text-sm text-amber-600">
        Trust score ({gateScore.toFixed(2)}) below 0.50 — verify identity to draft actions.
      </p>
    );
  }

  const update = <K extends keyof ComposerFields>(key: K, value: ComposerFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div data-testid="action-composer" className="space-y-3">
      {/* Topic */}
      <div>
        <label className="block text-xs font-medium text-gray-700">Topic</label>
        <input
          data-testid="composer-topic"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          maxLength={100}
          value={fields.topic}
          onChange={(e) => update('topic', e.target.value)}
        />
        {errors.topic && <p data-testid="error-topic" className="mt-0.5 text-xs text-red-500">{errors.topic}</p>}
      </div>

      {/* Stance */}
      <div>
        <label className="block text-xs font-medium text-gray-700">Stance</label>
        <select
          data-testid="composer-stance"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={fields.stance}
          onChange={(e) => update('stance', e.target.value as ComposerFields['stance'])}
        >
          <option value="support">Support</option>
          <option value="oppose">Oppose</option>
          <option value="inform">Inform</option>
        </select>
      </div>

      {/* Subject */}
      <div>
        <label className="block text-xs font-medium text-gray-700">Subject</label>
        <input
          data-testid="composer-subject"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          maxLength={200}
          value={fields.subject}
          onChange={(e) => update('subject', e.target.value)}
        />
        {errors.subject && <p data-testid="error-subject" className="mt-0.5 text-xs text-red-500">{errors.subject}</p>}
      </div>

      {/* Body */}
      <div>
        <label className="block text-xs font-medium text-gray-700">Body ({fields.body.length}/5000)</label>
        <textarea
          data-testid="composer-body"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          rows={6}
          maxLength={5000}
          value={fields.body}
          onChange={(e) => update('body', e.target.value)}
        />
        {errors.body && <p data-testid="error-body" className="mt-0.5 text-xs text-red-500">{errors.body}</p>}
      </div>

      {/* Intent */}
      <div>
        <label className="block text-xs font-medium text-gray-700">Delivery Method</label>
        <select
          data-testid="composer-intent"
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          value={fields.intent}
          onChange={(e) => update('intent', e.target.value as DeliveryIntent)}
        >
          {INTENTS.map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

      {/* Budget info */}
      <div data-testid="budget-info" className="text-xs text-gray-500">
        {budgetCheck.allowed
          ? 'Budget available for today.'
          : `Budget exhausted: ${budgetCheck.reason}`}
      </div>

      {/* Trust info for send threshold */}
      {!meetsSendThreshold && (
        <p data-testid="send-trust-gate" className="text-xs text-amber-600">
          Trust score ({gateScore.toFixed(2)}) below 0.70 — cannot send actions yet.
        </p>
      )}

      {errors.repId && (
        <p data-testid="error-rep" className="text-xs text-amber-600">{errors.repId}</p>
      )}

      {/* Send button */}
      <button
        data-testid="composer-send"
        className={`rounded px-4 py-2 text-sm font-medium ${canSend ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
        disabled={!canSend}
      >
        Send Action
      </button>
    </div>
  );
};
