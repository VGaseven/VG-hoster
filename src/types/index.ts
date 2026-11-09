/** Core domain types shared by the GIS engine, analytics, citizen view and video engine. */

export type LngLat = [number, number];

export type OrgId = 'municipality' | 'water' | 'electricity' | 'telecom' | 'roads';

export type Category =
  | 'water'
  | 'electricity'
  | 'telecom'
  | 'road_maintenance'
  | 'municipal'
  | 'drainage';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type ClosureType = 'full' | 'partial';

export type ProjectStatus =
  | 'draft'
  | 'submitted'
  | 'conflict_detected'
  | 'under_review'
  | 'alternative_proposed'
  | 'approved'
  | 'rejected'
  | 'scheduled';

export type RoadClass = 'motorway' | 'primary' | 'secondary' | 'connector';

export interface NetworkNode {
  id: string;
  kind: 'intersection' | 'gate' | 'zone';
  name: string;
  nameEn: string;
  coord: LngLat;
  /** Local planar coordinate (km) — u along King Fahd Rd axis, v across. */
  u: number;
  v: number;
}

export interface RoadSegment {
  id: string;
  roadId: string;
  name: string;
  nameEn: string;
  from: string;
  to: string;
  roadClass: RoadClass;
  lanesPerDirection: number;
  freeSpeedKmh: number;
  coords: LngLat[];
  lengthKm: number;
  /** Connectors are local-access links (not closable, no through traffic). */
  closable: boolean;
}

export interface ClosureExtent {
  segmentId: string;
  /** Fraction along the segment (0..1). */
  from: number;
  to: number;
}

export interface Schedule {
  /** ISO date YYYY-MM-DD, inclusive */
  start: string;
  end: string;
}

export interface WorkHours {
  /** 0..23 */
  start: number;
  /** 1..24, exclusive; start === 0 && end === 24 means continuous closure */
  end: number;
}

export interface Project {
  id: string;
  title: string;
  orgId: OrgId;
  category: Category;
  closures: ClosureExtent[];
  /** Schedule originally submitted by the organization (the "before" state). */
  proposed: Schedule;
  /** Current schedule (after approved coordination decisions). */
  schedule: Schedule;
  workHours: WorkHours;
  priority: Priority;
  earliestStart: string;
  latestEnd: string;
  closureType: ClosureType;
  /** Lanes closed per direction (partial closures). */
  affectedLanes: number;
  estimatedCostSar: number;
  status: ProjectStatus;
  neighborhood: string;
  createdAt: string;
  /** Projects coordinated into a shared work zone share this id. */
  coordinationGroup?: string;
  synthetic: true;
  notes?: string;
}

export type ConflictCategory = 'direct' | 'nearby' | 'detour' | 'access' | 'sequential';
export type EvidenceKind = 'geometric' | 'network' | 'proximity';
export type Severity = 'high' | 'medium' | 'low';

export interface ConflictEvidence {
  rule: ConflictCategory;
  kind: EvidenceKind;
  textAr: string;
  textEn: string;
  value?: number;
  unit?: string;
}

export interface Conflict {
  id: string;
  projectIds: [string, string];
  category: ConflictCategory;
  kind: EvidenceKind;
  severity: Severity;
  score: number;
  overlap: { start: string; end: string; days: number } | null;
  gapDays?: number;
  segmentIds: string[];
  evidence: ConflictEvidence[];
  scoreBreakdown: { label: string; points: number }[];
  explanationAr: string;
  location: LngLat;
}

export interface ScenarioMetrics {
  conflicts: number;
  highConflicts: number;
  closureSegmentDays: number;
  closureDays: number;
  vehicleHoursDelay: number;
  detourVehicleKm: number;
  accessibilityScore: number;
  worstAccessibility: number;
  maxVc: number;
  economicCostSar: number;
  daily: DailyMetric[];
}

export interface DailyMetric {
  day: number;
  date: string;
  activeProjects: number;
  closedSegments: number;
  vehicleHoursDelay: number;
  detourVehicleKm: number;
  accessibility: number;
}

export interface ScheduleChange {
  projectId: string;
  from: Schedule;
  to: Schedule;
  coordinationGroup?: string;
}

export type OptionKind = 'earlier' | 'delay' | 'coordinated';

export interface OptimizationOption {
  id: string;
  kind: OptionKind;
  titleAr: string;
  titleEn: string;
  feasible: boolean;
  infeasibleReasonAr?: string;
  changes: ScheduleChange[];
  metrics: ScenarioMetrics | null;
  shiftDays: number;
  tradeoffsAr: string[];
  score: number;
  recommended: boolean;
}

export interface Weights {
  conflicts: number;
  delay: number;
  closureDays: number;
  detour: number;
  accessibility: number;
  shift: number;
}

export interface EconomicAssumptions {
  valueOfTimeSarPerHour: number;
  vehicleOperatingCostSarPerKm: number;
  includeOperatingCost: boolean;
  occupancy: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: 'approve_option' | 'approve_project' | 'reject_project' | 'register_project' | 'reset' | 'status_change';
  conflictId?: string;
  optionKind?: OptionKind;
  projectIds: string[];
  rationale: string;
  changes: ScheduleChange[];
  actor: string;
}

export interface Place {
  id: string;
  nodeId: string;
  nameAr: string;
  nameEn: string;
}

export interface CitizenJourney {
  id: string;
  titleAr: string;
  originPlaceId: string;
  destinationPlaceId: string;
  date: string;
  hour: number;
}
