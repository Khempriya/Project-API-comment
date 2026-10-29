// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/member-service.test.js
// ============================================================================
// ทดสอบโค้ดของ : src/member-service/app.js
// ทดสอบอะไร    : ตรวจ route หลังปุ่มของแท็บ "สมาชิก" : GET (FLOW-07), POST + 409 อีเมลซ้ำ (FLOW-08), PUT (FLOW-09), DELETE (FLOW-10) — mock ฐานข้อมูล
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ทดสอบ member-service ด้วย Supertest โดย mock ฐานข้อมูล
jest.mock("../shared/db", () => ({ query: jest.fn() }));

const request = require("supertest");
const pool = require("../shared/db");
const app = require("../member-service/app");

const memberRow = { member_id: 1, name: "สมชาย ใจดี", email: "somchai@example.com" };

beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(() => {
  pool.query.mockReset();
});

describe("GET /health", () => {
  it("ตอบสถานะของบริการ", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok", service: "member-service" });
  });
});

describe("GET /members", () => {
  it("คืนรายชื่อสมาชิก", async () => {
    pool.query.mockResolvedValueOnce([[memberRow]]);
    const res = await request(app).get("/members").expect(200);
    expect(res.body.message).toBe("ดึงข้อมูลสมาชิกสำเร็จ");
    expect(res.body.data).toEqual([memberRow]);
  });

  it("ยังไม่มีสมาชิก -> 200 พร้อมข้อความ", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get("/members").expect(200);
    expect(res.body.message).toBe("ยังไม่มีข้อมูลสมาชิก");
    expect(res.body.data).toEqual([]);
  });

  it("ฐานข้อมูลล่ม -> 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("db down"));
    await request(app).get("/members").expect(500);
  });
});

describe("GET /members/:id", () => {
  it("พบสมาชิก", async () => {
    pool.query.mockResolvedValueOnce([[memberRow]]);
    const res = await request(app).get("/members/1").expect(200);
    expect(res.body.data).toEqual(memberRow);
  });

  it("ไม่พบสมาชิก -> 404 MEMBER_NOT_FOUND", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get("/members/99999").expect(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });

  it("id ผิดรูปแบบ -> 400 INVALID_ID", async () => {
    const res = await request(app).get("/members/abc").expect(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });
});

describe("POST /members", () => {
  const body = { name: "สมศักดิ์ มั่นคง", email: "somsak@example.com" };

  it("ลงทะเบียนสำเร็จ -> 201", async () => {
    pool.query.mockResolvedValueOnce([{ insertId: 4 }]);
    const res = await request(app).post("/members").send(body).expect(201);
    expect(res.body.message).toBe("ลงทะเบียนสมาชิกสำเร็จ");
    expect(res.body.data).toEqual({ member_id: 4, ...body });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO members"),
      [body.name, body.email],
    );
  });

  it("อีเมลซ้ำ (ER_DUP_ENTRY) -> 409 DUPLICATE_EMAIL", async () => {
    pool.query.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
    const res = await request(app).post("/members").send(body).expect(409);
    expect(res.body.error.code).toBe("DUPLICATE_EMAIL");
    expect(res.body.error.message).toBe("อีเมลนี้มีอยู่ในระบบแล้ว");
  });

  it("error ฐานข้อมูลอื่น -> 500", async () => {
    pool.query.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).post("/members").send(body).expect(500);
    expect(res.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("อีเมลผิดรูปแบบ -> 400 และไม่บันทึก", async () => {
    const res = await request(app)
      .post("/members")
      .send({ name: "a", email: "not-an-email" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("PUT /members/:id", () => {
  const body = { name: "สมชาย แก้ไขแล้ว", email: "new@example.com" };

  it("แก้ไขสำเร็จ -> 200", async () => {
    pool.query.mockResolvedValueOnce([[{ member_id: 1 }]]).mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).put("/members/1").send(body).expect(200);
    expect(res.body.message).toBe("อัปเดตข้อมูลสมาชิกสำเร็จ");
    expect(res.body.data).toEqual({ member_id: 1, ...body });
    expect(pool.query).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE members"),
      [body.name, body.email, 1],
    );
  });

  it("ไม่พบสมาชิก -> 404 MEMBER_NOT_FOUND", async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).put("/members/99").send(body).expect(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });

  it("อีเมลซ้ำกับสมาชิกคนอื่น -> 409 DUPLICATE_EMAIL", async () => {
    pool.query
      .mockResolvedValueOnce([[{ member_id: 1 }]])
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" }));
    const res = await request(app).put("/members/1").send(body).expect(409);
    expect(res.body.error.code).toBe("DUPLICATE_EMAIL");
  });

  it("error ฐานข้อมูลอื่นตอน UPDATE -> 500", async () => {
    pool.query.mockResolvedValueOnce([[{ member_id: 1 }]]).mockRejectedValueOnce(new Error("db down"));
    await request(app).put("/members/1").send(body).expect(500);
  });

  it("ข้อมูลไม่ถูกต้อง -> 400 และไม่แตะฐานข้อมูล", async () => {
    const res = await request(app).put("/members/1").send({ name: "", email: "x" }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("id ผิดรูปแบบ -> 400 INVALID_ID", async () => {
    const res = await request(app).put("/members/abc").send(body).expect(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });
});

describe("DELETE /members/:id", () => {
  it("ลบสำเร็จ -> 200", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).delete("/members/1").expect(200);
    expect(res.body.message).toBe("ลบสมาชิกและประวัติการสมัครที่เกี่ยวข้องสำเร็จ");
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM members"), [1]);
  });

  it("ไม่พบสมาชิก -> 404", async () => {
    pool.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const res = await request(app).delete("/members/99").expect(404);
    expect(res.body.error.code).toBe("MEMBER_NOT_FOUND");
  });

  it("id ผิดรูปแบบ -> 400", async () => {
    await request(app).delete("/members/abc").expect(400);
  });
});

describe("เส้นทางที่ไม่มี", () => {
  it("ตอบ 404 ROUTE_NOT_FOUND", async () => {
    const res = await request(app).get("/nothing-here").expect(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
