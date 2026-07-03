"""
PANDO pptx-service — FastAPI microservice on port 5053.
Called by the Next.js app at /api/documents/build.
"""
import base64
import io

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from builders.pptx_builder import PptxBuilder
from builders.template_profiler import TemplateProfiler

app = FastAPI(title="PANDO pptx-service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5052", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request models ─────────────────────────────────────────────────────────────
class BuildRequest(BaseModel):
    template_url: str
    slide_plan: dict
    palette: dict | None = None  # semantic color overrides from /profile/template, when the
    font: str | None = None      # uploaded template isn't PANDO's own — see template_profiler.py


class ProfileRequest(BaseModel):
    template_url: str


# ── Helpers ────────────────────────────────────────────────────────────────────
async def _fetch_template(url: str) -> bytes:
    """Fetch template bytes from a URL (Vercel Blob, local path, or data URI)."""
    if url.startswith("data:"):
        # base64 data URI
        _, data = url.split(",", 1)
        return base64.b64decode(data)
    if url.startswith("http"):
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.content
    # Local file path (for dev)
    with open(url, "rb") as f:
        return f.read()


# ── Endpoints ──────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "pptx-service", "port": 5053}


@app.post("/profile/template")
async def profile_template(req: ProfileRequest):
    """Extract color palette, fonts, and layout info from a PPTX template."""
    try:
        template_bytes = await _fetch_template(req.template_url)
        profiler = TemplateProfiler(template_bytes)
        return profiler.extract()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/build/pptx")
async def build_pptx(req: BuildRequest):
    """
    Build a PPTX from a slide plan JSON.
    Returns { data: base64_pptx, slide_count: int }.

    slide_plan schema:
    {
      "slides": [
        {
          "layout": "takeaway" | "divider" | "blank",
          "category": "3. THE MARKET",
          "title": "SLIDE TITLE",
          "takeaway": "Key message...",
          "note": "Source  Company info",
          "elements": [
            { "type": "panel_hdr", "text": "...", "x": 0.7, "y": 1.78, "w": 12.93, "bg": "004F46" },
            { "type": "line", "x": 0.7, "y": 2.05, "w": 6.1, "h": 2.03,
              "labels": [...], "values": [...], "color": "437742", "ymin": 0, "ymax": 500 },
            { "type": "line_multi", "x": 0.7, "y": 2.05, "w": 6.1, "h": 2.03,
              "labels": [...],
              "series": [{"name":"2021","values":[...],"color":"A5C8D1"},
                         {"name":"New stores","values":[...],"color":"0A231F","dashed":true}] },
            { "type": "hbar_float", "x": 0.7, "y": 1.78, "w": 12.93, "h": 3.5,
              "series": [{"label":"Brand A","min":2800,"max":4500},...] },
            { "type": "donut", "x": 0.7, "y": 2.05, "w": 3.91, "h": 2.35,
              "slices": [{"label":"Top 5","value":15,"color":"437742"},{"label":"Others","value":85,"color":"D9DBD4"}] },
            { "type": "scatter", "x": 0.7, "y": 1.78, "w": 12.93, "h": 4.5,
              "points": [{"label":"B&F","x":0.32,"y":0.18,"color":"004F46"},...],
              "x_fmt": "#,##0", "y_fmt": "0%" },  // number format per axis — default is plain numbers; pass "0%" only for that axis if it's actually a percentage

            { "type": "quadrant", "x": 0.7, "y": 1.78, "w": 6.1, "h": 4.5,
              "axis_labels": {"top":"Premium","bottom":"Value","left":"Digital","right":"Physical"},
              "brands": [{"label":"B&F","px":0.75,"py":0.80,"color":"004F46"},...] },
            { "type": "textbox", "text": "...", "x": 0.7, "y": 1.5, "w": 5, "h": 0.3,
              "size": 8, "bold": false, "fg": "0A231F", "align": "l" },
            { "type": "shape", "x": 0.7, "y": 1.5, "w": 5, "h": 0.3,
              "bg": "004F46", "text": "Label", "fg": "FFFFFF", "size": 8 },
            { "type": "stat_row", "x": 0.85, "y": 2.0, "w": 12.18, "h": 1.6,
              "items": [{"value":"$42M","label":"ARR","delta":"+18% YoY","color":"004F46"}, ...] },
            { "type": "icon_row", "x": 0.85, "y": 2.0, "w": 12.18, "h": 3.5, "direction": "col",
              "items": [{"glyph":"1","title":"Market leadership","text":"...","color":"004F46"}, ...] },
            { "type": "comparison_cards", "x": 0.85, "y": 2.0, "w": 12.18, "h": 4.0,
              "cards": [{"title":"Option A","bullets":["...","..."],"color":"004F46"}, ...] },
            { "type": "timeline", "x": 0.85, "y": 2.0, "w": 12.18, "h": 3.0,
              "steps": [{"label":"Q1 2025","text":"Seed round"},{"label":"Q3 2025","text":"Series A"}, ...] },
            { "type": "waterfall", "x": 0.85, "y": 2.0, "w": 12.18, "h": 4.0,
              "labels": ["Revenue","COGS","Opex","EBITDA"], "values": [100,-40,-35,25], "totals": [true,false,false,true] },
            { "type": "alt_timeline", "x": 0.85, "y": 2.0, "w": 12.18, "h": 4.4,
              "entries": [{"label":"2015","text":"**Founded** in Mexico City."}, ...] },  // company history: entries alternate above/below the axis
            { "type": "org_chart", "x": 0.85, "y": 2.0, "w": 12.18, "h": 4.4,
              "levels": [[{"label":"HoldCo","sub":"Cayman"}],
                         [{"label":"OpCo MX","sub":"Mexico","note":"Brand A","parent":0,"pct":"99.9%"}, ...]] },
            { "type": "process_flow", "x": 0.85, "y": 2.0, "w": 12.18, "h": 1.9,
              "steps": [{"title":"Designer","text":"Designs in-house."}, ...] },  // arrowed value-chain boxes
            { "type": "pill_row", "x": 0.85, "y": 4.6, "w": 12.18, "h": 0.85,
              "items": [{"text":"**+3.0x** sales per store vs. incumbents"}, ...] }  // rounded tinted KPI callouts
          ]

    All chart elements (bar/line/line_multi/donut/hbar_float/scatter/waterfall) also accept
    "title" and "subtitle" — a plain-text bold header + italic grey subtitle rendered above
    the chart inside its box. donut also accepts "center": [str] — KPI lines inside the hole.
    table accepts "label_col": true — first column becomes an alternating dark/white label rail.
    textbox/pill_row/alt_timeline text supports **bold** spans.
        }
      ]
    }

    Also returns { warnings: [str] } — geometry-based QA findings (elements placed
    off-canvas, or overlapping) collected while building, for the caller to surface.
    """
    try:
        template_bytes = await _fetch_template(req.template_url)
        builder = PptxBuilder(template_bytes, palette=req.palette, font=req.font)
        pptx_bytes = builder.build(req.slide_plan)
        return {
            "data": base64.b64encode(pptx_bytes).decode(),
            "slide_count": len(req.slide_plan.get("slides", [])),
            "warnings": builder.warnings,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=5053, reload=True)
