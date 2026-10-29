// ============================================================================
// ไฟล์: src/shared/errors.js — "ศูนย์กลางจัดการ error" ที่ทุกบริการใช้ร่วมกัน
// ============================================================================
// รูปแบบ error ที่ส่งกลับไปให้หน้าเว็บเสมอ:   { "error": { "code": "...", "message": "..." } }
//
// ใครเรียกไฟล์นี้?
//   - gateway/app.js, gym-service/app.js, member-service/app.js, subscription-service/app.js
//       -> ใช้ notFoundHandler + errorHandler เป็น middleware ตัวสุดท้ายของแต่ละ app
//   - shared/validators.js -> ใช้ HttpError ตอนข้อมูลไม่ถูกต้อง
//   - gym/member/subscription app.js -> ใช้ HttpError ตอนไม่พบข้อมูล (404) หรือซ้ำ (409)
//
// ปลายทางของ error คือ frontend/app.js:
//   ฟังก์ชัน api() (frontend/app.js) อ่าน payload.error.code / payload.error.message
//   แล้วสร้าง ApiError -> ที่ปุ่มต่าง ๆ catch แล้วเรียก toast(...) แสดงข้อความสีแดง
//   (เช่น code DUPLICATE_EMAIL ทำให้หน้าเว็บขึ้นข้อความใต้ช่องอีเมลโดยตรง)
// ============================================================================

// ตัวช่วยจัดการ error ที่ใช้ร่วมกันทุกบริการ (รูปแบบเดียวกับที่ใช้ตั้งแต่ระยะที่ 1-2)
// รูปแบบ error: { error: { code, message } }

// err.status / err.type ถูกใช้โดย errorHandler ด้านล่าง
// HttpError = error ที่ "เรากำหนดเอง" พร้อมรหัส HTTP (status) + รหัสข้อความ (code) + ข้อความไทย (message)
// ตัวอย่างที่ถูก throw ในโปรเจกต์:
//   new HttpError(404, "GYM_NOT_FOUND", "ไม่พบสาขาฟิตเนสที่ระบุ")   (gym-service/app.js)
//   new HttpError(409, "DUPLICATE_EMAIL", "อีเมลนี้มีอยู่ในระบบแล้ว") (member-service/app.js)
class HttpError extends Error {
  constructor(status, code, message) {
    super(message); // เก็บ message ไว้ใน Error มาตรฐาน (err.message)
    this.status = status; // รหัส HTTP เช่น 400 / 404 / 409 / 503 -> errorHandler ใช้ตอบกลับ
    this.type = code; // รหัสข้อความ เช่น "VALIDATION_ERROR" -> กลายเป็น error.code ใน JSON
  }
}

// 404 ไม่พบ route ที่ร้องขอ
// ทำงานเมื่อ request ไม่ตรงกับ route ใด ๆ ที่ประกาศไว้ก่อนหน้า
// (ลงทะเบียนด้วย app.use(notFoundHandler) เป็นตัวรองสุดท้ายในแต่ละ app.js)
function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: "ROUTE_NOT_FOUND", message: "ไม่พบเส้นทางที่ร้องขอ" },
  });
}

// Error-handling middleware ต้องมีพารามิเตอร์ 4 ตัวเสมอ
// Express แยก "middleware ปกติ (3 ตัว)" กับ "ตัวจัดการ error (4 ตัว)" จากจำนวนพารามิเตอร์
// ทุกครั้งที่ route เรียก next(err) (ใน catch ของ route) Express จะข้ามมาที่ฟังก์ชันนี้
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // ใช้ err.status/err.statusCode หากมี เพื่อไม่ให้ error ที่มีรหัสสถานะของตัวเอง
  // (เช่น 400 JSON ผิดรูปแบบ, 413 body ใหญ่เกิน) ถูกกลบด้วย 500 เสมอไป
  // - HttpError ของเรา        -> มี err.status
  // - error ของ express.json  -> มี err.status = 400 (JSON พัง) หรือ 413 (body > 10kb)
  // - error อื่น (เช่น SQL พัง, ฐานข้อมูลล่ม) -> ไม่มี status -> ตกเป็น 500
  const statusCode = err.status || err.statusCode || 500;
  // 500 = บั๊ก/ระบบพัง: พิมพ์ stack ลง console ของ service นั้น (ผู้ใช้ไม่เห็น)
  if (statusCode === 500) console.error(err.stack);
  res.status(statusCode).json({
    error: {
      // 500 -> ไม่เปิดเผยรายละเอียดภายใน ส่งรหัสกลาง INTERNAL_SERVER_ERROR
      // อื่น ๆ -> ใช้ err.type (จาก HttpError) ถ้าไม่มีให้เป็น "ERROR"
      code: statusCode === 500 ? "INTERNAL_SERVER_ERROR" : err.type || "ERROR",
      // 500 -> ข้อความกลาง ๆ (กันข้อมูลลับหลุด) / อื่น ๆ -> ข้อความไทยที่เราเขียนไว้
      message:
        statusCode === 500
          ? "เกิดข้อผิดพลาดที่ไม่คาดคิดภายในระบบ"
          : err.message,
    },
  });
}

module.exports = { HttpError, notFoundHandler, errorHandler };
