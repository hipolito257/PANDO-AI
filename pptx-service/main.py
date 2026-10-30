"""
PANDO pptx-service — FastAPI microservice on port 5053.
Called by the Next.js app (/api/documents/plan and /api/documents/build).
"""
import base64
import io
import os

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from builders.clone_builder import CloneBuilder
from builders.template_catalog import TemplateCatalog

app = FastAPI(title="PANDO pptx-service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # This service is only ever called server-to-server from the Next.js app
    # (never directly from a browser), so origin restriction isn't a real
    # security boundary here — kept permissive rather than hardcoding a
    # Vercel domain that changes across preview/production deployments.
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Shared-secret auth ─────────────────────────────────────────────────────────
# This service runs as its own public Vercel deployment, so the build endpoints
# require a token that only the Next.js app knows. When PPTX_SERVICE_TOKEN is
# unset the check is skipped, which keeps local dev (and /health) frictionless.
SERVICE_TOKEN = os.environ.get("PPTX_SERVICE_TOKEN")


def require_token(x_service_token: str | None = Header(default=None)):
    if SERVICE_TOKEN and x_service_token != SERVICE_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Request models ─────────────────────────────────────────────────────────────
class CatalogRequest(BaseModel):
    template_url: str
    thumbnails: bool = True


class CloneBuildRequest(BaseModel):
    template_url: str
    plan: dict                    # see builders/clone_builder.py for the schema
    palette: dict | None = None   # colors for engine-drawn charts (from the catalog)
    font: str | None = None       # body font for engine-drawn charts (from the catalog)


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


@app.post("/catalog/template", dependencies=[Depends(require_token)])
async def catalog_template(req: CatalogRequest):
    """Describe every slide of a template: shapes, text capacity, charts, tables, picture thumbnails."""
    try:
        template_bytes = await _fetch_template(req.template_url)
        return TemplateCatalog(template_bytes).extract(with_thumbnails=req.thumbnails)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/build/clone", dependencies=[Depends(require_token)])
async def build_clone(req: CloneBuildRequest):
    """
    Build a deck by copying template slides and replacing their content in place.
    Returns { data: base64_pptx, slide_count, warnings: [{slide, shape, kind, message, ...}] }.
    """
    try:
        template_bytes = await _fetch_template(req.template_url)
        builder = CloneBuilder(template_bytes, palette=req.palette, font=req.font)
        pptx_bytes = builder.build(req.plan)
        return {
            "data": base64.b64encode(pptx_bytes).decode(),
            "slide_count": len(req.plan.get("slides", [])),
            "warnings": builder.warnings,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=5053, reload=True)
