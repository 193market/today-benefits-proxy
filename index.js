/**
 * 오늘의 혜택 — 프록시 서버 (Render.com 배포용)
 * 역할:
 *  1. 생필품가격 API (HTTP 전용) → HTTPS로 중계
 *  2. 실거래가 API (IP 차단 우회) 서버 측 호출
 *  3. 보금자리론·전세대출 금리 API
 *  4. 보조금24 통계 API
 * 업데이트: 2026-03-22 — price.go.kr User-Agent 추가
 */
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { parseStringPromise } = require('xml2js');

const app = express();
const PORT = process.env.PORT || 3000;

const PRICE_BASE = 'http://openapi.price.go.kr/openApiImpl/ProductPriceInfoService';
const SERVICE_KEY = process.env.SERVICE_KEY ||
  'xsG0WMPtWS1mUarzKPkfhWjUUvyKIqfBF34M5NHtM7PcQykB9r9bfji96dhrfkH0peDerZ6iDfVqwSoYS9SEcQ==';
const PRICE_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; TodayBenefits-Proxy/2.0)' };

app.use(cors());
app.use(express.json());

// 응답 캐시 (메모리, 1시간)
const cache = new Map();
function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > 60 * 60 * 1000) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// XML → JSON 변환 헬퍼
async function xmlToJson(xmlData) {
  const result = await parseStringPromise(xmlData, { explicitArray: false, ignoreAttrs: true });
  return result;
}

// 상품 목록 조회
app.get('/price/products', async (req, res) => {
  const cacheKey = 'products';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(`${PRICE_BASE}/getProductInfoSvc.do`, {
      params: { serviceKey: SERVICE_KEY, type: 'xml', pageNo: 1, numOfRows: 500 },
      headers: PRICE_HEADERS,
      timeout: 30000,
    });
    const json = await xmlToJson(response.data);
    // 실제 응답 구조: response.result.item
    const items = json?.response?.result?.item || json?.response?.result?.item || json?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];
    setCache(cacheKey, list);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 판매점 목록 조회
app.get('/price/stores', async (req, res) => {
  const cacheKey = 'stores';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(`${PRICE_BASE}/getStoreInfoSvc.do`, {
      params: { serviceKey: SERVICE_KEY, type: 'xml', pageNo: 1, numOfRows: 1000 },
      headers: PRICE_HEADERS,
      timeout: 30000,
    });
    const json = await xmlToJson(response.data);
    const items = json?.response?.result?.item || json?.response?.result?.item || json?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];
    setCache(cacheKey, list);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 특정 상품 가격 조회 (판매점별)
app.get('/price/product-prices', async (req, res) => {
  const { goodId, goodInspectDay } = req.query;
  if (!goodId || !goodInspectDay) {
    return res.status(400).json({ error: 'goodId, goodInspectDay 필수' });
  }
  const cacheKey = `product-${goodId}-${goodInspectDay}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(`${PRICE_BASE}/getProductPriceInfoSvc.do`, {
      params: { serviceKey: SERVICE_KEY, type: 'xml', goodId, goodInspectDay, pageNo: 1, numOfRows: 200 },
      headers: PRICE_HEADERS,
      timeout: 30000,
    });
    const json = await xmlToJson(response.data);
    const items = json?.response?.result?.item || json?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];
    setCache(cacheKey, list);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 특정 판매점 가격 조회
app.get('/price/store-prices', async (req, res) => {
  const { entpId, goodInspectDay } = req.query;
  if (!entpId || !goodInspectDay) {
    return res.status(400).json({ error: 'entpId, goodInspectDay 필수' });
  }
  const cacheKey = `store-${entpId}-${goodInspectDay}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(`${PRICE_BASE}/getProductPriceInfoSvc.do`, {
      params: { serviceKey: SERVICE_KEY, type: 'xml', entpId, goodInspectDay, pageNo: 1, numOfRows: 200 },
      headers: PRICE_HEADERS,
      timeout: 30000,
    });
    const json = await xmlToJson(response.data);
    const items = json?.response?.result?.item || json?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];
    setCache(cacheKey, list);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 할인·1+1 상품 (최근 금요일 기준 전체 조회 후 필터)
app.get('/price/discounts', async (req, res) => {
  const { goodInspectDay } = req.query;
  if (!goodInspectDay) return res.status(400).json({ error: 'goodInspectDay 필수' });

  const cacheKey = `discounts-${goodInspectDay}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    // 인기 상품 ID 샘플 (신라면=1, 삼겹살=2 등 — 실제 ID는 /price/products 에서 확인)
    // 전체 조회는 너무 크므로 대표 판매점 몇 개만 조회
    const response = await axios.get(`${PRICE_BASE}/getProductPriceInfoSvc.do`, {
      params: {
        serviceKey: SERVICE_KEY, type: 'xml',
        goodInspectDay, pageNo: 1, numOfRows: 500,
      },
      headers: PRICE_HEADERS,
      timeout: 15000,
    });
    const json = await xmlToJson(response.data);
    const items = json?.response?.result?.item || json?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];
    // 할인 또는 1+1 필터
    const discounts = list.filter(i => i.goodDcYn === 'Y' || i.plusoneYn === 'Y');
    setCache(cacheKey, discounts);
    res.json(discounts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// 아파트 실거래가 (국토교통부) — IP 차단 우회
// ══════════════════════════════════════════════════════

// 시도별 대표 시군구 코드 목록 (법정동코드 앞 5자리)
const REGION_DISTRICTS = {
  서울: [
    { name: '강남구', code: '11680' }, { name: '서초구', code: '11650' },
    { name: '송파구', code: '11710' }, { name: '강동구', code: '11740' },
    { name: '마포구', code: '11440' }, { name: '용산구', code: '11170' },
    { name: '중구', code: '11140' },   { name: '종로구', code: '11110' },
    { name: '강서구', code: '11500' }, { name: '노원구', code: '11350' },
  ],
  경기: [
    { name: '수원시', code: '41111' }, { name: '성남시', code: '41131' },
    { name: '용인시', code: '41461' }, { name: '안양시', code: '41171' },
    { name: '고양시', code: '41281' }, { name: '화성시', code: '41590' },
    { name: '남양주시', code: '41360' }, { name: '부천시', code: '41190' },
  ],
  부산: [
    { name: '해운대구', code: '26350' }, { name: '수영구', code: '26380' },
    { name: '남구', code: '26290' }, { name: '연제구', code: '26370' },
  ],
  대구: [
    { name: '수성구', code: '27290' }, { name: '달서구', code: '27290' },
  ],
  인천: [
    { name: '연수구', code: '28185' }, { name: '남동구', code: '28177' },
  ],
};

function getCurrentYM() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 아파트 매매 실거래가
app.get('/realestate/trade', async (req, res) => {
  const { region = '서울', district, ym } = req.query;
  const DEAL_YMD = ym || getCurrentYM();
  const districts = REGION_DISTRICTS[region] || REGION_DISTRICTS['서울'];
  const targetDistrict = district
    ? districts.find(d => d.name === district) || districts[0]
    : districts[0];

  const cacheKey = `trade-${targetDistrict.code}-${DEAL_YMD}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(
      'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
      {
        params: { serviceKey: SERVICE_KEY, LAWD_CD: targetDistrict.code, DEAL_YMD, numOfRows: 50, pageNo: 1 },
        timeout: 15000,
      }
    );
    const raw = response.data;
    let list;
    if (typeof raw === 'string' && raw.trim().startsWith('<')) {
      // XML 응답
      const json = await parseStringPromise(raw, { explicitArray: false, ignoreAttrs: true });
      const items = json?.response?.body?.items?.item || [];
      list = Array.isArray(items) ? items : (items ? [items] : []);
    } else {
      // JSON 응답
      const items = raw?.response?.body?.items?.item || raw?.items || raw || [];
      list = Array.isArray(items) ? items : (items ? [items] : []);
    }
    setCache(cacheKey, { district: targetDistrict, districts, list });
    res.json({ district: targetDistrict, districts, list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 아파트 전월세 실거래가
app.get('/realestate/rent', async (req, res) => {
  const { region = '서울', district, ym } = req.query;
  const DEAL_YMD = ym || getCurrentYM();
  const districts = REGION_DISTRICTS[region] || REGION_DISTRICTS['서울'];
  const targetDistrict = district
    ? districts.find(d => d.name === district) || districts[0]
    : districts[0];

  const cacheKey = `rent-${targetDistrict.code}-${DEAL_YMD}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(
      'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent',
      {
        params: { serviceKey: SERVICE_KEY, LAWD_CD: targetDistrict.code, DEAL_YMD, numOfRows: 50, pageNo: 1 },
        timeout: 15000,
      }
    );
    const raw = response.data;
    let list;
    if (typeof raw === 'string' && raw.trim().startsWith('<')) {
      const json = await parseStringPromise(raw, { explicitArray: false, ignoreAttrs: true });
      const items = json?.response?.body?.items?.item || [];
      list = Array.isArray(items) ? items : (items ? [items] : []);
    } else {
      const items = raw?.response?.body?.items?.item || raw?.items || raw || [];
      list = Array.isArray(items) ? items : (items ? [items] : []);
    }
    setCache(cacheKey, { district: targetDistrict, districts, list });
    res.json({ district: targetDistrict, districts, list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 지역별 시군구 목록 조회
app.get('/realestate/districts', (req, res) => {
  const { region = '서울' } = req.query;
  res.json(REGION_DISTRICTS[region] || REGION_DISTRICTS['서울']);
});

// ══════════════════════════════════════════════════════
// 주택담보대출 상품 비교 (FSS 금융감독원)
// 보금자리론 HF API 차단 → FSS 주담대로 대체
// ══════════════════════════════════════════════════════
const FSS_KEY = '7cdf933c0e7a5e910842eae90b292d9b';
const FSS_BASE = 'https://finlife.fss.or.kr/finlifeapi';

app.get('/housing/bogumjari', async (req, res) => {
  const cacheKey = 'mortgage';
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(`${FSS_BASE}/mortgageLoanProductsSearch.json`, {
      params: { auth: FSS_KEY, topFinGrpNo: '020000', pageNo: 1 },
      timeout: 12000,
    });
    const list = response.data?.result?.baseList || [];
    setCache(cacheKey, list);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════
// 서민금융진흥원 대출 취급기관·상품 정보 #41
// (햇살론15·햇살론유스·근로자햇살론·새희망홀씨 등)
// ══════════════════════════════════════════════════════
app.get('/finance/micro-loan', async (req, res) => {
  const { pageNo = 1, numOfRows = 30 } = req.query;
  const cacheKey = `micro-loan-${pageNo}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const response = await axios.get(
      'https://apis.data.go.kr/B553701/LoanProductHandlingAgencyInfoService/getLoanProductHandlingAgencyInfo',
      {
        params: { serviceKey: SERVICE_KEY, pageNo, numOfRows },
        timeout: 10000,
      }
    );
    const json = await parseStringPromise(response.data, { explicitArray: false, ignoreAttrs: true });
    const items = json?.response?.body?.items?.item || [];
    const list = Array.isArray(items) ? items : [items];
    setCache(cacheKey, list);
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '2.1', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`프록시 서버 실행 중: http://localhost:${PORT}`));
