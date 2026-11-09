import type { Project, ScenarioMetrics } from '@/types';
import { ORGANIZATIONS } from '@/data/organizations';

/** CSV export of scenario metrics (summary, daily series, projects). UTF-8 with BOM for Excel. */
export function metricsCsv(before: ScenarioMetrics, after: ScenarioMetrics, projects: Project[]): string {
  const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push('section,metric,before,after');
  const keys: (keyof ScenarioMetrics)[] = ['closureEpisodes', 'repeatedClosures', 'closureKmDays', 'visibleClosureShare', 'conflicts', 'highConflicts', 'closureSegmentDays', 'closureDays', 'vehicleHoursDelay', 'detourVehicleKm', 'accessibilityScore', 'worstAccessibility', 'maxVc', 'economicCostSar'];
  for (const k of keys) lines.push(['summary', k, (before[k] as number).toFixed(3), (after[k] as number).toFixed(3)].map(esc).join(','));
  lines.push('');
  lines.push('section,date,before_vehicle_hours_delay,after_vehicle_hours_delay,before_detour_vkm,after_detour_vkm,before_accessibility,after_accessibility,before_closed_segments,after_closed_segments');
  before.daily.forEach((d, i) => {
    const a = after.daily[i];
    lines.push(['daily', d.date, d.vehicleHoursDelay.toFixed(2), a.vehicleHoursDelay.toFixed(2), d.detourVehicleKm.toFixed(2), a.detourVehicleKm.toFixed(2), d.accessibility.toFixed(2), a.accessibility.toFixed(2), d.closedSegments, a.closedSegments].map(esc).join(','));
  });
  lines.push('');
  lines.push('section,project_id,title,organization,category,segments,proposed_start,proposed_end,start,end,work_hours,priority,closure_type,lanes,status,synthetic');
  for (const p of projects)
    lines.push(['project', p.id, p.title, ORGANIZATIONS[p.orgId].en, p.category, p.closures.map((c) => c.segmentId).join('|'), p.proposed.start, p.proposed.end, p.schedule.start, p.schedule.end, `${p.workHours.start}-${p.workHours.end}`, p.priority, p.closureType, p.affectedLanes, p.status, 'true'].map(esc).join(','));
  return '﻿' + lines.join('\n');
}

