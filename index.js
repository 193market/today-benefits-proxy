/**
 * 오늘의 혜택 — 프록시 서버 (Render.com 배포용)
 * 역할: 생필품가격 API (HTTP 전용) → HTTPS로 중계
 * Base: http://openapi.price.go.kr (HTTP만 지원)
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
      timeout: 10000,
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
      timeout: 10000,
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
      timeout: 10000,
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
      timeout: 10000,
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
        // entpId 없으면 전체 판매점 전체 상품
      },
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

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`프록시 서버 실행 중: http://localhost:${PORT}`));
