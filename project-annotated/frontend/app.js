// Frontend ของระบบข้อมูลฟิตเนส: HTML/CSS/JavaScript ล้วน (ไม่ใช้เฟรมเวิร์ก)
// เรียก API จริงผ่าน API Gateway ที่ origin เดียวกัน (/api/v1/...)

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  📘 แผนที่ปุ่ม -> โค้ด -> Back end  (frontend/app.js)                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// ไฟล์นี้ทำงานในเบราว์เซอร์ ผูกกับ HTML ใน frontend/index.html ด้วย id ของ element
// (เช่น $("gym-form") = <form id="gym-form"> ใน index.html)
//
// เส้นทางของทุก request:
//   ปุ่มบนหน้าเว็บ -> ฟังก์ชันในไฟล์นี้ -> api() -> fetch -> Gateway (src/gateway/app.js :3000)
//   -> บริการปลายทาง (gym/member/subscription-service) -> MySQL -> JSON ย้อนกลับมาที่ api()
//
// ┌──────────────────────────────────┬────────────────────────────────┬───────────────────────────────┬─────────────────────────────────────────┐
// │ ปุ่ม/เหตุการณ์ในหน้าเว็บ           │ ฟังก์ชันในไฟล์นี้                │ HTTP ที่ยิง (ผ่าน Gateway)      │ ไปจบที่ Back end                           │
// ├──────────────────────────────────┼────────────────────────────────┼───────────────────────────────┼─────────────────────────────────────────┤
// │ FLOW-00 เปิดหน้าเว็บ              │ บรรทัดท้ายไฟล์ (loadHealth ฯลฯ)   │ GET / , styles.css , app.js    │ gateway/app.js express.static           │
// │ FLOW-01 แถบ "สถานะระบบ"           │ loadHealth()                   │ GET /health (ทุก 15 วินาที)     │ gateway/app.js app.get("/health")       │
// │ FLOW-02 โหลดสาขา / "โหลดใหม่"      │ loadGyms()                     │ GET /api/v1/gyms               │ gym-service GET /gyms                   │
// │ FLOW-03 "ดูสภาพอากาศ"             │ showWeather()                  │ GET /api/v1/gyms/:id/weather   │ gym-service GET /gyms/:id/weather+API ภายนอก│
// │ FLOW-04 "บันทึกสาขา" (เพิ่ม)       │ gym-form submit                │ POST /api/v1/gyms              │ gym-service POST /gyms                  │
// │ FLOW-05 "แก้ไข"สาขา->"บันทึกการแก้ไข"│ startEditGym + gym-form submit │ PUT /api/v1/gyms/:id           │ gym-service PUT /gyms/:id               │
// │ FLOW-06 "ลบ" สาขา                 │ deleteGym()                    │ DELETE /api/v1/gyms/:id        │ gym-service DELETE /gyms/:id            │
// │ FLOW-07 โหลดสมาชิก / "โหลดใหม่"     │ loadMembers()                  │ GET /api/v1/members            │ member-service GET /members             │
// │ FLOW-08 "ลงทะเบียน"               │ member-form submit             │ POST /api/v1/members           │ member-service POST /members            │
// │ FLOW-09 "แก้ไข"สมาชิก->"บันทึก…"    │ startEditMember+member-form    │ PUT /api/v1/members/:id        │ member-service PUT /members/:id         │
// │ FLOW-10 "ลบ" สมาชิก               │ deleteMember()                 │ DELETE /api/v1/members/:id     │ member-service DELETE /members/:id      │
// │ FLOW-11 โหลดการสมัคร/"ค้นหา"/"ล้าง"│ loadSubscriptions()            │ GET /api/v1/subscriptions[?..] │ subscription-service GET /subscriptions │
// │ FLOW-12 "บันทึกการสมัคร"           │ sub-form submit                │ POST /api/v1/subscriptions     │ subscription-service POST (+ถาม 2 บริการ) │
// │ FLOW-13 "แก้ไข"การสมัคร->"บันทึก…"  │ startEditSubscription+sub-form │ PUT /api/v1/subscriptions/:id  │ subscription-service PUT (+ถาม gym-svc)  │
// │ FLOW-14 "ลบ" การสมัคร             │ deleteSubscription()           │ DELETE /api/v1/subscriptions/:id│ subscription-service DELETE             │
// │ FLOW-15 dropdown สมาชิก/สาขา       │ fillMemberSelect/fillGymSelect │ (ไม่ยิงเอง ใช้ผล FLOW-07/02)     │ -                                       │
// │ FLOW-16 สลับแท็บ                  │ .tab click handler             │ (ไม่ยิง API)                    │ -                                       │
// │ FLOW-17 ลิงก์ Swagger (footer)    │ (ลิงก์ <a> ใน index.html)        │ GET /api-docs/                 │ gateway/app.js swaggerUi                │
// └──────────────────────────────────┴────────────────────────────────┴───────────────────────────────┴─────────────────────────────────────────┘
// หมายเหตุ: ปุ่ม "แก้ไข" ในทุกตาราง "ไม่ยิง API" — แค่คัดลอกข้อมูลของแถวนั้นไปใส่ฟอร์ม (ข้อมูลมีอยู่ในหน้าแล้ว)
//          API จะถูกยิงตอนกดปุ่ม "บันทึกการแก้ไข" (submit ของฟอร์ม) เท่านั้น
"use strict";

// ORIGIN = "ที่อยู่ของเซิร์ฟเวอร์" ที่จะยิง API ไปหา
//   เปิดหน้าผ่าน http://localhost:3000/ (ปกติ) -> protocol เป็น "http:" -> ORIGIN = "" (ยิงที่ origin เดียวกันกับหน้าเว็บ)
//   เปิดไฟล์ index.html ตรง ๆ (file://)        -> ORIGIN = "http://localhost:3000" (ยิงข้ามไปหา Gateway ต้องอาศัย CORS ใน Gateway)
const ORIGIN =
  window.location.protocol === "file:" ? "http://localhost:3000" : "";
// API_BASE = prefix ของ API ทั้งหมด -> ทุก path ที่ส่งเข้า api() จะถูกต่อท้ายตรงนี้
//   เช่น api("/gyms") -> fetch("/api/v1/gyms") -> ไปลง app.use("/api/v1/gyms", createProxy("gym")) ใน gateway/app.js
const API_BASE = ORIGIN + "/api/v1";
// รูปแบบอีเมลสำหรับตรวจฝั่งหน้าเว็บ (เหมือนกับ EMAIL_PATTERN ใน src/shared/validators.js ฝั่ง Back end)
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- ตัวช่วยเรียก API (จัดการ error ให้เป็นข้อความที่อ่านรู้เรื่อง) ----------
// ApiError = error ที่เราสร้างเองเมื่อ API ตอบผิดพลาด พก status (HTTP), code (รหัสจาก Back end), message (ข้อความไทย)
//   code เช่น "DUPLICATE_EMAIL" มาจาก HttpError ใน src/shared/errors.js ของ Back end
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ★ api(path, options) = "ท่อเดียว" ที่ทุกปุ่มใช้คุยกับ Back end (ยกเว้น /health ที่ใช้ fetch ตรง ๆ)
//   path    : เช่น "/gyms", "/members/3", "/subscriptions?member_name=..."
//   options : { method: "GET"|"POST"|"PUT"|"DELETE", body: อ็อบเจ็กต์ JS }
//   คืนค่า  : JSON ที่ Back end ตอบ เช่น { message:"...", data:[...] }
//   ผิดพลาด : throw ApiError (ผู้เรียกจับด้วย try/catch แล้วโชว์ toast หรือกล่องสถานะ)
async function api(path, options = {}) {
  const init = {
    method: options.method || "GET", // ไม่ระบุ = GET
    headers: { Accept: "application/json" }, // บอกว่าอยากได้ JSON กลับมา
  };
  // มี body (ตอน POST/PUT) -> แปลงอ็อบเจ็กต์เป็นข้อความ JSON และบอก Content-Type
  // (Gateway ใช้ express.json() อ่านต่อ; ถ้าไม่ใส่ Content-Type body จะไม่ถูก parse)
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let response;
  try {
    // 🚀 จุดที่ "ออกจากเบราว์เซอร์ไปหา Gateway" จริง ๆ  เช่น  fetch("/api/v1/gyms", {...})
    response = await fetch(API_BASE + path, init);
  } catch (err) {
    // เครือข่ายล่ม / server ไม่ตอบ
    // (เกิดเมื่อ Gateway ปิด/เชื่อมต่อไม่ได้เลย — ต่างจาก 503 ที่ Gateway ตอบเองเมื่อ "บริการข้างหลัง" ล่ม)
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่าระบบเปิดอยู่แล้วลองใหม่",
    );
  }
  let payload = null;
  try {
    // อ่าน body เป็น JSON (ทั้งกรณีสำเร็จและกรณี error ต่างก็เป็น JSON)
    payload = await response.json();
  } catch (err) {
    payload = null; // body ไม่ใช่ JSON -> ปล่อยเป็น null
  }
  // response.ok = HTTP status 200-299; นอกนั้น (400/404/409/500/502/503) = error
  if (!response.ok) {
    // รูปแบบ error จาก Back end: { error: { code, message } }
    const e = payload && payload.error;
    throw new ApiError(
      response.status,
      e && e.code,
      (e && e.message) || `เกิดข้อผิดพลาด (HTTP ${response.status})`,
    );
  }
  return payload; // สำเร็จ: ผู้เรียกมักทำ const { data, message } = await api(...)
}

// ---------- ตัวช่วย UI ----------
// $("x") = ย่อของ document.getElementById("x") — หา element จาก id ใน index.html
const $ = (id) => document.getElementById(id);

// เปลี่ยนกล่องสถานะ (<div id="gyms-state"> / "members-state" / "subs-state") ใต้หัวตาราง
function setState(el, kind, text) {
  // kind: loading | error | empty | ready
  if (kind === "ready") {
    // ready = ซ่อนกล่องสถานะ (แสดงตารางแทน)
    el.hidden = true;
    el.textContent = "";
    el.className = "state";
    return;
  }
  el.hidden = false;
  el.className = `state ${kind}`; // class ตรงกับสไตล์ใน styles.css (.state.loading/.error/.empty)
  el.textContent = text;
}

// แจ้งเตือนแบบ popup มุมจอ (<div id="toast">) — ใช้แสดง message จาก Back end หลังบันทึก/แก้ไข/ลบ
//   สำเร็จ: toast(res.message) เช่น "เพิ่มข้อมูลสาขาฟิตเนสสำเร็จ" (ข้อความมาจาก Back end)
//   ล้มเหลว: toast("...ไม่สำเร็จ: ...", true) พื้นแดง
let toastTimer;
function toast(text, isError = false) {
  const el = $("toast");
  el.textContent = text;
  el.className = isError ? "toast error" : "toast";
  el.hidden = false;
  clearTimeout(toastTimer);
  // ซ่อนเองหลัง 6 วินาที
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 6000);
}

// สร้างเซลล์ <td> ธรรมดา (ใช้วาดแถวตาราง) className ใส่ "num" เพื่อชิดขวาสำหรับตัวเลข
function td(text, className) {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

// สร้างปุ่ม "แก้ไข" / "ลบ" ต่อแถว
//   label = ข้อความบนปุ่ม / className = สไตล์ / handler = ฟังก์ชันที่ทำงานตอนคลิก (ส่งตัวปุ่มให้ด้วย
//   เพื่อให้ handler ปิดปุ่ม (disabled) ระหว่างรอ API)
function actionButton(label, className, handler) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", () => handler(btn));
  return btn;
}

// ห่อปุ่มหลายปุ่มไว้ในเซลล์ <td> คอลัมน์ "การทำงาน" ของตาราง
function actionsCell(...buttons) {
  const cell = document.createElement("td");
  const box = document.createElement("div");
  box.className = "actions";
  box.append(...buttons);
  cell.append(box);
  return cell;
}

// เปิดโหมดแก้ไขของฟอร์ม: เปลี่ยนหัวข้อ/ปุ่ม แล้วเลื่อนหน้าจอไปที่ฟอร์ม
// (ไม่ยิง API — เป็นแค่การเปลี่ยนหน้าตาฟอร์มให้เป็นโหมดแก้ไข ใช้ร่วมกันทั้ง 3 ฟอร์ม)
//   titleId = id ของหัวข้อฟอร์ม / cancelId = id ปุ่ม "ยกเลิกการแก้ไข" ที่จะโชว์
function enterEditMode(form, titleId, cancelId, title, submitLabel) {
  $(titleId).textContent = title;
  form.querySelector("button[type=submit]").textContent = submitLabel;
  $(cancelId).hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ออกจากโหมดแก้ไข: คืนหัวข้อ/ข้อความปุ่มเดิม และซ่อนปุ่ม "ยกเลิกการแก้ไข"
function exitEditMode(form, titleId, cancelId, title, submitLabel) {
  $(titleId).textContent = title;
  form.querySelector("button[type=submit]").textContent = submitLabel;
  $(cancelId).hidden = true;
}

// จัดรูปแบบตัวเลขเงินแบบไทย เช่น 1200 -> "1,200" (ใช้แสดงค่าบริการในตาราง)
const baht = (n) => Number(n).toLocaleString("th-TH");

// แสดง/ล้างข้อความ error ใต้ช่องกรอก: inputId="gym-name" -> ข้อความไปที่ <small id="gym-name-error">
//   ใส่ aria-invalid ให้ช่องกรอก (เพื่อการเข้าถึงสำหรับโปรแกรมอ่านหน้าจอ) message ว่าง = ล้าง error
function setFieldError(inputId, message) {
  const input = $(inputId);
  const err = $(`${inputId}-error`);
  err.textContent = message || "";
  if (message) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", err.id);
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
}

// ครอบการ submit ฟอร์ม: ระหว่างรอ API ปิดปุ่ม submit + เปลี่ยนข้อความเป็น "กำลังบันทึก..." (กันกดซ้ำ)
// เสร็จแล้ว (สำเร็จหรือพัง) คืนปุ่มกลับเหมือนเดิมใน finally
//   task = ฟังก์ชัน async ที่ยิง API (อยู่ใน submit handler ของแต่ละฟอร์ม)
async function withSubmitting(form, label, task) {
  const button = form.querySelector("button[type=submit]");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ---------- แท็บ ----------
// ▶ FLOW-16  สลับแท็บ "สาขาและราคา" / "สมาชิก" / "การสมัครแพ็กเกจ" (ปุ่ม .tab ใน index.html มี data-tab="gyms|members|subscriptions")
//   ไม่ยิง API — แค่ซ่อน/แสดง <section id="tab-gyms|tab-members|tab-subscriptions">
//   (ข้อมูลทั้ง 3 แท็บถูกโหลดไว้แล้วตั้งแต่เปิดหน้า ดูท้ายไฟล์)
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tab")
      .forEach((b) => b.classList.toggle("active", b === btn)); // ไฮไลต์เฉพาะแท็บที่กด
    document.querySelectorAll(".panel").forEach((p) => {
      p.hidden = p.id !== `tab-${btn.dataset.tab}`; // แสดงเฉพาะ panel ที่ id ตรงกับ data-tab
    });
  });
});

// ---------- สถานะระบบ (GET /health) ----------
// ▶ FLOW-01  แถบ "ระบบพร้อมใช้งานทุกบริการ" ที่ <div id="health"> ใต้หัวข้อหน้า
//   เรียกตอนเปิดหน้า และซ้ำทุก 15 วินาที (setInterval ท้ายไฟล์)
//   ⚠ ใช้ fetch ตรง ๆ (ไม่ผ่าน api()) และยิงที่ "/health" ไม่ใช่ "/api/v1/health"
//   เส้นทาง: GET /health -> gateway/app.js app.get("/health") -> Gateway ยิง GET /health ไปทั้ง 3 บริการ
//            (gym-service:4001, member-service:4002, subscription-service:4003) พร้อมกัน แล้วสรุปกลับมา
//   ข้อมูลที่ได้: { status:"ok"|"degraded", gateway:"up", services:{ gym:"up", member:"up", subscription:"up" } }
async function loadHealth() {
  const el = $("health");
  try {
    const res = await fetch(ORIGIN + "/health");
    const data = await res.json();
    // รวบรวมชื่อบริการที่ไม่ใช่ "up" (เช่น ["gym","member"])
    const down = Object.entries(data.services)
      .filter(([, s]) => s !== "up")
      .map(([k]) => k);
    if (data.status === "ok") {
      el.textContent = "ระบบพร้อมใช้งานทุกบริการ";
      el.className = "health ok";
    } else {
      el.textContent = `บางบริการไม่พร้อม: ${down.join(", ")}`;
      el.className = "health bad";
    }
  } catch (err) {
    // Gateway เองก็ต่อไม่ได้
    el.textContent = "ไม่สามารถเชื่อมต่อ Gateway";
    el.className = "health bad";
  }
}

// ---------- สาขา ----------
// gymsCache = เก็บรายการสาขาล่าสุดที่โหลดมา ใช้เติม dropdown "สาขา" ในฟอร์มการสมัคร (FLOW-15)
let gymsCache = [];

// ▶ FLOW-02  โหลดและวาดตาราง "รายการสาขาและราคา" (แท็บ "สาขาและราคา")
//   ถูกเรียกจาก: (1) ท้ายไฟล์ตอนเปิดหน้า  (2) ปุ่ม "โหลดใหม่" id="gyms-refresh"
//               (3) หลังเพิ่ม/แก้ไข/ลบสาขาสำเร็จ
//   เส้นทาง: api("/gyms") -> GET /api/v1/gyms -> Gateway createProxy("gym")
//            -> gym-service app.get("/gyms") -> SQL "SELECT gym_id,name,address,monthly_fee FROM gyms"
//   ผลที่ได้ { data:[{gym_id,name,address,monthly_fee},...] } ถูกวาดเป็นแถวใน <table id="gyms-table"> <tbody>
async function loadGyms() {
  const state = $("gyms-state");
  const table = $("gyms-table");
  table.hidden = true; // ซ่อนตารางระหว่างโหลด
  setState(state, "loading", "กำลังโหลดรายการสาขา...");
  try {
    const { data } = await api("/gyms"); // ← ยิงไป Back end
    gymsCache = data; // เก็บไว้ให้ dropdown
    fillGymSelect(); // ← FLOW-15 เติม <select id="sub-gym"> ด้วยสาขาที่เพิ่งโหลด
    if (!data.length) {
      setState(state, "empty", "ยังไม่มีข้อมูลสาขาฟิตเนส");
      return;
    }
    const tbody = table.querySelector("tbody");
    tbody.replaceChildren(); // ล้างแถวเก่า
    data.forEach((gym) => {
      // วาด 1 แถวต่อ 1 สาขา: 4 คอลัมน์ข้อมูลตรงกับหัวตารางใน index.html (รหัส/ชื่อสาขา/ที่อยู่/ค่าบริการ)
      const tr = document.createElement("tr");
      tr.append(
        td(gym.gym_id),
        td(gym.name),
        td(gym.address),
        td(baht(gym.monthly_fee), "num"),
      );
      // คอลัมน์ที่ 5 "การทำงาน": 3 ปุ่ม สร้างด้วยมือ (ไม่ใช้ actionsCell เพราะมีปุ่มสภาพอากาศเพิ่ม)
      const actions = document.createElement("td");
      const box = document.createElement("div");
      box.className = "actions";
      // ปุ่ม 1 "ดูสภาพอากาศ" -> showWeather() = FLOW-03 (ยิง API)
      const weatherBtn = document.createElement("button");
      weatherBtn.type = "button";
      weatherBtn.className = "btn secondary small";
      weatherBtn.textContent = "ดูสภาพอากาศ";
      weatherBtn.addEventListener("click", () => showWeather(gym, weatherBtn));
      // ปุ่ม 2 "แก้ไข" -> startEditGym() = FLOW-05 ขั้นเตรียมฟอร์ม (ไม่ยิง API)
      const editBtn = actionButton("แก้ไข", "btn secondary small", () =>
        startEditGym(gym),
      );
      // ปุ่ม 3 "ลบ" -> deleteGym() = FLOW-06 (ยิง API DELETE)
      const delBtn = actionButton("ลบ", "btn danger", (b) => deleteGym(gym, b));
      box.append(weatherBtn, editBtn, delBtn);
      actions.append(box);
      tr.append(actions);
      tbody.append(tr);
    });
    table.hidden = false; // แสดงตาราง
    setState(state, "ready"); // ซ่อนกล่องสถานะ
  } catch (err) {
    // เช่น Gateway/บริการสาขาล่ม -> 503 "บริการสาขาไม่พร้อมใช้งาน..." แสดงเป็นกล่องแดง
    setState(state, "error", `โหลดรายการสาขาไม่สำเร็จ: ${err.message}`);
  }
}

// ▶ FLOW-03  ปุ่ม "ดูสภาพอากาศ" ที่แถวสาขา
//   เส้นทาง: api(`/gyms/${gym.gym_id}/weather`) -> GET /api/v1/gyms/1/weather -> Gateway
//            -> gym-service app.get("/gyms/:id/weather") -> SELECT สาขา + weather.js -> external-api.js
//            -> Open-Meteo (เว็บบริการสภาพอากาศบนอินเทอร์เน็ต)
//   ผลที่ได้ { data:{ gym:{name}, weather:{available, temperature_c, ...} } } แสดงใน <div id="weather-box">
async function showWeather(gym, button) {
  const box = $("weather-box");
  box.hidden = false;
  box.className = "weather";
  box.textContent = `กำลังดึงสภาพอากาศบริเวณ ${gym.name}...`; // ข้อความรอ (ปุ่มนี้อาจใช้เวลาหลายวินาทีถ้า API ภายนอกช้า)
  button.disabled = true; // กันกดซ้ำระหว่างรอ
  try {
    const { data } = await api(`/gyms/${gym.gym_id}/weather`); // ← ยิงไป Back end
    const w = data.weather;
    if (w.available) {
      // ดึงข้อมูลจริงสำเร็จ — ฟิลด์ที่ใช้มาจาก weather.js > parseWeather()
      //   ?? "-" = ถ้า Back end ส่ง null มา ให้แสดงเป็น "-"
      box.textContent =
        `${data.gym.name}: ${w.condition} อุณหภูมิ ${w.temperature_c}°C ` +
        `ความชื้น ${w.humidity_percent ?? "-"}% ฝน ${w.precipitation_mm ?? "-"} มม. ` +
        `ลม ${w.wind_speed_kmh ?? "-"} กม./ชม. (เวลา ${w.observed_at ?? "-"})`;
    } else {
      // API ภายนอกล้มเหลว -> backend ตอบ fallback แจ้งข้อความที่ชัดเจน
      // (Back end ตอบ HTTP 200 แต่ available:false จาก WEATHER_FALLBACK ใน gym-service/weather.js)
      box.className = "weather fallback";
      box.textContent = `${data.gym.name}: ${w.message}`;
    }
  } catch (err) {
    // เช่น 404 ไม่พบสาขา (ถูกลบไปแล้ว) หรือ 503 บริการสาขาล่ม
    box.className = "weather fallback";
    box.textContent = `ดึงสภาพอากาศไม่สำเร็จ: ${err.message}`;
  } finally {
    button.disabled = false;
  }
}

// ▶ FLOW-06  ปุ่ม "ลบ" (สีแดง) ที่แถวสาขา
//   เส้นทาง: window.confirm -> api(`/gyms/${gym.gym_id}`,{method:"DELETE"}) -> DELETE /api/v1/gyms/1
//            -> Gateway -> gym-service app.delete("/gyms/:id") -> SQL "DELETE FROM gyms WHERE gym_id=?"
//            (MySQL ลบแถว subscriptions ของสาขานี้ตามอัตโนมัติด้วย ON DELETE CASCADE ใน schema.sql)
//   หลังสำเร็จ: toast(res.message) + โหลดทั้งตารางสาขาและตารางการสมัครใหม่ (Promise.all = ยิงพร้อมกัน)
//   ที่ต้องโหลดการสมัครด้วย เพราะแถวการสมัครของสาขานี้หายไปแล้ว
async function deleteGym(gym, button) {
  const ok = window.confirm(
    `ลบสาขา "${gym.name}" ?\nประวัติการสมัครทั้งหมดของสาขานี้จะถูกลบไปด้วย`,
  );
  if (!ok) return; // กด "ยกเลิก" ใน popup = ไม่ทำอะไร ไม่ยิง API
  button.disabled = true;
  try {
    const res = await api(`/gyms/${gym.gym_id}`, { method: "DELETE" }); // ← ยิงไป Back end
    toast(res.message); // "ลบสาขาฟิตเนสและประวัติการสมัครที่เกี่ยวข้องสำเร็จ"
    // ถ้าสาขาที่เพิ่งลบเป็นตัวที่กำลังแก้ไขอยู่ในฟอร์ม ให้ออกจากโหมดแก้ไข
    if (editingGymId === gym.gym_id) cancelEditGym();
    await Promise.all([loadGyms(), loadSubscriptions()]); // รีเฟรช FLOW-02 + FLOW-11
  } catch (err) {
    toast(`ลบสาขาไม่สำเร็จ: ${err.message}`, true);
    button.disabled = false; // ให้กดลองใหม่ได้
  }
}

// ตรวจฟอร์มสาขาฝั่งหน้าเว็บก่อนส่ง (ขั้นแรกของ FLOW-04 และ FLOW-05)
//   ผ่าน  -> คืน { name, address, monthly_fee } (= body ที่จะส่งให้ Back end)
//   ไม่ผ่าน -> แสดงข้อความแดงใต้ช่องที่ผิด และคืน null (ไม่ยิง API)
//   กติกาตรงกับ validateGymBody() ใน src/shared/validators.js (Back end ตรวจซ้ำอีกชั้น)
function validateGymForm() {
  const name = $("gym-name").value.trim(); // <input id="gym-name">
  const address = $("gym-address").value.trim(); // <textarea id="gym-address">
  const feeRaw = $("gym-fee").value.trim(); // <input id="gym-fee" type="number">
  const fee = Number(feeRaw);
  let valid = true;
  const nameMsg = !name
    ? "กรุณากรอกชื่อสาขา"
    : name.length > 150
      ? "ชื่อสาขายาวเกิน 150 ตัวอักษร"
      : "";
  const addrMsg = !address ? "กรุณากรอกที่อยู่" : "";
  const feeMsg =
    feeRaw === ""
      ? "กรุณากรอกค่าบริการ"
      : !Number.isInteger(fee) || fee < 0
        ? "ค่าบริการต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป"
        : "";
  setFieldError("gym-name", nameMsg);
  setFieldError("gym-address", addrMsg);
  setFieldError("gym-fee", feeMsg);
  valid = !nameMsg && !addrMsg && !feeMsg;
  // monthly_fee เป็น Number (ไม่ใช่ข้อความ) เพราะ Back end ตรวจ Number.isInteger()
  return valid ? { name, address, monthly_fee: fee } : null;
}

// ----- โหมดแก้ไขสาขา (ใช้ฟอร์มเดียวกับตอนเพิ่ม แล้วเรียก PUT /gyms/:id) -----
// editingGymId: null = ฟอร์มอยู่ "โหมดเพิ่ม" / เป็นตัวเลข = "โหมดแก้ไข" สาขารหัสนั้น
// ตัวแปรนี้คือสวิตช์ที่ทำให้ฟอร์มเดียวเลือกยิง POST (FLOW-04) หรือ PUT (FLOW-05) ตอน submit
let editingGymId = null;

// ▶ FLOW-05 (ขั้นที่ 1) ปุ่ม "แก้ไข" ที่แถวสาขา — "ไม่ยิง API"
//   เอาข้อมูลของแถวนั้น (อ็อบเจ็กต์ gym ที่ได้จาก FLOW-02) ไปเติมช่องฟอร์ม แล้วสลับเป็นโหมดแก้ไข
function startEditGym(gym) {
  editingGymId = gym.gym_id;
  $("gym-name").value = gym.name;
  $("gym-address").value = gym.address;
  $("gym-fee").value = gym.monthly_fee;
  ["gym-name", "gym-address", "gym-fee"].forEach((id) => setFieldError(id, ""));
  enterEditMode(
    $("gym-form"),
    "gym-form-title",
    "gym-cancel",
    `แก้ไขสาขา #${gym.gym_id} (ผู้ดูแลระบบ)`,
    "บันทึกการแก้ไข", // ข้อความบนปุ่ม submit เปลี่ยนเป็น "บันทึกการแก้ไข"
  );
}

// ปุ่ม "ยกเลิกการแก้ไข" (id="gym-cancel") — ล้างฟอร์ม + กลับเป็นโหมดเพิ่ม (ไม่ยิง API)
function cancelEditGym() {
  editingGymId = null;
  $("gym-form").reset();
  ["gym-name", "gym-address", "gym-fee"].forEach((id) => setFieldError(id, ""));
  exitEditMode(
    $("gym-form"),
    "gym-form-title",
    "gym-cancel",
    "เพิ่มสาขาใหม่ (ผู้ดูแลระบบ)",
    "บันทึกสาขา",
  );
}
$("gym-cancel").addEventListener("click", cancelEditGym);

// ▶ FLOW-04 + FLOW-05 (ขั้นที่ 2)  กด submit ของ <form id="gym-form">
//   editingGymId === null  -> FLOW-04 "เพิ่มสาขา"   : POST /api/v1/gyms      -> gym-service app.post("/gyms")
//   editingGymId !== null  -> FLOW-05 "แก้ไขสาขา"    : PUT  /api/v1/gyms/:id  -> gym-service app.put("/gyms/:id")
//   (ปุ่มที่กดคือปุ่ม "บันทึกสาขา" หรือ "บันทึกการแก้ไข" — ปุ่มเดียวกัน ข้อความเปลี่ยนตามโหมด)
$("gym-form").addEventListener("submit", async (e) => {
  e.preventDefault(); // กันเบราว์เซอร์ส่งฟอร์มแบบรีโหลดหน้า
  const body = validateGymForm(); // ตรวจฝั่งหน้าเว็บ
  if (!body) return; // ไม่ผ่าน = หยุด ไม่ยิง API
  const editing = editingGymId !== null;
  await withSubmitting(e.target, "กำลังบันทึก...", async () => {
    try {
      // ← ยิงไป Back end: เลือก PUT หรือ POST ตามโหมด
      const res = editing
        ? await api(`/gyms/${editingGymId}`, { method: "PUT", body })
        : await api("/gyms", { method: "POST", body });
      toast(res.message); // "เพิ่มข้อมูลสาขาฟิตเนสสำเร็จ" / "อัปเดตข้อมูลสาขาฟิตเนสสำเร็จ"
      if (editing) cancelEditGym();
      else e.target.reset(); // เพิ่มสำเร็จ -> ล้างฟอร์มพร้อมกรอกสาขาถัดไป
      // รีเฟรชตารางสาขา (FLOW-02); ถ้าเป็นการแก้ไข รีเฟรชตารางการสมัคร (FLOW-11) ด้วย
      // เพราะตารางการสมัครแสดงชื่อ/ค่าบริการของสาขา ซึ่งอาจเพิ่งเปลี่ยน (null ที่ส่งใน Promise.all ถูกข้าม)
      await Promise.all([loadGyms(), editing ? loadSubscriptions() : null]);
    } catch (err) {
      toast(
        `${editing ? "แก้ไข" : "เพิ่ม"}สาขาไม่สำเร็จ: ${err.message}`,
        true,
      );
    }
  });
});

// ปุ่ม "โหลดใหม่" ของการ์ดรายการสาขา = เรียก FLOW-02 ซ้ำ
$("gyms-refresh").addEventListener("click", loadGyms);

// ---------- สมาชิก ----------
// membersCache = เก็บรายชื่อสมาชิกล่าสุด ใช้เติม dropdown "สมาชิก" ในฟอร์มการสมัคร (FLOW-15)
let membersCache = [];

// ▶ FLOW-07  โหลดและวาดตาราง "รายชื่อสมาชิก" (แท็บ "สมาชิก")
//   ถูกเรียกจาก: (1) ท้ายไฟล์ตอนเปิดหน้า (2) ปุ่ม "โหลดใหม่" id="members-refresh"
//               (3) หลังลงทะเบียน/แก้ไข/ลบสมาชิกสำเร็จ
//   เส้นทาง: api("/members") -> GET /api/v1/members -> Gateway createProxy("member")
//            -> member-service app.get("/members") -> SQL "SELECT member_id,name,email FROM members"
async function loadMembers() {
  const state = $("members-state");
  const table = $("members-table");
  table.hidden = true;
  setState(state, "loading", "กำลังโหลดรายชื่อสมาชิก...");
  try {
    const { data } = await api("/members"); // ← ยิงไป Back end
    membersCache = data;
    fillMemberSelect(); // ← FLOW-15 เติม <select id="sub-member">
    if (!data.length) {
      setState(state, "empty", "ยังไม่มีข้อมูลสมาชิก");
      return;
    }
    const tbody = table.querySelector("tbody");
    tbody.replaceChildren();
    data.forEach((m) => {
      // 1 แถวต่อสมาชิก: รหัส / ชื่อ / อีเมล + คอลัมน์ปุ่ม "แก้ไข" "ลบ"
      const tr = document.createElement("tr");
      tr.append(
        td(m.member_id),
        td(m.name),
        td(m.email),
        actionsCell(
          // ปุ่ม "แก้ไข" -> startEditMember(m) = FLOW-09 ขั้นเตรียมฟอร์ม (ไม่ยิง API)
          actionButton("แก้ไข", "btn secondary small", () => startEditMember(m)),
          // ปุ่ม "ลบ" -> deleteMember(m, ปุ่ม) = FLOW-10 (ยิง API DELETE)
          actionButton("ลบ", "btn danger", (b) => deleteMember(m, b)),
        ),
      );
      tbody.append(tr);
    });
    table.hidden = false;
    setState(state, "ready");
  } catch (err) {
    setState(state, "error", `โหลดรายชื่อสมาชิกไม่สำเร็จ: ${err.message}`);
  }
}

// ตรวจฟอร์มสมาชิกฝั่งหน้าเว็บก่อนส่ง (ขั้นแรกของ FLOW-08 และ FLOW-09)
//   ผ่าน -> { name, email } = body ที่ส่งให้ Back end / ไม่ผ่าน -> แสดง error ใต้ช่อง คืน null
//   กติกาตรงกับ validateMemberBody() ใน src/shared/validators.js
function validateMemberForm() {
  const name = $("member-name").value.trim(); // <input id="member-name">
  const email = $("member-email").value.trim(); // <input id="member-email">
  const nameMsg = !name
    ? "กรุณากรอกชื่อ-นามสกุล"
    : name.length > 150
      ? "ชื่อยาวเกิน 150 ตัวอักษร"
      : "";
  const emailMsg = !email
    ? "กรุณากรอกอีเมล"
    : !EMAIL_PATTERN.test(email) || email.length > 150
      ? "รูปแบบอีเมลไม่ถูกต้อง"
      : "";
  setFieldError("member-name", nameMsg);
  setFieldError("member-email", emailMsg);
  return !nameMsg && !emailMsg ? { name, email } : null;
}

// ----- โหมดแก้ไขสมาชิก (เรียก PUT /members/:id) -----
// editingMemberId: null = โหมดลงทะเบียนใหม่ (POST) / เป็นตัวเลข = โหมดแก้ไข (PUT)
let editingMemberId = null;

// ▶ FLOW-09 (ขั้นที่ 1) ปุ่ม "แก้ไข" ที่แถวสมาชิก — ไม่ยิง API (เติมฟอร์มจากข้อมูลแถว แล้วสลับโหมด)
function startEditMember(member) {
  editingMemberId = member.member_id;
  $("member-name").value = member.name;
  $("member-email").value = member.email;
  ["member-name", "member-email"].forEach((id) => setFieldError(id, ""));
  enterEditMode(
    $("member-form"),
    "member-form-title",
    "member-cancel",
    `แก้ไขสมาชิก #${member.member_id} (พนักงาน)`,
    "บันทึกการแก้ไข",
  );
}

// ปุ่ม "ยกเลิกการแก้ไข" (id="member-cancel") — กลับเป็นโหมดลงทะเบียนใหม่ (ไม่ยิง API)
function cancelEditMember() {
  editingMemberId = null;
  $("member-form").reset();
  ["member-name", "member-email"].forEach((id) => setFieldError(id, ""));
  exitEditMode(
    $("member-form"),
    "member-form-title",
    "member-cancel",
    "ลงทะเบียนสมาชิกใหม่ (พนักงาน)",
    "ลงทะเบียน",
  );
}
$("member-cancel").addEventListener("click", cancelEditMember);

// ▶ FLOW-10  ปุ่ม "ลบ" ที่แถวสมาชิก
//   เส้นทาง: window.confirm -> api(`/members/${id}`,{method:"DELETE"}) -> DELETE /api/v1/members/3
//            -> Gateway -> member-service app.delete("/members/:id") -> SQL "DELETE FROM members WHERE member_id=?"
//            (การสมัครของสมาชิกคนนี้ถูกลบตามด้วย ON DELETE CASCADE) -> หน้าเว็บโหลดสมาชิก + การสมัครใหม่
async function deleteMember(member, button) {
  const ok = window.confirm(
    `ลบสมาชิก "${member.name}" ?\nประวัติการสมัครแพ็กเกจทั้งหมดของสมาชิกคนนี้จะถูกลบไปด้วย`,
  );
  if (!ok) return;
  button.disabled = true;
  try {
    const res = await api(`/members/${member.member_id}`, { method: "DELETE" }); // ← ยิงไป Back end
    toast(res.message); // "ลบสมาชิกและประวัติการสมัครที่เกี่ยวข้องสำเร็จ"
    if (editingMemberId === member.member_id) cancelEditMember();
    await Promise.all([loadMembers(), loadSubscriptions()]); // รีเฟรช FLOW-07 + FLOW-11
  } catch (err) {
    toast(`ลบสมาชิกไม่สำเร็จ: ${err.message}`, true);
    button.disabled = false;
  }
}

// ▶ FLOW-08 + FLOW-09 (ขั้นที่ 2)  กด submit ของ <form id="member-form">
//   editingMemberId === null -> FLOW-08 "ลงทะเบียน"     : POST /api/v1/members      -> member-service app.post("/members")
//   editingMemberId !== null -> FLOW-09 "บันทึกการแก้ไข"  : PUT  /api/v1/members/:id  -> member-service app.put("/members/:id")
$("member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = validateMemberForm();
  if (!body) return;
  const editing = editingMemberId !== null;
  await withSubmitting(
    e.target,
    editing ? "กำลังบันทึก..." : "กำลังลงทะเบียน...",
    async () => {
      try {
        // ← ยิงไป Back end
        const res = editing
          ? await api(`/members/${editingMemberId}`, { method: "PUT", body })
          : await api("/members", { method: "POST", body });
        toast(res.message); // "ลงทะเบียนสมาชิกสำเร็จ" / "อัปเดตข้อมูลสมาชิกสำเร็จ"
        if (editing) cancelEditMember();
        else e.target.reset();
        // รีเฟรชตารางสมาชิก; ถ้าแก้ไข รีเฟรชตารางการสมัครด้วย (เพราะแสดงชื่อสมาชิก)
        await Promise.all([loadMembers(), editing ? loadSubscriptions() : null]);
      } catch (err) {
        // เช่น 409 DUPLICATE_EMAIL: แสดงข้อความจาก API ที่ช่องอีเมลโดยตรง
        // (409 มาจาก member-service: MySQL UNIQUE(email) ชน -> ER_DUP_ENTRY -> HttpError 409
        //  แล้ว Gateway ส่งต่อมาตามเดิม -> api() ทำเป็น ApiError ที่ err.code = "DUPLICATE_EMAIL")
        if (err.code === "DUPLICATE_EMAIL")
          setFieldError("member-email", err.message);
        toast(
          `${editing ? "แก้ไข" : "ลงทะเบียน"}ไม่สำเร็จ: ${err.message}`,
          true,
        );
      }
    },
  );
});

// ปุ่ม "โหลดใหม่" ของการ์ดรายชื่อสมาชิก = เรียก FLOW-07 ซ้ำ
$("members-refresh").addEventListener("click", loadMembers);

// ---------- การสมัครแพ็กเกจ ----------
// ▶ FLOW-15  เติมตัวเลือกใน dropdown (ไม่ยิง API เอง — ใช้ข้อมูลที่ FLOW-02/FLOW-07 โหลดไว้ใน cache แล้ว)
//   select = <select> ที่จะเติม / items = อาร์เรย์ข้อมูล / valueKey = ฟิลด์ที่เป็นค่า (value) ของ option
//   labelFn = ฟังก์ชันสร้างข้อความที่แสดง / placeholder = ตัวเลือกแรก (ค่าว่าง)
function fillSelect(select, items, valueKey, labelFn, placeholder) {
  const current = select.value; // จำค่าที่เลือกอยู่ไว้ (เพื่อไม่ให้ค่าที่ผู้ใช้เลือกหายเมื่อโหลดข้อมูลใหม่)
  select.replaceChildren();
  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder;
  select.append(first);
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = String(item[valueKey]); // เช่น member_id -> ค่านี้แหละที่กลายเป็น member_id ใน body ของ POST /subscriptions
    opt.textContent = labelFn(item);
    select.append(opt);
  });
  // คืนค่าที่เลือกไว้ ถ้ายังมีอยู่ในรายการใหม่
  if ([...select.options].some((o) => o.value === current))
    select.value = current;
}
// dropdown "สมาชิก" <select id="sub-member"> ← ข้อมูลจาก membersCache ← FLOW-07 (member-service GET /members)
//   แสดงเป็น "ชื่อ (อีเมล)"
const fillMemberSelect = () =>
  fillSelect(
    $("sub-member"),
    membersCache,
    "member_id",
    (m) => `${m.name} (${m.email})`,
    "-- เลือกสมาชิก --",
  );
// dropdown "สาขา" <select id="sub-gym"> ← ข้อมูลจาก gymsCache ← FLOW-02 (gym-service GET /gyms)
const fillGymSelect = () =>
  fillSelect(
    $("sub-gym"),
    gymsCache,
    "gym_id",
    (g) => g.name,
    "-- เลือกสาขา --",
  );

// ตรวจฟอร์มการสมัครฝั่งหน้าเว็บก่อนส่ง (ขั้นแรกของ FLOW-12; ถ้าอยู่โหมดแก้ไขจะส่งต่อไป validateSubEditForm ของ FLOW-13)
//   ผ่าน -> { member_id, gym_id, [start_date] } = body ของ POST /subscriptions
//   start_date ใส่เฉพาะเมื่อผู้ใช้เลือกวันที่ — ถ้าเว้นว่าง Back end ใช้ "วันนี้" (COALESCE(?, CURDATE()))
function validateSubForm() {
  if (editingSubId !== null) return validateSubEditForm();
  const memberId = Number($("sub-member").value); // value ของ option = member_id (ตัวเลข) ; ว่าง -> 0
  const gymId = Number($("sub-gym").value);
  const date = $("sub-date").value; // <input type="date"> ให้ค่าเป็น "YYYY-MM-DD" หรือ ""
  const memberMsg = !memberId ? "กรุณาเลือกสมาชิก" : "";
  const gymMsg = !gymId ? "กรุณาเลือกสาขา" : "";
  const dateMsg =
    date && !/^\d{4}-\d{2}-\d{2}$/.test(date) ? "รูปแบบวันที่ไม่ถูกต้อง" : "";
  setFieldError("sub-member", memberMsg);
  setFieldError("sub-gym", gymMsg);
  setFieldError("sub-date", dateMsg);
  if (memberMsg || gymMsg || dateMsg) return null;
  const body = { member_id: memberId, gym_id: gymId };
  if (date) body.start_date = date;
  return body;
}

// ----- โหมดแก้ไขการสมัคร (เรียก PUT /subscriptions/:id) -----
// แก้ได้: สาขา วันที่เริ่ม สถานะ (สมาชิกเปลี่ยนไม่ได้ จึงล็อกช่องสมาชิกไว้)
// editingSubId: null = โหมดบันทึกการสมัครใหม่ (POST) / เป็นตัวเลข = โหมดแก้ไข (PUT)
let editingSubId = null;
// รายชื่อช่องในฟอร์มการสมัคร ไว้ล้างข้อความ error ทีเดียว
const SUB_FIELDS = ["sub-member", "sub-gym", "sub-date", "sub-status"];

// ตรวจฟอร์มโหมดแก้ไขการสมัคร -> body = { gym_id, start_date, status } (ขั้นแรกของ FLOW-13)
//   กติกาตรงกับ validateSubscriptionUpdateBody() ใน src/shared/validators.js
//   (ต่างจากตอนเพิ่ม: ไม่มี member_id, วันที่ "บังคับ", และมี status)
function validateSubEditForm() {
  const gymId = Number($("sub-gym").value);
  const date = $("sub-date").value;
  const status = $("sub-status").value; // <select id="sub-status"> active / expired / cancelled
  const gymMsg = !gymId ? "กรุณาเลือกสาขา" : "";
  const dateMsg = !date
    ? "กรุณาระบุวันที่เริ่ม"
    : !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ? "รูปแบบวันที่ไม่ถูกต้อง"
      : "";
  const statusMsg = ["active", "expired", "cancelled"].includes(status)
    ? ""
    : "กรุณาเลือกสถานะ";
  setFieldError("sub-gym", gymMsg);
  setFieldError("sub-date", dateMsg);
  setFieldError("sub-status", statusMsg);
  if (gymMsg || dateMsg || statusMsg) return null;
  return { gym_id: gymId, start_date: date, status };
}

// ▶ FLOW-13 (ขั้นที่ 1) ปุ่ม "แก้ไข" ที่แถวการสมัคร — ไม่ยิง API
//   เติมฟอร์มจากข้อมูลแถว (s = แถวที่ได้จาก FLOW-11) + ล็อกช่องสมาชิก + โชว์ช่อง "สถานะ"
//   ที่ใช้ s.member_id / s.gym_id / s.start_date / s.status ได้ เพราะ SQL ใน subscription-service
//   ส่งคอลัมน์เหล่านี้มาครบ (และ start_date เป็นสตริง YYYY-MM-DD จาก DATE_FORMAT จึงใส่ <input type="date"> ได้ตรง ๆ)
function startEditSubscription(s) {
  editingSubId = s.subscription_id;
  fillMemberSelect(); // เติม dropdown ให้ครบก่อนตั้งค่า (FLOW-15)
  fillGymSelect();
  $("sub-member").value = String(s.member_id);
  $("sub-member").disabled = true; // เปลี่ยนสมาชิกไม่ได้ (Back end PUT ไม่รับ member_id)
  $("sub-gym").value = String(s.gym_id);
  $("sub-date").value = s.start_date;
  $("sub-status").value = s.status;
  $("sub-status-field").hidden = false; // ช่อง "สถานะ" ซ่อนอยู่ตอนเพิ่ม โชว์เฉพาะตอนแก้ไข
  SUB_FIELDS.forEach((id) => setFieldError(id, ""));
  enterEditMode(
    $("sub-form"),
    "sub-form-title",
    "sub-cancel",
    `แก้ไขการสมัครแพ็กเกจ #${s.subscription_id} (พนักงาน)`,
    "บันทึกการแก้ไข",
  );
}

// ปุ่ม "ยกเลิกการแก้ไข" (id="sub-cancel") — กลับเป็นโหมดบันทึกการสมัครใหม่ (ไม่ยิง API)
function cancelEditSubscription() {
  editingSubId = null;
  $("sub-form").reset();
  $("sub-member").disabled = false; // ปลดล็อกช่องสมาชิก
  $("sub-status-field").hidden = true; // ซ่อนช่องสถานะ
  SUB_FIELDS.forEach((id) => setFieldError(id, ""));
  exitEditMode(
    $("sub-form"),
    "sub-form-title",
    "sub-cancel",
    "บันทึกการสมัครแพ็กเกจ (พนักงาน)",
    "บันทึกการสมัคร",
  );
}
$("sub-cancel").addEventListener("click", cancelEditSubscription);

// ▶ FLOW-14  ปุ่ม "ลบ" ที่แถวการสมัคร
//   เส้นทาง: window.confirm -> api(`/subscriptions/${id}`,{method:"DELETE"}) -> DELETE /api/v1/subscriptions/5
//            -> Gateway -> subscription-service app.delete("/subscriptions/:id") -> SQL "DELETE FROM subscriptions WHERE subscription_id=?"
//   ลบเฉพาะการสมัคร (สมาชิกและสาขายังอยู่) -> หน้าเว็บโหลดเฉพาะตารางการสมัครใหม่ (FLOW-11)
async function deleteSubscription(s, button) {
  const ok = window.confirm(
    `ลบการสมัครแพ็กเกจ #${s.subscription_id}\nของ "${s.member_name}" ที่สาขา "${s.gym_name}" ?`,
  );
  if (!ok) return;
  button.disabled = true;
  try {
    const res = await api(`/subscriptions/${s.subscription_id}`, {
      method: "DELETE",
    }); // ← ยิงไป Back end
    toast(res.message); // "ลบการสมัครแพ็กเกจสำเร็จ"
    if (editingSubId === s.subscription_id) cancelEditSubscription();
    await loadSubscriptions();
  } catch (err) {
    toast(`ลบการสมัครไม่สำเร็จ: ${err.message}`, true);
    button.disabled = false;
  }
}

// ▶ FLOW-12 + FLOW-13 (ขั้นที่ 2)  กด submit ของ <form id="sub-form">
//   editingSubId === null -> FLOW-12 ปุ่ม "บันทึกการสมัคร"   : POST /api/v1/subscriptions     -> subscription-service app.post
//        (Back end จะ "ถาม member-service และ gym-service" ก่อน INSERT — ดู ensureExists ใน subscription-service/app.js)
//   editingSubId !== null -> FLOW-13 ปุ่ม "บันทึกการแก้ไข"    : PUT  /api/v1/subscriptions/:id -> subscription-service app.put
//        (Back end ถาม gym-service ตรวจสาขาใหม่ แล้ว UPDATE)
//   error ที่เป็นไปได้ที่จะเห็นใน toast: 404 MEMBER_NOT_FOUND/GYM_NOT_FOUND, 409 ALREADY_SUBSCRIBED, 503 DEPENDENCY_UNAVAILABLE
$("sub-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = validateSubForm();
  if (!body) return;
  const editing = editingSubId !== null;
  await withSubmitting(e.target, "กำลังบันทึก...", async () => {
    try {
      // ← ยิงไป Back end
      const res = editing
        ? await api(`/subscriptions/${editingSubId}`, { method: "PUT", body })
        : await api("/subscriptions", { method: "POST", body });
      toast(res.message); // "บันทึกการสมัครแพ็กเกจสำเร็จ" / "อัปเดตการสมัครแพ็กเกจสำเร็จ"
      if (editing) cancelEditSubscription();
      else e.target.reset();
      await loadSubscriptions(); // รีเฟรชตารางประวัติการสมัคร (FLOW-11)
    } catch (err) {
      toast(
        `${editing ? "แก้ไข" : "บันทึก"}การสมัครไม่สำเร็จ: ${err.message}`,
        true,
      );
    }
  });
});

// ▶ FLOW-11  โหลดและวาดตาราง "ประวัติการสมัครแพ็กเกจ (ผู้ดูแลระบบ)" (แท็บ "การสมัครแพ็กเกจ")
//   ถูกเรียกจาก: (1) ท้ายไฟล์ตอนเปิดหน้า (2) ปุ่ม "ค้นหา" (3) ปุ่ม "ล้าง"
//               (4) หลังเพิ่ม/แก้ไข/ลบ การสมัคร สมาชิก สาขา
//   เส้นทาง: api(`/subscriptions?member_name=...`) -> GET /api/v1/subscriptions?member_name=...
//            -> Gateway createProxy("subscription") (ส่ง query string ต่อด้วย)
//            -> subscription-service app.get("/subscriptions")
//            -> SQL SELECT ... FROM subscriptions JOIN members JOIN gyms [WHERE m.name LIKE ?]
//   ฟิลด์ที่ใช้วาดตารางมาจากชื่อคอลัมน์ที่ตั้งไว้ใน SQL: subscription_id, member_name, gym_name, monthly_fee, start_date, status
async function loadSubscriptions() {
  const state = $("subs-state");
  const table = $("subs-table");
  const name = $("sub-search-name").value.trim(); // คำค้นจากช่อง <input id="sub-search-name"> (ว่าง = ไม่กรอง)
  table.hidden = true;
  setState(state, "loading", "กำลังโหลดประวัติการสมัคร...");
  try {
    // มีคำค้น -> ต่อ ?member_name=<คำค้นที่เข้ารหัส URL> ; ไม่มี -> ไม่ใส่ query
    // encodeURIComponent จำเป็นสำหรับภาษาไทย/อักขระพิเศษ
    const query = name ? `?member_name=${encodeURIComponent(name)}` : "";
    const { data, message } = await api(`/subscriptions${query}`); // ← ยิงไป Back end
    if (!data.length) {
      // ไม่มีข้อมูล (หรือค้นแล้วไม่เจอ) -> แสดงข้อความ "ไม่พบประวัติการสมัครในขณะนี้" ที่ Back end ส่งมาใน message
      setState(state, "empty", message);
      return;
    }
    const tbody = table.querySelector("tbody");
    tbody.replaceChildren();
    data.forEach((s) => {
      // 1 แถวต่อ 1 การสมัคร: รหัส / สมาชิก / สาขา / ค่าบริการ / เริ่มวันที่ / สถานะ / ปุ่ม
      const tr = document.createElement("tr");
      tr.append(
        td(s.subscription_id),
        td(s.member_name), // ← มาจาก m.name AS member_name (JOIN members)
        td(s.gym_name), // ← มาจาก g.name AS gym_name (JOIN gyms)
        td(baht(s.monthly_fee), "num"), // ← มาจาก g.monthly_fee (JOIN gyms)
        td(s.start_date),
        td(s.status),
        actionsCell(
          // ปุ่ม "แก้ไข" -> startEditSubscription(s) = FLOW-13 ขั้นเตรียมฟอร์ม (ไม่ยิง API)
          actionButton("แก้ไข", "btn secondary small", () =>
            startEditSubscription(s),
          ),
          // ปุ่ม "ลบ" -> deleteSubscription(s, ปุ่ม) = FLOW-14 (ยิง API DELETE)
          actionButton("ลบ", "btn danger", (b) => deleteSubscription(s, b)),
        ),
      );
      tbody.append(tr);
    });
    table.hidden = false;
    setState(state, "ready");
  } catch (err) {
    setState(state, "error", `โหลดประวัติการสมัครไม่สำเร็จ: ${err.message}`);
  }
}

// ปุ่ม "ค้นหา" (submit ของ <form id="sub-search">) -> FLOW-11 โดยอ่านคำค้นจากช่อง sub-search-name
$("sub-search").addEventListener("submit", (e) => {
  e.preventDefault();
  loadSubscriptions();
});
// ปุ่ม "ล้าง" (id="sub-search-clear") -> ล้างช่องค้นหา แล้ว FLOW-11 อีกครั้ง (ไม่มี query = ได้ทุกแถว)
$("sub-search-clear").addEventListener("click", () => {
  $("sub-search-name").value = "";
  loadSubscriptions();
});

// ▶ FLOW-00  "ทำงานทันทีที่หน้าเว็บโหลดเสร็จ" (บรรทัดเหล่านี้รันตอนเบราว์เซอร์อ่าน <script src="app.js">)
//   เบราว์เซอร์ขอ GET / (index.html) -> styles.css -> app.js จาก Gateway (express.static) แล้วจึงมาถึงตรงนี้
//   จากนั้นยิง 4 งานพร้อมกัน (ไม่รอกัน):
loadHealth(); // FLOW-01: ถามสถานะระบบ
setInterval(loadHealth, 15000); // FLOW-01: ถามซ้ำทุก 15,000 มิลลิวินาที = 15 วินาที
loadGyms(); // FLOW-02: โหลดสาขา -> GET /api/v1/gyms          (ได้ข้อมูลเติม dropdown สาขาด้วย)
loadMembers(); // FLOW-07: โหลดสมาชิก -> GET /api/v1/members  (ได้ข้อมูลเติม dropdown สมาชิกด้วย)
loadSubscriptions(); // FLOW-11: โหลดประวัติการสมัคร -> GET /api/v1/subscriptions
