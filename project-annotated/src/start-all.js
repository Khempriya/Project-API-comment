// รันทุก process ของระบบพร้อมกันด้วยคำสั่งเดียว (npm start)
// = gym-service (4001) + member-service (4002) + subscription-service (4003) + gateway (3000)
// แต่ละบริการเป็น process แยกกัน (จำลองการ deploy แยก) กด Ctrl+C ครั้งเดียวปิดทั้งหมด

// ============================================================================
// 📘 คำอธิบายไฟล์ src/start-all.js — "ตัวเปิดระบบทั้งหมดในคำสั่งเดียว"
// ============================================================================
// package.json:  "start": "node src/start-all.js"  (และ "main": "src/start-all.js")
// เมื่อพิมพ์ `npm start` ไฟล์นี้จะเปิด 4 process ลูก (child process) ต่อไปนี้ พร้อมกัน:
//
//   gym-service/server.js          -> พอร์ต 4001  (Back end ของแท็บสาขา)
//   member-service/server.js       -> พอร์ต 4002  (Back end ของแท็บสมาชิก)
//   subscription-service/server.js -> พอร์ต 4003  (Back end ของแท็บการสมัคร)
//   gateway/server.js              -> พอร์ต 3000  (ด่านหน้า + เสิร์ฟหน้าเว็บ)
//
// จากนั้นเปิดเบราว์เซอร์ไปที่ http://localhost:3000 ได้เลย (หน้าเว็บมาจาก Gateway)
// ★ ทุกปุ่มบนหน้าเว็บ "ใช้งานได้" ก็ต่อเมื่อทั้ง 4 process ทำงานอยู่ และ MySQL เปิดอยู่
//   (ตรวจได้จากแถบ "สถานะระบบ" บนหน้าเว็บ = FLOW-01)
// ============================================================================
const { spawn } = require("child_process"); // spawn = สั่งรันโปรแกรมอื่นเป็น process ลูก
const path = require("path");

// รายชื่อ process ที่ต้องเปิด: name ใช้เป็นป้ายหน้า log / file = ที่อยู่ไฟล์ server.js (สัมพันธ์กับโฟลเดอร์ src)
const PROCESSES = [
  { name: "gym-service", file: "gym-service/server.js" },
  { name: "member-service", file: "member-service/server.js" },
  { name: "subscription-service", file: "subscription-service/server.js" },
  { name: "gateway", file: "gateway/server.js" },
];

// วนเปิดทีละ process แล้วเก็บ child ไว้ใน children (ไว้ปิดตอน Ctrl+C)
const children = PROCESSES.map(({ name, file }) => {
  // process.execPath = ตำแหน่งของ node ที่กำลังรันอยู่ -> เทียบเท่าพิมพ์ `node src/<file>`
  const child = spawn(process.execPath, [path.join(__dirname, file)], {
    stdio: ["ignore", "pipe", "pipe"], // ไม่รับ input / ดัก stdout และ stderr มาจัดรูปแบบเอง
    env: process.env, // ส่งต่อตัวแปรแวดล้อมของ process แม่ (แต่ละ server.js จะโหลด .env เองอีกชั้น)
  });
  // ใส่ป้าย [ชื่อบริการ] หน้าทุกบรรทัด log เพื่อแยกว่า log นี้มาจากบริการไหน
  // เช่น "[gateway] GET /api/v1/gyms 200 ..." / "[subscription-service] [external-api] ครั้งที่ 1/3 ล้มเหลว"
  const prefix = (stream, out) =>
    stream.on("data", (chunk) =>
      String(chunk)
        .split("\n")
        .filter(Boolean)
        .forEach((line) => out.write(`[${name}] ${line}\n`)),
    );
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  // ถ้า process ลูกตัวใดดับ ให้แจ้งใน log (หน้าเว็บจะเห็นเป็น "บางบริการไม่พร้อม: ..." ในแถบสถานะ)
  child.on("exit", (code, signal) => {
    console.log(`[${name}] หยุดทำงาน (code=${code}, signal=${signal})`);
  });
  return child;
});

// ปิดทุก process ลูกอย่างเรียบร้อย (ส่งสัญญาณ SIGTERM) แล้วจบตัวเองหลังรอ 0.3 วินาที
function shutdown() {
  children.forEach((child) => child.kill("SIGTERM"));
  setTimeout(() => process.exit(0), 300);
}
// Ctrl+C (SIGINT) หรือถูกสั่งปิด (SIGTERM) -> ปิดทุกบริการพร้อมกัน
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
