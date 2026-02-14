import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@vh/ui';
import { useAI } from '@vh/ai-engine';
import { EnvelopeIcon, DocumentTextIcon, BeakerIcon } from '@heroicons/react/24/outline';
import { useForumStore } from '../../store/hermesForum';

type ActionType = 'send' | 'proposal' | 'project';

interface Props {
  threadId: string;
  children?: React.ReactNode;
}

const EMPTY_COMMENTS: readonly any[] = []; // Stable reference for empty state

// Summary generation thresholds: first at 10, then 20, then every 20 after
function shouldGenerateSummary(count: number, lastGeneratedAt: number): boolean {
  if (count < 10) return false;
  if (lastGeneratedAt === 0) return true; // First generation at 10+
  // Generate at 10, 20, 40, 60, 80...
  const thresholds = [10, 20];
  for (let t = 40; t <= count; t += 20) {
    thresholds.push(t);
  }
  return thresholds.includes(count);
}

export const CommunityReactionSummary: React.FC<Props> = ({ threadId, children }) => {
  const comments = useForumStore((s) => s.comments.get(threadId)) ?? EMPTY_COMMENTS;
  const { analyze } = useAI({ workerFactory: undefined });

  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [modalOpen, setModalOpen] = useState<ActionType | null>(null);
  const lastGeneratedAtCount = useRef<number>(0);

  const buildPrompt = useCallback(() => {
    const concur = comments.filter((c) => c.stance === 'concur');
    const counter = comments.filter((c) => c.stance === 'counter');
    const discuss = comments.filter((c) => c.stance === 'discuss');

    const concurCount = concur.length;
    const counterCount = counter.length;
    const discussCount = discuss.length;

    const debateTotal = concurCount + counterCount; // Excludes discuss
    const participantTotal = debateTotal + discussCount;

    const concurPct = debateTotal > 0 ? Math.round((concurCount / debateTotal) * 100) : 0;
    const counterPct = debateTotal > 0 ? Math.round((counterCount / debateTotal) * 100) : 0;
    
    const concurText = concur.map((c) => c.content).join('\n');
    const counterText = counter.map((c) => c.content).join('\n');
    const discussText = discuss.map((c) => c.content).join('\n');
    return `Summarize the following community discussion.

STATISTICS:
- Participants: ${participantTotal} comments (${concurCount} concur, ${counterCount} counter, ${discussCount} discuss)
- Debate split (excluding discuss): ${concurPct}% concur, ${counterPct}% counter

CONCUR ARGUMENTS (supporting the topic):
${concurText || '(none yet)'}

COUNTER ARGUMENTS (opposing the topic):
${counterText || '(none yet)'}

DISCUSSIONS / QUESTIONS (neutral):
${discussText || '(none yet)'}

RULES:
- If there are no concur/counter stances yet, start with "No clear stance has emerged yet..." and summarize the discussion/questions.
- Otherwise start with a phrase like "The community is divided..." or "${concurPct}% of respondents concur..." or "Most participants concur..."
- Provide a 2-3 sentence neutral summary capturing both sides
- Be factual and balanced
- Do NOT include usernames, handles, or any personally identifiable information
- Do NOT use titles or headers - just the summary text`;
  }, [comments]);

  const isGeneratingRef = useRef(false);
  
  const generateSummary = useCallback(async () => {
    if (isGeneratingRef.current || comments.length === 0) return;
    isGeneratingRef.current = true;
    setIsGenerating(true);
    try {
      const res = await analyze(buildPrompt());
      const summary = (res as any)?.summary ?? (typeof res === 'string' ? res : null);
      if (summary) {
        setAiSummary(summary);
        lastGeneratedAtCount.current = comments.length;
      }
    } catch (err) {
      console.warn('[vh:forum] AI summary failed', err);
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }, [analyze, buildPrompt, comments.length]);

  // Store generateSummary in a ref to avoid effect dependency instability
  const generateSummaryRef = useRef(generateSummary);
  generateSummaryRef.current = generateSummary;

  // Automatic generation at thresholds: 10, 20, 40, 60, 80...
  useEffect(() => {
    if (shouldGenerateSummary(comments.length, lastGeneratedAtCount.current)) {
      void generateSummaryRef.current();
    }
  }, [comments.length]);

  // Don't render anything if no comments and no children (standalone mode)
  if (comments.length === 0 && !children) {
    return null;
  }

  // Determine summary text
  const getSummaryText = () => {
    if (isGenerating) return 'Generating summary…';
    if (aiSummary) return aiSummary;
    if (comments.length === 0) return 'Add support, oppose, or discussion comments below to start the thread.';
    if (comments.length >= 10) return 'Summary will be generated shortly...';
    return `Summary will be generated when ${10 - comments.length} more comments are added.`;
  };

  return (
    <div data-testid="community-summary">
      {/* Summary card with action icons and debate threads inside */}
      <div className="rounded-lg p-4 text-sm space-y-4" style={{ backgroundColor: 'var(--summary-card-bg)' }}>
        {/* Summary text */}
        <p style={{ color: 'var(--summary-card-text)', opacity: 0.9, fontWeight: 300 }} data-testid="ai-summary">
          {getSummaryText()}
        </p>
        {/* Action icons */}
        <div className="flex items-center gap-3" style={{ color: 'var(--thread-muted)' }}>
          <IconAction icon={<EnvelopeIcon className="h-5 w-5" />} label="Send to Rep" onOpen={setModalOpen} action="send" />
          <IconAction icon={<DocumentTextIcon className="h-5 w-5" />} label="Draft Proposal" onOpen={setModalOpen} action="proposal" />
          <IconAction icon={<BeakerIcon className="h-5 w-5" />} label="Start Project" onOpen={setModalOpen} action="project" />
        </div>
        {/* Debate threads (Concur/Counter columns) */}
        {children}
      </div>
      {modalOpen && <ComingSoonModal action={modalOpen} onClose={() => setModalOpen(null)} />}
    </div>
  );
};

const IconAction: React.FC<{ icon: React.ReactNode; label: string; action: ActionType; onOpen: (action: ActionType) => void }> = ({
  icon,
  label,
  action,
  onOpen
}) => (
  <button
    className="inline-flex items-center rounded-lg bg-slate-900/40 p-2 text-slate-400 transition hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-500"
    onClick={() => {
      // W3-Budget assessment (2026-02-14): civic_actions/day budget is now wired in
      // ActionComposer (W3-CAK Phase 3, PR #236). This IconAction surface triggers
      // ComingSoonModal — no real delivery flow exists here yet.
      // Wire budget enforcement when this surface executes real civic action delivery.
      // See: docs/foundational/WAVE3_BUDGET_BOUNDARY_ASSESSMENT.md
      onOpen(action);
    }}
    aria-describedby={`${action}-coming-soon`}
    aria-label={label}
    title={label}
    data-testid={`action-${action}`}
    tabIndex={0}
  >
    {icon}
  </button>
);

const ComingSoonModal: React.FC<{ action: ActionType; onClose: () => void }> = ({ action, onClose }) => {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>('button');
        const first = focusables.item(0);
        const last = focusables.item(focusables.length - 1);
        if (!first || !last) return;
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    modalRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const labels: Record<ActionType, { title: string; desc: string }> = {
    send: { title: 'Send to Representative', desc: 'Coming in Sprint 4 (Sovereign Legislative Bridge).' },
    proposal: { title: 'Draft Proposal', desc: 'Coming in Sprint 4 (Quadratic Funding).' },
    project: { title: 'Start Project', desc: 'Coming in Sprint 4 (Community Initiatives).' }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coming-soon-title"
        aria-describedby="coming-soon-desc"
        tabIndex={-1}
        className="max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="coming-soon-title" className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          {labels[action].title}
        </h2>
        <p id="coming-soon-desc" className="mt-2 text-sm text-slate-700 dark:text-slate-200">
          {labels[action].desc}
        </p>
        <Button className="mt-4 w-full" onClick={onClose} data-testid="close-coming-soon">
          Close
        </Button>
      </div>
    </div>
  );
};
