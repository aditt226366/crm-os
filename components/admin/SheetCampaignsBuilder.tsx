"use client";

import { Plus, Trash2 } from "lucide-react";

/**
 * Dynamic builder for per-sheet drip campaigns (stored as the SHEET_CAMPAIGNS_JSON
 * field of the Broadcast & Campaign Templates integration). Fully controlled: it
 * parses the JSON string `value` on every render and emits a new JSON string via
 * `onChange` on every edit, so it never holds divergent local state.
 */

const LANGUAGE_OPTIONS = ["en_US", "en", "ar", "hi", "es", "fr"];
const VARIABLE_MODES = ["NUMBERED", "NAMED"];
const DEFAULT_COMBINED_SHEET = "crm_leads";

type TemplateRow = {
  name: string;
  language: string;
  delayDays: number;
  variableMode: string;
  variables: string;
};

type SheetRow = {
  sheetName: string;
  templates: TemplateRow[];
};

type Model = {
  combinedSheet: string;
  sheets: SheetRow[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseModel(value: string): Model {
  let parsed: unknown = null;
  try {
    parsed = value.trim() ? JSON.parse(value) : null;
  } catch {
    parsed = null;
  }
  const record = asRecord(parsed);
  // Keep the raw stored value so the field stays editable (typing spaces,
  // clearing it, etc.). The default is only a placeholder hint; the backend
  // (parseSheetCampaignsConfig) applies DEFAULT_COMBINED_SHEET when it's blank.
  const combinedSheet = typeof record.combinedSheet === "string" ? record.combinedSheet : "";
  const sheetsRaw = Array.isArray(record.sheets) ? record.sheets : [];
  const sheets: SheetRow[] = sheetsRaw.map((sheetRaw) => {
    const sheet = asRecord(sheetRaw);
    const templatesRaw = Array.isArray(sheet.templates) ? sheet.templates : [];
    return {
      sheetName: typeof sheet.sheetName === "string" ? sheet.sheetName : "",
      templates: templatesRaw.map((templateRaw) => {
        const template = asRecord(templateRaw);
        const delay = typeof template.delayDays === "number" ? template.delayDays : Number(template.delayDays);
        return {
          name: typeof template.name === "string" ? template.name : "",
          language: typeof template.language === "string" && template.language ? template.language : "en_US",
          delayDays: Number.isFinite(delay) && delay >= 0 ? Math.floor(delay) : 0,
          variableMode: typeof template.variableMode === "string" && template.variableMode ? template.variableMode : "NUMBERED",
          variables:
            template.variables && typeof template.variables === "object"
              ? JSON.stringify(template.variables)
              : typeof template.variables === "string"
                ? template.variables
                : ""
        };
      })
    };
  });
  return { combinedSheet, sheets };
}

function serializeModel(model: Model): string {
  // Store exactly what the user typed — do NOT trim here. This component
  // re-serializes on every keystroke, so trimming would strip the trailing
  // space the instant it is typed, making it impossible to type multi-word
  // names like "UG Leads". The backend trims/normalizes these names when it
  // parses and matches them (parseSheetCampaignsConfig / sheetCampaignForSheet).
  return JSON.stringify({
    combinedSheet: model.combinedSheet,
    sheets: model.sheets.map((sheet) => ({
      sheetName: sheet.sheetName,
      templates: sheet.templates.map((template) => {
        let variables: Record<string, string> = {};
        try {
          const parsed = template.variables.trim() ? JSON.parse(template.variables) : {};
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            variables = Object.fromEntries(
              Object.entries(parsed as Record<string, unknown>).map(([key, val]) => [key, String(val ?? "")])
            );
          }
        } catch {
          variables = {};
        }
        return {
          name: template.name,
          language: template.language,
          delayDays: template.delayDays,
          variableMode: template.variableMode,
          variables
        };
      })
    }))
  });
}

const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400";
const inputClass =
  "h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50";

export function SheetCampaignsBuilder({
  value,
  error,
  onChange
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const model = parseModel(value);
  const emit = (next: Model) => onChange(serializeModel(next));

  const updateSheet = (index: number, patch: Partial<SheetRow>) => {
    emit({ ...model, sheets: model.sheets.map((sheet, i) => (i === index ? { ...sheet, ...patch } : sheet)) });
  };
  const updateTemplate = (sheetIndex: number, templateIndex: number, patch: Partial<TemplateRow>) => {
    updateSheet(sheetIndex, {
      templates: model.sheets[sheetIndex].templates.map((template, i) =>
        i === templateIndex ? { ...template, ...patch } : template
      )
    });
  };
  const addSheet = () =>
    emit({ ...model, sheets: [...model.sheets, { sheetName: "", templates: [newTemplate()] }] });
  const removeSheet = (index: number) => emit({ ...model, sheets: model.sheets.filter((_, i) => i !== index) });
  const addTemplate = (sheetIndex: number) =>
    updateSheet(sheetIndex, { templates: [...model.sheets[sheetIndex].templates, newTemplate(model.sheets[sheetIndex].templates.length)] });
  const removeTemplate = (sheetIndex: number, templateIndex: number) =>
    updateSheet(sheetIndex, { templates: model.sheets[sheetIndex].templates.filter((_, i) => i !== templateIndex) });

  const needsCombinedSheet = model.sheets.length > 1;

  return (
    <div className="space-y-4">
      {needsCombinedSheet ? (
        <div>
          <label className={labelClass}>Combined sheet name</label>
          <input
            value={model.combinedSheet}
            onChange={(event) => emit({ ...model, combinedSheet: event.target.value })}
            placeholder={DEFAULT_COMBINED_SHEET}
            className={inputClass}
          />
          <p className="mt-1 text-xs leading-5 text-slate-500">
            The single tab all source sheets are merged into (leads are read from here; each row must carry a source_sheet).
            Required because more than one sheet is configured below.
          </p>
        </div>
      ) : (
        <p className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-xs leading-5 text-slate-500">
          With only one sheet configured, leads are read and status is written directly to that sheet &mdash; no combined
          sheet is needed. Add a second sheet below if you want to merge multiple source sheets into one combined tab.
        </p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Sheets ({model.sheets.length})</p>
        <button
          type="button"
          onClick={addSheet}
          className="inline-flex items-center gap-1 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add sheet
        </button>
      </div>

      {model.sheets.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 bg-slate-950/40 p-3 text-xs text-slate-500">
          No sheets configured. Add a sheet (e.g. &quot;UG Leads&quot;) and map it to its approved Meta templates.
        </p>
      ) : null}

      {model.sheets.map((sheet, sheetIndex) => (
        <div key={sheetIndex} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={labelClass}>Sheet name</label>
              <input
                value={sheet.sheetName}
                onChange={(event) => updateSheet(sheetIndex, { sheetName: event.target.value })}
                placeholder="UG Leads"
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => removeSheet(sheetIndex)}
              aria-label="Remove sheet"
              className="mb-0.5 grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-slate-400 transition hover:border-rose-300/40 hover:text-rose-200"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Templates ({sheet.templates.length})
            </p>
            <button
              type="button"
              onClick={() => addTemplate(sheetIndex)}
              className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-100"
            >
              <Plus className="h-3 w-3" /> Add template
            </button>
          </div>

          <div className="mt-2 space-y-3">
            {sheet.templates.map((template, templateIndex) => (
              <div key={templateIndex} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-cyan-100/80">Step {templateIndex + 1}</p>
                  <button
                    type="button"
                    onClick={() => removeTemplate(sheetIndex, templateIndex)}
                    aria-label="Remove template"
                    className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 text-slate-400 transition hover:border-rose-300/40 hover:text-rose-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Template name (Meta-approved)</label>
                    <input
                      value={template.name}
                      onChange={(event) => updateTemplate(sheetIndex, templateIndex, { name: event.target.value })}
                      placeholder="v9_ug_day1"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Language</label>
                    <select
                      value={template.language}
                      onChange={(event) => updateTemplate(sheetIndex, templateIndex, { language: event.target.value })}
                      className={inputClass}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Delay (days after start)</label>
                    <input
                      type="number"
                      min={0}
                      value={String(template.delayDays)}
                      onChange={(event) =>
                        updateTemplate(sheetIndex, templateIndex, {
                          delayDays: Math.max(0, Math.floor(Number(event.target.value) || 0))
                        })
                      }
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Variable mode</label>
                    <select
                      value={template.variableMode}
                      onChange={(event) => updateTemplate(sheetIndex, templateIndex, { variableMode: event.target.value })}
                      className={inputClass}
                    >
                      {VARIABLE_MODES.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Variable mapping (JSON)</label>
                    <input
                      value={template.variables}
                      onChange={(event) => updateTemplate(sheetIndex, templateIndex, { variables: event.target.value })}
                      placeholder={'{"1":"lead.name"}'}
                      className={inputClass}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {error ? <p className="text-xs font-semibold leading-5 text-rose-200">{error}</p> : null}
    </div>
  );
}

function newTemplate(existingCount = 0): TemplateRow {
  return {
    name: "",
    language: "en_US",
    delayDays: existingCount === 0 ? 0 : existingCount * 3,
    variableMode: "NUMBERED",
    variables: '{"1":"lead.name"}'
  };
}
