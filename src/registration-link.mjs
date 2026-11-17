import { normalizeBusinessName } from './business-search.mjs';

/** Return a *candidate* only when the names and complete public road addresses match.
 * Never treat a store ID or a shared company name as proof of taxpayer identity.
 */
const compactAddress = value => String(value||'').normalize('NFKC').toLocaleLowerCase('ko')
  .replace(/[\s,().\-]/gu,'').trim();

export function findRegistrationCandidates(store, records=[]) {
  if (!store || !Array.isArray(records)) return [];
  const name=normalizeBusinessName(store.name);
  const address=compactAddress(store.roadAddress||store.address);
  if (!name || address.length<8) return [];
  const found=new Map();
  for(const record of records) {
    if(!record?.businessNumber || normalizeBusinessName(record.name)!==name)continue;
    const other=compactAddress(record.address);
    if(other!==address)continue;
    found.set(record.businessNumber,record);
  }
  return [...found.values()];
}
