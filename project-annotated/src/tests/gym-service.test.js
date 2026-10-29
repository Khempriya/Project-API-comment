// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/gym-service.test.js
// ============================================================================
// ทดสอบโค้ดของ : src/gym-service/app.js
// ทดสอบอะไร    : ตรวจ route หลังปุ่มของแท็บ "สาขาและราคา" : GET /gyms (FLOW-02), /gyms/:id/weather (FLOW-03), POST (FLOW-04), PUT (FLOW-05), DELETE (FLOW-06) — mock ฐานข้อมูล
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ทดสอบ gym-service ด้วย Supertest โดย mock ฐานข้อมูลและ weather (ไม่ต้องใช้ MySQL จริง)
jest.mock("../shared/db", () => ({ query: jest.fn() }));
jest.mock("../gym-service/weather", () => ({ getWeatherForLocation: jest.fn() }));

const request = require("supertest");
const pool = require("../shared/db");
const { getWeatherForLocation } = require("../gym-service/weather");
const app = require("../gym-service/app");

const gymRow = {
  gym_id: 1,
  name: "Fit Plus Bangsaen",
  address: "123 ถนนลงหาดบางแสน ชลบุรี",
  monthly_fee: 1200,
};

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  pool.query.mockReset();
  getWeatherForLocation.mockReset();
});

describe("GET /health", () => {
  it("ตอบสถานะของบริการ", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok", service: "gym-service" });
  });
});

describe("GET /gyms", () => {
  it("คืนรายการสาขาทั้งหมด", async () => {
    pool.query.mockResolvedValueOnce([[gymRow]]);
    const res = await request(app).get("/gyms").expect(200);
    expect(res.body.message).toBe("ดึงข้อมูลสาขาฟิตเนสสำเร็จ");
    expect(res.body.data).toEqual([gymRow]);
  });

  it("ไม่มีสาขาเลย -> 200 พร้อมข้อความ 'ยังไม่มีข้อมูลสาขาฟิตเนส'", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get("/gyms").expect(200);
    expect(res.body.message).toBe("ยังไม่มีข้อมูลสาขาฟิตเนส");
    expect(res.body.data).toEqual([]);
  });

  it("ฐานข้อมูลล่ม -> 500 INTERNAL_SERVER_ERROR", async () => {
    pool.query.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).get("/gyms").expect(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("GET /gyms/:id", () => {
  it("พบสาขา", async () => {
    pool.query.mockResolvedValueOnce([[gymRow]]);
    const res = await request(app).get("/gyms/1").expect(200);
    expect(res.body.data).toEqual(gymRow);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("WHERE gym_id = ?"), [1]);
  });

  it("ไม่พบสาขา -> 404 GYM_NOT_FOUND", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get("/gyms/99999").expect(404);
    expect(res.body.error.code).toBe("GYM_NOT_FOUND");
  });

  it("id ไม่ใช่ตัวเลข -> 400 INVALID_ID และไม่แตะฐานข้อมูล", async () => {
    const res = await request(app).get("/gyms/abc").expect(400);
    expect(res.body.error.code).toBe("INVALID_ID");
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("GET /gyms/:id/weather", () => {
  it("ได้สภาพอากาศจริง", async () => {
    pool.query.mockResolvedValueOnce([[{ gym_id: 1, name: "Fit Plus Bangsaen" }]]);
    getWeatherForLocation.mockResolvedValueOnce({ available: true, source: "open-meteo", temperature_c: 31.2 });
    const res = await request(app).get("/gyms/1/weather").expect(200);
    expect(res.body.message).toBe("ดึงข้อมูลสภาพอากาศสำเร็จ");
    expect(res.body.data.gym).toEqual({ gym_id: 1, name: "Fit Plus Bangsaen" });
    expect(res.body.data.weather.available).toBe(true);
  });

  it("API ภายนอกล้มเหลว -> ยังตอบ 200 พร้อม fallback", async () => {
    pool.query.mockResolvedValueOnce([[{ gym_id: 1, name: "Fit Plus Bangsaen" }]]);
    getWeatherForLocation.mockResolvedValueOnce({ available: false, source: "fallback", message: "ไม่สามารถดึงข้อมูลสภาพอากาศได้ในขณะนี้" });
    const res = await request(app).get("/gyms/1/weather").expect(200);
    expect(res.body.data.weather.available).toBe(false);
    expect(res.body.message).toContain("ไม่สามารถดึงข้อมูลสภาพอากาศ");
  });

  it("ไม่พบสาขา -> 404 และไม่เรียก API ภายนอก", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    await request(app).get("/gyms/99999/weather").expect(404);
    expect(getWeatherForLocation).not.toHaveBeenCalled();
  });

  it("id ผิดรูปแบบ -> 400", async () => {
    await request(app).get("/gyms/abc/weather").expect(400);
    expect(getWeatherForLocation).not.toHaveBeenCalled();
  });
});

describe("POST /gyms", () => {
  const body = { name: "Fit Plus Rayong", address: "99 ระยอง", monthly_fee: 1400 };

  it("สร้างสาขา -> 201", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 4 }]);
    const res = await request(app).post("/gyms").send(body).expect(201);
    expect(res.body.data).toEqual({ gym_id: 4, ...body });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO gyms"),
      ["Fit Plus Rayong", "99 ระยอง", 1400],
    );
  });

  it("ข้อมูลไม่ครบ -> 400 VALIDATION_ERROR และไม่บันทึก", async () => {
    const res = await request(app).post("/gyms").send({ name: "ไม่ครบ" }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("JSON ผิดรูปแบบ -> 400 entity.parse.failed", async () => {
    const res = await request(app)
      .post("/gyms")
      .set("Content-Type", "application/json")
      .send('{"name": ')
      .expect(400);
    expect(res.body.error.code).toBe("entity.parse.failed");
  });

  it("body ใหญ่เกิน 10kb -> 413", async () => {
    const res = await request(app)
      .post("/gyms")
      .send({ ...body, name: "x".repeat(11000) })
      .expect(413);
    expect(res.body.error.code).toBe("entity.too.large");
  });
});

describe("PUT /gyms/:id", () => {
  const body = { name: "Fit Plus Bangsaen", address: "ที่อยู่ใหม่", monthly_fee: 1300 };

  it("แก้ไขสาขา -> 200", async () => {
    pool.query.mockResolvedValueOnce([[{ gym_id: 1 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).put("/gyms/1").send(body).expect(200);
    expect(res.body.data).toEqual({ gym_id: 1, ...body });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE gyms SET"),
      ["Fit Plus Bangsaen", "ที่อยู่ใหม่", 1300, 1],
    );
  });

  it("ไม่พบสาขา -> 404 และไม่ UPDATE", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    await request(app).put("/gyms/99999").send(body).expect(404);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("ข้อมูลไม่ถูกต้อง -> 400", async () => {
    await request(app).put("/gyms/1").send({ name: "x" }).expect(400);
  });
});

describe("DELETE /gyms/:id", () => {
  it("ลบสาขา -> 200", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).delete("/gyms/1").expect(200);
    expect(res.body.message).toContain("ลบสาขาฟิตเนส");
  });

  it("ไม่พบสาขา -> 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const res = await request(app).delete("/gyms/99999").expect(404);
    expect(res.body.error.code).toBe("GYM_NOT_FOUND");
  });
});

describe("เส้นทางที่ไม่มี", () => {
  it("ตอบ 404 ROUTE_NOT_FOUND", async () => {
    const res = await request(app).get("/nothing-here").expect(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
