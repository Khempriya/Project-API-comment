-- ============================================================================
-- 📘 ไฟล์: src/database/schema.sql — "สร้างฐานข้อมูลและตาราง" (รันครั้งเดียวก่อนใช้งานระบบ)
-- ============================================================================
-- รันด้วย MySQL เช่น:  mysql -u root -p < src/database/schema.sql   แล้วตามด้วย seed.sql
-- ⚠ บรรทัดแรก DROP DATABASE IF EXISTS = ลบฐานข้อมูล fitness_db เดิมทิ้งทั้งก้อนก่อนสร้างใหม่ (ข้อมูลเก่าหาย)
--
-- ตารางทั้ง 3 นี้คือ "แหล่งข้อมูลปลายทาง" ของทุกปุ่มบนหน้าเว็บ:
--   gyms           <- gym-service          (แท็บ "สาขาและราคา")
--   members        <- member-service       (แท็บ "สมาชิก")
--   subscriptions  <- subscription-service (แท็บ "การสมัครแพ็กเกจ") และถูก JOIN กับ 2 ตารางแรกตอนทำรายงาน
-- การเชื่อมต่อจาก Node: src/shared/db.js (DB_NAME=fitness_db ใน .env ต้องตรงกับชื่อที่สร้างที่นี่)
-- ============================================================================
-- ลบฐานข้อมูลเก่า (ถ้ามี) เพื่อเริ่มสะอาด
DROP DATABASE IF EXISTS fitness_db;
-- สร้างฐานข้อมูลใหม่ ใช้ utf8mb4 เพื่อเก็บภาษาไทยได้ (ตรงกับ charset:"utf8mb4" ใน src/shared/db.js)
CREATE DATABASE fitness_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- เลือกใช้ฐานข้อมูลนี้สำหรับคำสั่งถัดไป
USE fitness_db;

-- ตาราง gyms: สาขาฟิตเนส
--   ผู้ใช้: gym-service/app.js (SELECT/INSERT/UPDATE/DELETE) และ subscription-service (JOIN เอา g.name, g.monthly_fee)
--   หน้าเว็บ: ตารางในแท็บ "สาขาและราคา" (FLOW-02) และฟอร์ม gym-form (FLOW-04/05)
CREATE TABLE gyms (
    gym_id INT AUTO_INCREMENT PRIMARY KEY,   -- รหัสสาขา (MySQL รันเลขให้เอง -> คอลัมน์ "รหัส" ในตาราง / result.insertId ตอน POST /gyms)
    name VARCHAR(150) NOT NULL,              -- ชื่อสาขา (ยาวสุด 150 ตรงกับกติกาใน validators.js และ maxlength ของ #gym-name)
    address TEXT NOT NULL,                   -- ที่อยู่ (TEXT = ยาวได้มาก)  <- ช่อง #gym-address
    monthly_fee INT NOT NULL                 -- ค่าบริการรายเดือน เป็นจำนวนเต็ม (บาท) <- ช่อง #gym-fee
);

-- ตาราง members: สมาชิก
--   ผู้ใช้: member-service/app.js และ subscription-service (JOIN เอา m.name, m.email)
--   หน้าเว็บ: ตารางในแท็บ "สมาชิก" (FLOW-07) และฟอร์ม member-form (FLOW-08/09)
CREATE TABLE members (
    member_id INT AUTO_INCREMENT PRIMARY KEY, -- รหัสสมาชิก (รันเลขอัตโนมัติ)
    name VARCHAR(150) NOT NULL,               -- ชื่อสมาชิก <- ช่อง #member-name
    email VARCHAR(150) NOT NULL UNIQUE        -- UNIQUE: อีเมลซ้ำไม่ได้ -> MySQL โยน ER_DUP_ENTRY -> member-service ตอบ 409 DUPLICATE_EMAIL -> หน้าเว็บขึ้นแดงใต้ช่องอีเมล
);

-- ตาราง subscriptions: การสมัครแพ็กเกจ = ตารางเชื่อม "สมาชิก 1 คน" กับ "สาขา 1 แห่ง"
--   ผู้ใช้: subscription-service/app.js (ทุก route)
--   หน้าเว็บ: ตาราง "ประวัติการสมัครแพ็กเกจ" (FLOW-11), ฟอร์ม sub-form (FLOW-12/13), ปุ่มลบ (FLOW-14)
CREATE TABLE subscriptions (
    subscription_id INT AUTO_INCREMENT PRIMARY KEY, -- รหัสการสมัคร (รันเลขอัตโนมัติ)
    member_id INT NOT NULL,                  -- ใครสมัคร (อ้างถึง members.member_id) <- dropdown #sub-member
    gym_id INT NOT NULL,                     -- สมัครสาขาไหน (อ้างถึง gyms.gym_id) <- dropdown #sub-gym
    start_date DATE NOT NULL,                -- วันที่เริ่ม <- ช่อง #sub-date (ไม่ส่ง = COALESCE(?, CURDATE()) ใช้วันนี้)
    status VARCHAR(50) DEFAULT 'active',     -- สถานะ active/expired/cancelled <- ช่อง #sub-status (ตอนสร้างใหม่ SQL ใส่ 'active' ตรง ๆ)
    -- FOREIGN KEY + ON DELETE CASCADE: ลบสมาชิก (FLOW-10) -> แถวการสมัครของสมาชิกคนนั้นถูกลบอัตโนมัติ
    FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE,
    -- ลบสาขา (FLOW-06) -> แถวการสมัครของสาขานั้นถูกลบอัตโนมัติ (หน้าเว็บเตือนใน window.confirm ก่อนลบ)
    FOREIGN KEY (gym_id) REFERENCES gyms(gym_id) ON DELETE CASCADE,
    -- UNIQUE คู่ (สมาชิก, สาขา): คนเดียวสมัครสาขาเดิมซ้ำไม่ได้ -> ER_DUP_ENTRY -> subscription-service ตอบ 409 ALREADY_SUBSCRIBED
    -- (ใช้ทั้งตอน POST FLOW-12 และตอน PUT FLOW-13 ที่เปลี่ยนไปสาขาที่เคยสมัครแล้ว)
    UNIQUE KEY unique_enrollment (member_id, gym_id)
);