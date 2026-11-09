import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuditEntry, EconomicAssumptions, OptimizationOption, Project, ProjectStatus, Weights } from '@/types';
import { createDemoConflictProject, createSeedProjects } from '@/data/projects';
import { DEFAULT_WEIGHTS } from '@/engine/optimization/optimize';
import { DEFAULT_ECONOMICS } from '@/engine/economics/economics';
import { DEFAULT_OVERLAYS, type Overlays } from '@/components/map/overlays';
import type { BaseStyle } from '@/components/map/styles';
import { HORIZON_DAYS, dayIndex } from '@/utils/date';
import { getConflicts } from './derived';
import { PersistedSchema } from './schema';

export type Lang = 'ar' | 'en';
export type Speed = 0.5 | 1 | 2 | 4;

export interface Toast {
  id: number;
  tone: 'success' | 'error' | 'info' | 'warning';
  title: string;
  body?: string;
}

export type CameraCommand =
  | { type: 'fly'; center: [number, number]; zoom?: number; pitch?: number; bearing?: number; duration?: number }
  | { type: 'reset' }
  | { type: 'tour' }
  | { type: 'orbit'; center?: [number, number] }
  | { type: 'follow' }
  | { type: 'stop' }
  | { type: 'zoom'; delta: number }
  | { type: 'rotate'; delta: number }
  | { type: 'pitch'; delta: number };

export interface DraftClosure {
  segmentId: string | null;
  from: number;
  to: number;
  pickStage: 'idle' | 'segment' | 'start' | 'end';
}

interface State {
  lang: Lang;
  projects: Project[];
  audit: AuditEntry[];
  weights: Weights;
  economics: EconomicAssumptions;
  selectedProjectId: string | null;
  selectedConflictId: string | null;
  simTime: number; // fractional day index; hour = frac*24
  playing: boolean;
  speed: Speed;
  viewMode: 'after' | 'before';
  baseStyle: BaseStyle;
  is3D: boolean;
  overlays: Overlays;
  mapFallback: string | null;
  camera: { cmd: CameraCommand; nonce: number } | null;
  draft: DraftClosure;
  toasts: Toast[];
  panels: { left: boolean; right: boolean; timeline: boolean };
  scenarioName: string;
  tutorial: { active: boolean; step: number };
  demo: { active: boolean };
  reducedMotion: boolean;
  highlightSegments: string[];
  district: string;
  notificationsOpen: boolean;
  lastOptimization: { conflictId: string; options: OptimizationOption[] } | null;
  focusOption: OptimizationOption['kind'] | null;
  reviewRequest: OptimizationOption['kind'] | null;
  show: { active: boolean; scene: number; playing: boolean };

  setLang: (l: Lang) => void;
  selectProject: (id: string | null) => void;
  selectConflict: (id: string | null) => void;
  setSimTime: (t: number) => void;
  setSimDate: (iso: string, hour?: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setSpeed: (s: Speed) => void;
  restartSim: () => void;
  setViewMode: (m: 'after' | 'before') => void;
  setBaseStyle: (s: BaseStyle) => void;
  set3D: (v: boolean) => void;
  setOverlay: (k: keyof Overlays, v: boolean) => void;
  setMapFallback: (r: string | null) => void;
  cameraCmd: (c: CameraCommand) => void;
  setDraft: (d: Partial<DraftClosure>) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  togglePanel: (k: keyof State['panels'], v?: boolean) => void;
  setWeights: (w: Partial<Weights>) => void;
  setEconomics: (e: Partial<EconomicAssumptions>) => void;
  addProject: (p: Project) => void;
  injectDemoConflict: () => Project;
  removeProject: (id: string) => void;
  setStatus: (id: string, status: ProjectStatus, rationale?: string) => void;
  approveOption: (conflictId: string, option: OptimizationOption, rationale: string, modified?: boolean) => void;
  rejectOption: (conflictId: string, option: OptimizationOption, rationale: string) => void;
  setFocusOption: (k: OptimizationOption['kind'] | null) => void;
  setReviewRequest: (k: OptimizationOption['kind'] | null) => void;
  setShow: (s: Partial<State['show']>) => void;
  resetScenario: () => void;
  setTutorial: (t: Partial<State['tutorial']>) => void;
  setDemo: (active: boolean) => void;
  setReducedMotion: (v: boolean) => void;
  setHighlight: (segs: string[]) => void;
  setNotificationsOpen: (v: boolean) => void;
  setLastOptimization: (o: State['lastOptimization']) => void;
  markAlternativeProposed: (ids: string[]) => void;
}

let toastId = 1;
let camNonce = 1;

/** Re-derive project statuses from detected conflicts (keeps decisions intact). */
export function syncStatuses(projects: Project[]): Project[] {
  const conflicts = getConflicts(projects).filter((c) => c.kind !== 'proximity' || c.category === 'sequential');
  const inConflict = new Set(conflicts.flatMap((c) => c.projectIds));
  let changed = false;
  const next = projects.map((p) => {
    let s = p.status;
    if ((s === 'submitted' || s === 'under_review') && inConflict.has(p.id)) s = 'conflict_detected';
    else if (s === 'conflict_detected' && !inConflict.has(p.id)) s = 'submitted';
    if (s !== p.status) {
      changed = true;
      return { ...p, status: s };
    }
    return p;
  });
  return changed ? next : projects;
}

const initialProjects = () => syncStatuses(createSeedProjects());

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      lang: 'ar',
      projects: initialProjects(),
      audit: [],
      weights: DEFAULT_WEIGHTS,
      economics: DEFAULT_ECONOMICS,
      selectedProjectId: null,
      selectedConflictId: null,
      simTime: dayIndex('2026-12-16') + 8 / 24,
      playing: false,
      speed: 1,
      viewMode: 'after',
      baseStyle: 'dark',
      is3D: true,
      overlays: DEFAULT_OVERLAYS,
      mapFallback: null,
      camera: null,
      draft: { segmentId: null, from: 0.2, to: 0.8, pickStage: 'idle' },
      toasts: [],
      panels: { left: true, right: true, timeline: true },
      scenarioName: 'حي العليا — مشاريع افتراضية',
      tutorial: { active: false, step: 0 },
      demo: { active: false },
      reducedMotion: typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      highlightSegments: [],
      district: 'حي العليا',
      notificationsOpen: false,
      lastOptimization: null,
      focusOption: null,
      reviewRequest: null,
      show: { active: false, scene: 0, playing: true },

      setLang: (lang) => set({ lang }),
      selectProject: (id) => set({ selectedProjectId: id, panels: { ...get().panels, right: id ? true : get().panels.right } }),
      selectConflict: (id) => set({ selectedConflictId: id }),
      setSimTime: (t) => set({ simTime: Math.max(0, Math.min(HORIZON_DAYS - 1e-3, t)) }),
      setSimDate: (iso, hour) => set({ simTime: Math.max(0, Math.min(HORIZON_DAYS - 1e-3, dayIndex(iso) + (hour ?? (get().simTime % 1) * 24) / 24)) }),
      setPlaying: (playing) => set({ playing }),
      togglePlay: () => set({ playing: !get().playing }),
      setSpeed: (speed) => set({ speed }),
      restartSim: () => set({ simTime: 0, playing: false }),
      setViewMode: (viewMode) => set({ viewMode }),
      setBaseStyle: (baseStyle) => set({ baseStyle, mapFallback: null }),
      set3D: (is3D) => set({ is3D }),
      setOverlay: (k, v) => set({ overlays: { ...get().overlays, [k]: v } }),
      setMapFallback: (mapFallback) => set({ mapFallback }),
      cameraCmd: (cmd) => set({ camera: { cmd, nonce: camNonce++ } }),
      setDraft: (d) => set({ draft: { ...get().draft, ...d } }),
      toast: (t) => {
        const id = toastId++;
        set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
        setTimeout(() => get().dismissToast(id), 5200);
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
      togglePanel: (k, v) => set({ panels: { ...get().panels, [k]: v ?? !get().panels[k] } }),
      setWeights: (w) => set({ weights: { ...get().weights, ...w } }),
      setEconomics: (e) => set({ economics: { ...get().economics, ...e } }),
      addProject: (p) => {
        const projects = syncStatuses([...get().projects, p]);
        const audit: AuditEntry = {
          id: `A-${Date.now()}`,
          at: new Date().toISOString(),
          action: 'register_project',
          projectIds: [p.id],
          rationale: `تسجيل مشروع جديد: ${p.title}`,
          changes: [],
          actor: 'مستخدم المنصة (عرض تجريبي)',
        };
        set({ projects, audit: [audit, ...get().audit], selectedProjectId: p.id });
      },
      injectDemoConflict: () => {
        const existing = get().projects.find((p) => p.id === 'RASD-D01');
        if (existing) return existing;
        const p = createDemoConflictProject();
        get().addProject(p);
        return get().projects.find((x) => x.id === p.id)!;
      },
      removeProject: (id) => set({ projects: syncStatuses(get().projects.filter((p) => p.id !== id)), selectedProjectId: null }),
      setStatus: (id, status, rationale) => {
        const projects = syncStatuses(get().projects.map((p) => (p.id === id ? { ...p, status } : p)));
        const audit: AuditEntry = {
          id: `A-${Date.now()}`,
          at: new Date().toISOString(),
          action: status === 'approved' ? 'approve_project' : status === 'rejected' ? 'reject_project' : 'status_change',
          projectIds: [id],
          rationale: rationale ?? '',
          changes: [],
          actor: 'متخذ القرار (عرض تجريبي)',
        };
        set({ projects, audit: [audit, ...get().audit] });
      },
      setFocusOption: (focusOption) => set({ focusOption }),
      setReviewRequest: (reviewRequest) => set({ reviewRequest }),
      setShow: (sh) => set({ show: { ...get().show, ...sh } }),
      rejectOption: (conflictId, option, rationale) => {
        const conflict = getConflicts(get().projects).find((c) => c.id === conflictId);
        const ids = conflict?.projectIds ?? option.changes.map((c) => c.projectId);
        const audit: AuditEntry = { id: `A-${Date.now()}`, at: new Date().toISOString(), action: 'reject_option', conflictId, optionKind: option.kind, projectIds: ids, rationale, changes: option.changes, actor: 'الجهة المختصة (عرض تجريبي)' };
        set({ projects: get().projects.map((p) => (ids.includes(p.id) && p.status === 'alternative_proposed' ? { ...p, status: 'under_review' as const } : p)), audit: [audit, ...get().audit] });
      },
      approveOption: (conflictId, option, rationale, modified) => {
        const changed = new Map(option.changes.map((c) => [c.projectId, c]));
        const conflict = getConflicts(get().projects).find((c) => c.id === conflictId);
        const involved = new Set([...(conflict?.projectIds ?? []), ...changed.keys()]);
        const projects = syncStatuses(
          get().projects.map((p) => {
            const c = changed.get(p.id);
            if (c) return { ...p, schedule: { ...c.to }, coordinationGroup: c.coordinationGroup ?? p.coordinationGroup, status: 'scheduled' as const };
            if (involved.has(p.id)) return { ...p, status: 'approved' as const };
            return p;
          }),
        );
        const audit: AuditEntry = {
          id: `A-${Date.now()}`,
          at: new Date().toISOString(),
          action: modified ? 'modify_option' : 'approve_option',
          conflictId,
          optionKind: option.kind,
          projectIds: [...involved],
          rationale,
          changes: option.changes,
          actor: 'الجهة المختصة (عرض تجريبي)',
        };
        set({ projects, audit: [audit, ...get().audit], lastOptimization: null });
      },
      resetScenario: () => {
        set({
          projects: initialProjects(),
          audit: [
            { id: `A-${Date.now()}`, at: new Date().toISOString(), action: 'reset', projectIds: [], rationale: 'إعادة ضبط السيناريو إلى البيانات التجريبية الأصلية', changes: [], actor: 'النظام' },
          ],
          selectedProjectId: null,
          selectedConflictId: null,
          highlightSegments: [],
          lastOptimization: null,
          focusOption: null,
          viewMode: 'after',
          simTime: dayIndex('2026-12-16') + 8 / 24,
          playing: false,
        });
      },
      setTutorial: (t) => set({ tutorial: { ...get().tutorial, ...t } }),
      setDemo: (active) => set({ demo: { active } }),
      setReducedMotion: (reducedMotion) => set({ reducedMotion }),
      setHighlight: (highlightSegments) => set({ highlightSegments }),
      setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
      setLastOptimization: (lastOptimization) => set({ lastOptimization }),
      markAlternativeProposed: (ids) => {
        const target = new Set(ids);
        if (!get().projects.some((p) => target.has(p.id) && (p.status === 'conflict_detected' || p.status === 'under_review'))) return;
        set({ projects: get().projects.map((p) => (target.has(p.id) && (p.status === 'conflict_detected' || p.status === 'under_review') ? { ...p, status: 'alternative_proposed' as const } : p)) });
      },
    }),
    {
      name: 'rasd-state-v1',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        lang: s.lang,
        projects: s.projects,
        audit: s.audit,
        weights: s.weights,
        economics: s.economics,
        baseStyle: s.baseStyle,
        overlays: s.overlays,
        speed: s.speed,
        reducedMotion: s.reducedMotion,
      }),
      merge: (persisted, current) => {
        const parsed = PersistedSchema.safeParse(persisted);
        if (!parsed.success) return current;
        const p = parsed.data as Partial<State>;
        if (p.weights && (p.weights as Partial<Weights>).repeat === undefined) p.weights = { ...DEFAULT_WEIGHTS, ...p.weights };
        return { ...current, ...p, projects: syncStatuses((p.projects as Project[] | undefined) ?? current.projects), overlays: { ...current.overlays, ...(p.overlays ?? {}) } };
      },
    },
  ),
);

export const simDayOf = (t: number) => Math.floor(t);
export const simHourOf = (t: number) => (t - Math.floor(t)) * 24;
