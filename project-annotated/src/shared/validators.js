// ============================================================================
// ไฟล์: src/shared/validators.js — "ด่านตรวจข้อมูลที่ฝั่ง Back end" (validate ก่อนแตะฐานข้อมูล)
// ============================================================================
// ทำไมต้องตรวจซ้ำที่ Back end ทั้งที่ frontend/app.js ตรวจแล้ว?
//   เพราะ frontend ถูกข้ามได้ (เรียก API ตรง ๆ ผ่าน Postman/curl) ฝั่ง Back end จึงต้องตรวจเองเสมอ
//   ถ้าไม่ผ่าน -> throw HttpError 400 -> errorHandler (shared/errors.js) -> หน้าเว็บ toast สีแดง
//
// ใครเรียกฟังก์ชันไหน (ผูกกับปุ่มบนหน้าเว็บ):
//   parseId(...)                        <- ทุก route ที่มี :id  (PUT/DELETE/GET weather ฯลฯ)
//   validateGymBody(...)                <- gym-service  POST /gyms, PUT /gyms/:id
//                                          (ปุ่ม "บันทึกสาขา" / "บันทึกการแก้ไข" ในแท็บ "สาขาและราคา")
//   validateMemberBody(...)             <- member-service  POST /members, PUT /members/:id
//                                          (ปุ่ม "ลงทะเบียน" / "บันทึกการแก้ไข" ในแท็บ "สมาชิก")
//   validateSubscriptionBody(...)       <- subscription-service  POST /subscriptions
//                                          (ปุ่ม "บันทึกการสมัคร" ในแท็บ "การสมัครแพ็กเกจ")
//   validateSubscriptionUpdateBody(...) <- subscription-service  PUT /subscriptions/:id
//                                          (ปุ่ม "บันทึกการแก้ไข" ของการสมัคร)
//
// กติกาในไฟล์นี้ต้อง "สอดคล้อง" กับ validateXxxForm() ใน frontend/app.js
//   (เช่น ชื่อยาวไม่เกิน 150, อีเมลต้องผ่าน EMAIL_PATTERN เดียวกัน, ค่าบริการเป็นจำนวนเต็ม >= 0)
// ============================================================================

// ฟังก์ชันตรวจสอบข้อมูลนำเข้า (ย้ายมาจาก index.js ของระยะที่ 2 โดยไม่เปลี่ยนพฤติกรรม)
const { HttpError } = require("./errors");

// ตรวจ :id ใน URL เช่น /gyms/abc หรือ /gyms/0 หรือ /gyms/-5 -> 400 INVALID_ID
// ผ่านเมื่อ: เป็นตัวเลขล้วน (regex ^\d+$) และมากกว่า 0 แล้วแปลงเป็น Number คืนให้
function parseId(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) <= 0) {
    throw new HttpError(400, "INVALID_ID", "รหัสต้องเป็นจำนวนเต็มบวก");
  }
  return Number(value);
}

// รวมข้อความ error หลายข้อเป็น HttpError 400 ก้อนเดียว คั่นด้วย "; "
// ผู้ใช้จะเห็นข้อความนี้ใน toast (frontend: toast(`...ไม่สำเร็จ: ${err.message}`, true))
function validationError(errors) {
  return new HttpError(
    400,
    "VALIDATION_ERROR",
    `ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง: ${errors.join("; ")}`,
  );
}

// ตรวจ body ของสาขา -> { name, address, monthly_fee }
// ใช้โดย gym-service: POST /gyms และ PUT /gyms/:id
// body มาจาก frontend/app.js > validateGymForm() ที่ส่ง { name, address, monthly_fee }
function validateGymBody(body) {
  const { name, address, monthly_fee } = body || {}; // body || {} กัน body เป็น undefined
  const errors = [];
  // name: ต้องเป็นข้อความ, ไม่ว่างหลัง trim, ยาว <= 150 (ตรงกับ VARCHAR(150) ใน schema.sql)
  if (typeof name !== "string" || !name.trim() || name.trim().length > 150) {
    errors.push("name ต้องเป็นข้อความที่ไม่ว่างและยาวไม่เกิน 150 ตัวอักษร");
  }
  // address: ต้องเป็นข้อความที่ไม่ว่าง (ชนิด TEXT ใน schema.sql จึงไม่จำกัดความยาว)
  if (typeof address !== "string" || !address.trim()) {
    errors.push("address ต้องเป็นข้อความที่ไม่ว่าง");
  }
  // monthly_fee: ต้องเป็น "ตัวเลขจำนวนเต็ม" จริง ๆ (ไม่ใช่สตริง "1200") และ >= 0
  // (frontend แปลงด้วย Number(...) ก่อนส่ง JSON จึงเป็นชนิด number)
  if (!Number.isInteger(monthly_fee) || monthly_fee < 0) {
    errors.push("monthly_fee ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป");
  }
  if (errors.length) throw validationError(errors);
  // คืนเฉพาะฟิลด์ที่อนุญาต + trim แล้ว (ฟิลด์แปลกปลอมอื่นใน body ถูกทิ้ง)
  return { name: name.trim(), address: address.trim(), monthly_fee };
}

// รูปแบบอีเมลแบบง่าย: มีตัวอักษร + @ + ตัวอักษร + . + ตัวอักษร (ไม่มีช่องว่าง)
// เหมือนกับ EMAIL_PATTERN ใน frontend/app.js บรรทัดต้น ๆ
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ตรวจ body ของสมาชิก -> { name, email }
// ใช้โดย member-service: POST /members และ PUT /members/:id
// (อีเมลซ้ำไม่ได้ตรวจที่นี่ แต่ตรวจที่ฐานข้อมูลด้วย UNIQUE(email) -> ER_DUP_ENTRY -> 409)
function validateMemberBody(body) {
  const { name, email } = body || {};
  const errors = [];
  if (typeof name !== "string" || !name.trim() || name.trim().length > 150) {
    errors.push("name ต้องเป็นข้อความที่ไม่ว่างและยาวไม่เกิน 150 ตัวอักษร");
  }
  if (
    typeof email !== "string" ||
    email.trim().length > 150 ||
    !EMAIL_PATTERN.test(email.trim())
  ) {
    errors.push(
      "email ต้องเป็นรูปแบบอีเมลที่ถูกต้องและยาวไม่เกิน 150 ตัวอักษร",
    );
  }
  if (errors.length) throw validationError(errors);
  return { name: name.trim(), email: email.trim() };
}

// ตรวจว่าเป็นวันที่ "รูปแบบ YYYY-MM-DD และมีอยู่จริงในปฏิทิน"
// เช่น "2026-02-30" ผ่าน regex แต่ไม่มีอยู่จริง -> new Date จะเลื่อนเป็น 2026-03-02
// จึงเทียบ toISOString().slice(0,10) กลับกับค่าเดิม ถ้าไม่เท่ากัน = วันที่ปลอม
// ช่อง <input type="date"> ใน index.html (id="sub-date") ส่งค่ารูปแบบนี้มาอยู่แล้ว
function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// ตรวจ body ตอน "สมัครแพ็กเกจใหม่" -> { member_id, gym_id, start_date|null }
// ใช้โดย subscription-service: POST /subscriptions (ปุ่ม "บันทึกการสมัคร")
// body มาจาก frontend/app.js > validateSubForm() = { member_id, gym_id, [start_date] }
function validateSubscriptionBody(body) {
  const { member_id, gym_id, start_date } = body || {};
  const errors = [];
  if (!Number.isInteger(member_id) || member_id <= 0) {
    errors.push("member_id ต้องเป็นจำนวนเต็มบวก");
  }
  if (!Number.isInteger(gym_id) || gym_id <= 0) {
    errors.push("gym_id ต้องเป็นจำนวนเต็มบวก");
  }
  // start_date "ไม่บังคับ": ถ้าไม่ส่งมา (undefined) = ไม่ตรวจ
  // ถ้าส่งมาต้องเป็นวันที่จริง (ที่หน้าเว็บ: ช่องวันที่ว่าง = ไม่ใส่ start_date ใน body)
  if (start_date !== undefined && !isValidDateString(start_date)) {
    errors.push("start_date ต้องเป็นวันที่รูปแบบ YYYY-MM-DD ที่มีอยู่จริง");
  }
  if (errors.length) throw validationError(errors);
  // start_date ?? null : ไม่ส่งมา -> null
  //   แล้ว SQL ใน subscription-service ใช้ COALESCE(?, CURDATE()) แปลง null เป็น "วันนี้" ของ MySQL
  return { member_id, gym_id, start_date: start_date ?? null };
}

// สถานะที่อนุญาตของการสมัคร (ตรงกับ <option> ของ <select id="sub-status"> ใน index.html)
const SUBSCRIPTION_STATUSES = ["active", "expired", "cancelled"];

// แก้ไขการสมัคร (PUT): เปลี่ยนสาขา วันที่เริ่ม และสถานะได้ (สมาชิกคงเดิม) ต้องส่งครบทุกฟิลด์
// ใช้โดย subscription-service: PUT /subscriptions/:id
// body มาจาก frontend/app.js > validateSubEditForm() = { gym_id, start_date, status }
// ต่างจากตอนสร้าง: ที่นี่ "ไม่มี member_id" (เปลี่ยนสมาชิกไม่ได้) และ start_date/status "บังคับ"
function validateSubscriptionUpdateBody(body) {
  const { gym_id, start_date, status } = body || {};
  const errors = [];
  if (!Number.isInteger(gym_id) || gym_id <= 0) {
    errors.push("gym_id ต้องเป็นจำนวนเต็มบวก");
  }
  if (!isValidDateString(start_date)) {
    errors.push("start_date ต้องเป็นวันที่รูปแบบ YYYY-MM-DD ที่มีอยู่จริง");
  }
  if (!SUBSCRIPTION_STATUSES.includes(status)) {
    errors.push(`status ต้องเป็นหนึ่งใน ${SUBSCRIPTION_STATUSES.join(", ")}`);
  }
  if (errors.length) throw validationError(errors);
  return { gym_id, start_date, status };
}

module.exports = {
  SUBSCRIPTION_STATUSES,
  validateSubscriptionUpdateBody,
  parseId,
  validationError,
  validateGymBody,
  validateMemberBody,
  validateSubscriptionBody,
  isValidDateString,
  EMAIL_PATTERN,
};
