import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ScheduleSchema = z.object({ start: isoDate, end: isoDate });
export const ClosureSchema = z.object({ segmentId: z.string().min(1), from: z.number().min(0).max(1), to: z.number().min(0).max(1) });

export const ProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  orgId: z.enum(['municipality', 'water', 'electricity', 'telecom', 'roads']),
  category: z.enum(['water', 'electricity', 'telecom', 'road_maintenance', 'municipal', 'drainage']),
  closures: z.array(ClosureSchema).min(1),
  proposed: ScheduleSchema,
  schedule: ScheduleSchema,
  workHours: z.object({ start: z.number().int().min(0).max(23), end: z.number().int().min(1).max(24) }),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  earliestStart: isoDate,
  latestEnd: isoDate,
  closureType: z.enum(['full', 'partial']),
  affectedLanes: z.number().int().min(1).max(6),
  estimatedCostSar: z.number().min(0),
  status: z.enum(['draft', 'submitted', 'conflict_detected', 'under_review', 'alternative_proposed', 'approved', 'rejected', 'scheduled']),
  neighborhood: z.string(),
  createdAt: z.string(),
  coordinationGroup: z.string().optional(),
  synthetic: z.literal(true),
  notes: z.string().optional(),
});

export const PersistedSchema = z
  .object({
    lang: z.enum(['ar', 'en']).optional(),
    projects: z.array(ProjectSchema).optional(),
    audit: z.array(z.any()).optional(),
    weights: z.record(z.string(), z.number()).optional(),
    economics: z.object({ valueOfTimeSarPerHour: z.number(), vehicleOperatingCostSarPerKm: z.number(), includeOperatingCost: z.boolean(), occupancy: z.number() }).optional(),
    baseStyle: z.enum(['dark', 'light', 'satellite', 'offline']).optional(),
    overlays: z.record(z.string(), z.boolean()).optional(),
    speed: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(4)]).optional(),
    reducedMotion: z.boolean().optional(),
  })
  .passthrough();
