// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/gateway.test.js
// ============================================================================
// ทดสอบโค้ดของ : src/gateway/app.js
// ทดสอบอะไร    : ตรวจ routing /api/v1/* -> 3 บริการ, 503/502, /health (FLOW-01), เสิร์ฟหน้าเว็บ (FLOW-00), Swagger (FLOW-17) — ครอบคลุมทางผ่านของทุกปุ่ม
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ทดสอบ API Gateway: mock fetch (การเรียกไปยังบริการปลายทาง) แล้วตรวจ routing, 503, health, static
const request = require("supertest");
const app = require("../gateway/app");

// ตัวช่วยสร้าง response จำลองของบริการปลายทาง
const upstream = (status, body) => ({
  status,
  ok: status < 400,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

beforeEach(() => {
  global.fetch = jest.fn();
  delete process.env.GYM_SERVICE_URL;
  delete process.env.MEMBER_SERVICE_URL;
  delete process.env.SUBSCRIPTION_SERVICE_URL;
});

describe("routing ไปยังบริการที่ถูกต้อง", () => {
  it("/api/v1/gyms -> gym-service (ตัด /api/v1 และคง query string)", async () => {
    fetch.mockResolvedValueOnce(upstream(200, { data: [] }));
    const res = await request(app).get("/api/v1/gyms?x=1").expect(200);
    expect(res.body).toEqual({ data: [] });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:4001/gyms?x=1",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("/api/v1/gyms/1/weather -> gym-service", async () => {
    fetch.mockResolvedValueOnce(upstream(200, { data: {} }));
    await request(app).get("/api/v1/gyms/1/weather").expect(200);
    expect(fetch.mock.calls[0][0]).toBe("http://localhost:4001/gyms/1/weather");
  });

  it("/api/v1/members -> member-service", async () => {
    fetch.mockResolvedValueOnce(upstream(200, { data: [] }));
    await request(app).get("/api/v1/members").expect(200);
    expect(fetch.mock.calls[0][0]).toBe("http://localhost:4002/members");
  });

  it("/api/v1/subscriptions -> subscription-service", async () => {
    fetch.mockResolvedValueOnce(upstream(200, { data: [] }));
    await request(app).get("/api/v1/subscriptions").expect(200);
    expect(fetch.mock.calls[0][0]).toBe("http://localhost:4003/subscriptions");
  });

  it("อ่านที่อยู่บริการจาก .env", async () => {
    process.env.GYM_SERVICE_URL = "http://gym:9001";
    fetch.mockResolvedValueOnce(upstream(200, { data: [] }));
    await request(app).get("/api/v1/gyms").expect(200);
    expect(fetch.mock.calls[0][0]).toBe("http://gym:9001/gyms");
  });
});

describe("ส่งต่อ body และ method", () => {
  it("POST ส่ง JSON body ต่อไปพร้อม Content-Type และคืน status 201", async () => {
    const body = { name: "สมศักดิ์", email: "somsak@example.com" };
    fetch.mockResolvedValueOnce(upstream(201, { message: "ลงทะเบียนสมาชิกสำเร็จ" }));
    const res = await request(app).post("/api/v1/members").send(body).expect(201);
    expect(res.body.message).toBe("ลงทะเบียนสมาชิกสำเร็จ");
    const init = fetch.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("DELETE ไม่ส่ง body", async () => {
    fetch.mockResolvedValueOnce(upstream(200, { message: "ลบสำเร็จ" }));
    await request(app).delete("/api/v1/gyms/3").expect(200);
    const init = fetch.mock.calls[0][1];
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("ส่ง status และ body ของ error จากบริการปลายทางกลับตามเดิม (409)", async () => {
    const error = { error: { code: "DUPLICATE_EMAIL", message: "อีเมลนี้มีอยู่ในระบบแล้ว" } };
    fetch.mockResolvedValueOnce(upstream(409, error));
    const res = await request(app).post("/api/v1/members").send({ name: "a", email: "a@b.co" }).expect(409);
    expect(res.body).toEqual(error);
  });
});

describe("บริการปลายทางมีปัญหา", () => {
  it("ต่อไม่ได้ -> 503 SERVICE_UNAVAILABLE พร้อมชื่อบริการ", async () => {
    fetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    const res = await request(app).get("/api/v1/gyms").expect(503);
    expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(res.body.error.message).toContain("บริการสาขา");
  });

  it("รอเกินเวลา (timeout) -> 503", async () => {
    fetch.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const res = await request(app).get("/api/v1/members").expect(503);
    expect(res.body.error.message).toContain("บริการสมาชิก");
  });

  it("อ่าน body ไม่สำเร็จ -> 503", async () => {
    fetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      text: async () => {
        throw new Error("aborted");
      },
    });
    await request(app).get("/api/v1/subscriptions").expect(503);
  });

  it("บริการตอบไม่ใช่ JSON -> 502 BAD_GATEWAY", async () => {
    fetch.mockResolvedValueOnce(upstream(200, "<html>oops</html>"));
    const res = await request(app).get("/api/v1/gyms").expect(502);
    expect(res.body.error.code).toBe("BAD_GATEWAY");
  });
});

describe("GET /health", () => {
  it("ทุกบริการ up -> status ok", async () => {
    fetch.mockResolvedValue({ ok: true });
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({
      status: "ok",
      gateway: "up",
      services: { gym: "up", member: "up", subscription: "up" },
    });
  });

  it("บริการหนึ่งไม่ตอบ -> degraded แต่ Gateway ยังตอบ 200", async () => {
    fetch.mockImplementation((url) =>
      url.includes(":4002") ? Promise.reject(new Error("down")) : Promise.resolve({ ok: true }),
    );
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services).toEqual({ gym: "up", member: "down", subscription: "up" });
  });

  it("บริการตอบแต่ไม่ ok -> นับเป็น down", async () => {
    fetch.mockResolvedValue({ ok: false });
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.gym).toBe("down");
  });
});

describe("ส่วนอื่นของ Gateway", () => {
  it("เสิร์ฟหน้าเว็บ frontend ที่ /", async () => {
    const res = await request(app).get("/").expect(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("ระบบข้อมูลฟิตเนส");
  });

  it("เสิร์ฟ Swagger UI ที่ /api-docs/", async () => {
    const res = await request(app).get("/api-docs/").expect(200);
    expect(res.headers["content-type"]).toMatch(/html/);
  });

  it("เส้นทางที่ไม่มี -> 404 ROUTE_NOT_FOUND", async () => {
    const res = await request(app).get("/api/v1/unknown").expect(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });

  it("JSON ผิดรูปแบบ -> 400 และไม่ส่งต่อไปบริการ", async () => {
    const res = await request(app)
      .post("/api/v1/gyms")
      .set("Content-Type", "application/json")
      .send("{bad json")
      .expect(400);
    expect(res.body.error.code).toBe("entity.parse.failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("body ใหญ่เกิน 10kb -> 413 และไม่ส่งต่อไปบริการ", async () => {
    await request(app)
      .post("/api/v1/gyms")
      .send({ name: "x".repeat(11000), address: "a", monthly_fee: 1 })
      .expect(413);
    expect(fetch).not.toHaveBeenCalled();
  });
});
