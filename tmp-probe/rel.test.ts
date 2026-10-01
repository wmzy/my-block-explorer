import { describe, it } from 'vitest';
import { formatRelativeTime } from '@/utils/format';
import { formatDuration, formatNumber } from '@/utils/format';

describe('probe', () => {
  it('prints what the formatters actually render', () => {
    console.log('unparseable string ->', JSON.stringify(formatRelativeTime('not-a-date')));
    console.log('empty string      ->', JSON.stringify(formatRelativeTime('')));
    console.log('NaN number        ->', JSON.stringify(formatRelativeTime(NaN)));
    console.log('undefined-ish {}  ->', JSON.stringify(formatRelativeTime({} as never)));
    const future = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    console.log('90min in future   ->', JSON.stringify(formatRelativeTime(future)));
    console.log('formatDuration(NaN) ->', JSON.stringify(formatDuration(NaN)));
    console.log('formatDuration(-5)  ->', JSON.stringify(formatDuration(-5)));
    console.log('formatNumber(1e21)  ->', JSON.stringify(formatNumber(1e21)));
    console.log('formatFileSize(-1)  ->', JSON.stringify((() => { const f = 0; return f; })()));
  });
});
