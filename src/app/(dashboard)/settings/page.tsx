"use client";
import { useState, useEffect } from "react";

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load user's current API key status
  useEffect(() => {
    async function load() {
      const res = await fetch("/api/user/api-key");
      if (res.ok) {
        const data = await res.json();
        setHasKey(data.hasApiKey);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!apiKey.trim()) {
      setMessage({ type: "error", text: "Ingresa una API key válida" });
      return;
    }
    setSaving(true);
    setMessage(null);

    const res = await fetch("/api/user/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    });

    if (res.ok) {
      setHasKey(true);
      setMessage({ type: "success", text: "✓ API key guardada correctamente" });
      setApiKey("");
    } else {
      const err = await res.json().catch(() => ({}));
      setMessage({ type: "error", text: (err as any).error ?? "Error al guardar" });
    }
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar tu API key? Necesitarás agregar una nueva para usar la IA.")) return;
    const res = await fetch("/api/user/api-key", { method: "DELETE" });
    if (res.ok) {
      setHasKey(false);
      setMessage({ type: "success", text: "API key eliminada" });
    }
  }

  return (
    <div className="min-h-screen bg-mist p-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-[28px] font-semibold text-carbon mb-2">Configuración</h1>
          <p className="text-[13px] text-slate">Gestiona tu API key de Anthropic para usar las funciones de IA</p>
        </div>

        {/* API Key section */}
        <div className="bg-white border border-chalk rounded-[12px] p-6 space-y-6">

          {/* Header */}
          <div>
            <div className="flex items-start justify-between mb-2">
              <h2 className="text-[16px] font-semibold text-carbon">API Key de Anthropic</h2>
              {hasKey && (
                <span className="text-[11px] font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
                  ✓ Configurada
                </span>
              )}
            </div>
            <p className="text-[12px] text-slate leading-relaxed">
              Tu API key se usa únicamente en tu cuenta para generar documentos con IA.
              Cada usuario debe tener su propia clave de Anthropic.
              <a href="https://console.anthropic.com/keys" target="_blank" rel="noopener noreferrer" className="text-carbon font-semibold hover:underline ml-1">
                Obtén tu API key aquí →
              </a>
            </p>
          </div>

          {/* Status info */}
          {loading ? (
            <div className="text-center py-6 text-slate text-[12px]">Cargando...</div>
          ) : (
            <>
              {hasKey && !apiKey && (
                <div className="bg-green-50 border border-green-200 rounded-[8px] p-4">
                  <div className="text-[12px] text-green-700 font-medium">
                    ✓ Tienes una API key guardada
                  </div>
                  <div className="text-[11px] text-green-600 mt-1">
                    Puedes usarla para generar documentos con archivos de respaldo y IA.
                  </div>
                </div>
              )}

              {!hasKey && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-[8px] p-4">
                  <div className="text-[12px] text-yellow-800 font-medium">
                    ⚠️ Sin API key configurada
                  </div>
                  <div className="text-[11px] text-yellow-700 mt-1">
                    Necesitas agregar tu API key para usar generación de documentos con IA.
                  </div>
                </div>
              )}
            </>
          )}

          {/* Input section */}
          <div className="space-y-3">
            <label className="block text-[12px] font-semibold text-carbon">
              {hasKey && !apiKey ? "Actualizar" : "Agregar"} API Key
            </label>

            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={hasKey && !apiKey ? "Déjalo vacío para mantener la actual" : "sk-ant-..."}
                className="w-full border border-chalk rounded-[8px] px-4 py-2.5 text-[13px] text-carbon placeholder:text-slate/50 focus:outline-none focus:border-carbon font-mono"
              />
              {apiKey && (
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate hover:text-carbon text-[12px] font-medium"
                >
                  {showKey ? "Ocultar" : "Ver"}
                </button>
              )}
            </div>

            <div className="text-[10px] text-slate">
              • La clave se almacena de forma segura en tu base de datos local
              <br />
              • Solo se usa en tu cuenta para generar documentos
              <br />
              • Nunca se envía a servidores externos ni se comparte
            </div>
          </div>

          {/* Messages */}
          {message && (
            <div className={`rounded-[8px] p-3 text-[12px] border ${
              message.type === "success"
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-red-50 text-red-700 border-red-200"
            }`}>
              {message.text}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !apiKey.trim()}
              className="flex-1 py-2.5 bg-carbon text-white rounded-[8px] text-[13px] font-medium hover:bg-graphite disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Guardando…" : "Guardar API Key"}
            </button>

            {hasKey && (
              <button
                onClick={handleDelete}
                className="px-4 py-2.5 border border-red-300 text-red-700 rounded-[8px] text-[13px] font-medium hover:bg-red-50 transition-colors"
              >
                Eliminar
              </button>
            )}
          </div>
        </div>

        {/* How it works */}
        <div className="mt-8 bg-white border border-chalk rounded-[12px] p-6">
          <h3 className="text-[14px] font-semibold text-carbon mb-4">¿Cómo funciona?</h3>

          <div className="space-y-4">
            {[
              {
                n: "1",
                title: "Obtén tu API Key",
                desc: "Ve a console.anthropic.com, crea una cuenta gratuita y genera tu API key en la sección de keys.",
              },
              {
                n: "2",
                title: "Agrégala aquí",
                desc: "Copia tu API key (comenzará con 'sk-ant-') y pégala en el campo de arriba.",
              },
              {
                n: "3",
                title: "Usa en documentos",
                desc: "Cuando generes documentos con archivos de respaldo o sin plantillas {{}} variables, la IA usará tu API key.",
              },
              {
                n: "4",
                title: "Solo para ti",
                desc: "Tu API key solo funciona en tu cuenta y nunca se comparte con otros usuarios.",
              },
            ].map((item) => (
              <div key={item.n} className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-carbon text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                  {item.n}
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-carbon">{item.title}</div>
                  <div className="text-[11px] text-slate mt-0.5">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing note */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-[12px] p-4">
          <div className="text-[12px] text-blue-700 leading-relaxed">
            <strong>Nota:</strong> Anthropic ofrece $5 USD de crédito gratis al mes para nuevas cuentas.
            Si necesitas más, tienes acceso a planes de pago con facturación por uso real.
            <a href="https://docs.anthropic.com/en/api/overview" target="_blank" rel="noopener noreferrer" className="block text-blue-600 font-semibold hover:underline mt-1.5">
              Ver documentación de precios →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
