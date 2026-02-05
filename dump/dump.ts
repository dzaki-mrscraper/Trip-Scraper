/**
 * Express API Server for Trip.com Flight Scraping
 * 
 * Implements the scraping flow:
 * 1. Parse URL parameters
 * 2. Visit hostname root to get cookies (getWithRedirects)
 * 3. Make flight search API request
 */

import express, { Request, Response } from 'express';
import { CycleTLSSession } from '../cycleTLS-session';
import { Session } from '../session';
import { URL } from 'url';
import { generate_rguid_rsg_rdg } from '../collect-d.js';
import { randomUUID } from 'crypto';
import { md5 } from 'js-md5';
import { c_sign } from '../c-sign';
import signature from '../signature_jsdom';
import { encodePayload } from '../ubt-encoder';
import zlib from 'zlib';
import fs from 'fs'

const app = express();
app.use(express.json());

interface FlightSearchParams {
  dcity: string;        // Departure city code
  acity: string;        // Arrival city code
  ddate: string;        // Departure date (YYYY-MM-DD)
  rdate?: string;       // Return date (for round trips)
  triptype: string;     // 'rt' (round trip) or 'ow' (one way)
  class?: string;       // Cabin class: 'y' (economy), 'c' (business), 'f' (first)
  quantity?: number;    // Number of passengers
  locale?: string;      // Locale code (e.g., 'en-ID')
  curr?: string;        // Currency code (e.g., 'IDR', 'VND')
  dairport?: string;    // Departure airport code
  aairport?: string;    // Arrival airport code
}

interface ParsedUrlData {
  hostname: string;
  region: string;
  params: FlightSearchParams;
}

/**
 * Parse Trip.com flight search URL
 */
function parseTripUrl(urlString: string): ParsedUrlData {
  const url = new URL(urlString);
  const hostname = url.hostname;
  
  // Extract region from hostname (e.g., 'id' from 'id.trip.com')
  const hostParts = hostname.split('.');
  const region = hostParts[0] || 'id';
  
  // Parse query parameters
  const params: FlightSearchParams = {
    dcity: url.searchParams.get('dcity') || '',
    acity: url.searchParams.get('acity') || '',
    ddate: url.searchParams.get('ddate') || '',
    rdate: url.searchParams.get('rdate') || undefined,
    triptype: url.searchParams.get('triptype') || 'rt',
    class: url.searchParams.get('class') || 'y',
    quantity: parseInt(url.searchParams.get('quantity') || '1', 10),
    locale: url.searchParams.get('locale') || `en-${region.toUpperCase()}`,
    curr: url.searchParams.get('curr') || (region === 'id' ? 'IDR' : 'USD'),
    dairport: url.searchParams.get('dairport') || undefined,
    aairport: url.searchParams.get('aairport') || undefined,
  };
  
  return { hostname, region, params };
}

/**
 * Extract __APP_INITIAL_STATE__ from HTML response and get city information
 */
function extractAppInitialState(htmlBody: string): {
  appInitialState: any;
  cityInfoMap: Record<string, { cityId: string; cityName: string }>;
} {
  let appInitialState: any = null;
  let cityInfoMap: Record<string, { cityId: string; cityName: string }> = {};
  
  if (!htmlBody) {
    return { appInitialState, cityInfoMap };
  }
  
  try {
    // Look for __APP_INITIAL_STATE__ in the HTML
    // Try multiple patterns: __APP_INITIAL_STATE__: {...} or window.__APP_INITIAL_STATE__ = {...}
    let jsonStart = -1;
    let jsonString = '';
    
    // Find the position of __APP_INITIAL_STATE__
    const statePattern = /__APP_INITIAL_STATE__\s*[:=]\s*/;
    const match = htmlBody.match(statePattern);
    
    if (match) {
      jsonStart = match.index! + match[0].length;
      // Find the opening brace
      const bracePos = htmlBody.indexOf('{', jsonStart);
      if (bracePos !== -1) {
        // Extract from opening brace, find matching closing brace
        let braceCount = 0;
        let i = bracePos;
        while (i < htmlBody.length) {
          if (htmlBody[i] === '{') braceCount++;
          if (htmlBody[i] === '}') braceCount--;
          if (braceCount === 0) {
            jsonString = htmlBody.substring(bracePos, i + 1);
            break;
          }
          i++;
        }
      }
    }
    
    if (jsonString) {
      appInitialState = JSON.parse(jsonString);
      console.log('[extractAppInitialState] ✅ Extracted __APP_INITIAL_STATE__');
      
      // Extract city information from flightSearchInfo.segmentParameterList
      if (appInitialState.flightSearchInfo?.segmentParameterList) {
        for (const segment of appInitialState.flightSearchInfo.segmentParameterList) {
          if (segment.dCityInfo) {
            cityInfoMap[segment.dCityCode] = {
              cityId: segment.dCityInfo.cityId,
              cityName: segment.dCityInfo.multName || segment.dCityInfo.enName
            };
          }
          if (segment.aCityInfo) {
            cityInfoMap[segment.aCityCode] = {
              cityId: segment.aCityInfo.cityId,
              cityName: segment.aCityInfo.multName || segment.aCityInfo.enName
            };
          }
        }
      }
      
      // Also check cityInfo.cityCodeList as fallback
      if (appInitialState.cityInfo?.cityCodeList) {
        for (const city of appInitialState.cityInfo.cityCodeList) {
          if (city.code && !cityInfoMap[city.code]) {
            cityInfoMap[city.code] = {
              cityId: city.cityId,
              cityName: city.multName || city.enName
            };
          }
        }
      }
      
      console.log('[extractAppInitialState] ✅ Extracted city info:', Object.keys(cityInfoMap));
    }
  } catch (e) {
    console.warn('[extractAppInitialState] Failed to parse __APP_INITIAL_STATE__:', e);
  }
  
  return { appInitialState, cityInfoMap };
}

function generateCombinedCookie(options?: {
  pageId?: string;
  initPageId?: string;
  usedistributionchannels?: boolean;
}) {
  const pageId = options?.pageId || '10320667452';
  const initPageId = options?.initPageId || pageId;
  const used = options?.usedistributionchannels ?? false;

  // Timestamp in format: YYYYMMDDHHMMSSmmm
  const now = new Date();
  const ts =
    now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0') +
    String(now.getMilliseconds()).padStart(3, '0');

  const transactionId = `1-mf-${ts}-WEB`;

  const raw = `transactionId=${transactionId}` +
              `&pageId=${pageId}` +
              `&initPageId=${initPageId}` +
              `&usedistributionchannels=${used ? 'True' : 'False'}`;

  const encoded = encodeURIComponent(raw);

  return {
    transactionId,
    raw,                // decoded form
    encoded,            // value for _combined cookie
    cookieHeader: `_combined=${encoded}`
  };
}

/**
 * Get cookies by visiting hostname root (getWithRedirects equivalent)
 */
async function getCookiesFromHostname(
  session: CycleTLSSession | Session,
  hostname: string,
  region: string,
  locale: string,
  currency: string
): Promise<Record<string, any>> {
  // Visit the hostname root to get initial cookies
  // This is equivalent to getWithRedirects in TripCookies.ts
  const rootUrl = `https://${hostname}`;
  
  console.log(`[getCookiesFromHostname] Visiting root URL: ${rootUrl}`);
  
  const response = await session.get(rootUrl, {
    headers: {
      'Referer': rootUrl,
    },
  });

  fs.writeFileSync('response-root.html', response.body);
  console.log(`[getCookiesFromHostname] Status: ${response.statusCode}`);
  console.log(`[getCookiesFromHostname] Cookies received: ${JSON.stringify(response.cookies)}`);
  
  // Extract important cookies
  const cookies: Record<string, any> = {};
  
  // Get GUID
  if (response.cookies['GUID']) {
    cookies.GUID = response.cookies['GUID'].value;
  }
  
  // Get UBT_VID
  if (response.cookies['UBT_VID']) {
    cookies.UBT_VID = response.cookies['UBT_VID'].value;
  }
  
  // Get _combined cookie and parse it
  if (response.cookies['_combined']) {
    let combined = response.cookies['_combined'].value;
    
    // Replace 'nodejs' with 'WEB' in the _combined cookie value itself
    if (combined.includes('nodejs')) {
      combined = combined.replace(/nodejs/g, 'WEB');
      console.log('[getCookiesFromHostname] 🔧 Replaced "nodejs" with "WEB" in _combined cookie');
    }
    
    cookies._combined = combined;
    
    // Parse _combined to extract transactionId and pageId
    try {
      const decoded = decodeURIComponent(combined);
      const params = new URLSearchParams(decoded);
      let transactionId = params.get('transactionId') || '';
      // Replace 'nodejs' with 'WEB' in transactionId (should already be done, but double-check)
      if (transactionId && transactionId.includes('nodejs')) {
        transactionId = transactionId.replace(/nodejs/g, 'WEB');
      }
      cookies.transactionId = transactionId;
      cookies.pageId = params.get('pageId') || params.get('initPageId') || '';
    } catch (e) {
      console.warn('[getCookiesFromHostname] Failed to parse _combined:', e);
    }
  }
  
  // Get other important cookies
  const importantCookies = [
    'ibusite', 'ibugroup', 'ibu_country', 'ibu_cookie_strict',
    'ibulanguage', 'ibulocale', 'cookiePricesDisplayed',
    '_abtest_userid', '_RGUID', '_RSG', '_RDG', '_RF1'
  ];
  
  for (const cookieName of importantCookies) {
    if (response.cookies[cookieName]) {
      cookies[cookieName] = response.cookies[cookieName].value;
    }
  }

  // add _abtest_userid 
  cookies['_abtest_userid'] = randomUUID();

  // Get response headers that might be useful
  const relevantHeaders = {
    'x-ctx-country': response.headers['x-ctx-country'] || region.toUpperCase(),
    'x-ctx-currency': response.headers['x-ctx-currency'] || currency,
    'x-ctx-locale': response.headers['x-ctx-locale'] || locale,
    'x-ctx-ubt-pageid': response.headers['x-ctx-ubt-pageid'] || cookies.pageId || '',
    'x-ctx-ubt-pvid': response.headers['x-ctx-ubt-pvid'] || '1',
    'x-ctx-ubt-sid': response.headers['x-ctx-ubt-sid'] || '1',
    'x-ctx-ubt-vid': response.headers['x-ctx-ubt-vid'] || cookies.UBT_VID || '',
    'x-ctx-user-recognize': response.headers['x-ctx-user-recognize'] || 'NON_EU',
    'x-ctx-wclient-req': response.headers['x-ctx-wclient-req'] || '', // Important for anti-bot detection
  };
  
  return {
    ...cookies,
    headers: relevantHeaders,
    allCookies: response.cookies,
  };
}


/**
 * Generate flt_app_session_transactionId
 * Format: "1-mf-YYYYMMDDHHMMSSmmm-WEB"
 * @param date - Date object to use (default: current date)
 * @returns Generated transaction ID string
 */
function generateFltAppSessionTransactionId(date = new Date()) {
  function pad(n: number, width: number = 2): string {
    return String(n).padStart(width, '0');
  }

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const millis = pad(date.getMilliseconds(), 3);

  const timestampMs = `${year}${month}${day}${hours}${minutes}${seconds}${millis}`;

  return `1-mf-${timestampMs}-WEB`;
}


/**
 * Build simplified payload for token generation
 * This matches the format used by the browser for token signature
 */
function buildTokenPayload(
  params: FlightSearchParams,
  fltBatchId: string,
  productId?: string
): any {
  const tripType = params.triptype.toLowerCase() === 'rt' ? 2 : 1;
  const grade = params.class === 'y' ? 1 : params.class === 'c' ? 4 : params.class === 'f' ? 8 : 1;
  
  const journeyInfoTypes: any[] = [];
  
  // Outbound journey
  journeyInfoTypes.push({
    journeyNo: 1,
    departDate: params.ddate,
    departCode: params.dairport ? '' : params.dcity.toUpperCase(),
    arriveCode: params.aairport ? '' : params.acity.toUpperCase(),
    departAirport: params.dairport ? params.dairport.toUpperCase() : '',
    arriveAirport: params.aairport ? params.aairport.toUpperCase() : '',
  });
  
  // Return journey (if round trip)
  if (params.rdate && tripType === 2) {
    journeyInfoTypes.push({
      journeyNo: 2,
      departDate: params.rdate,
      departCode: params.aairport ? '' : params.acity.toUpperCase(),
      arriveCode: params.dairport ? '' : params.dcity.toUpperCase(),
      departAirport: params.aairport ? params.aairport.toUpperCase() : '',
      arriveAirport: params.dairport ? params.dairport.toUpperCase() : '',
    });
  }
  
  const payload: any = {
    mode: 0,
    Head: {
      extension: {
        LowPriceSource: 'searchForm',
        Flt_BatchId: fltBatchId,
        BlockTokenTimeout: '0',
        full_link_time_scene: 'pure_list_page',
        xproduct: 'baggage',
      },
    },
    searchCriteria: {
      grade: 3,
      realGrade: grade,
      tripType: tripType,
      journeyNo: tripType === 2 ? 1 : null,
      passengerInfoType: {
        adultCount: params.quantity || 1,
        childCount: 0,
        infantCount: 0,
      },
      journeyInfoTypes: journeyInfoTypes,
      policyId: null,
    },
    sortInfoType: {
      direction: true,
      orderBy: 'Direct',
      topList: [],
    },
    tagList: [],
    flagList: ['NEED_RESET_SORT', 'FullDataCache'],
    filterType: {
      filterFlagTypes: [],
      queryItemSettings: [],
      studentsSelectedStatus: true,
    },
    abtList: [
      { abCode: '250811_IBU_wjrankol', abVersion: 'D' },
      { abCode: '250806_IBU_FiltersOpt', abVersion: 'A' },
      { abCode: '250812_IBU_FiltersOp2', abVersion: 'A' },
      { abCode: '251023_IBU_pricetool', abVersion: 'D' },
    ],
  };
  
  // Add productId if provided
  if (productId) {
    payload.searchCriteria.productId = productId;
  }
  
  return payload;
}

/**
 * Build payload for w-payload-source MD5 hash generation
 * This uses a different format than the actual HTTP request
 */
function buildWPayloadSourcePayload(
  params: FlightSearchParams,
  cookies: Record<string, any>,
  fullPayload: any,
  fltBatchId: string
): any {
  const tripType = params.triptype.toLowerCase() === 'rt' ? 2 : 1;
  const flightWayType = tripType === 2 ? 'RT' : tripType === 1 ? 'OW' : 'MT';
  
  const journeyInfo0 = fullPayload.searchCriteria.journeyInfoTypes[0];
  const journeyInfo1 = fullPayload.searchCriteria.journeyInfoTypes.length > 1 
    ? fullPayload.searchCriteria.journeyInfoTypes[1] 
    : null;
  
  // Extract extension values from the full payload's head.extension array
  const extensions: Record<string, string> = {};
  if (fullPayload.head && fullPayload.head.extension) {
    for (const ext of fullPayload.head.extension) {
      if (ext.name) {
        extensions[ext.name] = ext.value || '';
      }
    }
  }
  
  // Build AbTesting string from abtList
  // The browser generates this from the abtList in the full payload
  // Format: "M:{random},abCode:abVersion;M:{random},abCode:abVersion;..."
  const abTestingParts: string[] = [];
  if (fullPayload.abtList && Array.isArray(fullPayload.abtList)) {
    // Generate random numbers for each AB test (matching browser behavior)
    for (const abt of fullPayload.abtList) {
      const randomNum = Math.floor(Math.random() * 100);
      abTestingParts.push(`M:${randomNum},${abt.abCode}:${abt.abVersion}`);
    }
  }
  const abTesting = abTestingParts.join(';');
  
  // If no abtList, use empty string (browser may have default AB tests)
  // For now, we'll use empty string if no abtList
  
  // Build ExtendFields
  const extendFields: any = {
    PageId: extensions.PageId || cookies.pageId || '10320667452',
    Os: 'Mac OS',
    OsVersion: '10.15.7',
    SpecialSupply: '',
    BatchedId: fltBatchId,
    flightsignature: '',
  };
  
  // Build AllianceInfo
  const allianceInfo = {
    AllianceID: parseInt(extensions.allianceID || '0', 10),
    SID: parseInt(extensions.sid || '0', 10),
    OuID: extensions.ouid || '',
    UseDistributionType: parseInt(extensions.useDistributionType || '1', 10),
  };
  
  const wPayload: any = {
    dCity: journeyInfo0.departCode.toUpperCase(),
    aCity: journeyInfo0.arriveCode.toUpperCase(),
    dDate: journeyInfo0.departDate,
    flightWayType: flightWayType,
    departureAirport: journeyInfo0.departAirport || '',
    arrivalAirport: journeyInfo0.arriveAirport || '',
    cabinClass: params.class === 'y' ? 'Economy' : params.class === 'c' ? 'Business' : params.class === 'f' ? 'First' : 'Economy',
    transferType: 'ANY',
    searchInfo: {
      travelerNum: {
        adult: fullPayload.searchCriteria.passengerInfoType.adultCount,
        child: fullPayload.searchCriteria.passengerInfoType.childCount,
        infant: fullPayload.searchCriteria.passengerInfoType.infantCount,
      },
    },
    abtList: [],
    offSet: 30,
    aDate: journeyInfo1 ? journeyInfo1.departDate : '',
    startInterval: 5,
    endInterval: 5,
    Head: {
      AbTesting: abTesting,
      Group: extensions.sotpGroup || 'Trip',
      Source: extensions.source || 'ONLINE',
      Version: fullPayload.head.cver || '3',
      Currency: fullPayload.head.Currency || params.curr || 'IDR',
      Locale: fullPayload.head.Locale || params.locale || 'en-ID',
      VID: extensions.vid || cookies.UBT_VID || '',
      SessionId: extensions.Flt_SessionId || '1',
      PvId: extensions.pvid || '1',
      AllianceInfo: allianceInfo,
      TransactionID: extensions.flt_app_session_transactionId || cookies.transactionId || '',
      ExtendFields: extendFields,
      ClientID: fullPayload.head.ClientID || cookies.GUID || extensions.cid || '',
    },
  };
  
  return wPayload;
}

/**
 * Build flight search payload (full format for actual HTTP request)
 */
function buildFlightSearchPayload(
  params: FlightSearchParams,
  cookies: Record<string, any>,
  fltBatchId: string,
  productId?: string
): any {
  const tripType = params.triptype.toLowerCase() === 'rt' ? 2 : 1;
  const grade = params.class === 'y' ? 1 : params.class === 'c' ? 4 : params.class === 'f' ? 8 : 1;
  
  const journeyInfoTypes: any[] = [];
  
  // Outbound journey
  journeyInfoTypes.push({
    journeyNo: 1,
    departDate: params.ddate,
    departCode: params.dairport ? '' : params.dcity.toUpperCase(),
    arriveCode: params.aairport ? '' : params.acity.toUpperCase(),
    departAirport: params.dairport ? params.dairport.toUpperCase() : '',
    arriveAirport: params.aairport ? params.aairport.toUpperCase() : '',
  });
  
  // Return journey (if round trip)
  if (params.rdate && tripType === 2) {
    journeyInfoTypes.push({
      journeyNo: 2,
      departDate: params.rdate,
      departCode: params.aairport ? '' : params.acity.toUpperCase(),
      arriveCode: params.dairport ? '' : params.dcity.toUpperCase(),
      departAirport: params.aairport ? params.aairport.toUpperCase() : '',
      arriveAirport: params.dairport ? params.dairport.toUpperCase() : '',
    });
  }
  
  const now = new Date();
  const timestamp = now.toISOString().replace('Z', '+00:00');

  const fltAppSessionTransactionId = cookies._combined.transactionId || generateFltAppSessionTransactionId(now);
  
  // Build full payload format for actual HTTP request (with all Head fields)
  return {
    mode: 0,
    searchCriteria: {
      grade: 3,
      realGrade: grade,
      tripType: tripType,
      journeyNo: 1,
      passengerInfoType: {
        adultCount: params.quantity || 1,
        childCount: 0,
        infantCount: 0,
      },
      journeyInfoTypes: journeyInfoTypes,
      policyId: null,
      productId: productId || undefined, // Add productId if provided (for sorting/filtering requests)
    },
    sortInfoType: {
      direction: true,
      orderBy: 'Direct',
      topList: [],
    },
    tagList: [],
    flagList: ['NEED_RESET_SORT', 'FullDataCache'],
    filterType: {
      filterFlagTypes: [],
      queryItemSettings: [],
      studentsSelectedStatus: true,
    },
    abtList: [
      { abCode: '250811_IBU_wjrankol', abVersion: 'A' },
      { abCode: '250806_IBU_FiltersOpt', abVersion: 'A' },
      { abCode: '250812_IBU_FiltersOp2', abVersion: 'A' },
      { abCode: '251023_IBU_pricetool', abVersion: 'C' },
    ],
    head: {
      cid: cookies.GUID || '',
      ctok: '',
      cver: '3',
      lang: '01',
      sid: '8888',
      syscode: '40',
      auth: '',
      xsid: '',
      extension: [
        { name: 'source', value: 'ONLINE' },
        { name: 'sotpGroup', value: 'Trip' },
        { name: 'sotpLocale', value: params.locale || 'en-ID' },
        { name: 'sotpCurrency', value: params.curr || 'IDR' },
        { name: 'allianceID', value: '0' },
        { name: 'sid', value: '0' },
        { name: 'ouid', value: '' },
        { name: 'uuid' },
        { name: 'useDistributionType', value: '1' },
        { name: 'flt_app_session_transactionId', value: fltAppSessionTransactionId },
        { name: 'vid', value: cookies.UBT_VID || '' },
        { name: 'pvid', value: '1' },
        { name: 'Flt_SessionId', value: '1' },
        { name: 'channel' },
        { name: 'x-ua', value: 'v=3_os=ONLINE_osv=10.15.7' },
        { name: 'PageId', value: cookies.pageId || '10320667452' },
        { name: 'clientTime', value: timestamp },
        { name: 'LowPriceSource', value: 'searchForm' },
        { name: 'Flt_BatchId', value: fltBatchId },
        { name: 'BlockTokenTimeout', value: '0' },
        { name: 'full_link_time_scene', value: 'pure_list_page' },
        { name: 'xproduct', value: 'baggage' },
        { name: 'units', value: 'METRIC' },
        { name: 'sotpUnit', value: 'METRIC' },
      ],
      Locale: params.locale || 'en-ID',
      Language: (params.locale || 'en-ID').split('-')[0],
      Currency: params.curr || 'IDR',
      ClientID: '',
      appid: '700020',
    },
  };
}

/**
 * Function to dump all the cookies in session (only for debugging)
 * @param session 
 */
function dumpSessionCookies(session: any) {
  if (typeof session.getCookies === 'function') {
    const cookies = session.getCookies();
    console.log('🍪 SESSION COOKIES BEFORE SSE:');
    for (const [k, v] of Object.entries(cookies)) {
      console.log(`  ${k} = ${(v as any).value || v}`);
    }
  } else {
    console.warn('Session does not support getCookies()');
  }
}

/**
 * Decode response body
 * 
 * This function for flight-search because cycleTLS does not auto-decode compressed responses
 * 
 * @param response 
 * @returns 
 */
function decodeBody(response: any): string {
  const encoding = response.headers?.['content-encoding'];

  const raw = response.body;

  if (!raw) return '';

  const buffer = Buffer.isBuffer(raw)
    ? raw
    : Buffer.from(raw, 'binary');

  if (encoding === 'gzip') {
    return zlib.gunzipSync(buffer).toString('utf-8');
  }

  if (encoding === 'deflate') {
    return zlib.inflateSync(buffer).toString('utf-8');
  }

  // brotli
  if (encoding === 'br') {
    return zlib.brotliDecompressSync(buffer).toString('utf-8');
  }

  // fallback
  return buffer.toString('utf-8');
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Build multipart/form-data string
 */
function buildMultipartFormData(fields: Record<string, string>, boundary?: string): { body: string; boundary: string } {
  if (!boundary) {
    // Generate a WebKit-style boundary
    boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
  }
  
  const parts: string[] = [];
  
  for (const [name, value] of Object.entries(fields)) {
    parts.push(`--${boundary}`);
    parts.push(`Content-Disposition: form-data; name="${name}"`);
    parts.push('');
    parts.push(value);
  }
  
  // Add closing boundary
  parts.push(`--${boundary}--`);
  parts.push('');
  
  return {
    body: parts.join('\r\n'),
    boundary,
  };
}

/**
 * Convert locale format (e.g., "id-ID" -> "id_id", "en-ID" -> "en_id")
 */
function convertLocaleForClog(locale: string): string {
  return locale.toLowerCase().replace('-', '_');
}

/**
 * Helper function to call getRouteInfo
 */
async function callGetRouteInfo(
  session: CycleTLSSession | Session,
  parsed: ParsedUrlData,
  cookies: Record<string, any>,
  url: string
): Promise<any> {
  // Build searchSegmentList based on trip type
  const searchSegmentList = parsed.params.triptype === 'rt' && parsed.params.rdate
    ? [
        {
          departCity: parsed.params.dcity.toUpperCase(),
          arriveCity: parsed.params.acity.toUpperCase(),
        },
        {
          departCity: parsed.params.acity.toUpperCase(),
          arriveCity: parsed.params.dcity.toUpperCase(),
        },
      ]
    : [
        {
          departCity: parsed.params.dcity.toUpperCase(),
          arriveCity: parsed.params.acity.toUpperCase(),
        },
      ];
  
  // Build Head object with required fields
  const routeInfoPayload = {
    departure: parsed.params.dcity.toUpperCase(),
    arrival: parsed.params.acity.toUpperCase(),
    searchCriteria: {
      searchSegmentList: searchSegmentList,
    },
    tripType: parsed.params.triptype === 'rt' ? 'RT' : 'OW',
    Head: {
      AbTesting: '', // Can be empty or populated from cookies/headers
      Group: 'Trip',
      Source: 'ONLINE',
      Version: '3',
      Currency: (parsed.params.curr || 'IDR').toUpperCase(),
      Locale: parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
      VID: cookies.UBT_VID || '',
      SessionId: '1',
      PvId: '1',
      AllianceInfo: {
        AllianceID: 0,
        SID: 0,
        OuID: '',
        UseDistributionType: 1,
      },
      TransactionID: cookies.transactionId || '',
      ExtendFields: {
        PageId: cookies.pageId || '10320667452',
        Os: 'Mac OS',
        OsVersion: '10.15.7',
        flightsignature: '',
      },
      ClientID: cookies.GUID || '',
    },
  };
  
  // Generate w-payload-source and x-ctx-wclient-req for getRouteInfo
  const routeInfoPayloadString = JSON.stringify(routeInfoPayload);
  const routeInfoPayloadMd5 = md5(routeInfoPayloadString);
  // Get user agent from session for c_sign
  const routeInfoUserAgent = session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
  const routeInfoWPayloadSource = c_sign(routeInfoPayloadMd5, routeInfoUserAgent);
  
  const routeInfoApiPath = '/restapi/soa2/21273/GetRouteInfo';
  const routeInfoTimestampRandom = `-${Date.now()}-${Math.floor(Math.random() * 1e7)}`;
  const routeInfoGuid = cookies.GUID || '';
  const routeInfoUbtVid = cookies.UBT_VID || '';
  const routeInfoDuid = '';
  const routeInfoRf1 = cookies._RF1 || '';
  // Format matches test.ts: md5(`${url};POST;${timestampRandom};${guid || ""};${ubtVid || ""};${duid || ""};${rf1 || ""}`)
  const routeInfoWclientReqString = `${routeInfoApiPath};POST;${routeInfoTimestampRandom};${routeInfoGuid || ""};${routeInfoUbtVid || ""};${routeInfoDuid || ""};${routeInfoRf1 || ""}`;
  const routeInfoXCtxWclientReq = md5(routeInfoWclientReqString);
  
  const response = await session.post(`https://${parsed.hostname}${routeInfoApiPath}`, {
    headers: {
      'accept': '*/*',
      'content-type': 'application/json',
      'cookieorigin': `https://${parsed.hostname}`,
      'currency': (parsed.params.curr || 'IDR').toUpperCase(),
      'locale': parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
      'origin': `https://${parsed.hostname}`,
      'priority': 'u=1, i',
      'referer': url,
      'w-payload-source': routeInfoWPayloadSource,
      'x-ctx-country': cookies.headers?.['x-ctx-country'],
      'x-ctx-currency': cookies.headers?.['x-ctx-currency'],
      'x-ctx-locale': cookies.headers?.['x-ctx-locale'],
      'x-ctx-ubt-pageid': cookies.headers?.['x-ctx-ubt-pageid'],
      'x-ctx-ubt-pvid': cookies.headers?.['x-ctx-ubt-pvid'],
      'x-ctx-ubt-sid': cookies.headers?.['x-ctx-ubt-sid'],
      'x-ctx-ubt-vid': cookies.headers?.['x-ctx-ubt-vid'],
      'x-ctx-wclient-req': routeInfoXCtxWclientReq,
    },
    json: routeInfoPayload,
  });
  
  return response;
}

/**
 * Build UBT payload for analytics collection
 * Based on test-ubt-encoder-decoder.js structure
 */
function buildUbtPayload(
  params: FlightSearchParams,
  cookies: Record<string, any>,
  url: string,
  sendTs: number,
  parsed: ParsedUrlData,
  flightSearchToken?: string
): any {
  const locale = params.locale || 'en-ID';
  const localeParts = locale.split('-');
  const language = localeParts[0] || 'id';
  const region = localeParts[1] || 'ID';
  const currency = params.curr || 'IDR';
  
  // Extract flight information from params
  const tripType = params.triptype?.toLowerCase() === 'rt' ? 'RT' : 'OW';
  const segments: any[] = [];
  
  if (params.dcity && params.acity && params.ddate) {
    segments.push({
      segmentno: 1,
      segments: [{
        sequence: 1,
        dport: params.dairport || params.dcity.toUpperCase(),
        aport: params.aairport || params.acity.toUpperCase(),
        takeofftime: params.ddate
      }]
    });
    
    if (params.rdate && tripType === 'RT') {
      segments.push({
        segmentno: 2,
        segments: [{
          sequence: 1,
          dport: params.aairport || params.acity.toUpperCase(),
          aport: params.dairport || params.dcity.toUpperCase(),
          takeofftime: params.rdate
        }]
      });
    }
  }
  
  // Generate UUIDs for various IDs
  const generateShortId = () => Math.random().toString(36).substring(2, 8);
  const reqIdSuffix = generateShortId();
  const batchIdParts = [generateShortId(), generateShortId()];
  
  // Build ubtList matching example-good-collect.json format
  // Sequence numbers start from 34 (as seen in example) and increment
  // Timestamps should be relative to sendTs, simulating page load timeline
  const baseTimestamp = sendTs - Math.floor(Math.random() * 30000) - 100000; // Simulate page load started earlier
  const navStart = baseTimestamp - Math.floor(Math.random() * 10000);
  const webcoreInit = Math.floor(Math.random() * 3000) + 500; // Random between 500-3500
  const ubtBatchId = `${sendTs - 1}_${batchIdParts[0]}_${batchIdParts[1]}`;
  const fltBatchId = generateUUID(); // Flt_BatchId used in FlightListSearchSSE payload
  const transactionId = cookies.transactionId || '';
  console.log('cookies ibu flt pref  cfg is appear', !!cookies.ibu_flt_pref_cfg)
  const fltFp = cookies.ibu_flt_pref_cfg || 'd1ea3865f0700aab15b40ad296d53cf2';
  
  // Helper to calculate __ubt_user_data_length (approximate JSON string length)
  const calculateDataLength = (obj: any): number => {
    try {
      return JSON.stringify(obj).length;
    } catch {
      return 0;
    }
  };
  
  // Helper to build flight info data for trace items
  const buildFlightInfoData = () => {
    const od: any[] = [];
    if (params.dcity && params.acity && params.ddate) {
      // Get city information from cookies (extracted from __APP_INITIAL_STATE__)
      const dcityInfo = cookies.cityInfoMap?.[params.dcity.toUpperCase()] || { cityId: '524', cityName: 'Jakarta' };
      const acityInfo = cookies.cityInfoMap?.[params.acity.toUpperCase()] || { cityId: '315', cityName: 'Kuala Lumpur' };
      
      od.push({
        segmentno: 1,
        depart: params.ddate,
        from: { 
          cityid: dcityInfo.cityId, 
          cityname: dcityInfo.cityName, 
          airportcode: '', 
          citycode: params.dcity.toUpperCase() 
        },
        to: { 
          cityid: acityInfo.cityId, 
          cityname: acityInfo.cityName, 
          airportcode: '', 
          citycode: params.acity.toUpperCase() 
        }
      });
      if (params.rdate && params.triptype?.toLowerCase() === 'rt') {
        od.push({
          segmentno: 2,
          depart: params.rdate,
          from: { 
            cityid: acityInfo.cityId, 
            cityname: acityInfo.cityName, 
            airportcode: '', 
            citycode: params.acity.toUpperCase() 
          },
          to: { 
            cityid: dcityInfo.cityId, 
            cityname: dcityInfo.cityName, 
            airportcode: '', 
            citycode: params.dcity.toUpperCase() 
          }
        });
      }
    }

    return {
      allianceId: 0,
      allianceSid: 0,
      allianceOuid: '',
      fltFp: fltFp,
      locale: locale,
      currency: currency,
      sort_initial: { sortType: 'direct', sortOrder: 1 },
      sort_current: { sortType: 'direct', sortOrder: 1 },
      sort_def: 'direct1',
      sort_default: 8,
      transactionid: transactionId,
      is_filter: 0,
      num_flightway: 1,
      Request_Batch: 1,
      has_recommendPosition: false,
      recommend_type: [],
      recommendList: [],
      flightclass: 'I',
      airlineclass: params.class?.toUpperCase() || 'Y',
      segmentnum: od.length,
      flightWay: params.triptype?.toLowerCase() === 'rt' ? 'D' : 'D',
      passengertype: { adult: params.quantity || 1, child: 0, infant: 0 },
      startDate: params.ddate || '',
      returnDate: params.rdate || '',
      od: od,
      isNaverPromotion: false
    };
  };
  
  // Start sequence from 34 (matching example format)
  let sequenceCounter = 34;
  let currentTimestamp = baseTimestamp;
  
  const ubtListItemsPart1 = [
    // Item 1 (34): metric - JS.Lizard.DomReady
    [
      sequenceCounter++,
      currentTimestamp,
      'metric',
      null,
      {
        name: 'JS.Lizard.DomReady',
        tags: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          __ubt_user_data_length: 72
        },
        value: Math.floor(Math.random() * 100000) + 50000 // Random between 50000-150000
      }
    ],
    // Item 2 (35): trace - echo init
    [
      sequenceCounter++,
      currentTimestamp,
      'trace',
      'tiled_tl',
      {
        key: '270362',
        val: {
          errorCode: 'A0601',
          operation: 'test/echo/init',
          errorMsg: '[echo-sdk] init success,echo trace function,global exist=true,productLine=mf,domain=flight,message=',
          action: 'NotOperation',
          tsid: '',
          echoSdkVersion: '2.0.4',
          errorType: 'A',
          __ubt_user_data_length: 238,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 3 (36): metric - webcore_fetch_cSign (GetLowPriceInCalender - first call)
    [
      sequenceCounter++,
      currentTimestamp + 27,
      'metric',
      null,
      {
        name: 'webcore_fetch_cSign',
        tags: {
          success: true,
          url: '/restapi/soa2/14427/GetLowPriceInCalender',
          md5: '', // Will be calculated by browser
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 282
        },
        value: 1
      }
    ],
    // Item 4 (37): metric - webcore_fetch_cSign (GetLowPriceInCalender - second call)
    [
      sequenceCounter++,
      currentTimestamp + 30,
      'metric',
      null,
      {
        name: 'webcore_fetch_cSign',
        tags: {
          success: true,
          url: '/restapi/soa2/14427/GetLowPriceInCalender',
          md5: '',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 282
        },
        value: 1
      }
    ],
    // Item 5 (38): metric - webcore_fetch_cSign (getCityImageById)
    [
      sequenceCounter++,
      currentTimestamp + 33,
      'metric',
      null,
      {
        name: 'webcore_fetch_cSign',
        tags: {
          success: true,
          url: '/restapi/soa2/14571/getCityImageById',
          md5: '',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 277
        },
        value: 1
      }
    ],
    // Item 6 (39): dev_trace - ibu_flt_pc_dev_nationality_init
    [
      sequenceCounter++,
      currentTimestamp + 38,
      'dev_trace',
      'tiled_tl',
      {
        key: 'ibu_flt_pc_dev_nationality_init',
        val: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          fltFp: fltFp,
          type: 'InitCountryData',
          locale: locale,
          __ubt_user_data_length: 135,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 7 (40): metric - web_page_perf_fcp
    [
      sequenceCounter++,
      currentTimestamp + 68,
      'metric',
      null,
      {
        name: 'web_page_perf_fcp',
        tags: {
          metric_name: 'web_page_perf_fcp',
          metric_value: Math.floor(Math.random() * 1000) + 500, // Random between 500-1500
          note: '',
          metric_type: 'page',
          platform: 'flight-online-main',
          idc: 'SGP-ALI',
          locale: locale.replace('-', '_'),
          aid: '',
          sid: '',
          sub_metric_name: '',
          ajaxInfo: '',
          __ubt_user_data_length: 223
        },
        value: Math.floor(Math.random() * 1000) + 500
      }
    ],
    // Item 8 (41-43): metric - web_resource_perf (CSS resources)
    ...Array.from({ length: 3 }, (_, i) => [
      sequenceCounter++,
      currentTimestamp + 69 + i,
      'metric',
      null,
      {
        name: 'web_resource_perf',
        tags: {
          metric_name: `https://aw-s.tripcdn.com/modules/ibu/online-flight/${['biz-common.css', 'pc-components.css', 'fe-flight-flight-base-s.css'][i]}`,
          metric_value: Math.random() * 300 + 200, // Random between 200-500
          note: JSON.stringify({
            transferSize: Math.floor(Math.random() * 20000) + 5000,
            encodedBodySize: Math.floor(Math.random() * 20000) + 5000,
            decodedBodySize: Math.floor(Math.random() * 100000) + 20000,
            initiatorType: 'link',
            nextHopProtocol: 'h3',
            renderBlockingStatus: 'blocking',
            dnsLookupTime: Math.random() * 10,
            tcpConnectionTime: Math.random() * 20,
            sslHandshakeTime: Math.random() * 20,
            firstByteTime: Math.random() * 60 + 20,
            downloadTime: Math.random() * 100 + 10,
            isCache: false,
            isCors: false
          }),
          metric_type: 'resource',
          platform: 'flight-online-main',
          idc: 'SGP-ALI',
          locale: locale.replace('-', '_'),
          aid: '',
          sid: '',
          sub_metric_name: '',
          ajaxInfo: '',
          __ubt_user_data_length: 600 + Math.floor(Math.random() * 50)
        },
        value: Math.random() * 300 + 200
      }
    ]),
    // Item 11 (44): metric - web_resource_perf (font CSS)
    [
      sequenceCounter++,
      currentTimestamp + 70,
      'metric',
      null,
      {
        name: 'web_resource_perf',
        tags: {
          metric_name: 'https://aw-s.tripcdn.com/modules/ibu/online-assets/font.ddfdb9c8916dd1ec37cbf52f9391aca5.css',
          metric_value: Math.random() * 100 + 200,
          note: JSON.stringify({
            transferSize: Math.floor(Math.random() * 5000) + 2000,
            encodedBodySize: Math.floor(Math.random() * 5000) + 2000,
            decodedBodySize: Math.floor(Math.random() * 20000) + 10000,
            initiatorType: 'link',
            nextHopProtocol: 'h3',
            renderBlockingStatus: 'blocking',
            dnsLookupTime: 0,
            tcpConnectionTime: 0,
            sslHandshakeTime: 0,
            firstByteTime: Math.random() * 40 + 30,
            downloadTime: Math.random() * 5 + 2,
            isCache: false,
            isCors: false
          }),
          metric_type: 'resource',
          platform: 'flight-online-main',
          idc: 'SGP-ALI',
          locale: locale.replace('-', '_'),
          aid: '',
          sid: '',
          sub_metric_name: '',
          ajaxInfo: '',
          __ubt_user_data_length: 644
        },
        value: Math.random() * 100 + 200
      }
    ]
  ];
  
  // Skip to sequence 151 (matching example format - there's a gap between 44 and 151)
  sequenceCounter = 151;
  
  const ubtListItemsPart2 = [
    // Item 12 (151): metric - bbz_perf_resource_timing (first batch)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 250000) - 100000,
      'metric',
      null,
      {
        name: 'bbz_perf_resource_timing',
        tags: {
          timings: JSON.stringify([
            {
              name: 'https://aw-s.tripcdn.com/modules/ibu/online-flight/google-login.2c24774d9a.css',
              domain: 'aw-s.tripcdn.com',
              totalTime: Math.random() * 100 + 200,
              responseStatus: 0,
              initiatorType: 'link',
              transferSize: Math.floor(Math.random() * 80000) + 70000,
              httpHopProtocol: 'h3',
              swStatus: 'unknown',
              startTime: Math.random() * 60000 + 50000,
              entryType: 'resource',
              ttfb: Math.random() * 30 + 20,
              download: Math.random() * 200 + 150,
              dnsTime: 0,
              tcpTime: 0,
              redirectTime: 0,
              initialPageVisibilityState: 'visible'
            },
            {
              name: 'https://ak-d.tripcdn.com/images/05E0412000cga1j9t7151.svg',
              domain: 'ak-d.tripcdn.com',
              totalTime: Math.random() * 50 + 80,
              responseStatus: 0,
              initiatorType: 'css',
              transferSize: Math.floor(Math.random() * 2000) + 1000,
              httpHopProtocol: 'h3',
              swStatus: 'unknown',
              startTime: Math.random() * 80000 + 70000,
              entryType: 'resource',
              ttfb: Math.random() * 25 + 20,
              download: Math.random() * 1 + 0.3,
              dnsTime: Math.random() * 30 + 25,
              tcpTime: Math.random() * 15 + 10,
              redirectTime: 0,
              initialPageVisibilityState: 'visible'
            }
          ]),
          category: 'webcore',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          isBot: 'F',
          navStart: navStart,
          __ubt_user_data_length: 1214
        },
        value: 1
      }
    ],
    // Item 13 (152): metric - bbz_perf_resource_timing (second batch - many resources)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 250000) - 100000,
      'metric',
      null,
      {
        name: 'bbz_perf_resource_timing',
        tags: {
          timings: JSON.stringify(Array.from({ length: 30 }, (_, i) => ({
            name: `https://aw-s.tripcdn.com/modules/ibu/online-flight/resource-${i}.css`,
            domain: 'aw-s.tripcdn.com',
            totalTime: Math.random() * 300 + 200,
            responseStatus: 200,
            initiatorType: 'link',
            transferSize: Math.floor(Math.random() * 200000) + 5000,
            httpHopProtocol: 'h3',
            swStatus: 'unknown',
            startTime: Math.random() * 10 + 330 + i * 0.1,
            entryType: 'resource',
            ttfb: Math.random() * 60 + 20,
            download: Math.random() * 100 + 10,
            dnsTime: Math.random() * 10,
            tcpTime: Math.random() * 20,
            redirectTime: 0,
            initialPageVisibilityState: 'visible'
          }))),
          category: 'webcore',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          isBot: 'F',
          navStart: navStart,
          __ubt_user_data_length: 20748
        },
        value: 1
      }
    ],
    // Item 14 (153): metric - ibu_flt_pc_dev_metric_sse_each_search_time
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000, // Much earlier, before flight search
      'metric',
      null,
      {
        name: 'ibu_flt_pc_dev_metric_sse_each_search_time',
        tags: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          apiName: 'FlightListSearchSSE',
          requestCount: 1,
          idc: '',
          transactionId: transactionId,
          status: '0', // Success status
          error: '',
          webdriver: 'false',
          sid: 0,
          ouid: '',
          locale: locale,
          requestPayload: JSON.stringify({
            mode: 0,
            Head: {
              extension: {
                LowPriceSource: 'searchForm',
                Flt_BatchId: fltBatchId,
                BlockTokenTimeout: '0',
                full_link_time_scene: 'pure_list_page',
                xproduct: 'baggage',
                units: 'METRIC',
                sotpUnit: 'METRIC'
              }
            },
            searchCriteria: {
              grade: 3,
              realGrade: 1,
              tripType: params.triptype?.toLowerCase() === 'rt' ? 2 : 1,
              journeyNo: 1,
              passengerInfoType: {
                adultCount: params.quantity || 1,
                childCount: 0,
                infantCount: 0
              },
              journeyInfoTypes: segments.map((seg, idx) => ({
                journeyNo: idx + 1,
                departDate: seg.segments[0].takeofftime,
                departCode: seg.segments[0].dport,
                arriveCode: seg.segments[0].aport,
                departAirport: '',
                arriveAirport: ''
              })),
              policyId: null
            },
            sortInfoType: {
              direction: true,
              orderBy: 'Direct',
              topList: []
            },
            tagList: [],
            flagList: ['NEED_RESET_SORT', 'FullDataCache'],
            filterType: {
              filterFlagTypes: [],
              queryItemSettings: [],
              studentsSelectedStatus: true
            },
            abtList: [
              { abCode: '250811_IBU_wjrankol', abVersion: 'D' },
              { abCode: '250806_IBU_FiltersOpt', abVersion: 'A' },
              { abCode: '250812_IBU_FiltersOp2', abVersion: 'A' },
              { abCode: '251023_IBU_pricetool', abVersion: 'B' }
            ]
          }),
          sequence: JSON.stringify(segments.map(seg => ({
            dCityCode: seg.segments[0].dport,
            aCityCode: seg.segments[0].aport,
            dDate: seg.segments[0].takeofftime
          }))),
          class: (params.class?.toUpperCase() || 'Y') + 'S',
          reqNonstop: 'off',
          requestTimeStr: new Date(sendTs - 200000).toISOString().replace('T', ' ').substring(0, 19) + '.' + String(sendTs - 200000).slice(-3),
          responseTimeStr: new Date(sendTs).toISOString().replace('T', ' ').substring(0, 19) + '.' + String(sendTs).slice(-3),
          requestStatus: 'success',
          __ubt_user_data_length: 1800
        },
        value: Math.floor(Math.random() * 200000) + 100000 // Response time in ms
      }
    ],
    // Item 13 (154): metric - ibu_flt_pc_dev_metric_sse_performance
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'ibu_flt_pc_dev_metric_sse_performance',
        tags: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          apiName: 'FlightListSearchSSE',
          transactionId: transactionId,
          idc: '',
          requestCount: 1,
          status: '0',
          error: '',
          locale: locale,
          requestPayload: JSON.stringify({
            mode: 0,
            Head: {
              extension: {
                LowPriceSource: 'searchForm',
                Flt_BatchId: fltBatchId,
                BlockTokenTimeout: '0',
                full_link_time_scene: 'pure_list_page',
                xproduct: 'baggage',
                units: 'METRIC',
                sotpUnit: 'METRIC'
              }
            },
            searchCriteria: {
              grade: 3,
              realGrade: 1,
              tripType: params.triptype?.toLowerCase() === 'rt' ? 2 : 1,
              journeyNo: 1,
              passengerInfoType: {
                adultCount: params.quantity || 1,
                childCount: 0,
                infantCount: 0
              },
              journeyInfoTypes: segments.map((seg, idx) => ({
                journeyNo: idx + 1,
                departDate: seg.segments[0].takeofftime,
                departCode: seg.segments[0].dport,
                arriveCode: seg.segments[0].aport,
                departAirport: '',
                arriveAirport: ''
              })),
              policyId: null
            },
            sortInfoType: {
              direction: true,
              orderBy: 'Direct',
              topList: []
            },
            tagList: [],
            flagList: ['NEED_RESET_SORT', 'FullDataCache'],
            filterType: {
              filterFlagTypes: [],
              queryItemSettings: [],
              studentsSelectedStatus: true
            },
            abtList: [
              { abCode: '250811_IBU_wjrankol', abVersion: 'D' },
              { abCode: '250806_IBU_FiltersOpt', abVersion: 'A' },
              { abCode: '250812_IBU_FiltersOp2', abVersion: 'A' },
              { abCode: '251023_IBU_pricetool', abVersion: 'B' }
            ]
          }),
          tripType: params.triptype?.toLowerCase() === 'rt' ? '2' : '1',
          requestTimeStr: new Date(sendTs - 200000).toISOString().replace('T', ' ').substring(0, 19) + '.' + String(sendTs - 200000).slice(-3),
          responseTimeStr: new Date(sendTs).toISOString().replace('T', ' ').substring(0, 19) + '.' + String(sendTs).slice(-3),
          __ubt_user_data_length: 1584
        },
        value: Math.floor(Math.random() * 200000) + 100000
      }
    ],
    // Item 15 (155): trace - O_FLT_Request_Service_State
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'trace',
      'tiled_tl',
      {
        key: 'O_FLT_Request_Service_State',
        val: {
          data: JSON.stringify({
            allianceId: 0,
            allianceSid: 0,
            allianceOuid: '',
            fltFp: fltFp,
            serverUrl: 'FlightListSearch',
            serverCode: '27015',
            action: 'fetchSuccess',
            operation: '0',
            locale: locale,
            site: region,
            currency: currency,
            alliance_id: 0,
            sid: 0,
            pageId: cookies.pageId || '10320667452',
            channel: 'Flight'
          }),
          __ubt_user_data_length: 358,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 16 (156): dev_trace - ibu_flt_online_jserror_log
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'ibu_flt_online_jserror_log',
        val: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          fltFp: fltFp,
          type: '[Empty Message Or Stack Error]',
          stack: 'Error\n    at t.trackError (https://aw-s.tripcdn.com/modules/ibu/online-flight/pc-components.4fc88a959c.js:1:255289)\n    at t.selector (https://aw-s.tripcdn.com/modules/ibu/online-flight/list-ssr-gateway.ef3a9fd1d4.js:1:530040)',
          __ubt_user_data_length: 875,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 17 (157): trace - ibu_flt_online_tolist_basic
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'trace',
      'tiled_tl',
      {
        key: 'ibu_flt_online_tolist_basic',
        val: {
          data: JSON.stringify(buildFlightInfoData()),
          __ubt_user_data_length: 1235,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 16 (158): trace - ibu_flt_online_listsearchbox_action
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'trace',
      'tiled_tl',
      {
        key: 'ibu_flt_online_listsearchbox_action',
        val: {
          data: JSON.stringify({
            allianceId: 0,
            allianceSid: 0,
            allianceOuid: '',
            fltFp: fltFp,
            clickType: '',
            triggerType: 'action',
            searchNo: 1,
            mode: 0,
            flightInfo: {
              flightWay: params.triptype?.toLowerCase() === 'rt' ? 'D' : 'D',
              airlineClass: params.class?.toUpperCase() || 'Y',
              passengerType: { adult: params.quantity || 1, child: 0, infant: 0 },
              od: segments.map(seg => ({
                segmentNo: seg.segmentno,
                depart: seg.segments[0].takeofftime,
                from: { airportCode: '', cityCode: seg.segments[0].dport },
                to: { airportCode: '', cityCode: seg.segments[0].aport }
              }))
            }
          }),
          __ubt_user_data_length: 610,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 17 (159): trace - all_flt_list_page_query
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'trace',
      'tiled_tl',
      {
        key: 'all_flt_list_page_query',
        val: {
          data: JSON.stringify({
            allianceId: 0,
            allianceSid: 0,
            allianceOuid: '',
            fltFp: fltFp,
            channel_ct: 'trip_ol',
            show_seq: 1,
            flighttype: params.triptype?.toLowerCase() === 'rt' ? 'D' : 'D',
            sequenceinfo: segments.map((seg, idx) => ({
              sequence: idx + 1,
              dport: seg.segments[0].dport,
              aport: seg.segments[0].aport,
              takeoffdate: seg.segments[0].takeofftime
            })),
            totalsequence: segments.length,
            txid: transactionId,
            start_time: sendTs - Math.floor(Math.random() * 5000) - 200000,
            isMtRcDispatch: false,
            isMtRichCombiner: false,
            isRtRcDispatch: params.triptype?.toLowerCase() === 'rt',
            isRtRichCombiner: false
          }),
          __ubt_user_data_length: 558,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 18 (160): metric - ibu_flt_pc_dev_metric_sdt_performance
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'ibu_flt_pc_dev_metric_sdt_performance',
        tags: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          subName: 'GetTokenCostTime',
          callCount: 2,
          paramSize: 1040,
          __ubt_user_data_length: 145
        },
        value: Math.random() * 20 + 10 // Random between 10-30
      }
    ],
    // Item 19 (161): dev_trace - ibu_flt_pc_dev_http_headers (FlightListSearch)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'ibu_flt_pc_dev_http_headers',
        val: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          fltFp: fltFp,
          type: 'FlightListSearch',
          info: JSON.stringify({
            token: flightSearchToken || ''
          }),
          transactionId: transactionId,
          __ubt_user_data_length: 888,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 20 (162): dev_trace - ibu_flt_pc_dev_http_headers (GetRouteInfo)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'ibu_flt_pc_dev_http_headers',
        val: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          fltFp: fltFp,
          type: 'GetRouteInfo',
          info: '{}',
          transactionId: transactionId,
          __ubt_user_data_length: 172,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 21 (163): metric - webcore_fetch_cSign (FlightListSearch)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'webcore_fetch_cSign',
        tags: {
          success: true,
          url: '/restapi/soa2/27015/FlightListSearch',
          md5: '',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 277
        },
        value: 1
      }
    ],
    // Item 22 (164): metric - webcore_fetch_cSign (GetRouteInfo)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'webcore_fetch_cSign',
        tags: {
          success: true,
          url: '/restapi/soa2/21273/GetRouteInfo',
          md5: '',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 273
        },
        value: 1
      }
    ],
    // Item 23 (165): metric - web_resource_perf (coffeebean-web)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'web_resource_perf',
        tags: {
          metric_name: 'https://static.tripcdn.com/packages/flight/coffeebean-web/5.5.14/main.js',
          metric_value: Math.random() * 50 + 180,
          note: JSON.stringify({
            transferSize: Math.floor(Math.random() * 10000) + 60000,
            encodedBodySize: Math.floor(Math.random() * 10000) + 60000,
            decodedBodySize: Math.floor(Math.random() * 50000) + 200000,
            initiatorType: 'script',
            nextHopProtocol: 'h3',
            renderBlockingStatus: 'non-blocking',
            dnsLookupTime: 0,
            tcpConnectionTime: Math.random() * 20 + 15,
            sslHandshakeTime: Math.random() * 20 + 15,
            firstByteTime: Math.random() * 30 + 70,
            downloadTime: Math.random() * 20 + 80,
            isCache: false,
            isCors: false
          }),
          metric_type: 'resource',
          platform: 'flight-online-main',
          idc: 'SGP-ALI',
          locale: locale.replace('-', '_'),
          aid: '',
          sid: '',
          sub_metric_name: '',
          ajaxInfo: '',
          __ubt_user_data_length: 640
        },
        value: Math.random() * 50 + 180
      }
    ],
    // Item 24 (166): dev_trace - o_flt_coffeebean_dev (type 10)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'o_flt_coffeebean_dev',
        val: {
          type: 10,
          sTotalSize: 213151,
          eTotalSize: 213151,
          VERSION: '5.5.14',
          IS_INS: 0,
          cbSource: 'ibuFlightOnline',
          __ubt_user_data_length: 110,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 25 (167): dev_trace - o_flt_coffeebean_dev (type 2, first)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'o_flt_coffeebean_dev',
        val: {
          type: 2,
          cache: `WEB_0_mac_${sendTs - 100000}_1249_721_2_ibuFlightOnline_${generateShortId()}_5.5.14_1`,
          tsid: `WEB_0_mac_${sendTs}_1249_721_2_ibuFlightOnline_${generateShortId()}_5.5.14_1`,
          VERSION: '5.5.14',
          IS_INS: 0,
          cbSource: 'ibuFlightOnline',
          __ubt_user_data_length: 242,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 26 (168): dev_trace - o_flt_coffeebean_dev (type 2, second)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'o_flt_coffeebean_dev',
        val: {
          type: 2,
          cache: `WEB_0_mac_${sendTs - 50000}_1249_721_2_ibuFlightOnline_${generateShortId()}_5.5.14_1`,
          tsid: `WEB_0_mac_${sendTs}_1249_721_2_ibuFlightOnline_${generateShortId()}_5.5.14_1`,
          VERSION: '5.5.14',
          IS_INS: 0,
          cbSource: 'ibuFlightOnline',
          __ubt_user_data_length: 242,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 27 (169): dev_trace - o_flt_coffeebean_window_size
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'o_flt_coffeebean_window_size',
        val: {
          source: 'ibuFlightOnline',
          width: 1249,
          height: 721,
          tsid: `WEB_0_mac_${sendTs}_1249_721_2_ibuFlightOnline_${generateShortId()}_5.5.14_1`,
          VERSION: '5.5.14',
          IS_INS: 0,
          cbSource: 'ibuFlightOnline',
          __ubt_user_data_length: 199,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 28 (170): metric - ibu_flt_pc_dev_metric_h5gateway_performance_all (lowPriceCalendar)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'ibu_flt_pc_dev_metric_h5gateway_performance_all',
        tags: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          apiName: 'lowPriceCalendar',
          errorCode: '0',
          responseHead: '{"errorCode":"0"}',
          resultCount: String(Math.floor(Math.random() * 100) + 50),
          status: '200',
          transactionId: transactionId,
          triggerAction: '',
          shortPolicyId: '0',
          __ubt_user_data_length: 270
        },
        value: 0
      }
    ],
    // Item 29 (171): metric - ibu_flt_pc_dev_metric_h5gateway_performance_all (getCityImageById)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'ibu_flt_pc_dev_metric_h5gateway_performance_all',
        tags: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          apiName: 'getCityImageById',
          errorCode: '0',
          responseHead: '""',
          resultCount: 1,
          status: '200',
          transactionId: transactionId,
          triggerAction: '',
          shortPolicyId: '0',
          __ubt_user_data_length: 250
        },
        value: 0
      }
    ],
    // Item 30 (172): metric - ibu_flt_pc_dev_metric_h5gateway_performance_all (lowPriceCalendar, second)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'ibu_flt_pc_dev_metric_h5gateway_performance_all',
        tags: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          apiName: 'lowPriceCalendar',
          errorCode: '0',
          responseHead: '{"errorCode":"0"}',
          resultCount: String(Math.floor(Math.random() * 600) + 500),
          status: '200',
          transactionId: transactionId,
          triggerAction: '',
          shortPolicyId: '0',
          __ubt_user_data_length: 271
        },
        value: 0
      }
    ],
    // Item 31 (173): dev_trace - ibu_flt_pc_dev_http_headers (GetRouteInfo - second call)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'ibu_flt_pc_dev_http_headers',
        val: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          fltFp: fltFp,
          type: 'GetRouteInfo',
          info: '{}',
          transactionId: transactionId,
          __ubt_user_data_length: 172,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 24 (174): metric - webcore_fetch_cSign (GetRouteInfo - second call)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'webcore_fetch_cSign',
        tags: {
          success: true,
          url: '/restapi/soa2/21273/GetRouteInfo',
          md5: '',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 273
        },
        value: 1
      }
    ],
    // Item 25 (175): dev_trace - ibu_flt_pc_dev_http_headers (getCityByIp)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'ibu_flt_pc_dev_http_headers',
        val: {
          allianceId: 0,
          allianceSid: 0,
          allianceOuid: '',
          fltFp: fltFp,
          type: 'getCityByIp',
          info: '{}',
          transactionId: transactionId,
          __ubt_user_data_length: 171,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 32 (176): metric - webcore_fetch_cSign (getCityByIp)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'webcore_fetch_cSign',
        tags: {
          success: true,
          url: '/restapi/soa2/14571/getCityByIp',
          md5: '',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 272
        },
        value: 1
      }
    ],
    // Item 33 (177): dev_trace - ibu_ajax_devtrace
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'ibu_ajax_devtrace',
        val: {
          step: 'request xhr success',
          url: `/restapi/soa2/13909/getUspInfo?x-traceID=${cookies.UBT_VID || generateUUID()}-${sendTs}-${Math.floor(Math.random() * 1000000)}`,
          __ubt_user_data_length: 131,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 34 (178): metric - ibu_ajax_perf
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'ibu_ajax_perf',
        tags: {
          url: `https://${parsed.hostname}/restapi/soa2/13909/getUspInfo?x-traceID=${cookies.UBT_VID || generateUUID()}-${sendTs}-${Math.floor(Math.random() * 1000000)}`,
          duration: Math.random() * 20 + 60,
          region: 'SGP-ALI',
          data: JSON.stringify({
            DNSTime: 0,
            TCPTime: 0,
            SSLTime: 0,
            requestTime: Math.random() * 20 + 60,
            responseTime: Math.random() * 1 + 0.3
          }),
          __ubt_user_data_length: 326
        },
        value: Math.random() * 20 + 60
      }
    ],
    // Item 35 (179): metric - JS.Lizard.AjaxReady
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'JS.Lizard.AjaxReady',
        tags: {
          url: `https://${parsed.hostname}/restapi/soa2/13909/getUspInfo?x-traceID=${cookies.UBT_VID || generateUUID()}-${sendTs}-${Math.floor(Math.random() * 1000000)}`,
          duration: Math.random() * 20 + 60,
          'ak-region': '',
          CLOGGING_TRACE_ID: String(Math.floor(Math.random() * 1000000000000000000)),
          RootMessageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
          collection: '',
          __ubt_user_data_length: 309
        },
        value: Math.random() * 20 + 60
      }
    ],
    // Item 36 (180): metric - o_web_http_success (getUspInfo)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'o_web_http_success',
        tags: {
          runningType: 'nfes-h5',
          serviceCode: '13909',
          operation: 'getUspInfo',
          RootMessageId: '',
          CLOGGING_TRACE_ID: '',
          gatewayRegion: '',
          gatewayTime: '',
          statusCode: 200,
          isSOA: true,
          isSotp: false,
          requestHost: parsed.hostname,
          requestUrl: `/restapi/soa2/13909/getUspInfo?x-traceID=${cookies.UBT_VID || generateUUID()}-${sendTs}-${Math.floor(Math.random() * 1000000)}`,
          method: 'POST',
          httpHopProtocol: 'unknown',
          errorReason: '',
          beforeFetch: 0,
          fromNative: 'T',
          isXHR: true,
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          isBot: 'F',
          __ubt_user_data_length: 629
        },
        value: Math.floor(Math.random() * 20000) + 98000
      }
    ],
    // Item 37 (181): metric - web_ajax_perf (GetRouteInfo)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'web_ajax_perf',
        tags: {
          metric_name: '/restapi/soa2/21273/GetRouteInfo',
          metric_value: Math.floor(Math.random() * 120000) + 100000, // Random between 100000-220000
          note: JSON.stringify({
            type: 2,
            method: 'POST',
            xhrCatId: '',
            flightIDC: '',
            gateRegion: 'SGP-ALI',
            messageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
            rootMessageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
            clientId: cookies.GUID || '',
            params: {
              departure: segments[0]?.segments[0]?.dport || '',
              arrival: segments[0]?.segments[0]?.aport || '',
              searchCriteria: {
                searchSegmentList: segments.map(seg => ({
                  departCity: seg.segments[0].dport,
                  arriveCity: seg.segments[0].aport
                }))
              },
              tripType: tripType,
              Head: {
                AbTesting: 'M:27,240912_IBU_jpwjo:A;M:84,241224_IBU_TOLNG:B;M:83,250109_IBU_OLFBO:D;M:57,250207_IBU_FLTOLM:C;M:49,250403_IBU_PDOOL:A;M:72,250427_IBU_TCBOL:A;M:94,250626_IBU_refresh:A;M:88,250710_IBU_meta:A;M:55,250710_IBU_automore:C;M:79,250710_IBU_stgp:D;M:20,250630_IBU_omp3:A;M:54,250716_IBU_Flightcard:A;M:99,250716_IBU_FCredesg:E;M:54,250630_IBU_BSOOL:C;M:37,250724_IBU_TooltipInt:A;M:85,250730_IBU_Load15:A;M:16,250807_IBU_sea:A;M:36,250811_IBU_wjrankol:E;M:69,250811_IBU_law:B;M:16,250806_IBU_Off2Scroll:B;M:98,250806_IBU_FiltersOpt:A;M:62,250730_IBU_OLNOHIDFE:A;M:34,250812_IBU_SDoubleCTA:B;M:51,250812_IBU_FiltersOp2:A;M:20,250924_IBU_OLYPGZ:B;M:54,251022_IBU_HoverRed:B;M:22,251031_IBU_lppg:B;M:63,251023_IBU_pricetool:A;M:59,251110_IBU_TVCOL:A;M:88,251010_IBU_mfm:A;M:29,251119_IBU_MCSearch:B;M:65,251118_IBU_XResultOpt:C;M:46,251119_IBU_MCSegDisp:E;M:48,251128_IBU_fic:B;M:0,251112_IBU_pxjygxtol:B;M:60,251124_IBU_lfp4:A;M:60,251029_IBU_GATETECH:B;M:27,251215_IBU_lfca:A;M:0,251231_IBU_lda:B;',
                Group: 'Trip',
                Source: 'ONLINE',
                Version: '3',
                Currency: currency,
                Locale: locale,
                VID: cookies.UBT_VID || '',
                SessionId: '1',
                PvId: '1',
                AllianceInfo: {
                  AllianceID: 0,
                  SID: 0,
                  OuID: '',
                  UseDistributionType: 1
                },
                TransactionID: transactionId,
                ExtendFields: {
                  PageId: cookies.pageId || '10320667452',
                  Os: 'Mac OS',
                  OsVersion: '10.15.7',
                  flightsignature: ''
                },
                ClientID: cookies.GUID || ''
              }
            },
            ajaxType: 'fetch',
            sc: 0,
            sfc: 0,
            sbc: 0,
            cnost: Math.floor(Math.random() * 120000) + 100000
          }),
          metric_type: 'ajax',
          platform: 'flight-online-main',
          idc: 'SGP-ALI',
          locale: locale.replace('-', '_'),
          aid: '',
          sid: '',
          sub_metric_name: '',
          ajaxInfo: '{"httpCode":200}',
          __ubt_user_data_length: 2270
        },
        value: Math.floor(Math.random() * 120000) + 100000
      }
    ],
    // Item 38 (182): dev_trace - webcore_sse_info (onmessage)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'webcore_sse_info',
        val: {
          url: `https://${parsed.hostname}/restapi/soa2/27015/FlightListSearchSSE`,
          retryTimes: 1,
          success: false,
          status: 'sse onmessage',
          duration: Math.floor(Math.random() * 200000) + 200000,
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 299,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 39 (183): dev_trace - webcore_sse_info (success)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'dev_trace',
      'tiled_tl',
      {
        key: 'webcore_sse_info',
        val: {
          url: `https://${parsed.hostname}/restapi/soa2/27015/FlightListSearchSSE`,
          retryTimes: 1,
          status: 'sse success',
          duration: Math.floor(Math.random() * 200000) + 200000,
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          __ubt_user_data_length: 281,
          tld: 'trip.com',
          ubt_language: language,
          ubt_currency: currency,
          ubt_site: region,
          ubt_locale: locale,
          ubt_batchid: ubtBatchId
        }
      }
    ],
    // Item 40 (184): metric - o_web_http_fail
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'o_web_http_fail',
        tags: {
          runningType: 'nfes-h5',
          serviceCode: '27015',
          operation: 'FlightListSearchSSE',
          RootMessageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
          CLOGGING_TRACE_ID: String(Math.floor(Math.random() * 1000000000000000000)),
          gatewayRegion: 'SGP-ALI',
          gatewayTime: String(Math.random() * 20 + 10).substring(0, 5),
          statusCode: 605,
          isSOA: true,
          requestHost: parsed.hostname,
          requestUrl: `https://${parsed.hostname}/restapi/soa2/27015/FlightListSearchSSE`,
          method: 'POST',
          errorReason: 'timeout',
          isSSE: true,
          beforeFetch: Math.floor(Math.random() * 10),
          timeout: 60000,
          buHead: JSON.stringify({
            appid: '700020',
            syscode: '40',
            cver: '3',
            cid: cookies.GUID || '',
            extension: [
              { name: 'source', value: 'ONLINE' },
              { name: 'sotpGroup', value: 'Trip' },
              { name: 'sotpLocale', value: locale },
              { name: 'sotpCurrency', value: currency },
              { name: 'allianceID', value: '0' },
              { name: 'sid', value: '0' },
              { name: 'ouid', value: '' },
              { name: 'uuid' },
              { name: 'useDistributionType', value: '1' },
              { name: 'flt_app_session_transactionId', value: transactionId },
              { name: 'vid', value: cookies.UBT_VID || '' },
              { name: 'pvid', value: '3' },
              { name: 'Flt_SessionId', value: '2' },
              { name: 'channel' },
              { name: 'x-ua', value: 'v=3_os=ONLINE_osv=10.15.7' },
              { name: 'PageId', value: cookies.pageId || '10320667452' },
              { name: 'clientTime', value: new Date(sendTs).toISOString() },
              { name: 'LowPriceSource', value: 'searchForm' },
              { name: 'Flt_BatchId', value: fltBatchId },
              { name: 'BlockTokenTimeout', value: '0' },
              { name: 'full_link_time_scene', value: 'pure_list_page' },
              { name: 'xproduct', value: 'baggage' },
              { name: 'units', value: 'METRIC' },
              { name: 'sotpUnit', value: 'METRIC' }
            ]
          }),
          httpHopProtocol: 'unknown',
          _ubt_pid: cookies.pageId || '10320667452',
          locale: locale,
          tripType: params.triptype?.toLowerCase() === 'rt' ? '2' : '1',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          isBot: 'F',
          __ubt_user_data_length: 2000
        },
        value: Math.floor(Math.random() * 200000) + 200000
      }
    ],
    // Item 41 (185): metric - web_ajax_perf (GetRouteInfo - second call)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'web_ajax_perf',
        tags: {
          metric_name: '/restapi/soa2/21273/GetRouteInfo',
          metric_value: Math.floor(Math.random() * 120000) + 100000,
          note: JSON.stringify({
            type: 2,
            method: 'POST',
            xhrCatId: '',
            flightIDC: '',
            gateRegion: 'SGP-ALI',
            messageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
            rootMessageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
            clientId: cookies.GUID || '',
            params: {
              departure: segments[0]?.segments[0]?.dport || '',
              arrival: segments[0]?.segments[0]?.aport || '',
              searchCriteria: {
                passengerCount: {
                  adult: params.quantity || 1,
                  child: 0,
                  infant: 0
                },
                searchSegmentList: segments.map(seg => ({
                  departCity: seg.segments[0].dport,
                  arriveCity: seg.segments[0].aport
                }))
              },
              tripType: tripType,
              extendInfoList: [{ key: 'needCheckESim', value: true }],
              Head: {
                AbTesting: 'M:27,240912_IBU_jpwjo:A;M:84,241224_IBU_TOLNG:B;M:83,250109_IBU_OLFBO:D;M:57,250207_IBU_FLTOLM:C;M:49,250403_IBU_PDOOL:A;M:72,250427_IBU_TCBOL:A;M:94,250626_IBU_refresh:A;M:88,250710_IBU_meta:A;M:55,250710_IBU_automore:C;M:79,250710_IBU_stgp:D;M:20,250630_IBU_omp3:A;M:54,250716_IBU_Flightcard:A;M:99,250716_IBU_FCredesg:E;M:54,250630_IBU_BSOOL:C;M:37,250724_IBU_TooltipInt:A;M:85,250730_IBU_Load15:A;M:16,250807_IBU_sea:A;M:36,250811_IBU_wjrankol:E;M:69,250811_IBU_law:B;M:16,250806_IBU_Off2Scroll:B;M:98,250806_IBU_FiltersOpt:A;M:62,250730_IBU_OLNOHIDFE:A;M:34,250812_IBU_SDoubleCTA:B;M:51,250812_IBU_FiltersOp2:A;M:20,250924_IBU_OLYPGZ:B;M:54,251022_IBU_HoverRed:B;M:22,251031_IBU_lppg:B;M:63,251023_IBU_pricetool:A;M:59,251110_IBU_TVCOL:A;M:88,251010_IBU_mfm:A;M:29,251119_IBU_MCSearch:B;M:65,251118_IBU_XResultOpt:C;M:46,251119_IBU_MCSegDisp:E;M:48,251128_IBU_fic:B;M:0,251112_IBU_pxjygxtol:B;M:60,251124_IBU_lfp4:A;M:60,251029_IBU_GATETECH:B;M:27,251215_IBU_lfca:A;M:0,251231_IBU_lda:B;',
                Group: 'Trip',
                Source: 'ONLINE',
                Version: '3',
                Currency: currency,
                Locale: locale,
                VID: cookies.UBT_VID || '',
                SessionId: '2',
                PvId: '3',
                AllianceInfo: {
                  AllianceID: 0,
                  SID: 0,
                  OuID: '',
                  UseDistributionType: 1
                },
                TransactionID: transactionId,
                ExtendFields: {
                  PageId: cookies.pageId || '10320667452',
                  Os: 'Mac OS',
                  OsVersion: '10.15.7',
                  flightsignature: ''
                },
                ClientID: cookies.GUID || ''
              }
            },
            ajaxType: 'fetch',
            sc: 0,
            sfc: 0,
            sbc: 0,
            cnost: Math.floor(Math.random() * 120000) + 100000
          }),
          metric_type: 'ajax',
          platform: 'flight-online-main',
          idc: 'SGP-ALI',
          locale: locale.replace('-', '_'),
          aid: '',
          sid: '',
          sub_metric_name: '',
          ajaxInfo: '{"httpCode":200}',
          __ubt_user_data_length: 2392
        },
        value: Math.floor(Math.random() * 120000) + 100000
      }
    ],
    // Item 42 (186): metric - o_web_http_success (getUrgentNotice)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'o_web_http_success',
        tags: {
          runningType: 'nfes-h5',
          serviceCode: '14427',
          operation: 'getUrgentNotice',
          RootMessageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
          CLOGGING_TRACE_ID: String(Math.floor(Math.random() * 1000000000000000000)),
          gatewayRegion: 'SGP-ALI',
          gatewayTime: '0.01',
          statusCode: 200,
          isSOA: true,
          requestHost: parsed.hostname,
          requestUrl: '/restapi/soa2/14427/getUrgentNotice',
          method: 'POST',
          errorReason: '',
          beforeFetch: Math.floor(Math.random() * 200),
          timeout: 30000,
          httpHopProtocol: 'unknown',
          _ubt_pid: cookies.pageId || '10320667452',
          pureUrl: url,
          captainAppId: '100014851',
          fromSDK: true,
          version: '2.0.91',
          webcoreInit: webcoreInit,
          framework: 'web-core',
          isBot: 'F',
          __ubt_user_data_length: 638
        },
        value: Math.floor(Math.random() * 20000) + 98000
      }
    ],
    // Item 43 (187): metric - web_ajax_perf (FlightListSearchSSE)
    [
      sequenceCounter++,
      sendTs - Math.floor(Math.random() * 5000) - 200000,
      'metric',
      null,
      {
        name: 'web_ajax_perf',
        tags: {
          metric_name: `https://${parsed.hostname}/restapi/soa2/27015/FlightListSearchSSE`,
          metric_value: Math.floor(Math.random() * 120000) + 100000,
          note: JSON.stringify({
            type: 2,
            method: 'POST',
            xhrCatId: '',
            flightIDC: '',
            gateRegion: 'SGP-ALI',
            messageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
            rootMessageId: `100025527-${generateShortId()}-491387-${Math.floor(Math.random() * 1000000)}`,
            clientId: cookies.GUID || '',
            params: {
              mode: 0,
              searchCriteria: {
                grade: 3,
                realGrade: 1,
                tripType: params.triptype?.toLowerCase() === 'rt' ? 2 : 1,
                journeyNo: 1,
                passengerInfoType: {
                  adultCount: params.quantity || 1,
                  childCount: 0,
                  infantCount: 0
                },
                journeyInfoTypes: segments.map((seg, idx) => ({
                  journeyNo: idx + 1,
                  departDate: seg.segments[0].takeofftime,
                  departCode: seg.segments[0].dport,
                  arriveCode: seg.segments[0].aport,
                  departAirport: '',
                  arriveAirport: ''
                })),
                policyId: null
              },
              sortInfoType: {
                direction: true,
                orderBy: 'Direct',
                topList: []
              },
              tagList: [],
              flagList: ['NEED_RESET_SORT', 'FullDataCache'],
              filterType: {
                filterFlagTypes: [],
                queryItemSettings: [],
                studentsSelectedStatus: true
              },
              abtList: [
                { abCode: '250811_IBU_wjrankol', abVersion: 'D' },
                { abCode: '250806_IBU_FiltersOpt', abVersion: 'A' },
                { abCode: '250812_IBU_FiltersOp2', abVersion: 'A' },
                { abCode: '251023_IBU_pricetool', abVersion: 'B' }
              ],
              head: {
                cid: cookies.GUID || '',
                ctok: '',
                cver: '3',
                lang: '01',
                sid: '8888',
                syscode: '40',
                auth: '',
                xsid: '',
                extension: [
                  { name: 'source', value: 'ONLINE' },
                  { name: 'sotpGroup', value: 'Trip' },
                  { name: 'sotpLocale', value: locale },
                  { name: 'sotpCurrency', value: currency },
                  { name: 'allianceID', value: '0' },
                  { name: 'sid', value: '0' },
                  { name: 'ouid', value: '' },
                  { name: 'uuid' },
                  { name: 'useDistributionType', value: '1' },
                  { name: 'flt_app_session_transactionId', value: transactionId },
                  { name: 'vid', value: cookies.UBT_VID || '' },
                  { name: 'pvid', value: '1' },
                  { name: 'Flt_SessionId', value: '1' },
                  { name: 'channel' },
                  { name: 'x-ua', value: 'v=3_os=ONLINE_osv=10.15.7' },
                  { name: 'PageId', value: cookies.pageId || '10320667452' },
                  { name: 'clientTime', value: new Date(sendTs).toISOString() },
                  { name: 'LowPriceSource', value: 'searchForm' },
                  { name: 'Flt_BatchId', value: fltBatchId },
                  { name: 'BlockTokenTimeout', value: '0' },
                  { name: 'full_link_time_scene', value: 'pure_list_page' },
                  { name: 'xproduct', value: 'baggage' },
                  { name: 'units', value: 'METRIC' },
                  { name: 'sotpUnit', value: 'METRIC' }
                ]
              },
              Locale: locale,
              Language: language,
              Currency: currency,
              ClientID: '',
              appid: '700020'
            },
            ajaxType: 'fetch',
            sc: 0,
            sfc: 0,
            sbc: 0,
            cnost: Math.floor(Math.random() * 120000) + 100000,
            dnsLookupTime: 0,
            tcpConnectionTime: 0,
            sslHandshakeTime: 0,
            firstByteTime: Math.floor(Math.random() * 15000) + 10000,
            downloadTime: Math.floor(Math.random() * 10) + 4
          }),
          metric_type: 'ajax',
          platform: 'flight-online-main',
          idc: 'SGP-ALI',
          locale: locale.replace('-', '_'),
          aid: '',
          sid: '',
          sub_metric_name: '',
          ajaxInfo: '{"httpCode":200}',
          __ubt_user_data_length: 3134
        },
        value: Math.floor(Math.random() * 120000) + 100000
      }
    ]
  ];
  
  // Combine both parts
  const ubtListItems = [...ubtListItemsPart1, ...ubtListItemsPart2];
  
  return {
    context: [
      cookies.pageId || '10320667452', // Page ID
      cookies.UBT_VID || '', // UBT VID
      2, // static
      2, // static
      '1.3.77/new/t', // static
      100014851, // Captain App ID - static
      null,
      null,
      'online',
      cookies.GUID || '', // Clid ID
      url, // URL
      cookies.pageId || '10320667452',
      1, // static
      2, // static
      1280, // static
      800, // static
      813, // static
      24, // static
      36, // static
      'en-us',
      '',
      '',
      '{"version":"","net":"None","platform":""}',
      2, // static
      `{"fef_name":"","fef_ver":"","rg":"","lang":"${locale}","lizard":""}`, // lang based on request url
      'SGP-ALI',
      `100014851-${generateShortId()}-${generateShortId()}-${generateShortId()}`, // {100014851}-{UUID}-{UUID}-{UUID}
      null,
      null,
      '',
      false,
      false,
      null,
      null
    ],
    business: [
      '', // static
      '', // static
      '', // static
      null, // static
      null, // static
      null, // static
      null, // static
      null, // static
      null, // static
      null, // static
      {
        enterTs: sendTs - Math.floor(Math.random() * 10000), // random timestamp but simulate user behavior
        instKey: 'd7d5kp', // static
        npmVersion: '1.6.5', // static
        npmEnterTs: sendTs - Math.floor(Math.random() * 10000) - 100, // random timestamp but simulate user behavior
        bizTokens: [], // static
        eid: null, // static
        framework: 'web-core', // static
        tcpSend: false, // static
        isSupportWasm: true, // static
        isOverseas: 'true', // static
        tld: 'trip.com', // static
        captainAppId: '100014851', // static
        lsSize: 24610, // static
        ubt_language: language, // based on request url
        ubt_currency: currency, // based on request url
        ubt_site: region, // based on request url
        ubt_locale: locale, // based on request url
        wcVersion: '2.0.91', // static
        flighttype: tripType === 'RT' ? 'D' : 'D', // static
        flightinformation: segments.length > 0 ? {
          segmentinfo: segments,
          airlineclass: params.class?.toUpperCase() || 'Y', // based on request url
          adult: params.quantity || 1, // based on request url
          child: 0, // based on request url
          infant: 0 // based on request url
        } : undefined,
        ubt_reqid: `${sendTs}${reqIdSuffix}`, // {timestamp}{suffix}
        ubt_batchid: `${sendTs - 1}_${batchIdParts[0]}_${batchIdParts[1]}` // {timestamp-1}_{UUID}_{UUID}
      }
    ],
    user: [
      null,
      'M:27,240912_IBU_jpwjo:A;M:84,241224_IBU_TOLNG:B;M:83,250109_IBU_OLFBO:D;M:57,250207_IBU_FLTOLM:C;M:49,250403_IBU_PDOOL:A;M:72,250427_IBU_TCBOL:A;M:94,250626_IBU_refresh:A;M:88,250710_IBU_meta:A;M:55,250710_IBU_automore:C;M:79,250710_IBU_stgp:D;M:20,250630_IBU_omp3:A;M:54,250716_IBU_Flightcard:A;M:99,250716_IBU_FCredesg:E;M:54,250630_IBU_BSOOL:C;M:37,250724_IBU_TooltipInt:A;M:85,250730_IBU_Load15:A;M:16,250807_IBU_sea:A;M:36,250811_IBU_wjrankol:E;M:69,250811_IBU_law:B;M:16,250806_IBU_Off2Scroll:B;M:98,250806_IBU_FiltersOpt:A;M:62,250730_IBU_OLNOHIDFE:A;M:34,250812_IBU_SDoubleCTA:B;M:51,250812_IBU_FiltersOp2:A;M:20,250924_IBU_OLYPGZ:B;M:54,251022_IBU_HoverRed:B;M:22,251031_IBU_lppg:B;M:63,251023_IBU_pricetool:A;M:59,251110_IBU_TVCOL:A;M:88,251010_IBU_mfm:A;M:29,251119_IBU_MCSearch:B;M:65,251118_IBU_XResultOpt:C;M:46,251119_IBU_MCSegDisp:E;M:48,251128_IBU_fic:B;M:0,251112_IBU_pxjygxtol:B;M:60,251124_IBU_lfp4:A;M:60,251029_IBU_GATETECH:B;M:27,251215_IBU_lfca:A;M:0,251231_IBU_lda:B;', // static
      null,
      ''
    ],
    ubtList: ubtListItems,
    sendTs: sendTs
  };
}

/**
 * POST /api/flight-search (using CycleTLS)
 * 
 * Request body:
 * {
 *   "url": "https://id.trip.com/flights/showfarefirst?dcity=han&acity=bkk&ddate=2026-01-22&rdate=2026-01-27&triptype=rt&class=y&lowpricesource=searchform&quantity=1&searchboxarg=t&nonstoponly=off&locale=en-ID&curr=VND",
 *   "proxy": "http://user:pass@proxy:8080" // optional
 * }
 */
app.post('/api/flight-search', async (req: Request, res: Response) => {
  try {
    const { url, proxy } = req.body;
    
    if (!url) {
      return res.status(400).json({
        error: 'Missing required field: url',
      });
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 New Flight Search Request');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('URL:', url);
    console.log('Proxy:', proxy || 'none');
    
    // Step 1: Parse URL
    console.log('\n✅ Parsed URL:');
    console.log('  Hostname:', url);
    const parsed = parseTripUrl(url);
    console.log('  Region:', parsed.region);
    console.log('  Params:', JSON.stringify(parsed.params, null, 2));
    
    // Step 2: Create session
    const session = new CycleTLSSession({
      proxy: proxy || process.env.PROXY_URL,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    });

    console.log(`\n parsed hostname: ${parsed.hostname}`);
    
    // Step 3: Get cookies from hostname root (getWithRedirects)
    console.log('\n📥 Step 1: Getting cookies from hostname root...');
    const rootCookies = await getCookiesFromHostname(
      session,
      parsed.hostname,
      parsed.region,
      parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
      parsed.params.curr || 'IDR'
    );
    
    console.log('✅ Root cookies obtained:');
    console.log('  GUID:', rootCookies.GUID);
    console.log('  TransactionId:', rootCookies.transactionId);
    console.log('  PageId:', rootCookies.pageId);

    // Ensure all cookies from rootCookies are set in the session
    console.log('\n🔧 Setting all root cookies in session...');
    if (rootCookies.GUID) session.setCookie('GUID', rootCookies.GUID);
    if (rootCookies.UBT_VID) session.setCookie('UBT_VID', rootCookies.UBT_VID);
    if (rootCookies.transactionId) session.setCookie('transactionId', rootCookies.transactionId);
    if (rootCookies.pageId) session.setCookie('pageId', rootCookies.pageId);
    // Set all cookies from allCookies if available
    if (rootCookies.allCookies) {
      for (const [name, cookie] of Object.entries(rootCookies.allCookies)) {
        if (cookie && typeof cookie === 'object' && 'value' in cookie) {
          const cookieValue = (cookie as { value: string }).value;
          if (typeof cookieValue === 'string') {
            session.setCookie(name, cookieValue);
          }
        }
      }
    }
    console.log('  ✅ All root cookies set in session');
    
    // Step 3.6: Create Client ID (before visiting target URL)
    console.log('\n📥 Step 1.6: Creating Client ID...');
    try {
      const createClientIdUrl = 'https://www.trip.com/restapi/soa2/10290/createclientid?systemcode=09&createtype=3&contentType=json';
      
      const cookiesForClientId = {
        UBT_VID: rootCookies.UBT_VID || '',
        ibu_online_jump_site_result: rootCookies.ibu_online_jump_site_result || `{"site_url":[],"suggestion":["${parsed.region}-${parsed.region}","","en-${parsed.region}","en-us"]}`,
        ibu_online_home_language_match: rootCookies.ibu_online_home_language_match || `{"isShowSuggestion":false}`,
        ibulanguage: rootCookies.ibulanguage || parsed.region.toUpperCase(),
        ibulocale: rootCookies.ibulocale || `${parsed.region.toLowerCase()}_${parsed.region.toLowerCase()}`,
        cookiePricesDisplayed: rootCookies.cookiePricesDisplayed || (parsed.params.curr || 'IDR'),
        _abtest_userid: rootCookies._abtest_userid || '',
      };
      
      // Build cookie header
      const cookieHeader = Object.entries(cookiesForClientId)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      
      const clientIdResponse = await session.post(createClientIdUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Ch-Ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Origin': `https://${parsed.hostname}`,
          'Sec-Fetch-Site': 'same-site',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'Referer': `https://${parsed.hostname}/`,
          'Priority': 'u=4, i',
          'Cookie': cookieHeader,
        },
      });
      
      if (clientIdResponse.statusCode === 200) {
        try {
          const data = JSON.parse(clientIdResponse.body);
          if (data?.ClientID) {
            rootCookies.GUID = data.ClientID;
            session.setCookie('GUID', data.ClientID);
            console.log('   ✅ GUID obtained:', data.ClientID);
          }
        } catch (e) {
          console.warn('   ⚠️  Failed to parse ClientID response:', e);
        }
      }
    } catch (e: any) {
      console.warn('   ⚠️  Create Client ID failed:', e?.message ?? e);
    }
    
    // Step 4: Visit target URL to get _combined cookie
    console.log('\n📥 Step 2: Visiting target URL to get _combined cookie...');
    const targetResponse = await session.get(url, {
      headers: {
        'Referer': `https://${parsed.hostname}`,
      },
    });

    console.log(`✅ Target URL visited (Status: ${targetResponse.statusCode})`);
    console.log(`   Cookies after target visit: ${Object.keys(targetResponse.cookies).length} cookies`);
    
    // Extract x-ctx-wclient-req from target response if available
    if (targetResponse.headers['x-ctx-wclient-req']) {
      rootCookies.headers['x-ctx-wclient-req'] = targetResponse.headers['x-ctx-wclient-req'];
      console.log('   ✅ x-ctx-wclient-req extracted:', targetResponse.headers['x-ctx-wclient-req']);
    }
    
    // Extract __APP_INITIAL_STATE__ from target URL response to get city information
    console.log('\n📥 Extracting __APP_INITIAL_STATE__ from target URL response...');
    const { appInitialState, cityInfoMap } = extractAppInitialState(targetResponse.body);
    if (appInitialState) {
      rootCookies.appInitialState = appInitialState;
      rootCookies.cityInfoMap = cityInfoMap;
      console.log('   ✅ __APP_INITIAL_STATE__ extracted and city info available');
      console.log('   ✅ City info map:', Object.keys(cityInfoMap));
    } else {
      console.warn('   ⚠️  Failed to extract __APP_INITIAL_STATE__ from target URL');
    }
    
    // Wait a bit to simulate page load time (browsers don't make requests instantly)
    // This is important - the page needs time to render and JavaScript to execute
    console.log('\n⏳ Waiting 1-2 seconds to simulate initial page load...');
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 1000)));
    
    // Step 2.1-2.8: Reorganized flow:
    // - Step 2.1-2.4: First batch (getAppConfig, getHeaderInfo, saveLogInfo, getRouteInfo first call) - concurrent
    // - Step 2.5: getRouteInfo (second call) - sequential
    // - Step 2.6-2.8: UBT collect, FlightListSearchSSE, and clog - all concurrent
    console.log('\n📥 Step 2.1-2.8: Preparing API calls in correct sequence...');
    
    // Prepare FlightListSearchSSE payload early (needed for concurrent call with clog)
    // We'll build it here but call it concurrently with clog
    let finalCookies = rootCookies;
    let combinedCookie = generateCombinedCookie();
    finalCookies._combined = combinedCookie;
    session.setCookie('_combined', combinedCookie.encoded);
    
    console.log('[getCookiesFromHostname] Generating _bfa cookie');
    const params = new URLSearchParams(finalCookies['_combined'].raw);
    const initPageId = params.get('initPageId');
    session.setCookie('_bfa', `1.${finalCookies['UBT_VID']}.1.${Date.now()}.${Date.now()+20000}.1.1.${initPageId}`);

    if (targetResponse.cookies['_combined']) {
      let combined = targetResponse.cookies['_combined'].value;
      
      // Parse _combined to extract transactionId and pageId (may be updated)
      try {
        const decoded = decodeURIComponent(combined);
        const params = new URLSearchParams(decoded);
        let newTransactionId = params.get('transactionId');
        const newPageId = params.get('pageId') || params.get('initPageId');
        
        // Replace 'nodejs' with 'WEB' in transactionId
        if (newTransactionId && newTransactionId.includes('nodejs')) {
          newTransactionId = newTransactionId.replace(/nodejs/g, 'WEB');
          combined = combined.replace(/nodejs/g, 'WEB');
          console.log('   🔧 Replaced "nodejs" with "WEB" in _combined cookie');
        }
        
        if (newTransactionId) {
          finalCookies.transactionId = newTransactionId;
          console.log('   ✅ Updated transactionId from _combined:', newTransactionId);
        }
        if (newPageId) {
          finalCookies.pageId = newPageId;
          console.log('   ✅ Updated pageId from _combined:', newPageId);
        }
      } catch (e) {
        console.warn('   ⚠️  Failed to parse _combined:', e);
        if (combined.includes('nodejs')) {
          combined = combined.replace(/nodejs/g, 'WEB');
          console.log('   🔧 Replaced "nodejs" with "WEB" in _combined cookie (fallback)');
        }
      }
      
      finalCookies._combined = combined;
      session.setCookie('_combined', combined);
    }

    console.log(`   ✅ Cookie set in session: _combined=${combinedCookie.encoded}`);
    console.log(`   ✅ Cookie set in session: _bfa=${session.getCookie('_bfa')}`);
    
    // Ensure all cookies from target response are set in session
    for (const [name, cookie] of Object.entries(targetResponse.cookies)) {
      if (cookie && typeof cookie === 'object' && 'value' in cookie) {
        session.setCookie(name, cookie.value);
      }
    }
    
    // Generate Flt_BatchId once (will be shared between clog and FlightListSearchSSE)
    const fltBatchId = generateUUID();
    console.log(`   🔑 Flt_BatchId (shared between clog and FlightListSearchSSE): ${fltBatchId}`);
    
    // Build payloads for FlightListSearchSSE (needed for concurrent call)
    const tokenPayload = buildTokenPayload(parsed.params, fltBatchId);
    const payload = buildFlightSearchPayload(parsed.params, finalCookies, fltBatchId);
    
    // Generate token for FlightListSearchSSE
    let flightSearchToken = '';
    try {
      flightSearchToken = signature(tokenPayload);
      console.log(`   ✅ Token generated for FlightListSearchSSE: ${flightSearchToken.substring(0, 50)}...`);
    } catch (error: any) {
      console.warn(`   ⚠️  Token generation failed: ${error?.message ?? error}`);
    }
    
    // Generate w-payload-source and x-ctx-wclient-req for FlightListSearchSSE
    const wPayloadSourcePayload = buildWPayloadSourcePayload(parsed.params, finalCookies, payload, fltBatchId);
    const wPayloadSourceString = JSON.stringify(wPayloadSourcePayload).replace(/\s+/g, '');
    const payloadMd5 = md5(wPayloadSourceString);
    const userAgent = session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    const wPayloadSource = c_sign(payloadMd5, userAgent);
    
    const apiPath = '/restapi/soa2/27015/FlightListSearchSSE';
    const timestampRandom = `-${Date.now()}-${Math.floor(Math.random() * 1e7)}`;
    const guid = finalCookies.GUID || '';
    const ubtVid = finalCookies.UBT_VID || '';
    const duid = '';
    const rf1 = finalCookies._RF1 || '';
    const wclientReqString = `${apiPath};POST;${timestampRandom};${guid || ""};${ubtVid || ""};${duid || ""};${rf1 || ""}`;
    const xCtxWclientReq = md5(wclientReqString);
    
    // Step 2.1-2.4: Make first batch of API calls (SEQUENTIAL for CycleTLS compatibility)
    // CycleTLS doesn't handle concurrent requests well, so we make them fully sequential
    console.log('\n📥 Step 2.1-2.4: Making first batch of API calls (sequential for CycleTLS compatibility)...');
    
    // Helper to add delay between requests
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    // Make requests SEQUENTIALLY (not concurrently) to avoid overwhelming CycleTLS
    const firstBatchResults: Array<{ status: 'fulfilled' | 'rejected'; value?: any; reason?: any }> = [];
    const firstBatchNames = ['getAppConfig', 'getHeaderInfo', 'saveLogInfo', 'getRouteInfo (first)'];
    
    // Step 2.1: getAppConfig
    try {
      await delay(300); // Delay before request
      const response1 = await session.post('https://www.trip.com/restapi/soa2/18088/getAppConfig.json', {
        headers: {
          'Content-Type': 'application/json',
          'Origin': `https://${parsed.hostname}`,
          'Referer': url,
        },
        data: JSON.stringify({}),
      });
      console.log(`✅ getAppConfig (Status: ${response1.statusCode})`);
      firstBatchResults.push({ status: 'fulfilled', value: response1 });
    } catch (e: any) {
      console.warn('   ⚠️  getAppConfig failed:', e?.message ?? e);
      firstBatchResults.push({ status: 'rejected', reason: e });
    }
    
    // Step 2.2: getHeaderInfo
    try {
      await delay(300); // Delay before request
      const response2 = await session.post(`https://${parsed.hostname}/m/home/getHeaderInfo?locale=${parsed.params.locale || `en-${parsed.region.toUpperCase()}`}`, {
        headers: {
          'Content-Type': 'application/json',
          'Origin': `https://${parsed.hostname}`,
          'Referer': url,
        },
        data: JSON.stringify({}),
      });
      console.log(`✅ getHeaderInfo (Status: ${response2.statusCode})`);
      firstBatchResults.push({ status: 'fulfilled', value: response2 });
    } catch (e: any) {
      console.warn('   ⚠️  getHeaderInfo failed:', e?.message ?? e);
      firstBatchResults.push({ status: 'rejected', reason: e });
    }
    
    // Step 2.3: saveLogInfo
    try {
      await delay(300); // Delay before request
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 1000);
      const uuid = randomUUID().replace(/-/g, '');
      const transId = `WEB_0_mac_${timestamp}_721_${random}_2_ibuFlightOnline_${uuid}_5.5.14_1`;
      
      const response3 = await session.post(`https://${parsed.hostname}/restapi/soa2/16163/saveLogInfo?transId=${transId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Origin': `https://${parsed.hostname}`,
          'Referer': url,
        },
        data: JSON.stringify({}),
      });
      console.log(`✅ saveLogInfo (Status: ${response3.statusCode})`);
      firstBatchResults.push({ status: 'fulfilled', value: response3 });
    } catch (e: any) {
      console.warn('   ⚠️  saveLogInfo failed:', e?.message ?? e);
      firstBatchResults.push({ status: 'rejected', reason: e });
    }
    
    // Step 2.4: getRouteInfo (first call)
    try {
      await delay(300); // Delay before request
      const response4 = await callGetRouteInfo(session, parsed, rootCookies, url);
      console.log(`✅ getRouteInfo (first call) (Status: ${response4.statusCode})`);
      if (response4.statusCode !== 200) {
        console.log(`   ⚠️  Response body: ${response4.body.substring(0, 200)}`);
      }
      firstBatchResults.push({ status: 'fulfilled', value: response4 });
    } catch (e: any) {
      console.warn('   ⚠️  getRouteInfo (first call) failed:', e?.message ?? e);
      firstBatchResults.push({ status: 'rejected', reason: e });
    }
    
    // Log first batch results
    firstBatchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const statusCode = result.value.statusCode;
        console.log(`   ✅ ${firstBatchNames[index]}: Success (Status: ${statusCode})`);
      } else {
        console.warn(`   ⚠️  ${firstBatchNames[index]} failed:`, result.reason?.message ?? result.reason);
      }
    });
    
    // Convert to Promise.allSettled format for compatibility with existing code
    const firstBatchCalls = firstBatchResults.map(r => ({
      status: r.status as 'fulfilled' | 'rejected',
      ...(r.status === 'fulfilled' ? { value: r.value } : { reason: r.reason })
    }));
    
    // Step 2.5: getRouteInfo (second call)
    console.log('\n📥 Step 2.5: Calling getRouteInfo (second time)...');
    try {
      const routeInfoResponse2 = await callGetRouteInfo(session, parsed, finalCookies, url);
      console.log(`✅ getRouteInfo (second call) (Status: ${routeInfoResponse2.statusCode})`);
      if (routeInfoResponse2.statusCode !== 200) {
        console.log(`   ⚠️  Response body: ${routeInfoResponse2.body.substring(0, 200)}`);
      }
    } catch (e: any) {
      console.warn('   ⚠️  getRouteInfo (second call) failed:', e?.message ?? e);
      // Don't throw - continue with flow
    }
    
    // Step 2.6-2.8: UBT collect, FlightListSearchSSE, and clog (all called concurrently)
    console.log('\n📥 Step 2.6-2.8: Calling UBT collect, FlightListSearchSSE, and clog concurrently...');
    
    // Prepare UBT payload before concurrent calls
    const sendTs = Date.now();
    const ubtPayload = buildUbtPayload(parsed.params, finalCookies, url, sendTs, parsed, flightSearchToken);
    const encodedPayload = encodePayload(ubtPayload);
    const ubtCollectBody = {
      d: `f00${sendTs}!m1Legacy!${encodedPayload}`
    };
    
    // Make concurrent calls but with staggered delays to avoid overwhelming CycleTLS
    const concurrentCalls = await Promise.allSettled([
      // Step 2.6: UBT collect (called concurrently with FlightListSearchSSE and clog)
      (async () => {
        try {
          await delay(100); // Small delay before request
          const ubtCollectResponse = await session.post('https://ubt-sgp.trip.com/bee/collect', {
            headers: {
              'accept': '*/*',
              'accept-language': 'en-US,en;q=0.7',
              'cache-control': 'no-cache',
              'content-type': 'application/json',
              'origin': `https://${parsed.hostname}`,
              'pragma': 'no-cache',
              'priority': 'u=4, i',
              'referer': `https://${parsed.hostname}/`,
              'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Brave";v="144"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"macOS"',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-site',
              'sec-gpc': '1',
              'user-agent': session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
            },
            json: ubtCollectBody,
          });
          console.log(`✅ UBT collect (Status: ${ubtCollectResponse.statusCode})`);
          return { type: 'ubtCollect', response: ubtCollectResponse };
        } catch (e: any) {
          console.warn('   ⚠️  UBT collect failed:', e?.message ?? e);
          throw e;
        }
      })(),
      
      // Step 2.7: clog (metrics/analytics endpoint)
      // This endpoint logs API call metrics and is called concurrently with UBT collect and FlightListSearchSSE
      // (async () => {
      //   try {
      //     // Use the same Flt_BatchId as FlightListSearchSSE (shared across both requests)
      //     const clogBatchId = fltBatchId;
          
      //     // Build AbTesting string (similar to w-payload-source format)
      //     // This should match the abtList from the actual request payload
      //     const abTestingParts: string[] = [];
      //     const abtList = [
      //       { abCode: '250811_IBU_wjrankol', abVersion: 'A' },
      //       { abCode: '250806_IBU_FiltersOpt', abVersion: 'A' },
      //       { abCode: '250812_IBU_FiltersOp2', abVersion: 'A' },
      //       { abCode: '251023_IBU_pricetool', abVersion: 'D' },
      //     ];
      //     for (const abt of abtList) {
      //       const randomNum = Math.floor(Math.random() * 100);
      //       abTestingParts.push(`M:${randomNum},${abt.abCode}:${abt.abVersion}`);
      //     }
      //     const abTesting = abTestingParts.join(';');
          
      //     // Build metric_value JSON matching the browser format
      //     // The example shows it logs getCityImageById API call
      //     const metricValue = {
      //       status: 'success',
      //       requestHeaders: {},
      //       requestBody: {
      //         cityCode: parsed.params.dcity.toUpperCase(), // Use departure city
      //         width: '960',
      //         height: '210',
      //         request: {
      //           Head: {
      //             ExtendFields: {
      //               BatchedId: clogBatchId,
      //             },
      //           },
      //         },
      //         Head: {
      //           AbTesting: abTesting,
      //           Group: 'Trip',
      //           Source: 'ONLINE',
      //           Version: '3',
      //           Currency: (parsed.params.curr || 'IDR').toUpperCase(),
      //           Locale: parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
      //           VID: rootCookies.UBT_VID || '',
      //           SessionId: '1',
      //           PvId: '1',
      //           AllianceInfo: {
      //             AllianceID: 0,
      //             SID: 0,
      //             OuID: '',
      //             UseDistributionType: 1,
      //           },
      //           TransactionID: rootCookies.transactionId || '',
      //           ExtendFields: {
      //             PageId: rootCookies.pageId || '10320667452',
      //             Os: 'Mac OS',
      //             OsVersion: '10.15.7',
      //             flightsignature: '',
      //           },
      //           ClientID: rootCookies.GUID || '',
      //         },
      //       },
      //       responseHeaders: {
      //         errorCode: '0',
      //       },
      //       transactionId: rootCookies.transactionId || '',
      //     };
          
      //     // Convert locale format (e.g., "id-ID" -> "id_id", "en-ID" -> "en_id")
      //     const clogLocale = convertLocaleForClog(parsed.params.locale || `en-${parsed.region.toUpperCase()}`);
          
      //     // Build multipart form data
      //     const formFields = {
      //       metric_name: 'getCityImageById',
      //       metric_value: JSON.stringify(metricValue),
      //       sub_name: 'H5GatewayLog',
      //       page_url: url,
      //       locale: clogLocale,
      //       vid: rootCookies.UBT_VID || '',
      //       aid: '',
      //       sid: '',
      //       uid: '',
      //     };
          
      //     const { body: formDataBody, boundary } = buildMultipartFormData(formFields);
          
      //     const response = await session.post('https://www.trip.com/restapi/soa2/29624/clog', {
      //       headers: {
      //         'accept': '*/*',
      //         'content-type': `multipart/form-data; boundary=${boundary}`,
      //         'origin': `https://${parsed.hostname}`,
      //         'priority': 'u=4, i',
      //         'referer': `https://${parsed.hostname}/`,
      //         'sec-fetch-dest': 'empty',
      //         'sec-fetch-mode': 'no-cors',
      //         'sec-fetch-site': 'same-site',
      //       },
      //       data: formDataBody,
      //     });
      //     console.log(`✅ clog (Status: ${response.statusCode})`);
      //     return response;
      //   } catch (e: any) {
      //     console.warn('   ⚠️  clog failed:', e?.message ?? e);
      //     throw e;
      //   }
      // })(),
      
      // Step 2.8: FlightListSearchSSE (called concurrently with UBT collect and clog)
      (async () => {
        try {
          await delay(300); // Small delay before request (staggered)
          const apiUrl = `https://${parsed.hostname}${apiPath}`;
          
          // Build headers for FlightListSearchSSE
          const headers: Record<string, string> = {
            'accept': 'text/event-stream',
            'content-type': 'application/json; charset=utf-8',
            'cookieorigin': `https://${parsed.hostname}`,
            'currency': (parsed.params.curr || 'IDR').toUpperCase(),
            'locale': parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
            'origin': `https://${parsed.hostname}`,
            'priority': 'u=1, i',
            'referer': url,
            'w-payload-source': wPayloadSource,
            'x-ctx-country': finalCookies.headers['x-ctx-country'] || parsed.region.toUpperCase(),
            'x-ctx-currency': finalCookies.headers['x-ctx-currency'] || (parsed.params.curr || 'IDR').toUpperCase(),
            'x-ctx-locale': finalCookies.headers['x-ctx-locale'] || parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
            'x-ctx-ubt-pageid': finalCookies.headers['x-ctx-ubt-pageid'] || finalCookies.pageId || '10320667452',
            'x-ctx-ubt-pvid': finalCookies.headers['x-ctx-ubt-pvid'] || '1',
            'x-ctx-ubt-sid': finalCookies.headers['x-ctx-ubt-sid'] || '1',
            'x-ctx-ubt-vid': finalCookies.headers['x-ctx-ubt-vid'] || finalCookies.UBT_VID || '',
            'x-ctx-user-recognize': finalCookies.headers['x-ctx-user-recognize'] || 'NON_EU',
            'x-ctx-wclient-req': xCtxWclientReq,
          };
          
          // Add token header if generated successfully
          if (flightSearchToken) {
            headers['token'] = flightSearchToken;
          }
          
          const response = await session.post(apiUrl, {
            headers,
            json: payload,
          });
          // fs.writeFileSync('flightSearchResponse.json', JSON.stringify(response, null, 2));
          console.log(`✅ FlightListSearchSSE (Status: ${response.statusCode})`);
          return { type: 'flightSearch', response };
        } catch (e: any) {
          console.warn('   ⚠️  FlightListSearchSSE failed:', e?.message ?? e);
          throw e;
        }
      })(),
    ]);
    
    // Log results and validate critical metrics endpoints
    // IMPORTANT: UBT collect, clog, and FlightListSearchSSE are called concurrently
    // The backend may validate metrics, but all requests are sent at the same time
    const endpointNames = ['UBT collect', 'clog', 'FlightListSearchSSE'];
    const results: { name: string; success: boolean; statusCode?: number; error?: string }[] = [];
    
    let flightSearchResponse: any = null;

    concurrentCalls.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const value = result.value as any;
        // FlightListSearchSSE returns { type: 'flightSearch', response }
        // UBT collect returns { type: 'ubtCollect', response }
        if (value && value.type === 'flightSearch') {
          flightSearchResponse = value.response;
          const statusCode = value.response.statusCode;
          console.log(`   ✅ ${endpointNames[index]}: Success (Status: ${statusCode})`);
          results.push({ name: endpointNames[index], success: true, statusCode });
        } else if (value && value.type === 'ubtCollect') {
          const statusCode = value.response.statusCode;
          console.log(`   ✅ ${endpointNames[index]}: Success (Status: ${statusCode})`);
          results.push({ name: endpointNames[index], success: true, statusCode });
        } else {
          const statusCode = value.statusCode;
          console.log(`   ✅ ${endpointNames[index]}: Success (Status: ${statusCode})`);
          results.push({ name: endpointNames[index], success: true, statusCode });
        }
      } else {
        const error = result.reason?.message || result.reason || 'Unknown error';
        console.warn(`   ⚠️  ${endpointNames[index]}: Failed - ${error}`);
        results.push({ name: endpointNames[index], success: false, error: String(error) });
      }
    });
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`   📊 Concurrent calls: ${successful} succeeded, ${failed} failed`);
    
    // Check if critical endpoints failed
    // UBT collect and clog are particularly important as they send analytics/metrics
    // The backend may validate these metrics before allowing FlightListSearchSSE
    const ubtCollectResult = results.find(r => r.name === 'UBT collect');
    const clogResult = results.find(r => r.name === 'clog');
    
    if (ubtCollectResult && !ubtCollectResult.success) {
      console.warn('\n   ⚠️  WARNING: UBT collect (analytics) failed!');
      console.warn('   ⚠️  Backend may reject FlightListSearchSSE if analytics are not validated');
      console.warn('   ⚠️  Error:', ubtCollectResult.error);
    } else if (ubtCollectResult && ubtCollectResult.success) {
      console.log('\n   ✅ Analytics endpoint (UBT collect) succeeded');
    }
    
    if (clogResult && !clogResult.success) {
      console.warn('\n   ⚠️  WARNING: clog (metrics/analytics) failed!');
      console.warn('   ⚠️  Backend may reject FlightListSearchSSE if metrics are not validated');
      console.warn('   ⚠️  Error:', clogResult.error);
    } else if (clogResult && clogResult.success) {
      console.log('\n   ✅ Metrics endpoint (clog) succeeded - backend validation should pass');
    }
    
    // Step 2.9: Register cookies via chloro.trip.com
    // Based on browser analysis: This happens early, before flight search
    console.log('\n📥 Step 2.9: Registering cookies via chloro.trip.com...');
    try {
      // Get user agent from session or use curl-impersonate-chrome default
      // curl-impersonate-chrome uses a Chrome user agent automatically
      const userAgent = session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
      
      // Update navigator in c-sign.node.js with the user agent
      // This ensures the navigator object matches the actual user agent being used
      const { setUserAgent } = require('../c-sign');
      setUserAgent(userAgent);
      
      // Extract Chrome version and platform from user agent
      const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
      const chromeVersion = chromeMatch ? chromeMatch[1] : '143';
      
      let platform = '"macOS"';
      if (userAgent.includes('Windows')) {
        platform = '"Windows"';
      } else if (userAgent.includes('Linux')) {
        platform = '"Linux"';
      } else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS X')) {
        platform = '"macOS"';
      }
      
      const secChUa = `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not A(Brand";v="24"`;
      
      const additionalHeaders = {
        userAgent,
        secChUa,
        platform,
      };
      
      console.log('   🔐 Generating browser fingerprint...');
      console.log(`      User Agent: ${userAgent}`);
      console.log(`      Platform: ${platform}`);
      console.log(`      Chrome Version: ${chromeVersion}`);
      
      const collectResp = await generate_rguid_rsg_rdg(session, parsed.region, additionalHeaders);
      
      if (collectResp && typeof collectResp.data === 'string') {
        const parts = collectResp.data.split('|').map((s: string) => s.trim());
        if (parts.length >= 4) {
          const [rguid, rf1, rsg, rdg] = parts;
          if (rguid) {
            rootCookies._RGUID = rguid;
            session.setCookie('_RGUID', rguid);
            console.log('   ✅ _RGUID obtained:', rguid);
          }
          if (rf1) {
            rootCookies._RF1 = rf1;
            session.setCookie('_RF1', rf1);
            console.log('   ✅ _RF1 obtained:', rf1);
          }
          if (rsg) {
            rootCookies._RSG = rsg;
            session.setCookie('_RSG', rsg);
            console.log('   ✅ _RSG obtained:', rsg);
          }
          if (rdg) {
            rootCookies._RDG = rdg;
            session.setCookie('_RDG', rdg);
            console.log('   ✅ _RDG obtained:', rdg);
          }
        }
      }
      console.log('✅ Cookie registration completed');
    } catch (e: any) {
      console.warn('   ⚠️  Cookie registration failed:', e?.message ?? e);
    }
    
    // Check if FlightListSearchSSE was successful (it was called concurrently with clog)
    if (!flightSearchResponse) {
      // If FlightListSearchSSE failed in concurrent call, try to find the error
      const flightSearchResult = results.find(r => r.name === 'FlightListSearchSSE');
      if (flightSearchResult && !flightSearchResult.success) {
        throw new Error(`FlightListSearchSSE failed: ${flightSearchResult.error}`);
      }
      throw new Error('FlightListSearchSSE response not found');
    }
    
    // Step 3: Process FlightListSearchSSE response (already received from concurrent call)
    console.log('\n✅ Flight search completed (called concurrently with clog)');
    console.log('  Status:', flightSearchResponse.statusCode);
    console.log('  Response length:', flightSearchResponse.body.length);
    console.log('  Response preview:', flightSearchResponse.body.substring(0, 500));
    
    // Log cookie string for browser testing
    console.log('\n🍪 Cookie String (for browser testing):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const cookieParts: string[] = [];
    if (finalCookies.GUID) cookieParts.push(`GUID=${finalCookies.GUID}`);
    if (finalCookies.UBT_VID) cookieParts.push(`UBT_VID=${finalCookies.UBT_VID}`);
    if (finalCookies._combined) cookieParts.push(`_combined=${finalCookies._combined.encoded}`);
    if (finalCookies._RGUID) cookieParts.push(`_RGUID=${finalCookies._RGUID}`);
    if (finalCookies._RF1) cookieParts.push(`_RF1=${finalCookies._RF1}`);
    const cookieString = cookieParts.join('; ');
    console.log(cookieString);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    fs.writeFileSync('cookie.txt', cookieString);
    // Parse response (handle SSE format)
    let flightData: any;
    let productId: string | undefined;
    try {
      // Handle SSE format: remove 'data:' prefix and parse first JSON object
      // let responseBody = flightSearchResponse.body;

      console.log('\n manual decode response body')
      
      let responseBody = decodeBody(flightSearchResponse);
      if (responseBody.includes('data:')) {
        // Extract first data line
        const dataLines = responseBody.split('\n').filter(line => line.startsWith('data:'));
        if (dataLines.length > 0) {
          responseBody = dataLines[0].replace('data:', '').trim();
        }
      }
      flightData = JSON.parse(responseBody);
      
      // Extract productId from response
      if (flightData?.basicInfo?.productId) {
        productId = flightData.basicInfo.productId;
        console.log('  ✅ ProductId extracted:', productId);
      } else {
        console.log('  ⚠️  ProductId not found in response');
      }
      
      // Check if we got blocked (recordCount: 1 usually means captcha/minimal response)
      if (flightData?.basicInfo?.recordCount === 1) {
        console.log('\n  ⚠️  WARNING: recordCount is 1 - might be blocked/captcha response!');
        console.log('  💡 This could indicate:');
        console.log('     - Missing or invalid cookies');
        console.log('     - Timing too fast (needs more delay)');
        console.log('     - Missing headers');
        console.log('     - Browser fingerprint mismatch');
        console.log('     - Captcha challenge');
        console.log('  📋 Debug info:');
        console.log('     - Response keys:', Object.keys(flightData || {}));
        if (flightData?.head?.retCode) {
          console.log('     - retCode:', flightData.head.retCode);
        }
        if (flightData?.ResponseStatus?.Ack) {
          console.log('     - Ack:', flightData.ResponseStatus.Ack);
        }
        if (flightData?.ResponseStatus?.Errors && flightData.ResponseStatus.Errors.length > 0) {
          console.log('     - Errors:', JSON.stringify(flightData.ResponseStatus.Errors));
        }
        console.log('\n  🔍 Troubleshooting suggestions:');
        console.log('     1. Check if cookies are valid by copying cookie string above and testing in browser');
        console.log('     2. Verify fingerprint is realistic (check logs above)');
        console.log('     3. Try increasing delays between requests');
        console.log('     4. Check if all required endpoints are being called');
        console.log('     5. Verify w-payload-source and x-ctx-wclient-req headers are generated correctly');
      } else if (flightData?.basicInfo?.recordCount) {
        console.log(`  ✅ Found ${flightData.basicInfo.recordCount} flight records`);
      } else {
        console.log('  ⚠️  No recordCount found in response');
        console.log('  📋 Response structure:', JSON.stringify(flightData, null, 2).substring(0, 1000));
      }
      
      // Step 4: Call risk endpoint AFTER flight search (based on browser analysis)
      // Browser calls riskpoc.trip.com/h AFTER FlightListSearchSSE (timestamp: 1768575691328 vs 1768575690373)
      // This is critical - the order matters!
      console.log('\n📥 Step 4: Calling risk endpoint (AFTER flight search, as per browser pattern)...');
      try {
        const uuid = randomUUID().replace(/-/g, '');
        const suffix = Math.floor(Math.random() * 100);
        const requestId = `${uuid}_${suffix}`;
        const serverName = `https://${parsed.hostname}`;
        const formData = `requestId=${requestId}&serverName=${encodeURIComponent(serverName)}`;
        
        const riskResponse = await session.post('https://riskpoc.trip.com/h', {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': `https://${parsed.hostname}`,
            'Referer': url,
          },
          data: formData,
        });
        console.log(`✅ Risk endpoint called (Status: ${riskResponse.statusCode})`);
      } catch (e: any) {
        console.warn('   ⚠️  Risk endpoint call failed:', e?.message ?? e);
      }
    } catch (e) {
      // If not JSON, return raw body
      flightData = flightSearchResponse.body;
    }
    
    return res.json({
      success: true,
      statusCode: flightSearchResponse.statusCode,
      data: flightData,
      productId: productId, // Include productId in response for subsequent requests
      cookies: {
      guid: finalCookies.GUID,
      transactionId: finalCookies.transactionId,
      pageId: finalCookies.pageId,
      },
      metadata: {
        hostname: parsed.hostname,
        region: parsed.region,
        params: parsed.params,
      },
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * POST /api/flight-search-grpc (using gRPC Session)
 * 
 * Request body:
 * {
 *   "url": "https://id.trip.com/flights/showfarefirst?dcity=han&acity=bkk&ddate=2026-01-22&rdate=2026-01-27&triptype=rt&class=y&lowpricesource=searchform&quantity=1&searchboxarg=t&nonstoponly=off&locale=en-ID&curr=VND",
 *   "proxy": "http://user:pass@proxy:8080" // optional
 * }
 */
app.post('/api/flight-search-grpc', async (req: Request, res: Response) => {
  try {
    const { url, proxy } = req.body;
    
    if (!url) {
      return res.status(400).json({
        error: 'Missing required field: url',
      });
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 New Flight Search Request (gRPC)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('URL:', url);
    console.log('Proxy:', proxy || 'none');
    console.log('Session Type: gRPC Session');
    
    // Step 1: Parse URL
    const parsed = parseTripUrl(url);
    console.log('\n✅ Parsed URL:');
    console.log('  Hostname:', parsed.hostname);
    console.log('  Region:', parsed.region);
    console.log('  Params:', JSON.stringify(parsed.params, null, 2));
    
    // Step 2: Create gRPC Session
    const session = new Session({
      proxy: proxy || process.env.PROXY_URL,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    });
    
    // Step 3: Get cookies from hostname root (getWithRedirects)
    console.log('\n📥 Step 1: Getting cookies from hostname root...');

    const cookie_hostname = parsed.hostname;
    const rootCookies = await getCookiesFromHostname(
      session,
      cookie_hostname,
      parsed.region,
      parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
      parsed.params.curr || 'IDR'
    );
    
    console.log('✅ Root cookies obtained:');
    console.log('  GUID:', rootCookies.GUID);
    console.log('  TransactionId:', rootCookies.transactionId);
    console.log('  PageId:', rootCookies.pageId);

    // Ensure all cookies from rootCookies are set in the session
    console.log('\n🔧 Setting all root cookies in session...');
    if (rootCookies.GUID) session.setCookie('GUID', rootCookies.GUID);
    if (rootCookies.UBT_VID) session.setCookie('UBT_VID', rootCookies.UBT_VID);
    if (rootCookies.transactionId) session.setCookie('transactionId', rootCookies.transactionId);
    if (rootCookies.pageId) session.setCookie('pageId', rootCookies.pageId);
    // Set all cookies from allCookies if available
    if (rootCookies.allCookies) {
      for (const [name, cookie] of Object.entries(rootCookies.allCookies)) {
        if (cookie && typeof cookie === 'object' && 'value' in cookie) {
          const cookieValue = (cookie as { value: string }).value;
          if (typeof cookieValue === 'string') {
            session.setCookie(name, cookieValue);
          }
        }
      }
    }
    console.log('  ✅ All root cookies set in session');
    
    // Step 3.6: Create Client ID (before visiting target URL)
    console.log('\n📥 Step 1.6: Creating Client ID...');
    try {
      const createClientIdUrl = 'https://www.trip.com/restapi/soa2/10290/createclientid?systemcode=09&createtype=3&contentType=json';
      
      const cookiesForClientId = {
        UBT_VID: rootCookies.UBT_VID || '',
        ibu_online_jump_site_result: rootCookies.ibu_online_jump_site_result || `{"site_url":[],"suggestion":["${parsed.region}-${parsed.region}","","en-${parsed.region}","en-us"]}`,
        ibu_online_home_language_match: rootCookies.ibu_online_home_language_match || `{"isShowSuggestion":false}`,
        ibulanguage: rootCookies.ibulanguage || parsed.region.toUpperCase(),
        ibulocale: rootCookies.ibulocale || `${parsed.region.toLowerCase()}_${parsed.region.toLowerCase()}`,
        cookiePricesDisplayed: rootCookies.cookiePricesDisplayed || (parsed.params.curr || 'IDR'),
        _abtest_userid: rootCookies._abtest_userid || '',
      };
      
      // Build cookie header
      const cookieHeader = Object.entries(cookiesForClientId)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      
      const clientIdResponse = await session.post(createClientIdUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
          'Sec-Ch-Ua-Platform': '"macOS"',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Ch-Ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Origin': `https://${parsed.hostname}`,
          'Sec-Fetch-Site': 'same-site',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Dest': 'empty',
          'Referer': `https://${parsed.hostname}/`,
          'Priority': 'u=4, i',
          'Cookie': cookieHeader,
        },
        data: JSON.stringify({}),
      });
      
      if (clientIdResponse.statusCode === 200) {
        try {
          const data = JSON.parse(clientIdResponse.body);
          if (data?.ClientID) {
            rootCookies.GUID = data.ClientID;
            session.setCookie('GUID', data.ClientID);
            console.log('   ✅ GUID obtained:', data.ClientID);
          }
        } catch (e) {
          console.warn('   ⚠️  Failed to parse ClientID response:', e);
        }
      }
    } catch (e: any) {
      console.warn('   ⚠️  Create Client ID failed:', e?.message ?? e);
    }
    
    // Step 4: Visit target URL to get _combined cookie
    console.log('\n📥 Step 2: Visiting target URL to get _combined cookie...');
    const targetResponse = await session.get(url, {
      headers: {
        'Referer': `https://${parsed.hostname}`,
      },
    });

    console.log(`✅ Target URL visited (Status: ${targetResponse.statusCode})`);
    console.log(`   Cookies after target visit: ${Object.keys(targetResponse.cookies).length} cookies`);
    
    // Extract x-ctx-wclient-req from target response if available
    if (targetResponse.headers['x-ctx-wclient-req']) {
      rootCookies.headers['x-ctx-wclient-req'] = targetResponse.headers['x-ctx-wclient-req'];
      console.log('   ✅ x-ctx-wclient-req extracted:', targetResponse.headers['x-ctx-wclient-req']);
    }
    
    // Extract __APP_INITIAL_STATE__ from target URL response to get city information
    console.log('\n📥 Extracting __APP_INITIAL_STATE__ from target URL response...');
    const { appInitialState, cityInfoMap } = extractAppInitialState(targetResponse.body);
    if (appInitialState) {
      rootCookies.appInitialState = appInitialState;
      rootCookies.cityInfoMap = cityInfoMap;
      console.log('   ✅ __APP_INITIAL_STATE__ extracted and city info available');
      console.log('   ✅ City info map:', Object.keys(cityInfoMap));
    } else {
      console.warn('   ⚠️  Failed to extract __APP_INITIAL_STATE__ from target URL');
    }
    
    // Wait a bit to simulate page load time (browsers don't make requests instantly)
    // This is important - the page needs time to render and JavaScript to execute
    console.log('\n⏳ Waiting 1-2 seconds to simulate initial page load...');
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.floor(Math.random() * 1000)));
    
    // Step 2.1-2.8: Reorganized flow:
    // - Step 2.1-2.4: First batch (getAppConfig, getHeaderInfo, saveLogInfo, getRouteInfo first call) - concurrent
    // - Step 2.5: getRouteInfo (second call) - sequential
    // - Step 2.6-2.8: UBT collect, FlightListSearchSSE, and clog - all concurrent
    console.log('\n📥 Step 2.1-2.8: Preparing API calls in correct sequence...');
    
    // Prepare FlightListSearchSSE payload early (needed for concurrent call with clog)
    // We'll build it here but call it concurrently with clog
    let finalCookies = rootCookies;
    let combinedCookie = generateCombinedCookie();
    finalCookies._combined = combinedCookie;
    session.setCookie('_combined', combinedCookie.encoded);

    
    console.log('[getCookiesFromHostname] Generating _bfa cookie');
    const params = new URLSearchParams(finalCookies['_combined'].raw);
    const initPageId = params.get('initPageId');
    session.setCookie('_bfa', `1.${finalCookies['UBT_VID']}.1.${Date.now()}.${Date.now()+20000}.1.1.${initPageId}`);
    
    if (targetResponse.cookies['_combined']) {
      console.log('   ✅ _combined cookie found in target response');
      let combined = targetResponse.cookies['_combined'].value;
      
      // Parse _combined to extract transactionId and pageId (may be updated)
      try {
        const decoded = decodeURIComponent(combined);
        const params = new URLSearchParams(decoded);
        let newTransactionId = params.get('transactionId');
        const newPageId = params.get('pageId') || params.get('initPageId');
        
        // Replace 'nodejs' with 'WEB' in transactionId
        if (newTransactionId && newTransactionId.includes('nodejs')) {
          newTransactionId = newTransactionId.replace(/nodejs/g, 'WEB');
          combined = combined.replace(/nodejs/g, 'WEB');
          console.log('   🔧 Replaced "nodejs" with "WEB" in _combined cookie');
        }
        
        if (newTransactionId) {
          finalCookies.transactionId = newTransactionId;
          console.log('   ✅ Updated transactionId from _combined:', newTransactionId);
        }
        if (newPageId) {
          finalCookies.pageId = newPageId;
          console.log('   ✅ Updated pageId from _combined:', newPageId);
        }
      } catch (e) {
        console.warn('   ⚠️  Failed to parse _combined:', e);
        if (combined.includes('nodejs')) {
          combined = combined.replace(/nodejs/g, 'WEB');
          console.log('   🔧 Replaced "nodejs" with "WEB" in _combined cookie (fallback)');
        }
      }
      
      finalCookies._combined = combined;
      session.setCookie('_combined', combined);
      console.log('   ✅ Final _combined cookie set in session');
    }
    
    // Ensure all cookies from target response are set in session
    console.log(`   ✅ Cookie set in session: _combined=${combinedCookie.encoded}`);
    console.log(`   ✅ Cookie set in session: _bfa=${session.getCookie('_bfa')}`);
    for (const [name, cookie] of Object.entries(targetResponse.cookies)) {
      if (cookie && typeof cookie === 'object' && 'value' in cookie) {
        session.setCookie(name, cookie.value);
        console.log(`   ✅ Cookie set in session: ${name}=${cookie.value}`);
      }
    }
    
    // Generate Flt_BatchId once (will be shared between clog and FlightListSearchSSE)
    const fltBatchId = generateUUID();
    console.log(`   🔑 Flt_BatchId (shared between clog and FlightListSearchSSE): ${fltBatchId}`);
    
    // Build payloads for FlightListSearchSSE (needed for concurrent call)
    const tokenPayload = buildTokenPayload(parsed.params, fltBatchId);
    const payload = buildFlightSearchPayload(parsed.params, finalCookies, fltBatchId);
    
    // Generate token for FlightListSearchSSE
    let flightSearchToken = '';
    try {
      flightSearchToken = signature(tokenPayload);
      console.log(`   ✅ Token generated for FlightListSearchSSE: ${flightSearchToken.substring(0, 50)}...`);
    } catch (error: any) {
      console.warn(`   ⚠️  Token generation failed: ${error?.message ?? error}`);
    }
    
    // Generate w-payload-source and x-ctx-wclient-req for FlightListSearchSSE
    const wPayloadSourcePayload = buildWPayloadSourcePayload(parsed.params, finalCookies, payload, fltBatchId);
    const wPayloadSourceString = JSON.stringify(wPayloadSourcePayload).replace(/\s+/g, '');
    const payloadMd5 = md5(wPayloadSourceString);
    const userAgent = session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    const wPayloadSource = c_sign(payloadMd5, userAgent);
    
    // const apiPath = '/restapi/soa2/27015/FlightListSearchSSE';
    const apiPath = '/restapi/soa2/27015/FlightListSearch';
    const timestampRandom = `-${Date.now()}-${Math.floor(Math.random() * 1e7)}`;
    const guid = finalCookies.GUID || '';
    const ubtVid = finalCookies.UBT_VID || '';
    const duid = '';
    const rf1 = finalCookies._RF1 || '';
    const wclientReqString = `${apiPath};POST;${timestampRandom};${guid || ""};${ubtVid || ""};${duid || ""};${rf1 || ""}`;
    const xCtxWclientReq = md5(wclientReqString);
    
    // Step 2.1-2.4: Make first batch of API calls (CONCURRENT for gRPC Session)
    // gRPC Session handles concurrent requests well
    console.log('\n📥 Step 2.1-2.4: Making first batch of API calls (concurrent for gRPC Session)...');
    
    const firstBatchCalls = await Promise.allSettled([
      // Step 2.1: getAppConfig
      session.post('https://www.trip.com/restapi/soa2/18088/getAppConfig.json', {
        headers: {
          'Content-Type': 'application/json',
          'Origin': `https://${parsed.hostname}`,
          'Referer': url,
        },
        data: JSON.stringify({}),
      }),
      
      // Step 2.2: getHeaderInfo
      session.post(`https://${parsed.hostname}/m/home/getHeaderInfo?locale=${parsed.params.locale || `en-${parsed.region.toUpperCase()}`}`, {
        headers: {
          'Content-Type': 'application/json',
          'Origin': `https://${parsed.hostname}`,
          'Referer': url,
        },
        data: JSON.stringify({}),
      }),
      
      // Step 2.3: saveLogInfo
      (async () => {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        const uuid = randomUUID().replace(/-/g, '');
        const transId = `WEB_0_mac_${timestamp}_721_${random}_2_ibuFlightOnline_${uuid}_5.5.14_1`;
        
        return session.post(`https://${parsed.hostname}/restapi/soa2/16163/saveLogInfo?transId=${transId}`, {
          headers: {
            'Content-Type': 'application/json',
            'Origin': `https://${parsed.hostname}`,
            'Referer': url,
          },
          data: JSON.stringify({}),
        });
      })(),
      
      // Step 2.4: getRouteInfo (first call)
      callGetRouteInfo(session, parsed, rootCookies, url),
    ]);
    
    // Log first batch results
    const firstBatchNames = ['getAppConfig', 'getHeaderInfo', 'saveLogInfo', 'getRouteInfo (first)'];
    firstBatchCalls.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const statusCode = result.value.statusCode;
        console.log(`   ✅ ${firstBatchNames[index]}: Success (Status: ${statusCode})`);
      } else {
        console.warn(`   ⚠️  ${firstBatchNames[index]} failed:`, result.reason?.message ?? result.reason);
      }
    });
    
    // Step 2.5: getRouteInfo (second call)
    console.log('\n📥 Step 2.5: Calling getRouteInfo (second time)...');
    try {
      const routeInfoResponse2 = await callGetRouteInfo(session, parsed, finalCookies, url);
      console.log(`✅ getRouteInfo (second call) (Status: ${routeInfoResponse2.statusCode})`);
      if (routeInfoResponse2.statusCode !== 200) {
        console.log(`   ⚠️  Response body: ${routeInfoResponse2.body.substring(0, 200)}`);
      }
    } catch (e: any) {
      console.warn('   ⚠️  getRouteInfo (second call) failed:', e?.message ?? e);
      // Don't throw - continue with flow
    }
    
    // Step 2.6-2.8: UBT collect, FlightListSearchSSE, and clog (all called concurrently)
    console.log('\n📥 Step 2.6-2.8: Calling UBT collect, FlightListSearchSSE, and clog concurrently...');
    
    // Prepare UBT payload before concurrent calls
    const sendTs = Date.now();
    const ubtPayload = buildUbtPayload(parsed.params, finalCookies, url, sendTs, parsed, flightSearchToken);
    const encodedPayload = encodePayload(ubtPayload);
    const ubtCollectBody = {
      d: `f00${sendTs}!m1Legacy!${encodedPayload}`
    };
    
    dumpSessionCookies(session);
    console.log('\n');

    
    
    // Make concurrent calls (gRPC Session handles concurrency well)
    const concurrentCalls = await Promise.allSettled([
      // Step 2.6: UBT collect
      session.post('https://ubt-sgp.trip.com/bee/collect', {
        headers: {
          'accept': '*/*',
          'accept-language': 'en-US,en;q=0.7',
          'cache-control': 'no-cache',
          'content-type': 'application/json',
          'origin': `https://${parsed.hostname}`,
          'pragma': 'no-cache',
          'priority': 'u=4, i',
          'referer': `https://${parsed.hostname}/`,
          'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Brave";v="144"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          'sec-gpc': '1',
          'user-agent': session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
        },
        data: JSON.stringify(ubtCollectBody),
      }).then(response => ({ type: 'ubtCollect', response })),
      
      // Step 2.8: FlightListSearchSSE
      (async () => {
        const apiUrl = `https://${parsed.hostname}${apiPath}`;
        
        // Build headers for FlightListSearchSSE
        const headers: Record<string, string> = {
          'accept': 'text/event-stream',
          'content-type': 'application/json; charset=utf-8',
          'cookieorigin': `https://${parsed.hostname}`,
          'currency': (parsed.params.curr || 'IDR').toUpperCase(),
          'locale': parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
          'origin': `https://${parsed.hostname}`,
          'priority': 'u=1, i',
          'referer': url,
          'w-payload-source': wPayloadSource,
          'x-ctx-country': finalCookies.headers['x-ctx-country'] || parsed.region.toUpperCase(),
          'x-ctx-currency': finalCookies.headers['x-ctx-currency'] || (parsed.params.curr || 'IDR').toUpperCase(),
          'x-ctx-locale': finalCookies.headers['x-ctx-locale'] || parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
          'x-ctx-ubt-pageid': finalCookies.headers['x-ctx-ubt-pageid'] || finalCookies.pageId || '10320667452',
          'x-ctx-ubt-pvid': finalCookies.headers['x-ctx-ubt-pvid'] || '1',
          'x-ctx-ubt-sid': finalCookies.headers['x-ctx-ubt-sid'] || '1',
          'x-ctx-ubt-vid': finalCookies.headers['x-ctx-ubt-vid'] || finalCookies.UBT_VID || '',
          'x-ctx-user-recognize': finalCookies.headers['x-ctx-user-recognize'] || 'NON_EU',
          'x-ctx-wclient-req': xCtxWclientReq,
        };
        
        // Add token header if generated successfully
        if (flightSearchToken) {
          headers['token'] = flightSearchToken;
        }

        console.log('     Calling FlightListSearchSSE with headers:', headers);
        console.log('')
        console.log('API URL:')
        console.log(apiUrl);
        console.log('')
        console.log('Payload:')
        console.log(JSON.stringify(payload));
        console.log('')
        console.log('headers:')
        console.log(headers);
        console.log('\ncookies:')
        // print all cookies in session in string format (concat)
        const cookies = session.getCookies();
        console.log(Object.entries(cookies).map(([name, cookie]) => `${name}=${cookie.value}`).join('; '));
        console.log('\n');


        const response = await session.post(apiUrl, {
          headers,
          data: JSON.stringify(payload),
        });
        return { type: 'flightSearch', response };
      })(),
    ]);
    
    // Log results
    const endpointNames = ['UBT collect', 'FlightListSearchSSE'];
    const results: { name: string; success: boolean; statusCode?: number; error?: string }[] = [];
    
    let flightSearchResponse: any = null;

    concurrentCalls.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const value = result.value as any;
        if (value && value.type === 'flightSearch') {
          flightSearchResponse = value.response;
          const statusCode = value.response.statusCode;
          console.log(`   ✅ ${endpointNames[index]}: Success (Status: ${statusCode})`);
          results.push({ name: endpointNames[index], success: true, statusCode });
        } else if (value && value.type === 'ubtCollect') {
          const statusCode = value.response.statusCode;
          console.log(`   ✅ ${endpointNames[index]}: Success (Status: ${statusCode})`);
          results.push({ name: endpointNames[index], success: true, statusCode });
        }
      } else {
        const error = result.reason?.message || result.reason || 'Unknown error';
        console.warn(`   ⚠️  ${endpointNames[index]}: Failed - ${error}`);
        results.push({ name: endpointNames[index], success: false, error: String(error) });
      }
    });
    
    // Step 2.9: Register cookies via chloro.trip.com
    console.log('\n📥 Step 2.9: Registering cookies via chloro.trip.com...');
    try {
      const userAgent = session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
      
      const { setUserAgent } = require('../c-sign');
      setUserAgent(userAgent);
      
      const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
      const chromeVersion = chromeMatch ? chromeMatch[1] : '143';
      
      let platform = '"macOS"';
      if (userAgent.includes('Windows')) {
        platform = '"Windows"';
      } else if (userAgent.includes('Linux')) {
        platform = '"Linux"';
      } else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS X')) {
        platform = '"macOS"';
      }
      
      const secChUa = `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not A(Brand";v="24"`;
      
      const additionalHeaders = {
        userAgent,
        secChUa,
        platform,
      };
      
      console.log('   🔐 Generating browser fingerprint...');
      
      const collectResp = await generate_rguid_rsg_rdg(session, parsed.region, additionalHeaders);
      
      if (collectResp && typeof collectResp.data === 'string') {
        const parts = collectResp.data.split('|').map((s: string) => s.trim());
        if (parts.length >= 4) {
          const [rguid, rf1, rsg, rdg] = parts;
          if (rguid) {
            rootCookies._RGUID = rguid;
            session.setCookie('_RGUID', rguid);
            console.log('   ✅ _RGUID obtained:', rguid);
          }
          if (rf1) {
            rootCookies._RF1 = rf1;
            session.setCookie('_RF1', rf1);
            console.log('   ✅ _RF1 obtained:', rf1);
          }
          if (rsg) {
            rootCookies._RSG = rsg;
            session.setCookie('_RSG', rsg);
            console.log('   ✅ _RSG obtained:', rsg);
          }
          if (rdg) {
            rootCookies._RDG = rdg;
            session.setCookie('_RDG', rdg);
            console.log('   ✅ _RDG obtained:', rdg);
          }
        }
      }
      console.log('✅ Cookie registration completed');
    } catch (e: any) {
      console.warn('   ⚠️  Cookie registration failed:', e?.message ?? e);
    }
    
    // Check if FlightListSearchSSE was successful
    if (!flightSearchResponse) {
      const flightSearchResult = results.find(r => r.name === 'FlightListSearchSSE');
      if (flightSearchResult && !flightSearchResult.success) {
        throw new Error(`FlightListSearchSSE failed: ${flightSearchResult.error}`);
      }
      throw new Error('FlightListSearchSSE response not found');
    }
    
    // Step 3: Process FlightListSearchSSE response
    console.log('\n✅ Flight search completed');
    console.log('  Status:', flightSearchResponse.statusCode);
    console.log('  Response length:', flightSearchResponse.body.length);
    
    // Parse response (handle SSE format)
    let flightData: any;
    let productId: string | undefined;
    try {
      let responseBody = flightSearchResponse.body;
      if (responseBody.includes('data:')) {
        const dataLines = responseBody
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.startsWith('data:') && l.length > 5);

        if (dataLines.length > 0) {
          console.log(`Found ${dataLines.length} SSE data events`);

          const lastData = dataLines[dataLines.length - 1];
          responseBody = lastData.replace(/^data:\s*/, '').trim();

          console.log('Using LAST SSE data event');
        }

        // if (dataLines.length > 0) {
        //   responseBody = dataLines[0].replace('data:', '').trim();
        // }
      }
      flightData = JSON.parse(responseBody);
      
      if (flightData?.basicInfo?.productId) {
        productId = flightData.basicInfo.productId;
        console.log('  ✅ ProductId extracted:', productId);
      }
      
      // Call risk endpoint AFTER flight search
      console.log('\n📥 Step 4: Calling risk endpoint (AFTER flight search)...');
      try {
        const uuid = randomUUID().replace(/-/g, '');
        const suffix = Math.floor(Math.random() * 100);
        const requestId = `${uuid}_${suffix}`;
        const serverName = `https://${parsed.hostname}`;
        const formData = `requestId=${requestId}&serverName=${encodeURIComponent(serverName)}`;
        
        const riskResponse = await session.post('https://riskpoc.trip.com/h', {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': `https://${parsed.hostname}`,
            'Referer': url,
          },
          data: formData,
        });
        console.log(`✅ Risk endpoint called (Status: ${riskResponse.statusCode})`);
      } catch (e: any) {
        console.warn('   ⚠️  Risk endpoint call failed:', e?.message ?? e);
      }
    } catch (e) {
      flightData = flightSearchResponse.body;
    }
    
    return res.json({
      success: true,
      statusCode: flightSearchResponse.statusCode,
      data: flightData,
      productId: productId,
      cookies: {
        guid: finalCookies.GUID,
        transactionId: finalCookies.transactionId,
        pageId: finalCookies.pageId,
      },
      metadata: {
        hostname: parsed.hostname,
        region: parsed.region,
        params: parsed.params,
        sessionType: 'gRPC',
      },
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * POST /api/flight-search-sort
 * 
 * Request body:
 * {
 *   "url": "https://id.trip.com/flights/showfarefirst?...",
 *   "productId": "SGP_SGP-ALI_PIDReduce-...", // From initial FlightListSearchSSE response
 *   "sortType": "Price", // Optional: "Direct", "Price", "Duration", etc.
 *   "direction": true, // Optional: true for ascending, false for descending
 *   "proxy": "http://user:pass@proxy:8080" // optional
 * }
 */
app.post('/api/flight-search-sort', async (req: Request, res: Response) => {
  try {
    const { url, productId, sortType = 'Price', direction = true, proxy } = req.body;
    
    if (!url) {
      return res.status(400).json({
        error: 'Missing required field: url',
      });
    }
    
    if (!productId) {
      return res.status(400).json({
        error: 'Missing required field: productId (get it from initial FlightListSearchSSE response)',
      });
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 New Flight Search Sort Request');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('URL:', url);
    console.log('ProductId:', productId);
    console.log('SortType:', sortType);
    console.log('Direction:', direction);
    console.log('Proxy:', proxy || 'none');
    
    // Step 1: Parse URL
    const parsed = parseTripUrl(url);
    
    // Step 2: Create session
    const session = new CycleTLSSession({
      proxy: proxy || process.env.PROXY_URL,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    });
    
    // Step 3: Get cookies from hostname root
    const rootCookies = await getCookiesFromHostname(
      session,
      parsed.hostname,
      parsed.region,
      parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
      parsed.params.curr || 'IDR'
    );
    
    // Step 4: Build payloads
    // IMPORTANT: Token generation uses simplified format, actual request uses full format
    console.log('\n📦 Building flight search payloads...');
    
    // Generate Flt_BatchId once and reuse it across all payloads
    const fltBatchId = generateUUID();
    console.log(`   🔑 Flt_BatchId (shared across all payloads): ${fltBatchId}`);
    
    // Build simplified payload for token generation
    const tokenPayload = buildTokenPayload(parsed.params, fltBatchId, productId);
    const tokenPayloadString = JSON.stringify(tokenPayload, null, 2);
    
    // Build full payload for actual HTTP request
    const payload = buildFlightSearchPayload(parsed.params, rootCookies, fltBatchId, productId);
    
    // Update sort info in both payloads
    payload.sortInfoType = {
      direction: direction,
      orderBy: sortType,
      topList: [],
    };
    tokenPayload.sortInfoType = {
      direction: direction,
      orderBy: sortType,
      topList: [],
    };
    
    console.log('   📋 Token payload (object):', tokenPayloadString.length);
    
    // Step 5: Make flight search API request (FlightListSearch, not SSE)
    console.log('\n📤 Making sorted flight search API request...');
    const apiPath = '/restapi/soa2/27015/FlightListSearch';
    const apiUrl = `https://${parsed.hostname}${apiPath}`;
    
    // Generate token: signature(payload) returns "1001-common-xxx"
    // Pass the payload object directly (not stringified)
    console.log('   🔐 Generating token header using signature function...');
    let token = '';
    try {
      token = signature(tokenPayload);
      console.log(`   ✅ Token generated (from object payload): ${token.substring(0, 50)}...`);
      console.log(`   ✅ Token length: ${token.length}`);
    } catch (error: any) {
      console.warn(`   ⚠️  Token generation failed: ${error?.message ?? error}`);
      console.warn('   ⚠️  Continuing without token header (may cause issues)');
    }
    
    // Generate w-payload-source: MD5 hash of special payload format, then pass to c_sign
    console.log('   🔐 Generating w-payload-source...');
    const wPayloadSourcePayload = buildWPayloadSourcePayload(parsed.params, rootCookies, payload, fltBatchId);
    // Use compact JSON (no spaces) for MD5, matching browser behavior
    const wPayloadSourceString = JSON.stringify(wPayloadSourcePayload).replace(/\s+/g, '');
    const payloadMd5 = md5(wPayloadSourceString);
    // Get user agent from session and pass it to c_sign
    const userAgent = session.getUserAgent() || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    const wPayloadSource = c_sign(payloadMd5, userAgent);
    console.log(`   ✅ w-payload-source generated (length: ${wPayloadSource.length})`);
    console.log(`   📋 w-payload-source payload length: ${wPayloadSourceString.length} chars`);
    
    // Generate x-ctx-wclient-req: MD5 of url;POST;timestamp-random;guid;ubtVid;duid;rf1
    // Format matches test.ts: md5(`${url};POST;${timestampRandom};${guid || ""};${ubtVid || ""};${duid || ""};${rf1 || ""}`)
    console.log('   🔐 Generating x-ctx-wclient-req...');
    const timestampRandom = `-${Date.now()}-${Math.floor(Math.random() * 1e7)}`;
    const guid = rootCookies.GUID || '';
    const ubtVid = rootCookies.UBT_VID || '';
    const duid = ''; // Usually empty
    const rf1 = rootCookies._RF1 || '';
    const wclientReqString = `${apiPath};POST;${timestampRandom};${guid || ""};${ubtVid || ""};${duid || ""};${rf1 || ""}`;
    const xCtxWclientReq = md5(wclientReqString);
    console.log(`   ✅ x-ctx-wclient-req generated: ${xCtxWclientReq}`);
    
    // Build headers object
    const headers: Record<string, string> = {
      'accept': 'application/json',
      'content-type': 'application/json; charset=utf-8',
      'cookieorigin': `https://${parsed.hostname}`,
      'currency': (parsed.params.curr || 'IDR').toUpperCase(),
      'locale': parsed.params.locale || `en-${parsed.region.toUpperCase()}`,
      'origin': `https://${parsed.hostname}`,
      'priority': 'u=1, i',
      'referer': url,
      'w-payload-source': wPayloadSource, // Generated using c_sign(MD5(payload))
      'x-ctx-country': rootCookies.headers['x-ctx-country'],
      'x-ctx-currency': rootCookies.headers['x-ctx-currency'],
      'x-ctx-locale': rootCookies.headers['x-ctx-locale'],
      'x-ctx-ubt-pageid': rootCookies.headers['x-ctx-ubt-pageid'],
      'x-ctx-ubt-pvid': rootCookies.headers['x-ctx-ubt-pvid'],
      'x-ctx-ubt-sid': rootCookies.headers['x-ctx-ubt-sid'],
      'x-ctx-ubt-vid': rootCookies.headers['x-ctx-ubt-vid'],
      'x-ctx-user-recognize': rootCookies.headers['x-ctx-user-recognize'],
      'x-ctx-wclient-req': xCtxWclientReq, // Generated using MD5(url;POST;timestamp;guid;ubtVid;duid;rf1)
    };
    
    // Add token header if generated successfully
    if (token) {
      headers['token'] = token;
      console.log('   ✅ Token header added to request');
    } else {
      console.log('   ⚠️  No token header (signature generation failed)');
    }
    
    const searchResponse = await session.post(apiUrl, {
      headers,
      json: payload,
    });
    
    console.log('✅ Sorted flight search completed');
    console.log('  Status:', searchResponse.statusCode);
    
    // Parse response
    let flightData;
    try {
      flightData = JSON.parse(searchResponse.body);
    } catch (e) {
      flightData = searchResponse.body;
    }
    
    return res.json({
      success: true,
      statusCode: searchResponse.statusCode,
      data: flightData,
      productId: productId,
      sortType: sortType,
      direction: direction,
      metadata: {
        hostname: parsed.hostname,
        region: parsed.region,
        params: parsed.params,
      },
    });
    
  } catch (error: any) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * GET /api/health
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'trip-flight-scraper',
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     Trip.com Flight Scraping API Server                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   POST /api/flight-search      - Initial flight search (returns productId)`);
  console.log(`   POST /api/flight-search-sort - Sorted/filtered search (requires productId)`);
  console.log(`   GET  /api/health            - Health check`);
  console.log(`\n💡 Example request:`);
  console.log(`   curl -X POST http://localhost:${PORT}/api/flight-search \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"url": "https://id.trip.com/flights/showfarefirst?dcity=han&acity=bkk&ddate=2026-01-22&rdate=2026-01-27&triptype=rt&class=y&locale=en-ID&curr=VND"}'`);
  console.log('\n');
});

export default app;
