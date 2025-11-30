import React from 'react';
import type { FeedItem, Perspective } from '../hooks/useFeedStore';
import { useSentimentState } from '../hooks/useSentimentState';
import { useRegion } from '../hooks/useRegion';
import { useIdentity } from '../hooks/useIdentity';

interface AnalysisViewProps {
  item: FeedItem;
}

interface PerspectiveRowProps {
  itemId: string;
  perspective: Perspective;
  onBlockedVote: () => void;
}

function PerspectiveRow({ itemId, perspective, onBlockedVote }: PerspectiveRowProps) {
  const framePointId = `${perspective.id}:frame`;
  const reframePointId = `${perspective.id}:reframe`;
  const frameAgreement = useSentimentState((s) => s.getAgreement(itemId, framePointId));
  const reframeAgreement = useSentimentState((s) => s.getAgreement(itemId, reframePointId));
  const setAgreement = useSentimentState((s) => s.setAgreement);
  const { proof } = useRegion();
  const { identity } = useIdentity();
  const canVote = Boolean(identity);

  const handleSet = (pointId: string, desired: -1 | 0 | 1) => {
    setAgreement({
      topicId: itemId,
      pointId,
      analysisId: itemId,
      desired,
      constituency_proof: proof || undefined
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3 rounded border border-slate-600/50 bg-slate-900/40 p-3">
      <div className="flex flex-col gap-2">
        <div className="text-sm text-slate-50">{perspective.frame}</div>
        <div className="relative flex items-center gap-1 text-xs text-slate-300">
          <ToggleButton
            label="Disagree"
            active={frameAgreement === -1}
            onClick={(e) => {
              e.stopPropagation();
              if (!canVote) {
                onBlockedVote();
                return;
              }
              handleSet(framePointId, frameAgreement === -1 ? 0 : -1);
            }}
            ariaLabel="Disagree frame"
            variant="disagree"
          >
              –
            </ToggleButton>
          <ToggleButton
            label="Agree"
            active={frameAgreement === 1}
            onClick={(e) => {
              e.stopPropagation();
              if (!canVote) {
                onBlockedVote();
                return;
              }
              handleSet(framePointId, frameAgreement === 1 ? 0 : 1);
            }}
            ariaLabel="Agree frame"
            variant="agree"
          >
            +
          </ToggleButton>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="text-sm text-slate-50">{perspective.reframe}</div>
        <div className="relative flex items-center gap-1 text-xs text-slate-300">
          <ToggleButton
            label="Disagree"
            active={reframeAgreement === -1}
            onClick={(e) => {
              e.stopPropagation();
              if (!canVote) {
                onBlockedVote();
                return;
              }
              handleSet(reframePointId, reframeAgreement === -1 ? 0 : -1);
            }}
            ariaLabel="Disagree reframe"
            variant="disagree"
          >
              –
            </ToggleButton>
          <ToggleButton
            label="Agree"
            active={reframeAgreement === 1}
            onClick={(e) => {
              e.stopPropagation();
              if (!canVote) {
                onBlockedVote();
                return;
              }
              handleSet(reframePointId, reframeAgreement === 1 ? 0 : 1);
            }}
            ariaLabel="Agree reframe"
            variant="agree"
          >
            +
          </ToggleButton>
        </div>
      </div>
    </div>
  );
}

function ToggleButton({
  children,
  active,
  onClick,
  ariaLabel,
  label,
  variant = 'default'
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel: string;
  label: string;
  variant?: 'agree' | 'disagree' | 'default';
}) {
  const activeColor = variant === 'agree' ? 'bg-emerald-600' : variant === 'disagree' ? 'bg-red-600' : 'bg-teal-600';
  return (
    <button
      type="button"
      className={`rounded px-2 py-1 ${active ? `${activeColor} text-white` : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
      onClick={onClick}
      aria-label={ariaLabel}
      title={label}
    >
      {children}
    </button>
  );
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({ item }) => {
  const { identity } = useIdentity();
  const canVote = Boolean(identity);
  const [warn, setWarn] = React.useState(false);
  const warnOnceRef = React.useRef<NodeJS.Timeout | null>(null);

  const showWarn = () => {
    setWarn(true);
    if (warnOnceRef.current) {
      clearTimeout(warnOnceRef.current);
    }
    warnOnceRef.current = setTimeout(() => setWarn(false), 1500);
  };

  // Note: recordRead is called by HeadlineCard when expanded, not here
  return (
    <div className="rounded-xl border border-slate-600/60 bg-slate-900/50 p-4 shadow-lg backdrop-blur">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="flex-1 space-y-2">
          <p className="text-sm uppercase tracking-wide text-teal-200">Summary</p>
          <p className="text-base leading-relaxed text-slate-50">{item.summary}</p>
        </div>
        {item.imageUrl && (
          <img
            src={item.imageUrl}
            alt={item.title}
            className="h-28 w-40 rounded-lg object-cover shadow-md"
          />
        )}
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-3">
          <p className="text-sm uppercase tracking-wide text-teal-200">Perspectives</p>
          {!canVote && warn && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800 shadow-sm animate-pulse">
              Create an account to cast votes
            </span>
          )}
        </div>
        <div className="space-y-2">
          {item.perspectives.map((p) => (
            <div
              key={p.id}
              onClick={() => {
                if (!canVote) {
                  showWarn();
                }
              }}
            >
              <PerspectiveRow itemId={item.id} perspective={p} onBlockedVote={showWarn} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AnalysisView;
