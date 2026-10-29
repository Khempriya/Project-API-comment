// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/validators.test.js
// ============================================================================
// ทดสอบโค้ดของ : src/shared/validators.js
// ทดสอบอะไร    : ตรวจกติกา validate ฝั่ง Back end ที่อยู่หลังปุ่ม "บันทึกสาขา"/"ลงทะเบียน"/"บันทึกการสมัคร"/"บันทึกการแก้ไข" (FLOW-04,05,08,09,12,13)
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ทดสอบฟังก์ชันตรวจสอบข้อมูล (Unit test) ใน shared/validators.js
const {
  parseId,
  validateGymBody,
  validateMemberBody,
  validateSubscriptionBody,
  isValidDateString,
} = require("../shared/validators");

function catchError(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

describe("parseId", () => {
  it("แปลงสตริงตัวเลขบวกเป็น number", () => {
    expect(parseId("12")).toBe(12);
  });

  it.each(["0", "-1", "abc", "1.5", "", "1e2"])(
    "ปฏิเสธค่า %p ด้วย 400 INVALID_ID",
    (value) => {
      const err = catchError(() => parseId(value));
      expect(err.status).toBe(400);
      expect(err.type).toBe("INVALID_ID");
    },
  );
});

describe("validateGymBody", () => {
  const valid = { name: " Fit Plus ", address: " ชลบุรี ", monthly_fee: 1200 };

  it("ตัดช่องว่างหน้า-หลังของ name และ address", () => {
    expect(validateGymBody(valid)).toEqual({
      name: "Fit Plus",
      address: "ชลบุรี",
      monthly_fee: 1200,
    });
  });

  it("ยอมรับ monthly_fee = 0", () => {
    expect(validateGymBody({ ...valid, monthly_fee: 0 }).monthly_fee).toBe(0);
  });

  it("body ว่างหรือไม่มี -> 400 VALIDATION_ERROR ครบทั้งสามฟิลด์", () => {
    const err = catchError(() => validateGymBody(undefined));
    expect(err.status).toBe(400);
    expect(err.type).toBe("VALIDATION_ERROR");
    expect(err.message).toContain("name");
    expect(err.message).toContain("address");
    expect(err.message).toContain("monthly_fee");
  });

  it.each([
    ["name ว่าง", { ...valid, name: "   " }, "name"],
    ["name ยาวเกิน 150", { ...valid, name: "x".repeat(151) }, "name"],
    ["address ว่าง", { ...valid, address: "" }, "address"],
    ["monthly_fee ติดลบ", { ...valid, monthly_fee: -1 }, "monthly_fee"],
    ["monthly_fee ไม่ใช่จำนวนเต็ม", { ...valid, monthly_fee: 1.5 }, "monthly_fee"],
    ["monthly_fee เป็นสตริง", { ...valid, monthly_fee: "1200" }, "monthly_fee"],
  ])("%s -> 400", (title, body, field) => {
    const err = catchError(() => validateGymBody(body));
    expect(err.status).toBe(400);
    expect(err.message).toContain(field);
  });
});

describe("validateMemberBody", () => {
  it("ผ่านและตัดช่องว่าง", () => {
    expect(
      validateMemberBody({ name: " สมชาย ", email: " somchai@example.com " }),
    ).toEqual({ name: "สมชาย", email: "somchai@example.com" });
  });

  it.each([
    ["name ว่าง", { name: "", email: "a@b.co" }, "name"],
    ["name ยาวเกิน 150", { name: "x".repeat(151), email: "a@b.co" }, "name"],
    ["email ผิดรูปแบบ", { name: "a", email: "not-an-email" }, "email"],
    ["email ไม่ใช่สตริง", { name: "a", email: 5 }, "email"],
    ["email ยาวเกิน 150", { name: "a", email: `${"x".repeat(150)}@b.co` }, "email"],
  ])("%s -> 400", (title, body, field) => {
    const err = catchError(() => validateMemberBody(body));
    expect(err.status).toBe(400);
    expect(err.type).toBe("VALIDATION_ERROR");
    expect(err.message).toContain(field);
  });
});

describe("isValidDateString", () => {
  it("ยอมรับวันที่ที่มีอยู่จริง", () => {
    expect(isValidDateString("2026-10-19")).toBe(true);
    expect(isValidDateString("2028-02-29")).toBe(true);
  });

  it.each(["2026-02-30", "2026-13-01", "19/10/2026", "2026-1-1", "", 20261019, null])(
    "ปฏิเสธ %p",
    (value) => {
      expect(isValidDateString(value)).toBe(false);
    },
  );
});

describe("validateSubscriptionBody", () => {
  it("ไม่ส่ง start_date -> ได้ null (ให้ฐานข้อมูลใช้วันนี้)", () => {
    expect(validateSubscriptionBody({ member_id: 1, gym_id: 2 })).toEqual({
      member_id: 1,
      gym_id: 2,
      start_date: null,
    });
  });

  it("ส่ง start_date ที่ถูกต้อง", () => {
    expect(
      validateSubscriptionBody({ member_id: 1, gym_id: 2, start_date: "2026-10-10" })
        .start_date,
    ).toBe("2026-10-10");
  });

  it.each([
    ["member_id เป็นสตริง", { member_id: "1", gym_id: 2 }, "member_id"],
    ["gym_id เป็น 0", { member_id: 1, gym_id: 0 }, "gym_id"],
    ["start_date ผิดรูปแบบ", { member_id: 1, gym_id: 2, start_date: "10/10/2026" }, "start_date"],
    ["body ว่าง", undefined, "member_id"],
  ])("%s -> 400", (title, body, field) => {
    const err = catchError(() => validateSubscriptionBody(body));
    expect(err.status).toBe(400);
    expect(err.message).toContain(field);
  });
});

describe("validateSubscriptionUpdateBody", () => {
  const { validateSubscriptionUpdateBody } = require("../shared/validators");
  const ok = { gym_id: 2, start_date: "2026-11-01", status: "active" };

  it("ข้อมูลถูกต้อง -> คืนค่าที่ตรวจแล้ว", () => {
    expect(validateSubscriptionUpdateBody(ok)).toEqual(ok);
  });

  it.each([
    [{ ...ok, gym_id: 0 }],
    [{ ...ok, gym_id: "2" }],
    [{ ...ok, start_date: undefined }],
    [{ ...ok, start_date: "2026-02-30" }],
    [{ ...ok, status: "paused" }],
    [undefined],
  ])("ข้อมูลไม่ถูกต้องถูกปฏิเสธ %#", (body) => {
    expect(() => validateSubscriptionUpdateBody(body)).toThrow();
  });
});
