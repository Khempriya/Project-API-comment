/**
 * ดึงสภาพอากาศจาก Open-Meteo สำหรับ gym-service (ฟีเจอร์ External API จากระยะที่ 2)
 * กลไก timeout / retry อยู่ใน shared/external-api.js ส่วนไฟล์นี้ทำ fallback:
 * ถ้าดึงไม่สำเร็จหลัง retry ครบ จะคืนค่า fallback ที่ชัดเจน ไม่ throw
 */

// ============================================================================
// 📘 คำอธิบายเพิ่มเติม (ไฟล์: src/gym-service/weather.js)  — FLOW-03 "ปุ่มดูสภาพอากาศ"
// ============================================================================
// ลำดับการเดินทางของข้อมูลเมื่อกดปุ่ม "ดูสภาพอากาศ" ที่แถวสาขาในหน้าเว็บ:
//   [1] frontend/app.js   loadGyms() สร้างปุ่ม -> คลิก -> showWeather(gym, btn)
//   [2] frontend/app.js   api(`/gyms/${gym.gym_id}/weather`)  = GET /api/v1/gyms/1/weather
//   [3] gateway/app.js    createProxy("gym") ตัด /api/v1 -> GET http://localhost:4001/gyms/1/weather
//   [4] gym-service/app.js  app.get("/gyms/:id/weather"): เช็คว่าสาขามีจริงใน MySQL
//   [5] ไฟล์นี้             getWeatherForLocation()  -> สร้าง URL ของ Open-Meteo
//   [6] shared/external-api.js  fetchJsonWithRetry()  -> ยิงอินเทอร์เน็ต (timeout/retry)
//   [7] กลับมาที่ไฟล์นี้      parseWeather() แปลงข้อมูล / หรือ WEATHER_FALLBACK ถ้าล้มเหลว
//   [8] ย้อนกลับ [4] -> [3] -> [2] -> showWeather() เอาไปแสดงใน <div id="weather-box">
// ============================================================================
const { fetchJsonWithRetry, ExternalApiError } = require("../shared/external-api");

function getWeatherConfig() {
  // อ่าน env ตอนเรียกใช้ (ไม่ใช่ตอน require) เพื่อไม่ให้ขึ้นกับลำดับการโหลด dotenv
  // ค่ามาจาก .env: WEATHER_API_URL, WEATHER_LAT, WEATHER_LON
  // ค่าสำรองคือพิกัดบางแสน (13.3611, 100.9847) ซึ่งตรงกับสาขา "Fit Plus Bangsaen"
  // ⚠ ข้อสังเกต: พิกัดนี้เป็น "ค่าเดียวของทั้งระบบ" ไม่ได้แยกตามสาขา (ตาราง gyms ไม่มีคอลัมน์ lat/lon)
  //   ดังนั้นกดดูอากาศของสาขาไหนก็ได้สภาพอากาศของบางแสนเหมือนกัน
  return {
    weatherApiUrl:
      process.env.WEATHER_API_URL || "https://api.open-meteo.com/v1/forecast",
    latitude: Number(process.env.WEATHER_LAT || 13.3611),
    longitude: Number(process.env.WEATHER_LON || 100.9847),
  };
}

/** แปลง WMO weather code เป็นข้อความไทย */
// Open-Meteo ส่งสภาพอากาศเป็นรหัสตัวเลขมาตรฐาน WMO -> แปลงเป็นคำไทยที่โชว์ใน weather-box
// (ฝั่งหน้าเว็บ showWeather() อ่านค่า w.condition ที่ได้จากฟังก์ชันนี้)
function describeWeatherCode(code) {
  if (code === 0) return "ท้องฟ้าแจ่มใส";
  if (code >= 1 && code <= 3) return "มีเมฆบางส่วนถึงมีเมฆมาก";
  if (code === 45 || code === 48) return "หมอก";
  if (code >= 51 && code <= 57) return "ฝนปรอย";
  if (code >= 61 && code <= 67) return "ฝนตก";
  if (code >= 80 && code <= 82) return "ฝนตกเป็นช่วง ๆ";
  if (code >= 95 && code <= 99) return "พายุฟ้าคะนอง";
  return "ไม่ทราบสภาพอากาศ";
}

// แปลง JSON ดิบของ Open-Meteo -> รูปแบบของเราที่ frontend รู้จัก
// ชื่อฟิลด์ที่ได้ตรงกับที่ frontend/app.js > showWeather() ใช้อ่าน:
//   available, temperature_c, humidity_percent, precipitation_mm, wind_speed_kmh, condition, observed_at
function parseWeather(json) {
  const c = json && json.current; // Open-Meteo ใส่ค่าปัจจุบันไว้ใน key "current"
  // ถ้าโครงสร้างผิด (ไม่มี current หรืออุณหภูมิไม่ใช่ตัวเลข) -> โยน error ชนิดไม่ retry
  // แล้ว getWeatherForLocation จะจับไปคืน fallback
  if (!c || typeof c.temperature_2m !== "number") {
    throw new ExternalApiError("โครงสร้างข้อมูลสภาพอากาศไม่ถูกต้อง", {
      retryable: false,
    });
  }
  return {
    available: true, // frontend ใช้ตัวนี้เลือกว่าจะแสดงข้อมูลอากาศ หรือข้อความ fallback
    source: "open-meteo",
    temperature_c: c.temperature_2m, // อุณหภูมิ °C
    humidity_percent: c.relative_humidity_2m ?? null, // ?? null = ถ้า API ไม่ส่งมา ให้เป็น null
    precipitation_mm: c.precipitation ?? null, // ปริมาณฝน มม.
    wind_speed_kmh: c.wind_speed_10m ?? null, // ลม กม./ชม.
    condition: describeWeatherCode(c.weather_code), // รหัส -> ข้อความไทย
    observed_at: c.time ?? null, // เวลาที่วัด
  };
}

// ค่า fallback ตอนดึงสภาพอากาศไม่ได้ (Object.freeze = ห้ามแก้ไข)
// available:false -> frontend (showWeather) จะเปลี่ยนกล่องเป็นสไตล์ "weather fallback" แล้วโชว์ w.message
const WEATHER_FALLBACK = Object.freeze({
  available: false,
  source: "fallback",
  message: "ไม่สามารถดึงข้อมูลสภาพอากาศได้ในขณะนี้ กรุณาลองใหม่อีกครั้งภายหลัง",
});

/**
 * ดึงสภาพอากาศปัจจุบัน ไม่ throw error เสมอ:
 *  - สำเร็จ  -> { available: true, ... }
 *  - ล้มเหลว -> WEATHER_FALLBACK ({ available: false, message })
 * options ใช้ override ค่า config (ใช้ตอนทดสอบ)
 */
// ผู้เรียก: gym-service/app.js > app.get("/gyms/:id/weather") (เรียกโดยไม่ส่ง options)
async function getWeatherForLocation(options = {}) {
  // รวมค่าจาก .env กับ options ที่ส่งมา (options ทับ .env)
  const cfg = { ...getWeatherConfig(), ...options };
  // สร้าง URL เช่น
  // https://api.open-meteo.com/v1/forecast?latitude=13.3611&longitude=100.9847&current=...&timezone=Asia%2FBangkok
  const url = new URL(cfg.weatherApiUrl);
  url.searchParams.set("latitude", cfg.latitude);
  url.searchParams.set("longitude", cfg.longitude);
  // current = รายการค่าปัจจุบันที่ขอ: อุณหภูมิ, ความชื้น, ฝน, รหัสอากาศ, ความเร็วลม
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
  );
  url.searchParams.set("timezone", "Asia/Bangkok"); // ให้ observed_at เป็นเวลาไทย

  try {
    // ยิงจริงผ่านตัวช่วย timeout/retry (shared/external-api.js) — cfg ถูกส่งเป็น options ด้วย
    const json = await fetchJsonWithRetry(url.toString(), cfg);
    return parseWeather(json);
  } catch (err) {
    // ล้มเหลวทุกกรณี (timeout, เน็ตหลุด, 5xx, รูปแบบผิด) -> log ไว้แล้วคืน fallback แทนที่จะ throw
    // จึงทำให้ gym-service ตอบ 200 เสมอ (แต่ข้อมูลข้างใน available:false) หน้าเว็บไม่พัง
    console.error(
      `[external-api] ใช้ fallback เพราะดึงสภาพอากาศไม่สำเร็จ: ${err.message}`,
    );
    return { ...WEATHER_FALLBACK }; // คืนสำเนาใหม่ (กันผู้เรียกแก้ค่าต้นฉบับ)
  }
}

module.exports = {
  getWeatherForLocation,
  parseWeather,
  describeWeatherCode,
  WEATHER_FALLBACK,
};
