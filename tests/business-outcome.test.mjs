import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessInsights } from '../src/business-insights.mjs';
import { buildBusinessOutcome } from '../src/business-outcome.mjs';

const BNO = '6901100416';
const NOW = '2026-10-28T12:00:00Z';
const STAMP = '2026-10-28T11:00:00Z';
const OLD = '2026-10-10T09:00:00Z';
const check = (overrides = {}) => ({
  businessNumber: BNO, outcome: 'ok', businessStatus: 'active', checkedAt: STAMP,
  taxType: '부가가치세 일반과세자',
  source: { name: '국세청 사업자등록정보', url: 'https://www.data.go.kr/data/15081808/openapi.do' },
  ...overrides,
});
const model = ({ result = check(), partner = null, ...overrides } = {}) => ({
  ...buildBusinessInsights({ businessNumber: BNO, check: result, partner, now: NOW }), ...overrides,
});

test('fresh successful registration states explain the fact and retain its observed time', () => {
  for (const [businessStatus, label, tone, action] of [
    ['active', '계속사업자', 'positive', 'validate-registration'],
    ['suspended', '휴업자', 'warning', 'validate-registration'],
    ['closed', '폐업자', 'danger', 'edit-lookup-number'],
  ]) {
    const outcome = buildBusinessOutcome(model({ result: check({ businessStatus }) }));
    assert.equal(outcome.kind, businessStatus);
    assert.equal(outcome.currentConfirmed, true);
    assert.equal(outcome.badge, label);
    assert.equal(outcome.tone, tone);
    assert.match(outcome.fact, new RegExp(label));
    assert.equal(outcome.observedAt, '2026-10-28T11:00:00.000Z');
    assert.equal(outcome.timeLabel, '확인한 시각');
    assert.equal(outcome.previousRecord, null);
    assert.equal(outcome.nextAction.action, action);
  }
});

test('latest unsuccessful attempts never present retained active, suspended or closed records as current', () => {
  for (const latestOutcome of ['error', 'not_found', 'not_configured']) {
    for (const businessStatus of ['active', 'suspended', 'closed']) {
      const lastSuccess = check({ businessStatus, checkedAt: OLD });
      const latest = check({ outcome: latestOutcome, businessStatus: 'unknown', taxType: '' });
      const input = model({ result: latest, partner: { businessNumber: BNO, lastSuccess, lastCheck: latest, history: [lastSuccess, latest] } });
      const outcome = buildBusinessOutcome(input);
      assert.equal(outcome.kind, latestOutcome);
      assert.equal(outcome.currentConfirmed, false);
      assert.notEqual(outcome.tone, 'positive');
      assert.doesNotMatch(outcome.fact, /계속사업자로 확인|결과는 휴업자|결과는 폐업자/);
      assert.equal(outcome.observedAt, '2026-10-28T11:00:00.000Z');
      assert.equal(outcome.previousRecord.checkedAt, '2026-10-10T09:00:00.000Z');
      assert.equal(outcome.previousRecord.taxType, '부가가치세 일반과세자');
      assert.equal(outcome.nextAction.action, latestOutcome === 'not_found' ? 'edit-lookup-number' : 'insight-refresh-status');
    }
  }
});

test('missing or unrecognized statuses ask for a lookup without claiming an unavailable business fact', () => {
  for (const result of [null, check({ businessStatus: 'unknown' })]) {
    const outcome = buildBusinessOutcome(model({ result }));
    assert.equal(outcome.kind, 'unknown');
    assert.equal(outcome.currentConfirmed, false);
    assert.equal(outcome.previousRecord, null);
    assert.equal(outcome.nextAction.action, 'insight-refresh-status');
    assert.doesNotMatch(outcome.fact, /휴업자|폐업자|계속사업자/);
  }
});

test('an OK response with an unknown state cannot promote an older active response', () => {
  const lastSuccess = check({ checkedAt: OLD });
  const unknown = check({ businessStatus: 'unknown', taxType: '' });
  const input = model({ result: unknown, partner: { businessNumber: BNO, lastSuccess, history: [lastSuccess] } });
  const outcome = buildBusinessOutcome(input);
  assert.equal(outcome.kind, 'unknown');
  assert.equal(outcome.currentConfirmed, false);
  assert.equal(outcome.previousRecord.label, '계속사업자');
  assert.equal(outcome.previousRecord.checkedAt, '2026-10-10T09:00:00.000Z');
  assert.equal(outcome.nextAction.action, 'insight-refresh-status');
});

test('exact seven-day freshness is retained, and older records require a fresh lookup before comparison work', () => {
  const conflicts = [{ field: 'address', label: '주소', values: [] }];
  const boundary = buildBusinessOutcome(model({ result: check({ checkedAt: '2026-10-21T12:00:00Z' }), conflicts }));
  assert.equal(boundary.currentConfirmed, true);
  const stale = buildBusinessOutcome(model({ result: check({ checkedAt: '2026-10-21T11:59:59Z' }), conflicts }));
  assert.equal(stale.kind, 'stale');
  assert.equal(stale.currentConfirmed, false);
  assert.equal(stale.tone, 'neutral');
  assert.match(stale.fact, /이전 조회 기록/);
  assert.match(stale.meaning, /7일을 넘겼습니다/);
  assert.equal(stale.observedAt, '2026-10-21T11:59:59.000Z');
  assert.equal(stale.nextAction.action, 'insight-refresh-status');
});

test('undated and future-dated successes stay marked as records with unverified time', () => {
  for (const checkedAt of [null, 'invalid', '2026-10-29T12:00:00Z']) {
    const outcome = buildBusinessOutcome(model({ result: check({ checkedAt }) }));
    assert.equal(outcome.kind, 'time_unverified');
    assert.equal(outcome.currentConfirmed, false);
    assert.equal(outcome.badge, '조회 시각 확인 필요');
    assert.equal(outcome.nextAction.action, 'insight-refresh-status');
  }
});

test('missing profiles and incomplete collection do not displace the user action with an operator request', () => {
  const input = model({ evidence: { collectionStatus: 'partial', sourceCount: 0, candidateCount: 27 } });
  const before = structuredClone(input);
  const outcome = buildBusinessOutcome(input);
  assert.equal(outcome.kind, 'active');
  assert.equal(outcome.nextAction.action, 'validate-registration');
  assert.doesNotMatch(JSON.stringify(outcome), /enrichment-request|자료 보강|신용등급|위험 점수/);
  assert.deepEqual(input, before);
});

test('identity rejection and comparable field conflicts take precedence over routine cross-checks only after current state is known', () => {
  const conflicts = [{ field: 'address', label: '주소', values: [] }];
  const conflict = buildBusinessOutcome(model({ conflicts }));
  assert.equal(conflict.nextAction.id, 'field-conflicts');
  assert.equal(conflict.nextAction.action, 'insight-view-sources');
  const mismatch = buildBusinessOutcome(model({ conflicts, identityRejected: true }));
  assert.equal(mismatch.nextAction.id, 'identity-mismatch');
  assert.equal(mismatch.nextAction.action, 'insight-refresh-status');
  const failed = buildBusinessOutcome(model({ conflicts, result: check({ outcome: 'error', businessStatus: 'unknown' }) }));
  assert.equal(failed.nextAction.action, 'insight-refresh-status');
  const closed = buildBusinessOutcome(model({ conflicts, result: check({ businessStatus: 'closed' }) }));
  assert.equal(closed.nextAction.action, 'edit-lookup-number');
});
