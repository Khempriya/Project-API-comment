/**
 * ตัวเรียก HTTP แบบทนต่อความผิดพลาด (timeout + retry + exponential backoff)
 * ใช้ร่วมกันโดย gym-service (เรียก Open-Meteo) และ subscription-service (เรียกข้ามบริการ)
 *
 *  1) Timeout  : ทุกครั้งที่เรียกจะมีเวลารอสูงสุด (AbortController)
 *  2) Retry    : network error / timeout / HTTP 5xx / 429 -> ลองใหม่อัตโนมัติ
 *                ด้วย exponential backoff (baseDelay * 2^n)
 *                HTTP 4xx อื่น ๆ (เช่น 404) ไม่ retry เพราะลองซ้ำก็ไม่หาย
 *  3) ถ้าล้มเหลวหลัง retry ครบ จะ throw ExternalApiError (มี .status ถ้าเป็น HTTP error)
 *     ผู้เรียกเป็นคนตัดสินใจ fallback เอง เช่น gym-service/weather.js คืนค่า fallback,
 *     subscription-service ตอบ 503 เมื่อบริการปลายทางไม่พร้อม
 */

// ============================================================================
// 📘 คำอธิบายเพิ่มเติม (ไฟล์: src/shared/external-api.js)
// ============================================================================
// ไฟล์นี้ไม่ได้ถูกเรียกจากหน้าเว็บโดยตรง แต่ถูกเรียก "ภายใน Back end" ใน 2 เส้นทาง:
//
//  (ก) FLOW-03 ปุ่ม "ดูสภาพอากาศ" (แท็บสาขา)
//      frontend showWeather() -> Gateway -> gym-service GET /gyms/:id/weather
//        -> gym-service/weather.js getWeatherForLocation()
//        -> fetchJsonWithRetry(url_ของ_Open-Meteo)      <-- ไฟล์นี้
//        -> อินเทอร์เน็ตจริง https://api.open-meteo.com/v1/forecast
//      ตั้งค่าด้วย .env: EXTERNAL_API_TIMEOUT_MS / EXTERNAL_API_MAX_RETRIES / EXTERNAL_API_BASE_DELAY_MS
//
//  (ข) FLOW-12 ปุ่ม "บันทึกการสมัคร" และ FLOW-13 ปุ่ม "บันทึกการแก้ไข" (แท็บการสมัครแพ็กเกจ)
//      subscription-service > ensureExists()
//        -> fetchJsonWithRetry("http://localhost:4002/members/:id")  (ไปถาม member-service)
//        -> fetchJsonWithRetry("http://localhost:4001/gyms/:id")     (ไปถาม gym-service)
//      ตั้งค่าด้วย .env: SERVICE_CALL_TIMEOUT_MS / SERVICE_CALL_MAX_RETRIES / SERVICE_CALL_BASE_DELAY_MS
//      (subscription-service ส่ง options เข้ามา override ค่า EXTERNAL_API_* ที่เป็นค่าตั้งต้นของไฟล์นี้)
// ============================================================================

function getConfig() {
  // อ่าน env ตอนเรียกใช้ (ไม่ใช่ตอน require) เพื่อไม่ให้ขึ้นกับลำดับการโหลด dotenv
  // ค่าตั้งต้น (ถ้าผู้เรียกไม่ส่ง options มา): รอ 3 วินาที / ลองซ้ำ 2 ครั้ง / หน่วงเริ่มต้น 500ms
  return {
    timeoutMs: Number(process.env.EXTERNAL_API_TIMEOUT_MS || 3000),
    // ใช้ ?? (ไม่ใช่ ||) เพราะ MAX_RETRIES=0 เป็นค่าที่ถูกต้อง (ไม่ retry) ต้องไม่ถูกแทนด้วย 2
    maxRetries: Number(process.env.EXTERNAL_API_MAX_RETRIES ?? 2),
    baseDelayMs: Number(process.env.EXTERNAL_API_BASE_DELAY_MS || 500),
    // fetch ในตัวของ Node 18+ (เก็บเป็นตัวแปรเพื่อให้เทสต์ปลอม fetch ได้)
    fetchImpl: globalThis.fetch,
  };
}

// error ชนิดพิเศษของไฟล์นี้: บอกได้ว่า "ควร retry ไหม" (retryable) และ HTTP status (ถ้ามี)
class ExternalApiError extends Error {
  constructor(message, { retryable = false, status = null } = {}) {
    super(message);
    this.name = "ExternalApiError";
    this.retryable = retryable; // true = ลองใหม่ได้ (timeout/network/5xx/429)
    this.status = status; // เช่น 404 -> subscription-service ใช้แยก "ไม่พบสมาชิก/สาขา" ออกจาก "บริการล่ม"
  }
}

// หน่วงเวลา (ใช้ระหว่าง retry)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** เรียก 1 ครั้ง + timeout; โยน ExternalApiError พร้อมบอกว่า retry ได้หรือไม่ */
async function requestOnce(url, { timeoutMs, fetchImpl }) {
  // AbortController = "สวิตช์ยกเลิก" request: ถ้าเลยเวลา timeoutMs จะสั่ง abort()
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    // HTTP status ไม่ใช่ 2xx
    if (!response.ok) {
      throw new ExternalApiError(`HTTP ${response.status}`, {
        status: response.status,
        // 5xx (ฝั่งเซิร์ฟเวอร์พัง) และ 429 (ถูกจำกัดอัตรา) ลองใหม่ได้
        // 4xx อื่น เช่น 404 ลองกี่ครั้งก็ได้ผลเดิม -> ไม่ retry
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    // อ่าน body ภายใต้ timer เดิม ถ้า server ส่งช้าระหว่างอ่าน body ก็ถือว่า timeout
    return await response.json();
  } catch (err) {
    // error ที่เราโยนเองด้านบน (HTTP ไม่ ok) ส่งต่อตามเดิม
    if (err instanceof ExternalApiError) throw err;
    // controller.abort() ทำให้ fetch โยน AbortError = เกินเวลา -> ลองใหม่ได้
    if (err.name === "AbortError") {
      throw new ExternalApiError(`timeout หลังรอ ${timeoutMs}ms`, {
        retryable: true,
      });
    }

    // body ไม่ใช่ JSON (response.json() โยน SyntaxError): ลองซ้ำก็ได้ผลเดิม จึงไม่ retry
    if (err.name === "SyntaxError" || err.message.includes("JSON")) {
      throw new ExternalApiError("ไม่ใช่ JSON", { retryable: false });
    }

    // fetch ล้มเหลวระดับ network (DNS, connection refused, reset ฯลฯ)
    // เช่น member-service ปิดอยู่ -> ECONNREFUSED -> ลองใหม่ได้ (เผื่อกำลังรีสตาร์ท)
    const reason = err.cause?.code || err.message;
    throw new ExternalApiError(`network error: ${reason}`, { retryable: true });
  } finally {
    // ไม่ว่าสำเร็จหรือพัง ต้องเคลียร์ตัวจับเวลาเสมอ (กัน timer ค้าง)
    clearTimeout(timer);
  }
}

/** เรียกพร้อม retry + exponential backoff; ถ้าล้มเหลวทุกครั้งจะ throw ExternalApiError */
// ฟังก์ชันหลักที่ไฟล์อื่นเรียกใช้ (export ท้ายไฟล์)
//   ผู้เรียก 1: gym-service/weather.js  -> fetchJsonWithRetry(url, cfg)
//   ผู้เรียก 2: subscription-service/app.js > ensureExists -> fetchJsonWithRetry(url, serviceCallOptions())
async function fetchJsonWithRetry(url, options = {}) {
  // ค่าที่ผู้เรียกส่งมา (options) ทับค่าตั้งต้น getConfig()
  const { timeoutMs, maxRetries, baseDelayMs, fetchImpl } = {
    ...getConfig(),
    ...options,
  };
  // จำนวนครั้งสูงสุด = ครั้งแรก 1 + retry อีก maxRetries (ค่าตั้งต้น 2 -> รวม 3 ครั้ง)
  const totalAttempts = maxRetries + 1;
  let lastError;
  let attempt = 0;

  while (attempt < totalAttempts) {
    attempt += 1;
    try {
      // สำเร็จ -> return JSON ทันที ออกจากลูป
      return await requestOnce(url, { timeoutMs, fetchImpl });
    } catch (err) {
      lastError = err;
      console.warn(
        `[external-api] ครั้งที่ ${attempt}/${totalAttempts} ล้มเหลว: ${err.message}`,
      );
      // เลิกลองเมื่อ: error ชนิดไม่ควร retry (เช่น 404) หรือใช้ครบทุกครั้งแล้ว
      if (!err.retryable || attempt === totalAttempts) break;
      // exponential backoff: หน่วง baseDelay x 2^(ครั้งที่ล้มเหลว-1)
      const delay = baseDelayMs * 2 ** (attempt - 1); // 500, 1000, 2000 ...
      console.warn(`[external-api] จะลองใหม่ในอีก ${delay}ms`);
      await sleep(delay);
    }
  }
  // ล้มเหลวหลังพยายามหมดแล้ว: แนบจำนวนครั้งที่ลองต่อท้ายข้อความ แล้วโยน error สุดท้ายออกไป
  //   - weather.js จะจับแล้วคืน WEATHER_FALLBACK
  //   - subscription-service จะจับแล้วแยกว่า 404 (ไม่พบ) หรืออย่างอื่น (503 DEPENDENCY_UNAVAILABLE)
  lastError.message = `${lastError.message} (ลองแล้ว ${attempt} ครั้ง)`;
  throw lastError;
}

module.exports = {
  fetchJsonWithRetry,
  ExternalApiError,
};
