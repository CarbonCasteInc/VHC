import type { Agreement } from '../components/feed/voteSemantics';

export const POINT_AGGREGATE_REFRESH_EVENT = 'vh:point-aggregate-refresh';

export interface PointAggregateRefreshDetail {
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly pointId: string;
  readonly previousAgreement?: Agreement;
  readonly nextAgreement?: Agreement;
  readonly previousWeight?: number;
  readonly weight?: number;
  readonly emittedAt?: number;
  readonly reason?: 'local_vote' | 'mesh_projection_settled';
}

type PointAggregateRefreshListener = (detail: PointAggregateRefreshDetail) => void;

function createPointAggregateRefreshEvent(detail: PointAggregateRefreshDetail): Event {
  if (typeof globalThis.CustomEvent === 'function') {
    return new CustomEvent<PointAggregateRefreshDetail>(POINT_AGGREGATE_REFRESH_EVENT, {
      detail,
    });
  }

  const event = new Event(POINT_AGGREGATE_REFRESH_EVENT);
  Object.defineProperty(event, 'detail', {
    configurable: true,
    enumerable: true,
    value: detail,
  });
  return event;
}

export function dispatchPointAggregateRefresh(detail: PointAggregateRefreshDetail): void {
  if (typeof globalThis.dispatchEvent !== 'function') {
    return;
  }

  globalThis.dispatchEvent(createPointAggregateRefreshEvent(detail));
}

export function subscribePointAggregateRefresh(
  listener: PointAggregateRefreshListener,
): () => void {
  if (
    typeof globalThis.addEventListener !== 'function' ||
    typeof globalThis.removeEventListener !== 'function'
  ) {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<PointAggregateRefreshDetail>).detail;
    if (!detail || typeof detail !== 'object') {
      return;
    }
    listener(detail);
  };

  globalThis.addEventListener(POINT_AGGREGATE_REFRESH_EVENT, handler);
  return () => {
    globalThis.removeEventListener(POINT_AGGREGATE_REFRESH_EVENT, handler);
  };
}
