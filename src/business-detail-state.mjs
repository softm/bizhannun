const plainObject = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.hasOwn(value, key);
const draftStrings = value => plainObject(value)
  && own(value, 'note') && typeof value.note === 'string'
  && own(value, 'tags') && typeof value.tags === 'string';

/** Editing state is text, separate from the persisted array of tags. */
export function noteDraft(partner = {}) {
  if (!plainObject(partner)) throw new TypeError('거래처 정보의 형식을 확인해 주세요.');
  const note = own(partner, 'note') ? partner.note : '';
  const tags = own(partner, 'tags') ? partner.tags : [];
  if (typeof note !== 'string' || !Array.isArray(tags) || !tags.every(tag => typeof tag === 'string')) {
    throw new TypeError('저장된 거래 메모와 태그의 형식을 확인해 주세요.');
  }
  return { note, tags: tags.join(', ') };
}

/** Match textarea.value line endings without changing the stored source text. */
export function editorNoteDraft(partner = {}) {
  const draft = noteDraft(partner);
  return { ...draft, note: draft.note.replace(/\r\n?/g, '\n') };
}

/** Compare exactly so changing whitespace or separators remains an unsaved edit. */
export function sameNoteDraft(a, b) {
  return draftStrings(a) && draftStrings(b) && a.note === b.note && a.tags === b.tags;
}

/** Validate before writing; never silently truncate the user's note or tags. */
export function parseNoteDraft(draft) {
  if (!draftStrings(draft)) throw new TypeError('거래 메모와 태그는 문자로 입력해 주세요.');
  if (draft.note.length > 5000) throw new RangeError('거래 메모는 5,000자 이하로 입력해 주세요.');
  if (draft.tags.length > 500) throw new RangeError('태그 입력은 500자 이하로 입력해 주세요.');
  const tags = [...new Set(draft.tags.split(/[,;|]/).map(tag => tag.trim()).filter(Boolean))];
  if (tags.length > 10) throw new RangeError('태그는 중복을 제외하고 최대 10개까지 입력할 수 있습니다.');
  return { note: draft.note, tags };
}

/** Merge into the latest saved partner, preserving identity, evidence and checks. */
export function applyNoteDraft(partner, draft, updatedAt = new Date().toISOString()) {
  if (!plainObject(partner)) throw new TypeError('거래처 정보의 형식을 확인해 주세요.');
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) {
    throw new TypeError('거래 메모의 저장 시각을 확인해 주세요.');
  }
  return { ...partner, ...parseNoteDraft(draft), updatedAt };
}
