-- مدار: المخطط الأساسي
-- ملاحظة: نخزّن الحي (منطقة الانطلاق) وليس عنوان المنزل الدقيق، ولا نخزّن أي تتبع مستمر للموقع.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  timezone        text NOT NULL DEFAULT 'Asia/Riyadh',
  -- طريقة تسجيل الدخول: oidc | saml | dev
  auth_type       text NOT NULL DEFAULT 'dev' CHECK (auth_type IN ('oidc','saml','dev')),
  oidc_issuer     text,
  oidc_client_id  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code              text NOT NULL,
  name              text NOT NULL,
  lat               double precision NOT NULL,
  lng               double precision NOT NULL,
  -- هامش المشي والدخول من المواقف إلى المكتب
  entry_buffer_min  integer NOT NULL DEFAULT 10 CHECK (entry_buffer_min BETWEEN 0 and 60),
  UNIQUE (org_id, code)
);

-- أحياء الانطلاق: مركز تقريبي فقط
CREATE TABLE districts (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city  text NOT NULL,
  name  text NOT NULL,
  lat   double precision NOT NULL,
  lng   double precision NOT NULL,
  UNIQUE (city, name)
);

CREATE TABLE employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_id   text NOT NULL,            -- المعرّف في نظام الموارد البشرية
  name          text NOT NULL,
  email         text NOT NULL,
  role          text NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','admin')),
  site_id       uuid REFERENCES sites(id) ON DELETE SET NULL,
  district_id   uuid REFERENCES districts(id) ON DELETE SET NULL,
  eligible      boolean NOT NULL DEFAULT true,   -- الوظيفة مؤهلة للمرونة
  work_hours    numeric(4,2) NOT NULL DEFAULT 8,
  travel_mode   text NOT NULL DEFAULT 'DRIVE' CHECK (travel_mode IN ('DRIVE','TRANSIT','TWO_WHEELER','WALK')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_id),
  UNIQUE (org_id, email)
);

CREATE TABLE leaves (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX leaves_employee_idx ON leaves(employee_id, start_date, end_date);

-- سياسة المرونة لكل مقر
CREATE TABLE policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               uuid NOT NULL UNIQUE REFERENCES sites(id) ON DELETE CASCADE,
  earliest_arrival      time NOT NULL DEFAULT '06:30',
  latest_arrival        time NOT NULL DEFAULT '09:00',
  slot_minutes          integer NOT NULL DEFAULT 30 CHECK (slot_minutes IN (10,15,20,30,45,60)),
  default_quota         integer NOT NULL DEFAULT 20 CHECK (default_quota >= 0),
  default_min_staff     integer NOT NULL DEFAULT 0 CHECK (default_min_staff >= 0),
  workdays              integer[] NOT NULL DEFAULT '{0,1,2,3,4}', -- 0 = الأحد
  booking_horizon_days  integer NOT NULL DEFAULT 14 CHECK (booking_horizon_days BETWEEN 1 AND 90),
  change_cutoff_hours   integer NOT NULL DEFAULT 12 CHECK (change_cutoff_hours BETWEEN 0 AND 168),
  require_change_approval boolean NOT NULL DEFAULT true,
  late_grace_min        integer NOT NULL DEFAULT 10,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (latest_arrival > earliest_arrival)
);

-- الفترات: «السعة» هنا حصة لتنظيم حجوزات المشاركين وليست سعة الطريق
CREATE TABLE slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  date          date NOT NULL,
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  quota         integer NOT NULL CHECK (quota >= 0),
  min_staff     integer NOT NULL DEFAULT 0 CHECK (min_staff >= 0),
  booked_count  integer NOT NULL DEFAULT 0,
  closed        boolean NOT NULL DEFAULT false,
  CHECK (booked_count >= 0),
  UNIQUE (site_id, date, start_time)
);
CREATE INDEX slots_site_date_idx ON slots(site_id, date);

CREATE TABLE bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  slot_id         uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  date            date NOT NULL,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','superseded')),
  planned_departure timestamptz,          -- وقت الانطلاق الذي اختاره الموظف (قراره هو)
  created_at      timestamptz NOT NULL DEFAULT now(),
  cancelled_at    timestamptz
);
-- حجز نشط واحد لكل موظف في اليوم
CREATE UNIQUE INDEX bookings_one_active_per_day ON bookings(employee_id, date) WHERE status = 'active';
CREATE INDEX bookings_slot_idx ON bookings(slot_id) WHERE status = 'active';

-- طلبات التغيير: الموعد السابق يبقى ساريًا حتى الاعتماد
CREATE TABLE change_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  new_slot_id   uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  reason        text,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn','failed')),
  decided_by    uuid REFERENCES employees(id),
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX change_requests_one_pending ON change_requests(booking_id) WHERE status = 'pending';

-- الحضور الفعلي المعتمد من الجهة
CREATE TABLE attendance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date          date NOT NULL,
  check_in_at   timestamptz NOT NULL,
  source        text NOT NULL DEFAULT 'file' CHECK (source IN ('file','api')),
  batch_id      uuid,
  UNIQUE (employee_id, date)
);

CREATE TABLE import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('hr','leaves','attendance')),
  source      text NOT NULL,
  row_count   integer NOT NULL DEFAULT 0,
  ok_count    integer NOT NULL DEFAULT 0,
  errors      jsonb NOT NULL DEFAULT '[]',
  created_by  uuid REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ذاكرة مؤقتة قصيرة لتقديرات الرحلات (تُحذف بعد انتهاء الصلاحية، لا تُستخدم للأرشفة أو التدريب)
CREATE TABLE trip_estimate_cache (
  cache_key     text PRIMARY KEY,
  duration_s    integer NOT NULL,
  distance_m    integer,
  source        text NOT NULL CHECK (source IN ('google','fallback')),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX trip_estimate_cache_exp_idx ON trip_estimate_cache(expires_at);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES bookings(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  send_at     timestamptz NOT NULL,
  sent_at     timestamptz,
  cancelled   boolean NOT NULL DEFAULT false,
  payload     jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX notifications_due_idx ON notifications(send_at) WHERE sent_at IS NULL AND cancelled = false;

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid,
  actor_id    uuid,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
