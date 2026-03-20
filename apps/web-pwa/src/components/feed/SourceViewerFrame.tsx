import React from 'react';

export interface SourceViewerFrameProps {
  readonly topicId: string;
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
}

export const SourceViewerFrame: React.FC<SourceViewerFrameProps> = ({
  topicId,
  publisher,
  title,
  url,
}) => {
  return (
    <section
      className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3"
      data-testid={`source-viewer-frame-${topicId}`}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">Source video</h3>
        <p className="text-xs text-slate-600" data-testid={`source-viewer-note-${topicId}`}>
          This headline points to a direct source video from {publisher}. We keep it available in
          the feed, but skip text synthesis for singleton video stories.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-sm">
        <iframe
          title={`${publisher} source viewer`}
          src={url}
          className="aspect-video h-auto min-h-[16rem] w-full"
          loading="lazy"
          referrerPolicy="no-referrer"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          sandbox="allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
          allowFullScreen
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 underline-offset-2 hover:text-slate-900 hover:underline"
          data-testid={`source-viewer-open-link-${topicId}`}
        >
          Open at source
        </a>
        <p className="text-slate-500">
          If the publisher blocks embedding, use the direct source link.
        </p>
      </div>

      <p className="text-xs text-slate-500" data-testid={`source-viewer-title-${topicId}`}>
        {title}
      </p>
    </section>
  );
};

export default SourceViewerFrame;
