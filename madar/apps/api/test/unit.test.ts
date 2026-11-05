import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, addDays, weekday } from '../src/common/time';
import { parseCsv } from '../src/integrations/csv';
import { slotTimes } from '../src/slots/slots.service';
import { planArrival, googleMapsDirectionsUrl } from '../src/routes/planner';
import { TripEstimator } from '../src/routes/estimator';
import { GoogleRoutesEstimator, buildRoutesRequest, parseDuration } from '../src/routes/google-routes';

test('zonedToUtc: Riyadh is UTC+3', () => {
  assert.equal(zonedToUtc('2026-11-08', '07:30', 'Asia/Riyadh').toISOString(), '2026-11-08T04:30:00.000Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-11-08'), 0); // الأحد
});

test('slotTimes splits the arrival window', () => {
  const t = slotTimes({ earliest_arrival: '06:30', latest_arrival: '09:00', slot_minutes: 30 });
  assert.equal(t.length, 5);
  assert.deepEqual(t[0], { start: '06:30', end: '07:00' });
  assert.deepEqual(t[4], { start: '08:30', end: '09:00' });
});

test('parseCsv handles quotes, BOM and CRLF', () => {
  const rows = parseCsv('﻿external_id,name\r\nE1,"العتيبي, سارة"\r\nE2,"قال ""مرحبا"""\r\n');
  assert.deepEqual(rows, [
    { external_id: 'E1', name: 'العتيبي, سارة' },
    { external_id: 'E2', name: 'قال "مرحبا"' },
  ]);
});

test('planArrival converges on a departure that arrives by slot start', async () => {
  const slotStart = new Date('2026-11-08T04:30:00Z'); // 07:30 الرياض
  const slotEnd = new Date('2026-11-08T05:00:00Z');
  const calls: Date[] = [];
  // ازدحام يتصاعد: كل دقيقة متأخرة تضيف 20 ثانية
  const est: TripEstimator = {
    async estimate(_o, _d, dep) {
      calls.push(dep);
      const minsAfter6 = (dep.getTime() - Date.parse('2026-11-08T03:00:00Z')) / 60000;
      return { durationS: Math.round(1500 + Math.max(0, minsAfter6) * 20), source: 'google' };
    },
  };
  const plan = await planArrival(est, {
    origin: { lat: 24.8, lng: 46.6 }, dest: { lat: 24.76, lng: 46.64 }, mode: 'DRIVE',
    slotStart, slotEnd, entryBufferMin: 10, now: new Date('2026-11-07T12:00:00Z'),
  });
  const rec = plan.options.find((o) => o.label === 'recommended')!;
  assert.ok(new Date(rec.arriveAt) <= slotEnd, 'recommended arrives within the slot');
  assert.ok(new Date(rec.arriveAt).getTime() <= slotStart.getTime() + 5 * 60_000, 'close to slot start');
  assert.equal(new Date(rec.departAt).getUTCMinutes() % 5, 0);
  assert.ok(plan.options[0].departAt < rec.departAt, 'safer option leaves earlier');
  assert.equal(plan.approximate, false);
  assert.ok(calls.length <= 7, `bounded API calls (${calls.length})`);
});

test('Routes request uses departureTime only for future departures', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const b = buildRoutesRequest({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, new Date('2026-11-08T04:00:00Z'), 'DRIVE', now);
  assert.equal(b.departureTime, '2026-11-08T04:00:00.000Z');
  assert.equal(b.routingPreference, 'TRAFFIC_AWARE');
  const past = buildRoutesRequest({ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, new Date('2026-11-07T11:00:00Z'), 'TRANSIT', now);
  assert.equal(past.departureTime, undefined);
  assert.equal(past.routingPreference, undefined);
  assert.equal(parseDuration('1234s'), 1234);
  assert.equal(parseDuration('12.6s'), 13);
});

test('Google estimator parses responses and falls back on outage', async () => {
  let body: any;
  const ok = new GoogleRoutesEstimator('k', null, 60, undefined, (async (_u: any, init: any) => {
    body = JSON.parse(init.body);
    assert.equal(init.headers['X-Goog-Api-Key'], 'k');
    return new Response(JSON.stringify({ routes: [{ duration: '1800s', distanceMeters: 21000 }] }));
  }) as any);
  const r = await ok.estimate({ lat: 24.8, lng: 46.6 }, { lat: 24.76, lng: 46.64 }, new Date(Date.now() + 3600_000), 'DRIVE');
  assert.deepEqual(r, { durationS: 1800, distanceM: 21000, source: 'google' });
  assert.ok(body.departureTime);

  const down = new GoogleRoutesEstimator('k', null, 60, undefined, (async () => new Response('err', { status: 503 })) as any);
  const f = await down.estimate({ lat: 24.8, lng: 46.6 }, { lat: 24.76, lng: 46.64 }, new Date(), 'DRIVE');
  assert.equal(f.source, 'fallback');
  assert.ok(f.durationS > 0);
});

test('Google Maps navigation link', () => {
  const u = new URL(googleMapsDirectionsUrl({ lat: 24.7646, lng: 46.6402 }, 'DRIVE'));
  assert.equal(u.searchParams.get('api'), '1');
  assert.equal(u.searchParams.get('destination'), '24.7646,46.6402');
  assert.equal(u.searchParams.get('travelmode'), 'driving');
  assert.equal(u.searchParams.get('origin'), null);
  const fromDistrict = new URL(googleMapsDirectionsUrl({ lat: 24.7646, lng: 46.6402 }, 'DRIVE', { lat: 24.827, lng: 46.64 }));
  assert.equal(fromDistrict.searchParams.get('origin'), '24.827,46.64');
});
