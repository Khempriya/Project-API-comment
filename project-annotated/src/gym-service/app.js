// gym-service: ดูแลทรัพยากร gyms (Bounded Context "สาขา") + สภาพอากาศบริเวณสาขา
// รันเป็น process แยก (พอร์ต 4001) และถูกเรียกผ่าน API Gateway เท่านั้น
// app.js ส่งออก app โดยไม่ listen เพื่อให้ Supertest เรียกทดสอบได้ (รูปแบบเดียวกับ Week 9)

// ============================================================================
// 📘 คำอธิบายไฟล์ src/gym-service/app.js — Back end ของแท็บ "สาขาและราคา"
// ============================================================================
// ตารางสรุป: ปุ่ม/การกระทำบนหน้าเว็บ  ->  route ในไฟล์นี้  ->  SQL ที่ทำงานกับตาราง gyms
//
//  ปุ่ม/การกระทำใน frontend                       | Route (หลัง Gateway ตัด /api/v1) | SQL
//  ----------------------------------------------|---------------------------------|----------------------------
//  FLOW-02 เปิดหน้า / ปุ่ม "โหลดใหม่" (สาขา)        | GET    /gyms                    | SELECT ... ORDER BY gym_id
//  FLOW-03 ปุ่ม "ดูสภาพอากาศ"                      | GET    /gyms/:id/weather        | SELECT ... WHERE gym_id=? + Open-Meteo
//  FLOW-04 ปุ่ม "บันทึกสาขา" (โหมดเพิ่ม)            | POST   /gyms                    | INSERT INTO gyms
//  FLOW-05 ปุ่ม "บันทึกการแก้ไข" (โหมดแก้ไข)        | PUT    /gyms/:id                | SELECT เช็คมีอยู่ + UPDATE
//  FLOW-06 ปุ่ม "ลบ" (สาขา)                        | DELETE /gyms/:id                | DELETE FROM gyms (CASCADE)
//  (ไม่ใช่ปุ่ม) subscription-service ตรวจสาขา       | GET    /gyms/:id                | SELECT ... WHERE gym_id=?
//  FLOW-01 แถบสถานะระบบ (Gateway ถามทุก 15 วินาที)  | GET    /health                  | (ไม่มี SQL)
//
// เส้นทางข้อมูลของทุก route:
//   frontend/app.js > api() -> Gateway (createProxy("gym")) -> ไฟล์นี้ -> shared/db.js (pool) -> MySQL
//   แล้วผลย้อนกลับตามเส้นทางเดิม: JSON { message, data } -> api() -> loadGyms() วาดตาราง / toast(message)
//
// รูปแบบ JSON ที่ตอบเสมอ:  { message: "ข้อความไทย", data: ... }  (หน้าเว็บใช้ message ใน toast)
// รูปแบบ error:            { error: { code, message } }  (สร้างโดย shared/errors.js)
//
// โครงสร้าง try/catch ที่ทุก route ใช้ซ้ำ:
//   try { ...ทำงาน... } catch (err) { next(err); }
//   next(err) = ส่ง error ให้ errorHandler (ท้ายไฟล์) แปลงเป็น JSON error + HTTP status ที่เหมาะสม
// ============================================================================
const express = require("express");
// pool = ตัวเชื่อม MySQL (src/shared/db.js) ใช้ pool.query("SQL", [ค่า])
const pool = require("../shared/db");
const {
  HttpError,
  notFoundHandler,
  errorHandler,
} = require("../shared/errors");
// parseId = ตรวจ :id ใน URL / validateGymBody = ตรวจ body ของ POST/PUT สาขา (shared/validators.js)
const { parseId, validateGymBody } = require("../shared/validators");
// getWeatherForLocation = ดึงสภาพอากาศ (gym-service/weather.js) ใช้ใน route /gyms/:id/weather เท่านั้น
const { getWeatherForLocation } = require("./weather");

const app = express();
// อ่าน JSON body (จำกัด 10kb) -> req.body  (ใช้ใน POST/PUT; Gateway ส่ง body มาให้แล้ว)
app.use(express.json({ limit: "10kb" }));

// ตัวสร้าง error 404 "ไม่พบสาขา" (ใช้ซ้ำในหลาย route) -> หน้าเว็บเห็นข้อความ "ไม่พบสาขาฟิตเนสที่ระบุ"
const gymNotFound = () =>
  new HttpError(404, "GYM_NOT_FOUND", "ไม่พบสาขาฟิตเนสที่ระบุ");

// FLOW-01 (ขั้นสุดท้าย): Gateway > app.get("/health") ยิงมาที่นี่ -> ตอบ { status:"ok" } = ติดป้าย "up"
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", service: "gym-service" });
});

// UC3: ดูรายการสาขาและราคา
// ▶ FLOW-02  (ปลายทางของ frontend/app.js > loadGyms() และปุ่ม "โหลดใหม่" id="gyms-refresh")
//   เส้นทาง: loadGyms -> api("/gyms") -> GET /api/v1/gyms -> Gateway -> GET /gyms (ที่นี่)
//   ข้อมูลที่ได้ถูกใช้ 2 ที่ในหน้าเว็บ: (1) วาดตารางสาขา (2) เติม dropdown "สาขา" ในฟอร์มการสมัคร (FLOW-15)
app.get("/gyms", async (req, res, next) => {
  try {
    // 🗄 ดึงข้อมูลจากฐานข้อมูล MySQL ตาราง gyms (ทุกแถว เรียงตามรหัส)
    //    [rows] = destructuring: ผลลัพธ์ของ query คือ [แถวข้อมูล, ข้อมูลคอลัมน์] เราเอาแค่ตัวแรก
    const [rows] = await pool.query(
      "SELECT gym_id, name, address, monthly_fee FROM gyms ORDER BY gym_id",
    );
    res.status(200).json({
      // ไม่มีข้อมูล -> message = "ยังไม่มีข้อมูลสาขาฟิตเนส" (frontend ตรวจ !data.length แล้วโชว์สถานะ empty)
      message: rows.length
        ? "ดึงข้อมูลสาขาฟิตเนสสำเร็จ"
        : "ยังไม่มีข้อมูลสาขาฟิตเนส",
      data: rows, // อาร์เรย์ { gym_id, name, address, monthly_fee } -> frontend: const { data } = await api("/gyms")
    });
  } catch (err) {
    // เช่น MySQL ล่ม -> next(err) -> errorHandler ตอบ 500 INTERNAL_SERVER_ERROR
    // -> หน้าเว็บขึ้นกล่องแดง "โหลดรายการสาขาไม่สำเร็จ: ..."
    next(err);
  }
});

// ดึงสาขาทีละ 1 รายการ
// ⚠ หน้าเว็บ "ไม่ได้" เรียก route นี้โดยตรง — ผู้เรียกจริงคือ subscription-service (ensureExists)
//   ตอนกดปุ่ม "บันทึกการสมัคร" (FLOW-12) และ "บันทึกการแก้ไข" ของการสมัคร (FLOW-13)
//   เพื่อตรวจว่า gym_id ที่เลือกมีอยู่จริง: GET http://localhost:4001/gyms/:id
app.get("/gyms/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id); // "5" -> 5 / "abc" -> throw 400 INVALID_ID
    // 🗄 SELECT สาขาตามรหัส (ใช้ ? + [id] ป้องกัน SQL Injection)
    const [rows] = await pool.query(
      "SELECT gym_id, name, address, monthly_fee FROM gyms WHERE gym_id = ?",
      [id],
    );
    if (!rows.length) throw gymNotFound(); // ไม่เจอ -> 404 (subscription-service จะแปลงเป็น "ไม่พบสาขาฟิตเนสที่ระบุ")
    res
      .status(200)
      .json({ message: "ดึงข้อมูลสาขาฟิตเนสสำเร็จ", data: rows[0] });
  } catch (err) {
    next(err);
  }
});

// External API: สภาพอากาศบริเวณสาขา (retry / timeout / fallback อยู่ใน weather.js)
// ▶ FLOW-03  ปลายทางของปุ่ม "ดูสภาพอากาศ" (frontend/app.js > showWeather())
//   เส้นทาง: showWeather -> api(`/gyms/${gym.gym_id}/weather`) -> Gateway -> GET /gyms/:id/weather (ที่นี่)
//   หน้าเว็บแสดงผลลง <div id="weather-box"> ใต้ตารางสาขา
app.get("/gyms/:id/weather", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    // 🗄 ขั้น 1: เช็คว่าสาขามีจริงในตาราง gyms (ดึงเฉพาะ gym_id, name — name ใช้โชว์หน้าเว็บ)
    const [rows] = await pool.query(
      "SELECT gym_id, name FROM gyms WHERE gym_id = ?",
      [id],
    );
    if (!rows.length) throw gymNotFound(); // ไม่พบสาขา -> 404 และ "ไม่ยิง" API ภายนอก (ประหยัด)

    // getWeatherForLocation ไม่ throw: ถ้า API ภายนอกล่ม จะได้ fallback กลับมา
    // 🌐 ขั้น 2: ไปดึงข้อมูลจากอินเทอร์เน็ต (Open-Meteo) ผ่าน weather.js -> shared/external-api.js
    const weather = await getWeatherForLocation();
    res.status(200).json({
      // message ต่างกันตามความสำเร็จ แต่ HTTP status เป็น 200 เสมอ (หน้าเว็บดูที่ data.weather.available)
      message: weather.available
        ? "ดึงข้อมูลสภาพอากาศสำเร็จ"
        : "ดึงข้อมูลสาขาสำเร็จ แต่ไม่สามารถดึงข้อมูลสภาพอากาศได้ในขณะนี้",
      // data.gym (name) -> หน้าเว็บใช้ data.gym.name / data.weather -> w.condition, w.temperature_c, ...
      data: { gym: rows[0], weather },
    });
  } catch (err) {
    next(err);
  }
});

// UC4: ผู้ดูแลระบบเพิ่มสาขา
// ▶ FLOW-04  ปลายทางของฟอร์ม <form id="gym-form"> เมื่ออยู่ใน "โหมดเพิ่ม" แล้วกดปุ่ม "บันทึกสาขา"
//   เส้นทาง: submit -> validateGymForm() (ตรวจฝั่งหน้าเว็บ) -> api("/gyms",{method:"POST",body})
//            -> POST /api/v1/gyms -> Gateway -> POST /gyms (ที่นี่)
//   หลังสำเร็จ frontend: toast(res.message) + reset ฟอร์ม + loadGyms() โหลดตารางใหม่
app.post("/gyms", async (req, res, next) => {
  try {
    // ตรวจ + ทำความสะอาด body (trim ช่องว่าง) -> { name, address, monthly_fee } ไม่ผ่านจะ throw 400
    const gym = validateGymBody(req.body);
    // 🗄 INSERT สาขาใหม่ลงตาราง gyms (gym_id เป็น AUTO_INCREMENT จึงไม่ต้องส่ง)
    const [result] = await pool.query(
      "INSERT INTO gyms (name, address, monthly_fee) VALUES (?, ?, ?)",
      [gym.name, gym.address, gym.monthly_fee],
    );
    // 201 Created + คืนข้อมูลที่สร้าง (result.insertId = gym_id ที่ MySQL สร้างให้)
    res.status(201).json({
      message: "เพิ่มข้อมูลสาขาฟิตเนสสำเร็จ", // <- ข้อความนี้คือที่ toast(res.message) แสดงบนหน้าเว็บ
      data: { gym_id: result.insertId, ...gym },
    });
  } catch (err) {
    next(err);
  }
});

// UC4: ผู้ดูแลระบบแก้ไขสาขา (แทนที่ทั้งรายการ ต้องส่งครบทุกฟิลด์)
// ▶ FLOW-05  ปลายทางของฟอร์ม gym-form เมื่ออยู่ใน "โหมดแก้ไข" (หลังกดปุ่ม "แก้ไข" ที่แถวสาขา -> startEditGym())
//   แล้วกดปุ่ม "บันทึกการแก้ไข"
//   (ปุ่ม "แก้ไข" เองไม่เรียก API: แค่เอาข้อมูลของแถวนั้นไปใส่ในฟอร์ม)
//   เส้นทาง: submit -> api(`/gyms/${editingGymId}`,{method:"PUT",body}) -> Gateway -> PUT /gyms/:id (ที่นี่)
//   หลังสำเร็จ frontend: toast + cancelEditGym() + loadGyms() และ loadSubscriptions()
//   (โหลดการสมัครด้วย เพราะตารางการสมัครแสดงชื่อ/ราคาสาขา ซึ่งเพิ่งเปลี่ยน)
app.put("/gyms/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id); // รหัสจาก URL
    const gym = validateGymBody(req.body); // ข้อมูลใหม่จากฟอร์ม
    // 🗄 ขั้น 1: SELECT เช็คว่าสาขานี้มีอยู่จริง (เพื่อแยก 404 ออกจากกรณี "ข้อมูลเหมือนเดิม")
    const [exists] = await pool.query(
      "SELECT gym_id FROM gyms WHERE gym_id = ?",
      [id],
    );
    if (!exists.length) throw gymNotFound();
    // 🗄 ขั้น 2: UPDATE ทุกคอลัมน์ (PUT = แทนที่ทั้งรายการ)
    await pool.query(
      "UPDATE gyms SET name = ?, address = ?, monthly_fee = ? WHERE gym_id = ?",
      [gym.name, gym.address, gym.monthly_fee, id],
    );
    res.status(200).json({
      message: "อัปเดตข้อมูลสาขาฟิตเนสสำเร็จ",
      data: { gym_id: id, ...gym },
    });
  } catch (err) {
    next(err);
  }
});

// UC4 (Alt 1a): ลบสาขา -> ประวัติการสมัครของสาขานั้นถูกลบด้วย (ON DELETE CASCADE ในฐานข้อมูล)
// ▶ FLOW-06  ปลายทางของปุ่ม "ลบ" (สีแดง) ที่แถวสาขา -> frontend/app.js > deleteGym()
//   deleteGym ถามยืนยัน window.confirm ก่อน -> api(`/gyms/${gym.gym_id}`,{method:"DELETE"})
//   -> Gateway -> DELETE /gyms/:id (ที่นี่)  -> หน้าเว็บ loadGyms() + loadSubscriptions() ใหม่
app.delete("/gyms/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    // 🗄 DELETE สาขา — แถวใน subscriptions ที่อ้าง gym_id นี้ถูกลบตามอัตโนมัติด้วย
    //    เพราะ schema.sql กำหนด FOREIGN KEY (gym_id) ... ON DELETE CASCADE
    const [result] = await pool.query("DELETE FROM gyms WHERE gym_id = ?", [
      id,
    ]);
    // affectedRows = จำนวนแถวที่ถูกลบ ถ้า 0 = ไม่มีสาขารหัสนี้ -> 404
    if (result.affectedRows === 0) throw gymNotFound();
    res.status(200).json({
      message: "ลบสาขาฟิตเนสและประวัติการสมัครที่เกี่ยวข้องสำเร็จ",
    });
  } catch (err) {
    next(err);
  }
});

// ไม่ตรง route ใดเลย -> 404 ROUTE_NOT_FOUND / error ทั้งหมดจาก next(err) ไหลมาจบที่ errorHandler
app.use(notFoundHandler);
app.use(errorHandler);

// ส่งออก app (ไม่ listen) — gym-service/server.js เป็นคนเปิดพอร์ต 4001
module.exports = app;
