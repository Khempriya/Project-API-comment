// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/external-api.test.js
// ============================================================================
// ทดสอบโค้ดของ : src/shared/external-api.js และ src/gym-service/weather.js
// ทดสอบอะไร    : ตรวจ timeout/retry/fallback ที่อยู่หลังปุ่ม "ดูสภาพอากาศ" (FLOW-03) และการเรียกข้ามบริการของ FLOW-12/13 — mock fetch จึงไม่ยิงอินเทอร์เน็ตจริง
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ทดสอบกลไก timeout / retry / fallback ของ shared/external-api.js และ gym-service/weather.js
// ใช้เซิร์ฟเวอร์จำลองในเครื่อง (ไม่ต้องใช้อินเทอร์เน็ต) แล้วนับจำนวน request ที่ไปถึงจริง
const http = require("http");
const { fetchJsonWithRetry } = require("../shared/external-api");
const {
  getWeatherForLocation,
  parseWeather,
  describeWeatherCode,
  WEATHER_FALLBACK,
} = require("../gym-service/weather");

// ค่าสำหรับทดสอบ (สั้นกว่าค่าจริงเพื่อให้รันเร็ว แต่ logic เดียวกัน)
const CFG = { timeoutMs: 150, maxRetries: 2, baseDelayMs: 10 };

const WEATHER_OK = {
  current: {
    time: "2026-10-19T10:00",
    temperature_2m: 31.2,
    relative_humidity_2m: 68,
    precipitation: 0,
    weather_code: 2,
    wind_speed_10m: 12.4,
  },
};

let server;
let base;
let hits;
let lastUrl;

beforeAll(async () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  server = http.createServer((req, res) => {
    const route = req.url.split("?")[0];
    lastUrl = req.url;
    hits[route] = (hits[route] || 0) + 1;
    const n = hits[route];
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    switch (route) {
      case "/ok":
        return json(200, WEATHER_OK);
      case "/flaky503": // ล้มสองครั้งแรก แล้วค่อยสำเร็จ
        return n <= 2 ? json(503, { error: "unavailable" }) : json(200, WEATHER_OK);
      case "/flaky429":
        return n <= 2 ? json(429, { error: "slow down" }) : json(200, WEATHER_OK);
      case "/always500":
        return json(500, { error: "boom" });
      case "/slow": // ตอบช้ากว่า timeout
        return setTimeout(() => json(200, WEATHER_OK), 600);
      case "/notfound":
        return json(404, { error: "not found" });
      case "/badjson":
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end("<html>not json</html>");
      case "/badshape":
        return json(200, { hello: "world" });
      default:
        return json(404, {});
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  hits = {};
  lastUrl = "";
  delete process.env.EXTERNAL_API_TIMEOUT_MS;
  delete process.env.EXTERNAL_API_MAX_RETRIES;
  delete process.env.EXTERNAL_API_BASE_DELAY_MS;
  delete process.env.WEATHER_API_URL;
  delete process.env.WEATHER_LAT;
  delete process.env.WEATHER_LON;
});

describe("fetchJsonWithRetry", () => {
  it("สำเร็จตั้งแต่ครั้งแรก (เรียก 1 ครั้ง)", async () => {
    const data = await fetchJsonWithRetry(`${base}/ok`, CFG);
    expect(data.current.temperature_2m).toBe(31.2);
    expect(hits["/ok"]).toBe(1);
  });

  it("retry เมื่อ 5xx แล้วสำเร็จในครั้งที่ 3", async () => {
    const data = await fetchJsonWithRetry(`${base}/flaky503`, CFG);
    expect(data.current).toBeDefined();
    expect(hits["/flaky503"]).toBe(3);
  });

  it("retry เมื่อ 429", async () => {
    await fetchJsonWithRetry(`${base}/flaky429`, CFG);
    expect(hits["/flaky429"]).toBe(3);
  });

  it("ล้มเหลวทุกครั้ง -> เรียกครบ 3 ครั้ง (retry 2) แล้ว throw พร้อม status", async () => {
    await expect(fetchJsonWithRetry(`${base}/always500`, CFG)).rejects.toMatchObject({
      status: 500,
      retryable: true,
    });
    expect(hits["/always500"]).toBe(3);
  });

  it("ข้อความ error บอกจำนวนครั้งที่ลอง", async () => {
    await expect(fetchJsonWithRetry(`${base}/always500`, CFG)).rejects.toThrow("ลองแล้ว 3 ครั้ง");
  });

  it("ตอบช้ากว่า timeout -> timeout ทุกครั้งแล้ว throw", async () => {
    await expect(fetchJsonWithRetry(`${base}/slow`, CFG)).rejects.toThrow("timeout หลังรอ 150ms");
    expect(hits["/slow"]).toBe(3);
  });

  it("404 ไม่ retry (เรียก 1 ครั้ง) และมี status 404", async () => {
    await expect(fetchJsonWithRetry(`${base}/notfound`, CFG)).rejects.toMatchObject({
      status: 404,
      retryable: false,
    });
    expect(hits["/notfound"]).toBe(1);
  });

  it("ตอบ 200 แต่ไม่ใช่ JSON -> ไม่ retry", async () => {
    await expect(fetchJsonWithRetry(`${base}/badjson`, CFG)).rejects.toThrow("ไม่ใช่ JSON");
    expect(hits["/badjson"]).toBe(1);
  });

  it("เซิร์ฟเวอร์ปลายทางล่ม (connection refused) -> network error แล้ว retry ครบ", async () => {
    const closed = http.createServer();
    await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = closed.address().port;
    await new Promise((resolve) => closed.close(resolve));
    await expect(fetchJsonWithRetry(`http://127.0.0.1:${port}/x`, CFG)).rejects.toThrow("network error");
  });

  it("maxRetries = 0 -> เรียกแค่ครั้งเดียว", async () => {
    await expect(
      fetchJsonWithRetry(`${base}/always500`, { ...CFG, maxRetries: 0 }),
    ).rejects.toMatchObject({ status: 500 });
    expect(hits["/always500"]).toBe(1);
  });

  it("ไม่ส่ง options -> อ่านค่าจาก .env (EXTERNAL_API_*)", async () => {
    process.env.EXTERNAL_API_TIMEOUT_MS = "150";
    process.env.EXTERNAL_API_MAX_RETRIES = "1";
    process.env.EXTERNAL_API_BASE_DELAY_MS = "10";
    await expect(fetchJsonWithRetry(`${base}/always500`)).rejects.toMatchObject({ status: 500 });
    expect(hits["/always500"]).toBe(2);
  });
});

describe("getWeatherForLocation", () => {
  const weatherCfg = (route) => ({ ...CFG, weatherApiUrl: `${base}${route}` });

  it("สำเร็จ -> available true พร้อมข้อมูลที่แปลงแล้ว", async () => {
    const w = await getWeatherForLocation(weatherCfg("/ok"));
    expect(w).toEqual({
      available: true,
      source: "open-meteo",
      temperature_c: 31.2,
      humidity_percent: 68,
      precipitation_mm: 0,
      wind_speed_kmh: 12.4,
      condition: "มีเมฆบางส่วนถึงมีเมฆมาก",
      observed_at: "2026-10-19T10:00",
    });
  });

  it("ส่งพิกัดและพารามิเตอร์ที่ถูกต้องไปยัง API", async () => {
    await getWeatherForLocation({ ...weatherCfg("/ok"), latitude: 12.5, longitude: 99.5 });
    expect(lastUrl).toContain("latitude=12.5");
    expect(lastUrl).toContain("longitude=99.5");
    expect(lastUrl).toContain("timezone=Asia%2FBangkok");
  });

  it("อ่านค่าจาก .env เมื่อไม่ส่ง options (WEATHER_*)", async () => {
    process.env.WEATHER_API_URL = `${base}/ok`;
    process.env.WEATHER_LAT = "10.5";
    process.env.WEATHER_LON = "98.5";
    process.env.EXTERNAL_API_BASE_DELAY_MS = "10";
    const w = await getWeatherForLocation();
    expect(w.available).toBe(true);
    expect(lastUrl).toContain("latitude=10.5");
    expect(lastUrl).toContain("longitude=98.5");
  });

  it("API ตอบ 5xx ตลอด -> retry ครบแล้วคืน fallback (ไม่ throw)", async () => {
    const w = await getWeatherForLocation(weatherCfg("/always500"));
    expect(w).toEqual(WEATHER_FALLBACK);
    expect(hits["/always500"]).toBe(3);
  });

  it("timeout -> fallback", async () => {
    const w = await getWeatherForLocation(weatherCfg("/slow"));
    expect(w.available).toBe(false);
    expect(w.source).toBe("fallback");
  });

  it("404 -> fallback โดยไม่ retry", async () => {
    const w = await getWeatherForLocation(weatherCfg("/notfound"));
    expect(w.available).toBe(false);
    expect(hits["/notfound"]).toBe(1);
  });

  it("โครงสร้างข้อมูลผิด -> fallback โดยไม่ retry", async () => {
    const w = await getWeatherForLocation(weatherCfg("/badshape"));
    expect(w.available).toBe(false);
    expect(hits["/badshape"]).toBe(1);
  });

  it("fallback เป็นสำเนาใหม่ทุกครั้ง (แก้ไขไม่กระทบค่าคงที่)", async () => {
    const w = await getWeatherForLocation(weatherCfg("/notfound"));
    w.message = "แก้ไข";
    expect(WEATHER_FALLBACK.message).toContain("ไม่สามารถดึงข้อมูลสภาพอากาศ");
  });
});

describe("parseWeather / describeWeatherCode", () => {
  it("ฟิลด์ที่ไม่มีให้เป็น null", () => {
    const w = parseWeather({ current: { temperature_2m: 25, weather_code: 0 } });
    expect(w.humidity_percent).toBeNull();
    expect(w.precipitation_mm).toBeNull();
    expect(w.wind_speed_kmh).toBeNull();
    expect(w.observed_at).toBeNull();
    expect(w.condition).toBe("ท้องฟ้าแจ่มใส");
  });

  it("โครงสร้างผิด -> throw", () => {
    expect(() => parseWeather(null)).toThrow("โครงสร้างข้อมูลสภาพอากาศไม่ถูกต้อง");
    expect(() => parseWeather({ current: { temperature_2m: "hot" } })).toThrow();
  });

  it.each([
    [0, "ท้องฟ้าแจ่มใส"],
    [2, "มีเมฆบางส่วนถึงมีเมฆมาก"],
    [45, "หมอก"],
    [48, "หมอก"],
    [53, "ฝนปรอย"],
    [63, "ฝนตก"],
    [81, "ฝนตกเป็นช่วง ๆ"],
    [95, "พายุฟ้าคะนอง"],
    [1234, "ไม่ทราบสภาพอากาศ"],
  ])("weather_code %p -> %p", (code, text) => {
    expect(describeWeatherCode(code)).toBe(text);
  });
});
