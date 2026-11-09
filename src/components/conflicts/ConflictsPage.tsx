import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { AlertTriangle, ChevronRight, Crosshair, FileSearch, Radar, ShieldAlert, Wand2, Zap } from 'lucide-react';
import type { Conflict } from '@/types';
import { SidePanel } from '@/app/Layout';
import { useStore } from '@/store/store';
import { useConflicts } from '@/store/derived';
import { CATEGORY_LABELS, KIND_LABELS, RULES, SEVERITY_LABELS } from '@/engine/conflicts/detect';
import { ORGANIZATIONS } from '@/data/organizations';
import { Badge, Button, Dialog, Empty } from '@/components/ui/ui';
import { fmtDate } from '@/utils/date';
import { cn } from '@/utils/format';
import { startShow } from '@/components/tutorial/RasdShow';

const sevTone = { high: 'red', medium: 'amber', low: 'slate' } as const;

export function ConflictsPage() {
  const projects = useStore((s) => s.projects);
  const conflicts = useConflicts(projects);
  const selectedId = useStore((s) => s.selectedConflictId);
  const select = useStore((s) => s.selectConflict);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('scenario') === '1') {
      startShow(2);
      params.delete('scenario');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);
  const main = conflicts.filter((c) => c.kind !== 'proximity' || c.category === 'sequential');
  const warnings = conflicts.filter((c) => c.kind === 'proximity' && c.category !== 'sequential');
  const selected = conflicts.find((c) => c.id === selectedId) ?? null;

  return (
    <>
      <SidePanel width={392} testid="conflicts-panel" tour="conflicts-panel">
        <div className="border-b border-white/6 p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Radar size={17} className="text-red-300" /> تحليل التعارض
          </h2>
          <p className="mt-1 text-[11.5px] text-slate-400">قراءة المشاريع معاً بدل التعامل مع كل إغلاق منفرداً — كل تعارض مدعوم بأدلة ونوع دليل واضح.</p>
          <Button variant="primary" size="sm" className="mt-3 w-full" onClick={() => startShow(2)} data-testid="open-scenario" data-tour="simulate-conflict">
            <Zap size={14} /> عرض سيناريو رصد (التعارض)
          </Button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
          {selected ? (
            <ConflictDetails conflict={selected} onBack={() => select(null)} />
          ) : (
            <>
              {main.length === 0 && <Empty icon={<ShieldAlert size={22} />} title="لا توجد تعارضات" body="جميع المشاريع منسقة حالياً." />}
              <div className="space-y-1.5">
                {main.map((c) => (
                  <ConflictRow key={c.id} c={c} onClick={() => select(c.id)} />
                ))}
              </div>
              {warnings.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 text-[11.5px] font-semibold text-slate-400">تحذيرات قرب (ليست دليلاً على ازدحام) · {warnings.length}</div>
                  <div className="space-y-1.5 opacity-80">
                    {warnings.map((c) => (
                      <ConflictRow key={c.id} c={c} onClick={() => select(c.id)} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SidePanel>
    </>
  );
}

function ConflictRow({ c, onClick }: { c: Conflict; onClick: () => void }) {
  const projects = useStore((s) => s.projects);
  const [a, b] = c.projectIds.map((id) => projects.find((p) => p.id === id));
  return (
    <button onClick={onClick} className="w-full rounded-xl border border-white/6 bg-white/[0.02] p-2.5 text-right transition hover:border-red-400/30 hover:bg-red-500/[0.04]" data-testid={`conflict-row-${c.id}`}>
      <div className="flex items-center gap-1.5">
        <Badge tone={sevTone[c.severity]}>{SEVERITY_LABELS[c.severity].ar}</Badge>
        <Badge tone="slate">{CATEGORY_LABELS[c.category]}</Badge>
        <span className="num mr-auto text-[11px] font-semibold text-slate-400">{c.score}</span>
      </div>
      <div className="mt-1.5 space-y-0.5 text-[12px]">
        {[a, b].map((p) =>
          p ? (
            <div key={p.id} className="flex items-center gap-1.5 truncate">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ORGANIZATIONS[p.orgId].color }} />
              <span className="truncate text-slate-200">{p.title}</span>
            </div>
          ) : null,
        )}
      </div>
      {c.overlap && (
        <div className="mt-1 text-[10.5px] text-slate-500">
          تداخل: {fmtDate(c.overlap.start)} – {fmtDate(c.overlap.end)} ({c.overlap.days} يوم)
        </div>
      )}
    </button>
  );
}

export function ConflictDetails({ conflict: c, onBack }: { conflict: Conflict; onBack?: () => void }) {
  const navigate = useNavigate();
  const projects = useStore((s) => s.projects);
  const cameraCmd = useStore((s) => s.cameraCmd);
  const selectProject = useStore((s) => s.selectProject);
  const [open, setOpen] = useState(false);
  const ps = c.projectIds.map((id) => projects.find((p) => p.id === id)!).filter(Boolean);
  useEffect(() => {
    cameraCmd({ type: 'fly', center: c.location, zoom: 15, pitch: 62 });
  }, [c.id, c.location, cameraCmd]);
  return (
    <div className="space-y-3" data-testid="conflict-details">
      {onBack && (
        <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-slate-400 hover:text-white">
          <ChevronRight size={14} /> كل التعارضات
        </button>
      )}
      <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn('rounded-xl border p-3.5', c.severity === 'high' ? 'border-red-500/40 bg-red-500/[0.08]' : c.severity === 'medium' ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'border-white/10 bg-white/[0.03]')} data-testid="conflict-warning">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className={c.severity === 'high' ? 'text-red-400' : 'text-amber-300'} />
          <span className="text-[15px] font-bold">{SEVERITY_LABELS[c.severity].ar}</span>
          <span className="num mr-auto rounded-md bg-black/30 px-2 py-0.5 text-[12px] font-semibold">{c.score}/100</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="red">{CATEGORY_LABELS[c.category]}</Badge>
          <Badge tone={c.kind === 'geometric' ? 'violet' : c.kind === 'network' ? 'sky' : 'slate'}>{KIND_LABELS[c.kind].ar}</Badge>
        </div>
        <div className="mt-3 space-y-1.5 text-[12.5px]">
          {ps.map((p, i) => (
            <button key={p.id} onClick={() => selectProject(p.id)} className="flex w-full items-center gap-2 text-right hover:text-cyan-200">
              <span className="w-4 text-slate-500">{i === 0 ? 'أ' : 'ب'}</span>
              <span className="h-2 w-2 rounded-full" style={{ background: ORGANIZATIONS[p.orgId].color }} />
              <span className="truncate">{p.title}</span>
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-black/25 p-2.5 text-[12px] leading-relaxed text-slate-200">
          <span className="text-slate-400">السبب: </span>
          {c.explanationAr}
        </div>
        {c.overlap ? (
          <div className="mt-2 text-[11.5px] text-slate-300">
            الفترة المتأثرة: {fmtDate(c.overlap.start)} – {fmtDate(c.overlap.end)} <span className="text-slate-500">({c.overlap.days} يوم)</span>
          </div>
        ) : (
          c.gapDays !== undefined && <div className="mt-2 text-[11.5px] text-slate-300">فاصل بين الإغلاقين: {c.gapDays} يوم</div>
        )}
      </motion.div>
      <div className="space-y-1.5">
        <div className="text-[11.5px] font-semibold text-slate-400">الأدلة ({c.evidence.length})</div>
        {c.evidence.slice(0, 3).map((e, i) => (
          <div key={i} className="rounded-lg border border-white/6 bg-white/[0.02] p-2 text-[11.5px] leading-relaxed text-slate-300">
            <Badge tone={e.kind === 'geometric' ? 'violet' : e.kind === 'network' ? 'sky' : 'slate'} className="mb-1">
              {KIND_LABELS[e.kind].ar}
            </Badge>
            <div>{e.textAr}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="conflict-evidence">
          <FileSearch size={14} /> عرض تفاصيل التعارض
        </Button>
        <Button size="sm" variant="outline" onClick={() => cameraCmd({ type: 'fly', center: c.location, zoom: 15.6, pitch: 65 })}>
          <Crosshair size={14} /> التحليق إلى التعارض
        </Button>
        <Button size="sm" variant="primary" className="col-span-2" onClick={() => navigate('/optimize')} data-testid="go-optimize">
          <Wand2 size={14} /> مقارنة البدائل الثلاثة
        </Button>
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="تفاصيل التعارض — الأدلة والحساب" wide>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-400">الأدلة الكاملة</div>
            {c.evidence.map((e, i) => (
              <div key={i} className="rounded-lg border border-white/8 bg-white/[0.03] p-2.5 text-[12px] leading-relaxed">
                <div className="mb-1 flex gap-1.5">
                  <Badge tone="slate">{CATEGORY_LABELS[e.rule]}</Badge>
                  <Badge tone={e.kind === 'geometric' ? 'violet' : e.kind === 'network' ? 'sky' : 'slate'}>{KIND_LABELS[e.kind].ar}</Badge>
                </div>
                {e.textAr}
                <div className="mt-1 text-[10.5px] text-slate-500" dir="ltr">
                  {e.textEn}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-400">تفصيل درجة الخطورة</div>
              {c.scoreBreakdown.map((b, i) => (
                <div key={i} className="flex justify-between border-b border-white/5 py-1.5 text-[12px]">
                  <span className="text-slate-300">{b.label}</span>
                  <span className="num font-semibold">+{b.points}</span>
                </div>
              ))}
              <div className="flex justify-between py-1.5 text-[13px] font-bold">
                <span>المجموع</span>
                <span className="num">{c.score}/100</span>
              </div>
              <div className="text-[10.5px] text-slate-500">≥٦٥ مرتفع · ٤٠–٦٤ متوسط · أقل من ٤٠ منخفض</div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-slate-400">عتبات القواعد</div>
              <ul className="space-y-1 text-[11.5px] text-slate-400">
                <li>• التداخل المباشر: نفس معرّف المقطع + تداخل التاريخ وساعات العمل + تأكيد هندسي عبر Turf.</li>
                <li>• تعارض التحويل: ≥ {RULES.DETOUR_MIN_VPH} مركبة/ساعة محوّلة إلى مقطع المشروع الآخر (نموذج التوزيع).</li>
                <li>• المتجاورة: مسافة ≤ {RULES.NEARBY_KM * 1000} م و تشابه رحلات ≥ {RULES.MOVEMENT_JACCARD * 100}% وإلا تُعد تحذير قرب فقط.</li>
                <li>• تعطّل الوصول: انخفاض ≥ {RULES.ACCESS_DROP_POINTS} نقاط مع زيادة ≥ {RULES.ACCESS_EXTRA_POINTS} عن أسوأ أثر منفرد.</li>
                <li>• المتتابعة: نفس الطريق ضمن {RULES.SEQUENTIAL_KM * 1000} م وفاصل ≤ {RULES.SEQUENTIAL_GAP_DAYS} يوم.</li>
              </ul>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

