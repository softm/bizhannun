const labels = Object.freeze({ active: '계속사업자', suspended: '휴업자', closed: '폐업자' });
const recognized = value => Object.hasOwn(labels, value);
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const retry = (description = '조회가 완료되면 등록 상태와 확인 시각을 다시 보여 드립니다.') => ({
  id: 'status-recheck', action: 'insight-refresh-status', label: '상태 다시 확인',
  title: '사업자 상태를 다시 조회하세요', description,
});
const editNumber = description => ({
  id: 'check-entered-number', action: 'edit-lookup-number', label: '사업자번호 확인·수정',
  title: '입력한 번호를 등록증과 맞춰 보세요', description,
});

/**
 * Describe evidence that the UI already has; never infer a business condition
 * from an unavailable lookup, missing public profile or collection failure.
 * Freshness is supplied by the existing insight policy, including its strict
 * seven-day boundary. An old success is kept separately from the latest attempt.
 */
export function buildBusinessOutcome(model = {}) {
  const status = model.status || {};
  const hasStatus = recognized(status.businessStatus);
  const label = hasStatus ? labels[status.businessStatus] : '미확인';
  const successTime = stamp(status.checkedAt);
  const latestTime = stamp(status.latestCheckedAt);
  // An OK response with an unknown status must not promote an older success.
  const newerUnrecognizedResponse = status.latestOutcome === 'ok' && hasStatus &&
    latestTime !== null && successTime !== null && latestTime > successTime;
  const latestConfirmed = status.latestOutcome === 'ok' && hasStatus && !status.usingPrevious && !newerUnrecognizedResponse;
  const prior = !latestConfirmed && hasStatus ? {
    label, taxType: status.taxType || '', checkedAt: status.checkedAt || null,
  } : null;
  const common = {
    kind: 'unknown', tone: 'neutral', badge: '현재 상태 미확인',
    fact: '현재 사업자 상태를 확인하지 못했습니다.',
    meaning: '확인된 등록 상태가 없습니다. 사업자번호로 다시 조회해 주세요.',
    observedAt: status.latestCheckedAt || null, timeLabel: '마지막 조회 시도',
    sourceName: status.sourceName || '', sourceUrl: status.sourceUrl || null,
    currentConfirmed: false, previousRecord: prior, nextAction: retry(),
  };
  if (status.latestOutcome === 'not_found') return {
    ...common, kind: 'not_found', badge: '등록정보 미확인',
    fact: '이 번호의 등록정보를 찾지 못했습니다.',
    meaning: '조회 결과가 없다는 이유로 폐업이나 미등록으로 판단할 수 없습니다. 번호를 다시 확인해 주세요.',
    nextAction: editNumber('사업자등록증에 적힌 10자리 번호와 입력값을 비교한 뒤 다시 조회하세요.'),
  };
  if (status.latestOutcome === 'not_configured') return {
    ...common, kind: 'not_configured', badge: '조회 서비스 연결 대기',
    fact: '사업자 상태 조회를 아직 사용할 수 없습니다.',
    meaning: '조회 서비스 연결이 준비되지 않아 현재 상태를 확인하지 못했습니다. 업체의 등록 상태와 관계없는 연결 문제입니다.',
    nextAction: retry('잠시 후 다시 시도해 주세요. 같은 안내가 계속되면 추가 작업의 연동 상태에서 서비스 연결을 확인할 수 있습니다.'),
  };
  if (status.latestOutcome === 'error' || status.usingPrevious) return {
    ...common, kind: 'error', tone: 'warning', badge: '조회 실패 · 상태 미확인',
    fact: '이번 조회를 완료하지 못했습니다.',
    meaning: '현재 사업자 상태는 미확인입니다. 조회 오류는 업체의 휴업·폐업을 뜻하지 않습니다.',
    nextAction: retry('잠시 후 다시 조회하세요. 이전 성공 기록이 있어도 이번 확인 결과를 대신하지 않습니다.'),
  };
  if (!latestConfirmed) return common;

  const freshness = status.freshness?.state;
  if (freshness !== 'fresh') return {
    ...common, kind: freshness === 'stale' ? 'stale' : 'time_unverified',
    badge: freshness === 'stale' ? '이전 기록 · 재확인 필요' : '조회 시각 확인 필요',
    fact: `이전 조회 기록은 ${label}입니다.`,
    meaning: freshness === 'stale'
      ? '마지막 정상 조회 후 7일을 넘겼습니다. 지금 상태는 다시 조회해 확인하세요.'
      : freshness === 'future'
        ? '기록의 조회 시각이 현재보다 미래입니다. 현재 상태와 올바른 확인 시각을 다시 조회해 주세요.'
        : '이 기록의 조회 시각을 확인할 수 없습니다. 현재 상태와 확인 시각을 다시 조회해 주세요.',
    observedAt: status.checkedAt || null, timeLabel: '이전 기록의 조회 시각',
    previousRecord: null, nextAction: retry('거래에 사용할 상태와 확인 시각을 최신 조회 결과로 갱신하세요.'),
  };

  const current = {
    ...common, kind: status.businessStatus, currentConfirmed: true,
    badge: label, observedAt: status.checkedAt || null, timeLabel: '확인한 시각', previousRecord: null,
  };
  if (status.businessStatus === 'closed') return {
    ...current, tone: 'danger', fact: '조회 결과는 폐업자입니다.',
    meaning: '조회 시점에 이 사업자번호가 폐업자로 등록되어 있습니다. 거래처가 현재 사용하는 등록정보를 확인하세요.',
    nextAction: {
      ...editNumber('거래처에 현재 사업자등록증을 요청하세요. 다른 번호를 사용한다면 그 번호로 다시 조회할 수 있습니다.'),
      title: '거래처의 현재 사업자번호를 확인하세요',
    },
  };
  if (status.businessStatus === 'suspended') return {
    ...current, tone: 'warning', fact: '조회 결과는 휴업자입니다.',
    meaning: '조회 시점에 휴업자로 등록되어 있습니다. 현재 업무 진행 여부와 거래 일정은 거래처에 확인하세요.',
    nextAction: {
      id: 'operation-check', action: 'validate-registration', label: '등록증 정보 대조',
      title: '거래 일정과 등록증 정보를 확인하세요',
      description: '거래처에 업무 재개 여부를 확인하고, 받은 등록증의 번호·개업일·대표자명을 대조할 수 있습니다.',
    },
  };
  const nextAction = model.identityRejected ? {
    ...retry('번호가 다른 자료는 제외했습니다. 입력한 사업자번호의 자료를 다시 불러와 확인하세요.'),
    id: 'identity-mismatch', title: '이 번호에 연결된 자료를 다시 확인하세요',
  } : Array.isArray(model.conflicts) && model.conflicts.length ? {
    id: 'field-conflicts', action: 'insight-view-sources', label: '서로 다른 정보 비교',
    title: '공개자료의 서로 다른 값을 비교하세요',
    description: `${model.conflicts.length}개 항목이 출처마다 다릅니다. 각 자료의 원문과 수집일을 함께 확인하세요.`,
  } : {
    id: 'registration-cross-check', action: 'validate-registration', label: '등록증 정보 대조',
    title: '거래할 업체의 등록증과 맞춰 보세요',
    description: '상태 조회만으로 상호·주소가 확인되지는 않습니다. 받은 등록증의 번호·개업일·대표자명을 대조할 수 있습니다.',
  };
  return {
    ...current, tone: 'positive', fact: '계속사업자로 확인됐습니다.',
    meaning: '조회 시점의 세무 등록 상태입니다. 실제 영업 여부와 거래 이행 능력은 별도로 확인하세요.',
    nextAction,
  };
}
