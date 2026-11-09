import type { EconomicAssumptions } from '@/types';

/**
 * ILLUSTRATIVE economic model — configurable assumptions, NOT verified Saudi government
 * statistics.
 *   Delay cost      = vehicle-hours of delay × occupancy (persons/vehicle) × value of time (SAR/person-hour)
 *   Operating cost  = additional vehicle-km × vehicle operating cost (SAR/vehicle-km)   [optional]
 */
export const DEFAULT_ECONOMICS: EconomicAssumptions = {
  valueOfTimeSarPerHour: 45,
  vehicleOperatingCostSarPerKm: 0.55,
  includeOperatingCost: true,
  occupancy: 1.3,
};

export function economicCost(vehicleHoursDelay: number, detourVehicleKm: number, a: EconomicAssumptions = DEFAULT_ECONOMICS) {
  const delayCost = vehicleHoursDelay * a.occupancy * a.valueOfTimeSarPerHour;
  const operatingCost = a.includeOperatingCost ? detourVehicleKm * a.vehicleOperatingCostSarPerKm : 0;
  return { delayCost, operatingCost, total: delayCost + operatingCost };
}

export const ECONOMIC_FORMULA_AR = [
  'تكلفة التأخير = ساعات تأخير المركبات × متوسط الإشغال (شخص/مركبة) × قيمة الوقت (ر.س/ساعة-شخص)',
  'تكلفة التشغيل = المسافة الإضافية (مركبة-كم) × تكلفة تشغيل المركبة (ر.س/كم)',
  'الأثر الاقتصادي التقديري = تكلفة التأخير + تكلفة التشغيل',
];
