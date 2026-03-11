/* @vitest-environment jsdom */

import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { NewsCardBack } from './NewsCardBack';

function renderBack(
  overrides: Partial<ComponentProps<typeof NewsCardBack>> = {},
) {
  render(
    <NewsCardBack
      topicId="news-1"
      summary="Summary"
      frameRows={[]}
      analysisProvider={null}
      perSourceSummaries={[]}
      relatedCoverage={[
        {
          source_id: 'related-1',
          publisher: 'Metro Desk',
          title: 'Follow-up coverage',
          url: 'https://example.com/follow-up',
        },
      ]}
      storylineHeadline="Transit storyline"
      storylineStoryCount={1}
      analysisFeedbackStatus={null}
      analysisError={null}
      retryAnalysis={() => {}}
      synthesisLoading={false}
      synthesisError={null}
      analysis={null}
      onFlipBack={() => {}}
      {...overrides}
    />,
  );
}

describe('NewsCardBack storyline presentation', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders singular storyline counts', () => {
    renderBack();

    expect(screen.getByTestId('news-card-storyline-headline-news-1')).toHaveTextContent(
      'Transit storyline • 1 story',
    );
  });

  it('omits the count suffix when storyline story count is zero', () => {
    renderBack({ storylineStoryCount: 0 });

    expect(screen.getByTestId('news-card-storyline-headline-news-1')).toHaveTextContent(
      'Transit storyline',
    );
    expect(screen.getByTestId('news-card-storyline-headline-news-1')).not.toHaveTextContent('•');
  });
});
