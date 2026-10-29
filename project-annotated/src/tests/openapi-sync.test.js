// ============================================================================
// 📘 ไฟล์ทดสอบ: src/tests/openapi-sync.test.js
// ============================================================================
// ทดสอบโค้ดของ : openapi.yaml เทียบกับ route จริงของ 3 บริการ
// ทดสอบอะไร    : ตรวจว่าเอกสาร Swagger (FLOW-17) ตรงกับโค้ดจริง — ไม่ผูกกับปุ่มโดยตรง
// รันด้วย      : `npm test` (jest)  — ไฟล์เทสต์ "ไม่ได้ถูกใช้ตอนหน้าเว็บทำงานจริง" เป็นเพียงตัวตรวจสอบคุณภาพ
// ============================================================================
// ตรวจความสอดคล้องระหว่างเอกสาร (openapi.yaml) กับโค้ดจริงโดยอัตโนมัติ (Swagger/Code Match)
// อ่านรายการ route จาก Express app ของแต่ละบริการ แล้วเทียบกับ paths ใน openapi.yaml
jest.mock("../shared/db", () => ({ query: jest.fn() }));

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const gymApp = require("../gym-service/app");
const memberApp = require("../member-service/app");
const subscriptionApp = require("../subscription-service/app");

const doc = yaml.load(
  fs.readFileSync(path.join(__dirname, "..", "..", "openapi.yaml"), "utf8"),
);
const METHODS = ["get", "post", "put", "patch", "delete"];

// รายการ "METHOD /path" ของ route ที่ app ลงทะเบียนไว้ (แปลง :id เป็น {id} และเติม prefix ของ Gateway)
function routesOf(app, prefix) {
  const out = [];
  for (const layer of app.router.stack) {
    if (!layer.route) continue;
    const routePath = layer.route.path;
    if (routePath === "/health") continue; // health ภายในของแต่ละบริการ ไม่เปิดผ่าน Gateway
    for (const method of Object.keys(layer.route.methods)) {
      out.push(`${method.toUpperCase()} ${prefix}${routePath.replace(/:(\w+)/g, "{$1}")}`);
    }
  }
  return out;
}

const documented = [];
Object.entries(doc.paths).forEach(([p, item]) => {
  METHODS.filter((m) => item[m]).forEach((m) => documented.push(`${m.toUpperCase()} ${p}`));
});

describe("openapi.yaml ตรงกับโค้ดจริง", () => {
  const implemented = [
    ...routesOf(gymApp, "/api/v1"),
    ...routesOf(memberApp, "/api/v1"),
    ...routesOf(subscriptionApp, "/api/v1"),
    "GET /health", // route ของ Gateway เอง
  ];

  it("ทุก endpoint ในโค้ดมีอยู่ในเอกสาร", () => {
    const missing = implemented.filter((r) => !documented.includes(r));
    expect(missing).toEqual([]);
  });

  it("ทุก endpoint ในเอกสารมีอยู่ในโค้ด", () => {
    const extra = documented.filter((r) => !implemented.includes(r));
    expect(extra).toEqual([]);
  });

  it("เอกสารครอบคลุมอย่างน้อย 6 endpoint และทุก resource หลัก", () => {
    expect(documented.length).toBeGreaterThanOrEqual(6);
    ["/api/v1/gyms", "/api/v1/members", "/api/v1/subscriptions"].forEach((p) => {
      expect(Object.keys(doc.paths)).toContain(p);
    });
  });

  it("ทุก endpoint ระบุ response ทั้งกรณีสำเร็จและกรณีผิดพลาด", () => {
    Object.entries(doc.paths).forEach(([p, item]) => {
      METHODS.filter((m) => item[m]).forEach((m) => {
        const codes = Object.keys(item[m].responses);
        expect(codes.some((c) => c.startsWith("2"))).toBe(true);
        if (p.startsWith("/api/v1")) {
          expect(codes).toContain("500");
          expect(codes).toContain("503");
        }
      });
    });
  });
});
