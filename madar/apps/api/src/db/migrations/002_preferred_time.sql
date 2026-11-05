-- «موعدي المعتاد»: يحجز به الموظف أسبوعه بضغطة واحدة
ALTER TABLE employees ADD COLUMN IF NOT EXISTS preferred_start time;
