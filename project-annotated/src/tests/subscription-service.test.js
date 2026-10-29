// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/subscription-service.test.js
// ============================================================================
// ทดสอบโค้ดของ : src/subscription-service/app.js
// ทดสอบอะไร    : ตรวจ route หลังปุ่มของแท็บ "การสมัครแพ็กเกจ" : GET+ค้นหา (FLOW-11), POST (FLOW-12), PUT (FLOW-13), DELETE (FLOW-14) — mock ฐานข้อมูลและ fetch ไปบริการอื่น
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ทดสอบ subscription-service: mock ฐานข้อมูล และ mock การเรียกข้ามบริการ (fetchJsonWithRetry)
jest.mock("../shared/db", () => ({ query: jest.fn() }));
jest.mock("../shared/external-api", () => ({ fetchJsonWithRetry: jest.fn() }));

const request = require("supertest");
const pool = require("../shared/db");
const { fetchJsonWithRetry } = require("../shared/external-api");
const app = require("../subscription-service/app");

const subRow = {
  subscription_id: 7,
  member_id: 3,
  gym_id: 2,
  start_date: "2026-10-10",
  status: "active",
};
const notFound = () => Object.assign(new Error("HTTP 404"), { status: 404 });

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  pool.query.mockReset();
  fetchJsonWithRetry.mockReset();
  delete process.env.MEMBER_SERVICE_URL;
  delete process.env.GYM_SERVICE_URL;
  delete process.env.SERVICE_CALL_TIMEOUT_MS;
  delete process.env.SERVICE_CALL_MAX_RETRIES;
  delete process.env.SERVICE_CALL_BASE_DELAY_MS;
});

describe("GET /health", () => {
  it("ตอบสถานะของบริการ", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok", service: "subscription-service" });
  });
});

describe("POST /subscriptions", () => {
  const body = { member_id: 3, gym_id: 2, start_date: "2026-10-10" };

  function mockInsertOk() {
    pool.query.mockResolvedValueOnce([{ insertId: 7 }]).mockResolvedValueOnce([[subRow]]);
  }

  it("สมัครสำเร็จ -> 201 status active (ตรวจสมาชิกก่อน แล้วตรวจสาขา)", async () => {
    fetchJsonWithRetry.mockResolvedValue({});
    mockInsertOk();
    const res = await request(app).post("/subscriptions").send(body).expect(201);
    expect(res.body.message).toBe("บันทึกการสมัครแพ็กเกจสำเร็จ");
    expect(res.body.data).toEqual(subRow);
    expect(fetchJsonWithRetry).toHaveBeenCalledTimes(2);
    expect(fetchJsonWithRetry).toHaveBeenNthCalledWith(
      1,
      "http://localhost:4002/members/3",
      { timeoutMs: 2000, maxRetries: 2, baseDelayMs: 200 },
    );
    expect(fetchJsonWithRetry).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4001/gyms/2",
      { timeoutMs: 2000, maxRetries: 2, baseDelayMs: 200 },
    );
    expect(pool.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO subscriptions"),
      [3, 2, "2026-10-10"],
    );
  });

  it("ไม่ส่ง start_date -> ส่ง null ให้ฐานข้อมูลใช้วันนี้ (CURDATE)", async () => {
    fetchJsonWithRetry.mockResolvedValue({});
    mockInsertOk();
    await request(app).post("/subscriptions").send({ member_id: 3, gym_id: 2 }).expect(201);
    expect(pool.query).toHaveBeenNthCalledWith(1, expect.any(String), [3, 2, null]);
  });

  it("อ่านที่อยู่บริการและค่า retry จาก .env", async () => {
    process.env.MEMBER_SERVICE_URL = "http://member:9002";
    process.env.GYM_SERVICE_URL = "http://gym:9001";
    process.env.SERVICE_CALL_TIMEOUT_MS = "500";
    process.env.SERVICE_CALL_MAX_RETRIES = "0";
    process.env.SERVICE_CALL_BASE_DELAY_MS = "10";
    fetchJsonWithRetry.mockResolvedValue({});
    mockInsertOk();
    await request(app).post("/subscriptions").send(body).expect(201);
    expect(fetchJsonWithRetry).toHaveBeenNthCalledWith(
      1,
      "http://member:9002/members/3",
      { timeoutMs: 500, maxRetries: 0, baseDelayMs: 10 },
    );
    expect(fetchJsonWithRetry).toHaveBeenNthCalledWith(
      2,
      "http://gym:9001/gyms/2",
      { timeoutMs: 500, maxRetries: 0, baseDelayMs: 10 },
    );
  });

  it("ไม่พบสมาชิก -> 404 MEMBER_NOT_FOUND และไม่ตรวจสาขา/ไม่บันทึก", async () => {
    fetchJsonWithRetry.mockRejectedValueOnce(notFound());
    const res = await request(app).post("/subscriptions").send(body).expect(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
    expect(fetchJsonWithRetry).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("ไม่พบสาขา -> 404 GYM_NOT_FOUND และไม่บันทึก", async () => {
    fetchJsonWithRetry.mockResolvedValueOnce({}).mockRejectedValueOnce(notFound());
    const res = await request(app).post("/subscriptions").send(body).expect(404);
    expect(res.body.error.code).toBe("GYM_NOT_FOUND");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("member-service ล่ม (หลัง retry ครบ) -> 503 DEPENDENCY_UNAVAILABLE", async () => {
    fetchJsonWithRetry.mockRejectedValueOnce(new Error("network error: ECONNREFUSED"));
    const res = await request(app).post("/subscriptions").send(body).expect(503);
    expect(res.body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(res.body.error.message).toContain("บริการสมาชิก");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("gym-service ล่ม -> 503 DEPENDENCY_UNAVAILABLE", async () => {
    fetchJsonWithRetry.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("timeout"));
    const res = await request(app).post("/subscriptions").send(body).expect(503);
    expect(res.body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(res.body.error.message).toContain("บริการสาขา");
  });

  it("สมัครสาขาเดิมซ้ำ (ER_DUP_ENTRY) -> 409 ALREADY_SUBSCRIBED", async () => {
    fetchJsonWithRetry.mockResolvedValue({});
    pool.query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
    const res = await request(app).post("/subscriptions").send(body).expect(409);
    expect(res.body.error.code).toBe("ALREADY_SUBSCRIBED");
  });

  it("error ฐานข้อมูลอื่น -> 500", async () => {
    fetchJsonWithRetry.mockResolvedValue({});
    pool.query.mockRejectedValueOnce(new Error("db down"));
    await request(app).post("/subscriptions").send(body).expect(500);
  });

  it("body ไม่ถูกต้อง -> 400 และไม่เรียกบริการอื่น", async () => {
    const res = await request(app).post("/subscriptions").send({ member_id: "abc" }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(fetchJsonWithRetry).not.toHaveBeenCalled();
  });
});

describe("GET /subscriptions (รายงาน UC5)", () => {
  const reportRow = {
    subscription_id: 1,
    member_id: 1,
    member_name: "สมชาย ใจดี",
    member_email: "somchai@example.com",
    gym_id: 1,
    gym_name: "Fit Plus Bangsaen",
    monthly_fee: 1200,
    start_date: "2026-08-01",
    status: "active",
  };

  it("คืนประวัติทั้งหมด (JOIN members และ gyms) โดยไม่มี WHERE", async () => {
    pool.query.mockResolvedValueOnce([[reportRow]]);
    const res = await request(app).get("/subscriptions").expect(200);
    expect(res.body.message).toBe("ดึงข้อมูลประวัติการสมัครสำเร็จ");
    expect(res.body.data).toEqual([reportRow]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("JOIN members");
    expect(sql).toContain("JOIN gyms");
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual([]);
  });

  it("ค้นหาด้วยชื่อสมาชิก -> ใช้ LIKE", async () => {
    pool.query.mockResolvedValueOnce([[reportRow]]);
    await request(app).get("/subscriptions").query({ member_name: " สมชาย " }).expect(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("WHERE m.name LIKE ?");
    expect(params).toEqual(["%สมชาย%"]);
  });

  it("escape อักขระพิเศษของ LIKE (% _ \\)", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    await request(app).get("/subscriptions").query({ member_name: "50%_a" }).expect(200);
    expect(pool.query.mock.calls[0][1]).toEqual(["%50\\%\\_a%"]);
  });

  it("ค้นหาด้วยค่าว่าง -> เหมือนไม่ค้นหา", async () => {
    pool.query.mockResolvedValueOnce([[reportRow]]);
    await request(app).get("/subscriptions").query({ member_name: "   " }).expect(200);
    expect(pool.query.mock.calls[0][0]).not.toContain("WHERE");
  });

  it("ไม่พบประวัติ -> 200 พร้อมข้อความ 'ไม่พบประวัติการสมัครในขณะนี้'", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get("/subscriptions").expect(200);
    expect(res.body.message).toBe("ไม่พบประวัติการสมัครในขณะนี้");
    expect(res.body.data).toEqual([]);
  });

  it("member_name ซ้ำหลายค่า -> 400 VALIDATION_ERROR", async () => {
    const res = await request(app).get("/subscriptions?member_name=a&member_name=b").expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("ฐานข้อมูลล่ม -> 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("db down"));
    await request(app).get("/subscriptions").expect(500);
  });
});

describe("PUT /subscriptions/:id", () => {
  const body = { gym_id: 2, start_date: "2026-11-01", status: "cancelled" };
  const updated = { ...subRow, ...body };

  it("แก้ไขสำเร็จ -> 200 (ตรวจสาขาก่อนอัปเดต)", async () => {
    fetchJsonWithRetry.mockResolvedValue({});
    pool.query
      .mockResolvedValueOnce([[{ subscription_id: 7 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[updated]]);
    const res = await request(app).put("/subscriptions/7").send(body).expect(200);
    expect(res.body.message).toBe("อัปเดตการสมัครแพ็กเกจสำเร็จ");
    expect(res.body.data).toEqual(updated);
    expect(fetchJsonWithRetry).toHaveBeenCalledWith("http://localhost:4001/gyms/2", expect.any(Object));
  });

  it("ไม่พบการสมัคร -> 404 SUBSCRIPTION_NOT_FOUND", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).put("/subscriptions/99").send(body).expect(404);
    expect(res.body.error.code).toBe("SUBSCRIPTION_NOT_FOUND");
    expect(fetchJsonWithRetry).not.toHaveBeenCalled();
  });

  it("ไม่พบสาขา -> 404 GYM_NOT_FOUND", async () => {
    pool.query.mockResolvedValueOnce([[{ subscription_id: 7 }]]);
    fetchJsonWithRetry.mockRejectedValueOnce(notFound());
    const res = await request(app).put("/subscriptions/7").send(body).expect(404);
    expect(res.body.error.code).toBe("GYM_NOT_FOUND");
  });

  it("บริการสาขาไม่ตอบ -> 503 DEPENDENCY_UNAVAILABLE", async () => {
    pool.query.mockResolvedValueOnce([[{ subscription_id: 7 }]]);
    fetchJsonWithRetry.mockRejectedValueOnce(new Error("timeout"));
    const res = await request(app).put("/subscriptions/7").send(body).expect(503);
    expect(res.body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("สมัครสาขานั้นซ้ำ -> 409 ALREADY_SUBSCRIBED", async () => {
    fetchJsonWithRetry.mockResolvedValue({});
    pool.query
      .mockResolvedValueOnce([[{ subscription_id: 7 }]])
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
    const res = await request(app).put("/subscriptions/7").send(body).expect(409);
    expect(res.body.error.code).toBe("ALREADY_SUBSCRIBED");
  });

  it("error ฐานข้อมูลอื่น -> 500", async () => {
    fetchJsonWithRetry.mockResolvedValue({});
    pool.query.mockResolvedValueOnce([[{ subscription_id: 7 }]]).mockRejectedValueOnce(new Error("db down"));
    await request(app).put("/subscriptions/7").send(body).expect(500);
  });

  it("status ไม่อยู่ในรายการ -> 400", async () => {
    const res = await request(app)
      .put("/subscriptions/7")
      .send({ ...body, status: "paused" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("id ผิดรูปแบบ -> 400 INVALID_ID", async () => {
    const res = await request(app).put("/subscriptions/abc").send(body).expect(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });
});

describe("DELETE /subscriptions/:id", () => {
  it("ลบสำเร็จ -> 200", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).delete("/subscriptions/7").expect(200);
    expect(res.body.message).toBe("ลบการสมัครแพ็กเกจสำเร็จ");
  });

  it("ไม่พบการสมัคร -> 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const res = await request(app).delete("/subscriptions/99").expect(404);
    expect(res.body.error.code).toBe("SUBSCRIPTION_NOT_FOUND");
  });

  it("id ผิดรูปแบบ -> 400", async () => {
    await request(app).delete("/subscriptions/abc").expect(400);
  });
});
