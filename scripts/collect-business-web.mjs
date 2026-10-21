import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib';
import { isValidBusinessNumber } from '../src/domain.mjs';

const USER_AGENT = 'BizHannunBot/0.3 (+https://softm.github.io/bizhannun/)';
const MAX_BYTES = 1_000_000;
const MAX_PAGES = 4;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizedNumber = value => typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
const clean = (value, limit = 1000) => typeof value === 'string' ? decodeEntities(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const sourceId = url => createHash('sha256').update(url).digest('hex').slice(0, 24);

function decodeEntities(text) {
  return String(text).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const named = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'", nbsp:' ' };
    if (entity[0] !== '#') return named[entity.toLowerCase()] || '';
    const point = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : parseInt(entity.slice(1),10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}
function attribute(tag, name) {
  const match = tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : '';
}
function visibleMarkup(html) {
  return html.replace(/<!--[\s\S]*?-->/g,' ').replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ').replace(/<([a-z][\w-]*)\b[^>]*(?:\shidden(?=\s|=|>)|aria-hidden\s*=\s*[\"']true[\"']|style\s*=\s*[\"'][^\"']*display\s*:\s*none)[^>]*>[\s\S]*?<\/\1\s*>/gi,' ');
}
function visibleText(html) {
  return decodeEntities(visibleMarkup(html).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}

/** Decode only declared encodings; bad bytes never become replacement-character business facts. */
export function decodePublicBody(input, { contentType = '', contentEncoding = '' } = {}) {
  let raw = Buffer.from(input);
  if (raw.length > MAX_BYTES) throw new Error('response_too_large');
  const encodings = contentEncoding.toLowerCase().split(',').map(value => value.trim()).filter(value => value && value !== 'identity');
  if (encodings.length > 3) throw new Error('unsupported_content_encoding');
  for (const encoding of encodings.reverse()) {
    const decompress = new Map([['gzip', gunzipSync], ['x-gzip', gunzipSync], ['deflate', inflateSync], ['br', brotliDecompressSync]]).get(encoding);
    if (!decompress) throw new Error('unsupported_content_encoding');
    try { raw = decompress(raw, { maxOutputLength: MAX_BYTES }); }
    catch (error) { throw new Error(error.code === 'ERR_BUFFER_TOO_LARGE' ? 'response_too_large' : 'invalid_compressed_response'); }
  }
  const declaration = /charset\s*=\s*["']?([\w.-]+)/i;
  const head = raw.subarray(0, 4096).toString('latin1');
  const headerLabel = contentType.match(declaration)?.[1];
  const metaLabel = [...head.matchAll(/<meta\b[^>]*>/gi)].map(value => value[0].match(declaration)?.[1]).find(Boolean);
  const xmlLabel = head.match(/^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.-]+)["']/i)?.[1];
  const bomLabel = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf ? 'utf-8'
    : raw[0] === 0xff && raw[1] === 0xfe ? 'utf-16le' : raw[0] === 0xfe && raw[1] === 0xff ? 'utf-16be' : '';
  const declared = (bomLabel || headerLabel || metaLabel || xmlLabel || 'utf-8').toLowerCase();
  const koreanAliases = new Set(['euc-kr', 'euc_kr', 'euckr', 'ks_c_5601-1987', 'ks_c_5601-1989', 'ks_c_5601', 'ksc5601', 'ksc_5601', 'korean', 'csksc56011987', 'windows-949', 'cp949', 'ms949', 'x-windows-949']);
  const encoding = koreanAliases.has(declared) ? 'euc-kr' : declared;
  try {
    const decoded = new TextDecoder(encoding, { fatal: true }).decode(raw);
    // Some ICU builds accept UHC extension bytes as C1 controls instead of decoding CP949.
    // Keep the previous snapshot when the runtime cannot correctly decode those bytes.
    if (encoding === 'euc-kr' && /[\u0080-\u009f\ufffd]/.test(decoded)) throw new Error('invalid_korean_text');
    return decoded;
  }
  catch { throw new Error('unsupported_encoding'); }
}
function publicIp(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) return /^[23][\da-f]{3}:/i.test(address) && !/^2001:0?db8:/i.test(address);
  return false;
}

/** Resolve and validate all answers. Native requests pin these answers, avoiding a second DNS lookup. */
export async function validatePublicUrl(input, lookupImpl = dnsLookup) {
  const url = new URL(input);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 2048) throw new Error('unsafe_url');
  if ([...url.searchParams.keys()].some(key => /token|api.?key|service.?key|password|secret|authorization/i.test(key))) throw new Error('unsafe_url');
  const hostname = url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
  if (!hostname || hostname === 'localhost' || /\.(?:localhost|local|internal|test|invalid)$/.test(hostname)) throw new Error('unsafe_url');
  const addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await lookupImpl(hostname,{all:true,verbatim:true});
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(item=>!publicIp(item.address))) throw new Error('unsafe_address');
  url.hash = '';
  return { url, addresses };
}

function nativeFetch(url, options, addresses) {
  return new Promise((resolveResponse,reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method:'GET', headers:options.headers, signal:options.signal,
      lookup(_host, opts, callback) { callback(null, opts?.all ? addresses : addresses[0].address, opts?.all ? undefined : addresses[0].family); },
    }, response => {
      const status = response.statusCode || 500;
      resolveResponse(new Response([204,304].includes(status) ? null : Readable.toWeb(response), { status, headers:response.headers }));
    });
    request.on('error',reject);request.end();
  });
}
async function fetchPublic(input, context, beforeRedirect) {
  let target = input;
  for (let redirects=0;redirects<5;redirects++) {
    const {url,addresses} = await validatePublicUrl(target,context.lookupImpl);
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),10000);
    try {
      const init = { method:'GET',redirect:'manual',credentials:'omit',signal:controller.signal,headers:{'User-Agent':USER_AGENT,Accept:'text/html,application/xhtml+xml,application/rss+xml,text/plain;q=0.9'} };
      const response = context.fetchImpl ? await context.fetchImpl(url,init) : await nativeFetch(url,init,addresses);
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        response.body?.cancel().catch(()=>{});
        if (!location) throw new Error('invalid_redirect');
        target = new URL(location,url).href;
        // Validate before invoking robots retrieval or the redirected request.
        await validatePublicUrl(target,context.lookupImpl);
        if (beforeRedirect) await beforeRedirect(new URL(target));
        continue;
      }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) { response.body?.cancel().catch(()=>{});throw new Error('response_too_large'); }
      const reader = response.body?.getReader();
      let bytes=0;const chunks=[];
      if (reader) {
        try {
          while (true) {
            const {done,value}=await reader.read();if(done)break;
            bytes+=value.byteLength;
            if(bytes>MAX_BYTES){reader.cancel().catch(()=>{});throw new Error('response_too_large');}
            chunks.push(Buffer.from(value));
          }
        } finally {reader.releaseLock();}
      }
      const contentType = response.headers.get('content-type') || '';
      // Native HTTP exposes encoded bytes. A supplied Fetch implementation already handles transport decoding.
      const body = decodePublicBody(Buffer.concat(chunks), { contentType,
        contentEncoding: context.fetchImpl ? '' : response.headers.get('content-encoding') || '' });
      return {url:url.href,status:response.status,contentType,body};
    } finally {clearTimeout(timer);}
  }
  throw new Error('too_many_redirects');
}

export function robotsAllows(text, path) {
  const groups=[];let group=null;let rulesStarted=false;
  for(const line of String(text).split(/\r?\n/)) {
    const item=line.replace(/#.*/,'').match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);if(!item)continue;
    const key=item[1].toLowerCase(),value=item[2];
    if(key==='user-agent') {
      if(!value)continue;
      if(!group||rulesStarted){group={agents:[],rules:[]};groups.push(group);rulesStarted=false;}
      group.agents.push(value.toLowerCase());
    } else if(group&&['allow','disallow'].includes(key)){rulesStarted=true;if(value)group.rules.push({allow:key==='allow',path:value});}
  }
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'bizhannunbot'.includes(a)));
  const selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
  let decision={allow:true,length:-1};
  for(const rule of selected.flatMap(g=>g.rules)) {
    const pattern='^'+rule.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$');
    if(new RegExp(pattern).test(path)) {
      const length=rule.path.replace(/[*$]/g,'').length;
      if(length>decision.length||(length===decision.length&&rule.allow))decision={allow:rule.allow,length};
    }
  }
  return decision.allow;
}
async function robotsFor(url,context) {
  const origin=url.origin;
  if(!context.robots.has(origin)) context.robots.set(origin,(async()=>{
    const result=await fetchPublic(new URL('/robots.txt',origin).href,context);
    if(result.status===404)return '';
    if(result.status<200||result.status>=300)throw new Error('robots_unavailable');
    return result.body;
  })());
  return context.robots.get(origin);
}
async function fetchPage(url,context) {
  const allowed=async target=>{if(!robotsAllows(await robotsFor(target,context),target.pathname+target.search))throw new Error('robots_disallowed');};
  await allowed(new URL(url));
  return fetchPublic(url,context,allowed);
}

function organizations(html) {
  const found=[];
  const walk=(value,depth=0)=>{
    if(depth>6||!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const item of value.slice(0,100))walk(item,depth+1);return;}
    const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];
    if(types.some(type=>typeof type==='string'&&/^(?:Organization|Corporation|LocalBusiness|Store|Restaurant|ProfessionalService|MedicalBusiness)$/.test(type)))found.push(value);
    if(value['@graph'])walk(value['@graph'],depth+1);
  };
  for(const match of html.matchAll(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    if(!/application\/ld\+json/i.test(attribute(match[0].slice(0,match[0].indexOf('>')+1),'type')))continue;
    const body=match[0].replace(/^<script\b[^>]*>/i,'').replace(/<\/script\s*>$/i,'');
    if(body.length>100000)continue;
    try{walk(JSON.parse(body));}catch{}
  }
  return found.slice(0,20);
}
function metadata(html,property) {
  for(const match of html.matchAll(/<meta\b[^>]*>/gi))if([attribute(match[0],'name'),attribute(match[0],'property')].some(x=>x.toLowerCase()===property))return clean(attribute(match[0],'content'));
  return '';
}
function businessNumbers(text) {
  return new Set([...String(text).matchAll(/(?:^|[^\d])(\d{3}[\s-]*\d{2}[\s-]*\d{5})(?!\d)/g)]
    .map(match => normalizedNumber(match[1])).filter(isValidBusinessNumber));
}
function organizationIdentifiers(org) {
  const identifiers = Array.isArray(org.identifier) ? org.identifier.slice(0, 30) : [org.identifier];
  return [org.taxID, org.vatID, ...identifiers.map(value => object(value) ? value.value : value)]
    .filter(value => typeof value === 'string').join(' ');
}
function leafTables(html) {
  const stack = [], tables = [];
  for (const tag of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    if (!/^<\//.test(tag[0])) {
      if (stack.length) stack[stack.length - 1].nested = true;
      stack.push({ start: tag.index, nested: false });
    } else {
      const open = stack.pop();
      if (open && !open.nested) tables.push(html.slice(open.start, tag.index + tag[0].length));
    }
  }
  return tables;
}
function tableRows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(row => {
    const cells = [...row[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
    return { cells: cells.map(cell => clean(visibleText(cell[2]))), header: cells.length > 0 && cells.every(cell => cell[1].toLowerCase() === 'th') };
  });
}
function tableField(label) {
  const key = label.replace(/[\s:：]/g, '');
  if (/^(?:사업자등록번호|사업자번호|businessregistrationnumber|brn)$/i.test(key)) return 'businessNumber';
  if (/^(?:회사명|상호명|상호|법인명|사업장명)$/.test(key)) return 'name';
  if (/^(?:회사주소|사업장소재지|사업장주소|주소|소재지)$/.test(key)) return 'address';
  if (/^(?:회사전화번호|전화번호|대표전화|고객센터)$/.test(key)) return 'phone';
  if (/^(?:대표이메일|회사이메일|이메일|E-?mail)$/i.test(key)) return 'email';
  return new Map([['업태', 'businessType'], ['업종', 'industry'], ['종목', 'businessCategory']]).get(key) || '';
}

export function extractBusinessPage(html, pageUrl, seed, collectedAt = new Date().toISOString()) {
  const text=visibleText(html);const orgs=organizations(html);const number=normalizedNumber(seed.businessNumber);
  const identityText=text+' '+orgs.map(organizationIdentifiers).join(' ');
  const pageNumbers=businessNumbers(identityText);
  const targetPresent=pageNumbers.has(number),otherNumberPresent=[...pageNumbers].some(value=>value!==number);
  const officialHost=seed.channel!=='directory'?(seed.verifiedDomain===true?new URL(seed.website).hostname:seed.officialDomain):null;
  const domainConfirmed=Boolean(officialHost&&officialHost===new URL(pageUrl).hostname);
  const match=targetPresent?'exact_bno':domainConfirmed&&!otherNumberPresent?'confirmed_domain':'candidate';
  const id=sourceId(pageUrl);
  const title=clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]||metadata(html,'og:title')||new URL(pageUrl).hostname,200);
  const source={id,url:pageUrl,title,channel:seed.channel==='directory'?'directory':'website',collectedAt,publishedAt:null,match,...(match==='exact_bno'?{businessNumber:number}:{}),...(!targetPresent&&otherNumberPresent?{identityMismatch:true,...(pageNumbers.size===1?{matchedBusinessNumber:[...pageNumbers][0]}:{})}:{}),excerpt:clean(text.slice(Math.max(0,text.search(/사업자\s*등록\s*번호|사업자번호|business registration/i)-80)),500)};
  const fields=[];const add=(field,value,scope)=>{const v=clean(value,field==='description'?1500:500);if(v&&!fields.some(f=>f.field===field&&f.value===v))fields.push({field,value:v,sourceId:id,match,...(scope?{scope}:{})});};
  const tables=leafTables(visibleMarkup(html)).map(value=>({html:value,rows:tableRows(value),numbers:businessNumbers(visibleText(value))})).filter(table=>table.rows.some(row=>row.cells.some(cell=>tableField(cell))));
  const pageWideFieldsAllowed=!otherNumberPresent&&orgs.length<=1&&tables.length<=1;
  // A publisher's Organization is not the target business just because its page mentions the BRN.
  const eligibleOrgs=orgs.filter(org=>{
    const identifiers=organizationIdentifiers(org),numbers=businessNumbers(identifiers);
    if(numbers.has(number))return numbers.size===1;
    if(orgs.length!==1||!domainConfirmed||org.taxID||org.vatID||numbers.size||otherNumberPresent)return false;
    const canonical=typeof org.url==='string'?org.url:typeof org['@id']==='string'?org['@id']:'';
    try { return !canonical||new URL(canonical,pageUrl).hostname===new URL(pageUrl).hostname; } catch { return false; }
  });
  for(const org of seed.channel==='directory'?[]:eligibleOrgs) {
    add('name',org.legalName||org.name);add('description',org.description);add('industry',org.industry);add('foundedAt',org.foundingDate);
    if(typeof org.address==='string')add('address',org.address);
    else if(object(org.address))add('address',[org.address.addressCountry?.name||org.address.addressCountry,org.address.addressRegion,org.address.addressLocality,org.address.streetAddress,org.address.postalCode].filter(v=>typeof v==='string').join(' '));
    if(typeof org.telephone==='string')add('phone',org.telephone,'public_business');
    if(typeof org.email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(org.email))add('email',org.email,'public_business');
  }
  if(domainConfirmed&&pageWideFieldsAllowed){add('name',metadata(html,'og:site_name'));add('description',metadata(html,'description')||metadata(html,'og:description'));}
  const addCell=(label,value)=>{
    const field=tableField(label);
    if(!field||field==='businessNumber'||(field==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))return;
    add(field,value,['phone','email'].includes(field)?'public_business':undefined);
  };
  for(const table of tables) {
    const header=table.rows.find(row=>row.header&&row.cells.some(cell=>tableField(cell)==='businessNumber'));
    if(header) {
      const numberColumn=header.cells.findIndex(cell=>tableField(cell)==='businessNumber');
      for(const row of table.rows.filter(value=>!value.header)) {
        if(normalizedNumber(row.cells[numberColumn])!==number)continue;
        for(let i=0;i<Math.min(header.cells.length,row.cells.length);i++)addCell(header.cells[i],row.cells[i]);
      }
      continue;
    }
    const tableMatches=table.numbers.has(number)&&table.numbers.size===1;
    const unambiguousPage=table.numbers.size===0&&tables.length===1&&pageWideFieldsAllowed&&match!=='candidate';
    for(const row of table.rows) {
      const rowNumbers=businessNumbers(row.cells.join(' '));
      // Repeated business cards in one table require their own row-level identifier.
      if(!tableMatches&&!unambiguousPage&&!(rowNumbers.has(number)&&rowNumbers.size===1))continue;
      for(let i=0;i+1<row.cells.length;i+=2)addCell(row.cells[i],row.cells[i+1]);
    }
  }
  const phone=text.match(/(?:대표\s*전화|고객\s*센터|전화\s*번호|고객\s*상담|\bTEL(?:EPHONE)?\b)\s*[:：]?\s*(\+?\d[\d()\s-]{6,22}\d)/i)?.[1];
  if(phone&&domainConfirmed&&pageWideFieldsAllowed)add('phone',phone,'public_business');
  const email=text.match(/(?:고객\s*문의\s*(?:이메일|E-?mail)|대표\s*(?:이메일|E-?mail)|이메일|E-?mail)\s*[:：]?\s*([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1];
  if(email&&domainConfirmed&&pageWideFieldsAllowed)add('email',email,'public_business');
  const address=text.match(/(?:본사\s*주소|사업장\s*(?:소재지|주소)|주소|소재지)\s*[:：]\s*([^|©]{8,180})/)?.[1];
  if(address&&domainConfirmed&&pageWideFieldsAllowed)add('address',address.split(/대표(?:자|이사)|사업자\s*등록|전화|팩스|TEL|Copyright/i)[0]);
  if(seed.channel==='directory'&&match==='exact_bno'&&pageWideFieldsAllowed&&!fields.some(field=>field.field==='name')) {
    const heading=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i)?.[1];
    const candidate=clean(heading?visibleText(heading):metadata(html,'og:title'),200)
      .replace(/\s*[-|·]\s*(?:사업자(?:등록번호)?\s*(?:조회|정보)|기업정보|회사정보).*$/,'').trim();
    if(candidate&&!/^(?:사업자(?:등록번호)?\s*(?:조회|정보)|기업정보|회사정보|사업자한눈)$/.test(candidate)&&!/^https?:/i.test(candidate))add('name',candidate);
  }
  const links=[],references=[];
  for(const anchor of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi)) {
    const href=attribute(anchor[0].slice(0,anchor[0].indexOf('>')+1),'href');
    if(!href||href.startsWith('#'))continue;
    try {
      const url=new URL(href,pageUrl);url.hash='';
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||url.href.length>2048)continue;
      if([...url.searchParams.keys()].some(key=>/token|api.?key|service.?key|password|secret|authorization/i.test(key)))continue;
      const host=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();
      if(host==='localhost'||/\.(?:localhost|local|internal|test|invalid)$/.test(host)||(isIP(host)&&!publicIp(host)))continue;
      const label=clean(visibleText(anchor[0]),200);
      if(url.origin===new URL(pageUrl).origin&&/(?:about|company|contact|introduc|overview|corporat|business|회사소개|기업소개|오시는길|고객센터)/i.test(url.pathname+' '+label))links.push(url.href);
      let channel='';
      if(/(?:^|\.)(?:instagram\.com|youtube\.com|youtu\.be|blog\.naver\.com|post\.naver\.com|linkedin\.com|facebook\.com|x\.com|twitter\.com|threads\.net|tiktok\.com|pf\.kakao\.com)$/.test(host))channel='social';
      else if(/(?:^|[\/_.-])(?:recruit(?:ment)?|careers?|jobs?)(?:[\/_.-]|$)|채용/i.test(url.hostname+' '+url.pathname+' '+label))channel='jobs';
      else if(/(?:^|[\/_.-])(?:press|news|media)(?:[\/_.-]|$)|보도자료|언론보도/i.test(url.pathname+' '+label))channel='news';
      if(channel&&url.href!==pageUrl&&!references.some(item=>item.url===url.href)&&references.length<12)references.push({id:sourceId(url.href),url:url.href,title:label||url.hostname,channel,match:'candidate',discoveredFrom:pageUrl,collectedAt,publishedAt:null});
    } catch {}
  }
  return {source,fields,links:[...new Set(links)].slice(0,12),references,matched:match!=='candidate'};
}

function readSeeds(value) {
  const list=Array.isArray(value)?value:value?.businesses;
  if(!Array.isArray(list)||list.length>100)throw new Error('invalid_seed_config');
  return list.map(seed=>{
    const number=normalizedNumber(seed.businessNumber);
    if(!isValidBusinessNumber(number)||typeof seed.website!=='string'||!seed.website||seed.website.length>2048)throw new Error('invalid_seed_config');
    return {businessNumber:number,name:clean(seed.name,200),website:seed.website,verifiedDomain:seed.verifiedDomain===true,search:seed.search===true,channel:seed.channel==='directory'?'directory':'website'};
  });
}
function discoverRss(xml,businessNumber,collectedAt) {
  const sources=[];
  for(const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const body=match[1];const value=name=>clean(body.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'))?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')||'');
    const url=value('link');
    try{const target=new URL(url);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)continue;}catch{continue;}
    sources.push({id:sourceId(url),url,title:value('title'),channel:'website',discoveredFrom:'https://www.bing.com/search',collectedAt,publishedAt:null,match:'candidate',excerpt:value('description').slice(0,500)});
  }
  return sources.slice(0,10);
}

/** Existing unrelated businesses and last successful evidence survive partial/network failure. */
export async function runCollector({configPath='config/business-sources.json',outputPath='data/enrichment/index.json',fetchImpl,lookupImpl=dnsLookup,now=()=>new Date().toISOString(),delayMs=400}={}) {
  const seeds=readSeeds(JSON.parse(await readFile(configPath,'utf8')));
  let previous={businesses:[],meta:{}};
  try{previous=JSON.parse(await readFile(outputPath,'utf8'));if(!Array.isArray(previous.businesses))throw new Error('invalid_previous_data');}catch(error){if(error.code!=='ENOENT')throw error;}
  const records=new Map(previous.businesses.map(record=>[record.businessNumber,record]));
  const context={fetchImpl,lookupImpl,robots:new Map()};const errors=[];
  for(const seed of seeds) {
    const attempt=now();const old=records.get(seed.businessNumber);const sources=[];const fields=[];let failure='';let officialDomain=seed.channel==='directory'?null:seed.verifiedDomain?new URL(seed.website).hostname:old?.officialDomain||null;
    const queue=[seed.website],seen=new Set();
    while(queue.length&&seen.size<MAX_PAGES) {
      const url=queue.shift();if(seen.has(url))continue;seen.add(url);
      try {
        if(seen.size>1&&delayMs>0)await new Promise(resolveDelay=>setTimeout(resolveDelay,Math.min(delayMs,2000)));
        const response=await fetchPage(url,context);
        if(response.status<200||response.status>=300)throw new Error('http_'+response.status);
        if(response.contentType&&!/text\/html|application\/xhtml\+xml/i.test(response.contentType))throw new Error('unsupported_content_type');
        if(/captcha|verify you are human|access denied|로그인 후 이용/i.test(visibleText(response.body).slice(0,300)))throw new Error('access_restricted');
        const page=extractBusinessPage(response.body,response.url,{...seed,officialDomain},attempt);
        const previousSource=(old?.sources||[]).find(source=>source.id===page.source.id||source.url===page.source.url);
        const rank=match=>({candidate:0,confirmed_domain:1,exact_bno:2}[match]||0);
        const previousFields=(old?.fields||[]).filter(field=>field.sourceId===previousSource?.id);
        const nextKinds=new Set(page.fields.filter(field=>field.match!=='candidate').map(field=>field.field));
        const incomplete=previousFields.some(field=>field.match!=='candidate'&&field.field!=='website'&&!nextKinds.has(field.field));
        if(previousSource&&rank(previousSource.match)>0&&(rank(page.source.match)<rank(previousSource.match)||incomplete)) {
          failure=rank(page.source.match)<rank(previousSource.match)?'identity_not_confirmed':nextKinds.size?'partial_extraction':'no_public_fields';
          // Retain the original snapshot and fields, with their original collection time.
          // Missing fields on a partial response are not evidence that earlier facts disappeared.
          continue;
        }
        if(previousSource?.id&&previousSource.id!==page.source.id) {
          const originalId=page.source.id;
          page.source.id=previousSource.id;
          for(const field of page.fields)if(field.sourceId===originalId)field.sourceId=previousSource.id;
        }
        sources.push(page.source,...page.references);fields.push(...page.fields);
        queue.push(...page.links.filter(link=>!seen.has(link)));
      }catch(error){failure=String(error.message).replace(/[^a-z0-9_]/gi,'').slice(0,80)||'fetch_failed';}
    }
    if(seed.search) {
      try{const url=new URL('https://www.bing.com/search');url.searchParams.set('format','rss');url.searchParams.set('q','"'+seed.businessNumber+'"');const found=await fetchPage(url.href,context);if(found.status>=200&&found.status<300)sources.push(...discoverRss(found.body,seed.businessNumber,attempt));}catch{ /* Search discovery is optional; never turn its absence into no-business evidence. */ }
    }
    const pageSources=sources.filter(source=>['website','directory'].includes(source.channel)&&!source.discoveredFrom);
    if(!pageSources.length) {
      errors.push({businessNumber:seed.businessNumber,code:failure||'no_pages'});
      records.set(seed.businessNumber,{...(old||{businessNumber:seed.businessNumber,name:seed.name,sources:[],fields:[],collectedAt:null}),collection:{...(old?.collection||{}),status:'failed',lastAttemptAt:attempt,error:failure||'no_pages'}});
      continue;
    }
    if(pageSources.every(source=>source.match==='candidate'))failure=failure||'identity_not_confirmed';
    const uniqueSources=[...new Map([...sources.filter(source=>source.discoveredFrom),...sources.filter(source=>!source.discoveredFrom)].map(source=>[source.id,source])).values()];
    const oldSourceById=new Map((old?.sources||[]).map(source=>[source.id,source]));
    const rank=match=>({candidate:0,confirmed_domain:1,exact_bno:2}[match]||0);
    const weakenedIds=new Set(uniqueSources.filter(source=>rank(oldSourceById.get(source.id)?.match)>rank(source.match)).map(source=>source.id));
    if(weakenedIds.size)failure='identity_not_confirmed';
    const acceptedSources=uniqueSources.filter(source=>!weakenedIds.has(source.id));
    const sourceIds=new Set(acceptedSources.map(source=>source.id));
    const mergedSources=[...acceptedSources,...(old?.sources||[]).filter(source=>!sourceIds.has(source.id))];
    const mergedFields=[...fields.filter(field=>!weakenedIds.has(field.sourceId)),...(old?.fields||[]).filter(field=>!sourceIds.has(field.sourceId))];
    if(officialDomain) {
      const websiteSource=pageSources.find(source=>source.channel==='website'&&new URL(source.url).hostname===officialDomain&&source.match!=='candidate');
      if(websiteSource)mergedFields.push({field:'website',value:new URL(websiteSource.url).origin,sourceId:websiteSource.id,match:websiteSource.match});
    }
    const collection={...(old?.collection||{}),status:failure?'partial':'success',lastAttemptAt:attempt,
      lastSuccessAt:pageSources.some(source=>source.match!=='candidate')?attempt:old?.collection?.lastSuccessAt||null};
    delete collection.error;if(failure)collection.error=failure;
    records.set(seed.businessNumber,{businessNumber:seed.businessNumber,name:seed.name,collectedAt:attempt,
      ...(['business','corporation'].includes(old?.entityType)?{entityType:old.entityType}:{}),
      ...(officialDomain?{officialDomain,website:'https://'+officialDomain}:{}),sources:mergedSources,fields:mergedFields,collection});
  }
  const result={businesses:[...records.values()],meta:{...(previous.meta||{}),generatedAt:now(),attemptedCount:seeds.length,businessCount:records.size,failedCount:errors.length,errors,policy:'Public business information only; exact BRN/domain evidence and source URLs retained. Discovery candidates are not verified facts.'}};
  await mkdir(dirname(outputPath),{recursive:true});const temporary=outputPath+'.tmp';await writeFile(temporary,JSON.stringify(result,null,2)+'\n');await rename(temporary,outputPath);
  return {businessCount:records.size,attemptedCount:seeds.length,failedCount:errors.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);const options={};
  for(let i=0;i<args.length;i+=2){if(!['--config','--output'].includes(args[i])||!args[i+1])throw new Error('Usage: node scripts/collect-business-web.mjs [--config path] [--output path]');options[args[i]==='--config'?'configPath':'outputPath']=args[i+1];}
  const result=await runCollector(options);console.log(JSON.stringify(result));
}
