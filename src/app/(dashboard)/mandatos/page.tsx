"use client";
import { useState, useEffect } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

type Mandate = {
  id: string; name: string; description: string | null; sectors: string; countries: string;
  stages: string; minRevenue: number | null; maxRevenue: number | null; thesis: string | null;
  isActive: boolean; createdAt: string; createdBy: string | null; updatedBy: string | null;
  _count: { matches: number }; matches: { companyId: string }[];
};

const SECTOR_OPTIONS = ["Software", "SaaS", "Fintech", "Proptech", "Consumer", "Retail", "Logistics", "Healthcare", "Mobility", "Edtech", "Agritech", "Other"];
const COUNTRY_OPTIONS = ["México", "Colombia", "Chile", "Perú", "Brasil", "Argentina"];
const STAGE_OPTIONS = [
  { value: "seed", label: "Seed" }, { value: "series-a", label: "Serie A" },
  { value: "series-b", label: "Serie B" }, { value: "growth", label: "Growth" }, { value: "mature", label: "Maduro" },
];

export default function MandatosPage() {
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: "", description: "", sectors: [] as string[], countries: ["México"] as string[],
    stages: [] as string[], minRevenue: "", maxRevenue: "", thesis: "", isActive: true,
  });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/mandatos");
    setMandates(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    setForm({ name: "", description: "", sectors: [], countries: ["México"], stages: [], minRevenue: "", maxRevenue: "", thesis: "", isActive: true });
    setEditId(null);
    setShowForm(true);
  }

  function openEdit(m: Mandate) {
    setForm({
      name: m.name, description: m.description ?? "", sectors: JSON.parse(m.sectors),
      countries: JSON.parse(m.countries), stages: JSON.parse(m.stages),
      minRevenue: m.minRevenue?.toString() ?? "", maxRevenue: m.maxRevenue?.toString() ?? "",
      thesis: m.thesis ?? "", isActive: m.isActive,
    });
    setEditId(m.id);
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const body = { ...form, minRevenue: form.minRevenue ? Number(form.minRevenue) : null, maxRevenue: form.maxRevenue ? Number(form.maxRevenue) : null };
    if (editId) {
      await fetch("/api/mandatos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id: editId }) });
    } else {
      await fetch("/api/mandatos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }
    setSaving(false);
    setShowForm(false);
    load();
  }

  function toggleArr<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  const inputClass = "w-full px-3 py-2 text-[13px] bg-fog border border-chalk rounded-[8px] text-carbon focus:outline-none focus:border-carbon";

  return (
    <div>
      <Topbar
        title="Mandatos"
        subtitle={`${mandates.filter((m) => m.isActive).length} activos`}
        actions={<Button variant="fill" size="sm" onClick={openNew}>+ Nuevo mandato</Button>}
      />

      <div className="p-6 space-y-4">
        {/* Form panel */}
        {showForm && (
          <Card className="border-2 border-carbon">
            <SectionHeader title={editId ? "Editar mandato" : "Nuevo mandato"} className="mb-4" />
            <form onSubmit={save} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] text-slate mb-1 font-medium">Nombre del mandato *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} placeholder="Ej. Tech & SaaS México" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate mb-1 font-medium">Descripción</label>
                  <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} placeholder="Resumen del mandato" />
                </div>
              </div>

              {/* Sectors */}
              <div>
                <label className="block text-[11px] text-slate mb-2 font-medium">Sectores objetivo</label>
                <div className="flex flex-wrap gap-1.5">
                  {SECTOR_OPTIONS.map((s) => (
                    <button key={s} type="button" onClick={() => setForm({ ...form, sectors: toggleArr(form.sectors, s) })}
                      className={`px-2.5 py-1 text-[11px] rounded-[20px] border font-medium transition-colors ${form.sectors.includes(s) ? "bg-carbon text-white border-carbon" : "bg-fog text-graphite border-chalk hover:border-carbon"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Countries */}
              <div>
                <label className="block text-[11px] text-slate mb-2 font-medium">Geografías</label>
                <div className="flex flex-wrap gap-1.5">
                  {COUNTRY_OPTIONS.map((c) => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, countries: toggleArr(form.countries, c) })}
                      className={`px-2.5 py-1 text-[11px] rounded-[20px] border font-medium transition-colors ${form.countries.includes(c) ? "bg-carbon text-white border-carbon" : "bg-fog text-graphite border-chalk hover:border-carbon"}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stages */}
              <div>
                <label className="block text-[11px] text-slate mb-2 font-medium">Etapas</label>
                <div className="flex flex-wrap gap-1.5">
                  {STAGE_OPTIONS.map((s) => (
                    <button key={s.value} type="button" onClick={() => setForm({ ...form, stages: toggleArr(form.stages, s.value) })}
                      className={`px-2.5 py-1 text-[11px] rounded-[20px] border font-medium transition-colors ${form.stages.includes(s.value) ? "bg-carbon text-white border-carbon" : "bg-fog text-graphite border-chalk hover:border-carbon"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Revenue range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] text-slate mb-1 font-medium">Revenue mínimo (USD miles)</label>
                  <input type="number" value={form.minRevenue} onChange={(e) => setForm({ ...form, minRevenue: e.target.value })} className={inputClass} placeholder="Ej. 1000 = $1M" />
                </div>
                <div>
                  <label className="block text-[11px] text-slate mb-1 font-medium">Revenue máximo (USD miles)</label>
                  <input type="number" value={form.maxRevenue} onChange={(e) => setForm({ ...form, maxRevenue: e.target.value })} className={inputClass} placeholder="Ej. 50000 = $50M" />
                </div>
              </div>

              {/* Thesis */}
              <div>
                <label className="block text-[11px] text-slate mb-1 font-medium">Tesis de inversión</label>
                <textarea value={form.thesis} onChange={(e) => setForm({ ...form, thesis: e.target.value })} rows={3}
                  className={inputClass + " resize-none"} placeholder="Describe qué buscas en este mandato, ventajas competitivas, mercado objetivo..." />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <Button type="submit" variant="fill" loading={saving}>
                  {editId ? "Guardar cambios" : "Crear mandato"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              </div>
            </form>
          </Card>
        )}

        {/* Mandate cards */}
        {loading ? (
          <div className="text-center py-12 text-slate text-[13px]">Cargando...</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {mandates.map((m) => {
              const sectors = JSON.parse(m.sectors) as string[];
              const countries = JSON.parse(m.countries) as string[];
              const stages = JSON.parse(m.stages) as string[];

              return (
                <Card key={m.id} className={`relative ${!m.isActive ? "opacity-50" : ""}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <h3 className="text-[14px] font-semibold text-carbon tracking-tight">{m.name}</h3>
                        {m.isActive ? (
                          <Badge variant="green">Activo</Badge>
                        ) : (
                          <Badge variant="default">Inactivo</Badge>
                        )}
                      </div>
                      {m.description && <p className="text-[12px] text-slate">{m.description}</p>}
                    </div>
                    <button onClick={() => openEdit(m)} className="text-[11px] text-slate hover:text-carbon font-medium transition-colors px-2 py-1 rounded hover:bg-fog">
                      Editar
                    </button>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 mb-4 text-[12px]">
                    <div className="text-center">
                      <div className="text-[20px] font-semibold text-carbon font-poly">{m._count.matches}</div>
                      <div className="text-slate">candidatas</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[20px] font-semibold text-carbon font-poly">{m.matches.length}</div>
                      <div className="text-slate">fuerte match</div>
                    </div>
                  </div>

                  {/* Sectors */}
                  {sectors.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {sectors.map((s) => <Badge key={s} variant="default">{s}</Badge>)}
                    </div>
                  )}

                  {/* Countries */}
                  {countries.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {countries.map((c) => <Badge key={c} variant="blue">{c}</Badge>)}
                    </div>
                  )}

                  {/* Stages */}
                  {stages.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {stages.map((s) => <Badge key={s} variant="yellow">{s}</Badge>)}
                    </div>
                  )}

                  {/* Thesis */}
                  {m.thesis && (
                    <p className="text-[11px] text-graphite bg-fog rounded-[6px] p-3 leading-relaxed italic border border-chalk">
                      "{m.thesis}"
                    </p>
                  )}

                  {/* Audit */}
                  <div className="mt-3 pt-3 border-t border-chalk flex items-center justify-between text-[10px] text-slate">
                    <span>Creado por <span className="font-medium text-graphite">{m.createdBy ?? "Sistema PANDO"}</span></span>
                    {m.updatedBy && m.updatedBy !== m.createdBy && (
                      <span>Editado por <span className="font-medium text-graphite">{m.updatedBy}</span></span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
