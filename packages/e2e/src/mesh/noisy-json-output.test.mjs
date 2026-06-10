import { describe, expect, it } from 'vitest';

import { parseLastJsonObjectFromOutput } from './noisy-json-output.mjs';

describe('parseLastJsonObjectFromOutput', () => {
  it('parses a single-line JSON object after noisy GUN output on stderr', () => {
    const parsed = parseLastJsonObjectFromOutput(
      '',
      [
        'Hello wonderful person! :) Thanks for using GUN',
        '{"observed":true,"latency_ms":280446,"trace_id":"trace-1"}',
      ].join('\n')
    );

    expect(parsed).toEqual({
      observed: true,
      latency_ms: 280446,
      trace_id: 'trace-1',
    });
  });

  it('returns the newest single-line JSON object from the preferred stream', () => {
    const parsed = parseLastJsonObjectFromOutput(
      [
        '{"observed":false,"trace_id":"old"}',
        'diagnostic banner',
        '{"observed":true,"trace_id":"new"}',
      ].join('\n'),
      '{"observed":true,"trace_id":"stderr"}'
    );

    expect(parsed).toEqual({
      observed: true,
      trace_id: 'new',
    });
  });

  it('falls back to parsing a pretty-printed JSON suffix', () => {
    const parsed = parseLastJsonObjectFromOutput(`banner
{
  "ok": true,
  "nested": {
    "value": 1
  }
}`);

    expect(parsed).toEqual({
      ok: true,
      nested: {
        value: 1,
      },
    });
  });

  it('ignores non-object JSON and output without JSON objects', () => {
    expect(parseLastJsonObjectFromOutput('banner\n[1,2,3]')).toBeNull();
    expect(parseLastJsonObjectFromOutput('banner only')).toBeNull();
  });
});
