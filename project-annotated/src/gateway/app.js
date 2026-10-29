// API Gateway (พอร์ต 3000): จุดเข้าเดียวของระบบ ทำหน้าที่
//  1) routing: /api/v1/gyms -> gym-service, /api/v1/members -> member-service,
//              /api/v1/subscriptions -> subscription-service
//  2) logging รวมศูนย์ (morgan: method, path, status, เวลาที่ใช้)
//  3) ความปลอดภัยส่วนกลาง (helmet, cors, จำกัดขนาด body)
//  4) ถ้าบริการปลายทางไม่พร้อม -> ตอบ 503 SERVICE_UNAVAILABLE ที่มีความหมาย ไม่ crash ไม่ค้าง
//  5) เสิร์ฟ Swagger UI (/api-docs) และหน้าเว็บ frontend
// รูปแบบเดียวกับ Gateway ใน Week 13 (แต่ใช้ fetch ของ Node แทน axios)

// ============================================================================
// 📘 คำอธิบายภาพรวมของไฟล์ src/gateway/app.js  — "ด่านหน้า" ที่หน้าเว็บคุยด้วยเพียงตัวเดียว
// ============================================================================
// หน้าเว็บ (frontend/app.js) ไม่เคยคุยกับ gym/member/subscription-service ตรง ๆ
// ทุกอย่างวิ่งมาที่ Gateway (พอร์ต 3000) ก่อนเสมอ แล้ว Gateway ค่อยส่งต่อ:
//
//   เบราว์เซอร์ ──► Gateway :3000 ──┬─► gym-service          :4001 ──► MySQL (ตาราง gyms)
//                                   ├─► member-service       :4002 ──► MySQL (ตาราง members)
//                                   └─► subscription-service :4003 ──► MySQL (subscriptions + JOIN)
//                                                                 └─► (เรียก member/gym-service ผ่าน HTTP ตรวจก่อนบันทึก)
//
// ตารางแปลง URL (Gateway ตัด "/api/v1" ออกแล้วส่งต่อ):
//   /api/v1/gyms...          -> http://localhost:4001/gyms...          (GYM_SERVICE_URL)
//   /api/v1/members...       -> http://localhost:4002/members...       (MEMBER_SERVICE_URL)
//   /api/v1/subscriptions... -> http://localhost:4003/subscriptions... (SUBSCRIPTION_SERVICE_URL)
//   /health                  -> Gateway ตอบเอง โดยไปถาม /health ของทั้ง 3 บริการ
//   /api-docs                -> Gateway ตอบเอง (Swagger UI จาก openapi.yaml)
//   /  และไฟล์ .css/.js      -> Gateway ตอบเอง (ไฟล์ในโฟลเดอร์ frontend/)
//
// ใครเรียกไฟล์นี้?
//   - src/gateway/server.js  require("./app") แล้ว app.listen(3000)
//   - src/tests/gateway.test.js ใช้ Supertest ยิงทดสอบ
// ============================================================================
const fs = require("fs");
const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const swaggerUi = require("swagger-ui-express");
const yaml = require("js-yaml");
// notFoundHandler = ตอบ 404 เมื่อไม่มี route ตรง / errorHandler = ตัวรับ error ทั้งหมด (ดู shared/errors.js)
const { notFoundHandler, errorHandler } = require("../shared/errors");

// ROOT = โฟลเดอร์รากของโปรเจกต์ (ขึ้นไป 2 ระดับจาก src/gateway/) ใช้หา openapi.yaml และ frontend/
const ROOT = path.join(__dirname, "..", "..");

// URL อ่านตอนเรียกใช้ เพื่อให้ปรับผ่าน .env ได้
// ตารางทะเบียนบริการปลายทาง: key ("gym"/"member"/"subscription") ถูกใช้โดย createProxy(...) ด้านล่าง
//   label = ชื่อภาษาไทยที่จะโผล่ในข้อความ error 503 (เช่น "บริการสาขาไม่พร้อมใช้งาน...")
//   url   = ฟังก์ชันที่ "อ่าน .env ตอนเรียก" (ไม่ใช่ตอนโหลดไฟล์) ค่าไม่มีให้ใช้ localhost:400x
const SERVICES = {
  gym: {
    label: "บริการสาขา",
    url: () => process.env.GYM_SERVICE_URL || "http://localhost:4001",
  },
  member: {
    label: "บริการสมาชิก",
    url: () => process.env.MEMBER_SERVICE_URL || "http://localhost:4002",
  },
  subscription: {
    label: "บริการการสมัครแพ็กเกจ",
    url: () => process.env.SUBSCRIPTION_SERVICE_URL || "http://localhost:4003",
  },
};

// ต้องมากกว่าเวลาสูงสุดที่ gym-service ใช้เรียก Open-Meteo (3 ครั้ง x 3 วินาที + backoff ~1.5 วินาที)
// ไม่อย่างนั้น Gateway จะตัดสายก่อนที่ gym-service จะตอบ fallback ของสภาพอากาศ
// (คำนวณ: ปุ่ม "ดูสภาพอากาศ" อาจใช้เวลา 3x3s + 0.5s + 1s = 10.5s จึงตั้ง Gateway ไว้ 15 วินาที)
function gatewayTimeoutMs() {
  return Number(process.env.GATEWAY_TIMEOUT_MS || 15000);
}

// สร้างก้อน JSON ของ error 503 "บริการปลายทางไม่พร้อม" (รูปแบบเดียวกับ errorHandler: { error:{code,message} })
// หน้าเว็บจะเห็นข้อความนี้ใน toast หรือในกล่องสถานะสีแดง
function unavailable(label) {
  return {
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: `${label}ไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลัง`,
    },
  };
}

// ส่งต่อ request ไปยังบริการปลายทาง โดยตัด prefix /api/v1 ออก (/api/v1/gyms/1 -> /gyms/1)
//
// ★★★ หัวใจของ Gateway: ฟังก์ชันนี้ถูกใช้กับ "ทุกปุ่มที่เรียก /api/v1/..." ของหน้าเว็บ ★★★
// createProxy("gym") คืนค่าเป็น handler (req,res) ของ Express สำหรับ 1 บริการ
// ถูกผูกกับ URL ที่ท้ายไฟล์ (app.use("/api/v1/gyms", createProxy("gym")) ฯลฯ)
function createProxy(serviceKey) {
  const service = SERVICES[serviceKey]; // หยิบข้อมูลบริการ (label + url)
  return async (req, res) => {
    // req.originalUrl = URL เต็มที่เบราว์เซอร์ส่งมา รวม query string
    //   เช่น "/api/v1/subscriptions?member_name=%E0%B8%AA..."  (จากช่องค้นหาของการสมัคร FLOW-11)
    // .replace("/api/v1","") ตัด prefix -> "/subscriptions?member_name=..."
    // ต่อท้ายด้วย URL ของบริการ -> "http://localhost:4003/subscriptions?member_name=..."
    const url = `${service.url()}${req.originalUrl.replace("/api/v1", "")}`;
    const init = {
      method: req.method, // ใช้ HTTP method เดิม GET/POST/PUT/DELETE (มาจาก api() ใน frontend)
      headers: { Accept: "application/json" },
      // ตัดสายเองถ้าบริการปลายทางไม่ตอบภายใน GATEWAY_TIMEOUT_MS (ค่าเริ่มต้น 15 วินาที)
      signal: AbortSignal.timeout(gatewayTimeoutMs()),
    };
    // ถ้ามี body (POST/PUT จากฟอร์ม) -> แปลง req.body (ที่ express.json() อ่านไว้แล้ว) กลับเป็น JSON ส่งต่อ
    // GET/HEAD/DELETE ไม่มี body จึงข้าม
    if (req.body !== undefined && !["GET", "HEAD"].includes(req.method)) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(req.body);
    }

    let upstream; // = response จากบริการปลายทาง
    let text; // = body ของ response เป็นข้อความดิบ
    try {
      // 🔗 จุดที่ Gateway "ยิง HTTP ไปหา" gym/member/subscription-service จริง ๆ
      upstream = await fetch(url, init);
      text = await upstream.text();
    } catch (err) {
      // ต่อไม่ได้ (service ล่ม) หรือรอเกินเวลา
      // -> หน้าเว็บได้ 503 + ข้อความ "บริการสาขาไม่พร้อมใช้งาน..." (ไม่ค้าง ไม่ crash)
      return res.status(503).json(unavailable(service.label));
    }

    try {
      // ส่ง status และ body ของบริการปลายทางกลับไปตามเดิม (รวม 400/404/409 ฯลฯ)
      // จึงทำให้ error เช่น 409 DUPLICATE_EMAIL จาก member-service เดินทางถึง frontend ครบถ้วน
      return res.status(upstream.status).json(JSON.parse(text));
    } catch (err) {
      // บริการปลายทางตอบมาแต่ไม่ใช่ JSON (เช่น หน้า HTML error) -> 502 Bad Gateway
      return res.status(502).json({
        error: {
          code: "BAD_GATEWAY",
          message: `${service.label}ตอบกลับในรูปแบบที่ไม่ถูกต้อง`,
        },
      });
    }
  };
}

// สร้างแอป Express ของ Gateway (ยังไม่ listen — server.js เป็นคน listen)
const app = express();

// log รวมศูนย์ของทุก request ที่ผ่าน Gateway (ปิดตอนรันเทสต์เพื่อไม่ให้ output รก)
// ดูผลได้ที่ terminal ของ Gateway เช่น  "GET /api/v1/gyms 200 12.3 ms - 540"
app.use(morgan("dev", { skip: () => process.env.NODE_ENV === "test" }));

// Swagger UI: อ่านจากไฟล์ openapi.yaml ไฟล์เดียวกับที่ส่งงาน เพื่อให้เอกสารตรงกับโค้ดเสมอ
// mount ก่อน helmet เพราะ CSP เริ่มต้นของ helmet (upgrade-insecure-requests) ทำให้
// Swagger UI โหลดไม่ขึ้นบน http://localhost ในบางเบราว์เซอร์
// FLOW-17: ลิงก์ "เอกสาร API (Swagger UI)" ที่ footer ใน frontend/index.html (href="/api-docs/")
const openapiDocument = yaml.load(
  fs.readFileSync(path.join(ROOT, "openapi.yaml"), "utf8"),
);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));

// helmet = ใส่ HTTP security header มาตรฐานให้ทุก response (กันโจมตีพื้นฐาน)
app.use(helmet());
// cors = อนุญาตให้เว็บจาก origin อื่นเรียก API ได้
//   ถ้าไม่ตั้ง ALLOWED_ORIGIN ใน .env (ปัจจุบันไม่ได้ตั้ง) แพ็กเกจ cors จะถือเป็น "*" (อนุญาตทุก origin)
//   กรณีเปิด index.html ตรง ๆ (file://) frontend จะเรียก http://localhost:3000 ข้าม origin -> ต้องอาศัย CORS ตรงนี้
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);
// express.json = อ่าน body ที่เป็น JSON เข้า req.body (จำกัด 10kb)
//   - JSON พัง -> error 400 / body เกิน 10kb -> 413 (ไปที่ errorHandler ท้ายไฟล์ ไม่ส่งต่อบริการ)
//   - body นี้คือสิ่งที่ frontend api() แนบมา (JSON.stringify(options.body))
app.use(express.json({ limit: "10kb" }));

// หน้าเว็บ frontend (HTML/CSS/JS) เสิร์ฟจาก origin เดียวกับ API จึงไม่ต้องตั้ง CORS เพิ่ม
// FLOW-00: เปิด http://localhost:3000/ -> ได้ frontend/index.html
//          index.html สั่งโหลด styles.css และ app.js -> ก็ถูกเสิร์ฟจากบรรทัดนี้เช่นกัน
//          (ที่ frontend/app.js ตัวแปร ORIGIN เป็น "" จึงเรียก /api/v1/... ที่ origin เดียวกัน)
app.use(express.static(path.join(ROOT, "frontend")));

// สถานะรวมของระบบ: ถามทุกบริการด้วย GET /health (รอสูงสุด 1 วินาทีต่อบริการ)
// FLOW-01: frontend/app.js > loadHealth() เรียก fetch(ORIGIN + "/health") ตอนเปิดหน้า และซ้ำทุก 15 วินาที
//          ผลลัพธ์แสดงในแถบ <div id="health"> ใต้หัวข้อ ("ระบบพร้อมใช้งานทุกบริการ" / "บางบริการไม่พร้อม: ...")
app.get("/health", async (req, res) => {
  const entries = await Promise.all(
    // วนทั้ง 3 บริการ ถามพร้อมกัน (Promise.all) ไม่ต้องรอทีละตัว
    Object.entries(SERVICES).map(async ([key, service]) => {
      try {
        // ยิง GET http://localhost:400x/health  (ตอบโดย app.get("/health") ของแต่ละ service)
        const r = await fetch(`${service.url()}/health`, {
          signal: AbortSignal.timeout(1000), // รอไม่เกิน 1 วินาที
        });
        return [key, r.ok ? "up" : "down"]; // ตอบ 2xx = up
      } catch (err) {
        return [key, "down"]; // ต่อไม่ได้/ช้าเกิน = down
      }
    }),
  );
  // แปลง [["gym","up"],["member","down"],...] -> { gym:"up", member:"down", ... }
  const services = Object.fromEntries(entries);
  const allUp = Object.values(services).every((s) => s === "up");
  // ตอบ 200 เสมอ (Gateway เองยังปกติ) แต่ status = "ok" หรือ "degraded" บอกว่ามีบริการล่มไหม
  // frontend จะอ่าน data.status และ data.services เพื่อแสดงรายชื่อบริการที่ล่ม
  res
    .status(200)
    .json({ status: allUp ? "ok" : "degraded", gateway: "up", services });
});

// ===== ตารางเส้นทาง (routing table) — ทุก request ของปุ่มบนหน้าเว็บมาลงตรงนี้ =====
// app.use(prefix, handler): จับทุก URL ที่ขึ้นต้นด้วย prefix (ไม่ว่า method ไหน) รวมถึง /:id และ query string
//
// แท็บ "สาขาและราคา"  -> gym-service
//   FLOW-02 loadGyms (โหลดใหม่)   GET    /api/v1/gyms
//   FLOW-03 ดูสภาพอากาศ           GET    /api/v1/gyms/:id/weather
//   FLOW-04 บันทึกสาขา(เพิ่ม)      POST   /api/v1/gyms
//   FLOW-05 บันทึกการแก้ไขสาขา     PUT    /api/v1/gyms/:id
//   FLOW-06 ลบสาขา                DELETE /api/v1/gyms/:id
app.use("/api/v1/gyms", createProxy("gym"));
// แท็บ "สมาชิก"  -> member-service
//   FLOW-07 loadMembers           GET    /api/v1/members
//   FLOW-08 ลงทะเบียน              POST   /api/v1/members
//   FLOW-09 บันทึกการแก้ไขสมาชิก    PUT    /api/v1/members/:id
//   FLOW-10 ลบสมาชิก               DELETE /api/v1/members/:id
app.use("/api/v1/members", createProxy("member"));
// แท็บ "การสมัครแพ็กเกจ" -> subscription-service
//   FLOW-11 loadSubscriptions/ค้นหา/ล้าง  GET    /api/v1/subscriptions[?member_name=...]
//   FLOW-12 บันทึกการสมัคร                 POST   /api/v1/subscriptions
//   FLOW-13 บันทึกการแก้ไขการสมัคร          PUT    /api/v1/subscriptions/:id
//   FLOW-14 ลบการสมัคร                     DELETE /api/v1/subscriptions/:id
app.use("/api/v1/subscriptions", createProxy("subscription"));

// URL อื่นที่ไม่ตรงกับอะไรเลยด้านบน -> 404 ROUTE_NOT_FOUND
app.use(notFoundHandler);
// ตัวรับ error สุดท้ายของ Gateway (เช่น JSON ที่ส่งมาพัง หรือ body ใหญ่เกิน)
app.use(errorHandler);

module.exports = app;
