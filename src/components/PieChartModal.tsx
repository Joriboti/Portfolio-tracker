import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Position } from "@/lib/excel-parser";
import type { PriceQuote } from "@/lib/api";
import type { Currency } from "@/lib/currency";
import { convert, formatMoney } from "@/lib/currency";

type Slice = { ticker: string; value: number; pct: number };

const COLORS = [
  "#0d9488", "#0891b2", "#2563eb", "#7c3aed", "#c026d3",
  "#e11d48", "#ea580c", "#d97706", "#65a30d", "#059669",
  "#6366f1", "#ec4899", "#f59e0b", "#14b8a6", "#8b5cf6",
  "#ef4444", "#3b82f6", "#10b981", "#f97316", "#a855f7",
];

function buildSlices(
  positions: Position[],
  quotes: Record<string, PriceQuote>,
  currency: Currency,
  fxRates: Record<string, number>,
): Slice[] {
  const raw: { ticker: string; value: number }[] = [];
  for (const p of positions) {
    const q = quotes[p.ticker];
    let value: number;
    if (q) {
      const priceInDisplay =
        q.currency && q.currency !== currency
          ? convert(q.price, q.currency as Currency, currency, fxRates)
          : q.price;
      value = priceInDisplay * p.shares;
    } else {
      value = p.totalCost;
    }
    if (value > 0) raw.push({ ticker: p.ticker, value });
  }
  raw.sort((a, b) => b.value - a.value);

  const total = raw.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return [];

  const BIG_LIMIT = 12;
  let slices: Slice[];
  if (raw.length <= BIG_LIMIT) {
    slices = raw.map((r) => ({
      ticker: r.ticker,
      value: r.value,
      pct: r.value / total,
    }));
  } else {
    const top = raw.slice(0, BIG_LIMIT - 1);
    const rest = raw.slice(BIG_LIMIT - 1);
    const restValue = rest.reduce((s, r) => s + r.value, 0);
    slices = top.map((r) => ({
      ticker: r.ticker,
      value: r.value,
      pct: r.value / total,
    }));
    slices.push({ ticker: "Altres", value: restValue, pct: restValue / total });
  }
  return slices;
}

function drawPie(
  canvas: HTMLCanvasElement,
  slices: Slice[],
  currency: Currency,
  title: string,
) {
  const dpr = window.devicePixelRatio || 1;
  const W = 700;
  const H = 520;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(title, W / 2, 32);

  const cx = 200;
  const cy = 270;
  const radius = 160;

  let angle = -Math.PI / 2;
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const sweep = s.pct * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fill();

    // Label on slice if big enough
    if (s.pct > 0.04) {
      const mid = angle + sweep / 2;
      const lx = cx + Math.cos(mid) * radius * 0.65;
      const ly = cy + Math.sin(mid) * radius * 0.65;
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${(s.pct * 100).toFixed(1)}%`, lx, ly);
    }

    angle += sweep;
  }

  // Legend
  const legendX = 420;
  let legendY = 60;
  const lineH = 28;

  ctx.textBaseline = "middle";
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const y = legendY + i * lineH;

    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.beginPath();
    ctx.arc(legendX, y, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#334155";
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(s.ticker, legendX + 16, y);

    ctx.fillStyle = "#64748b";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "right";
    const valStr = `${formatMoney(s.value, currency)}  (${(s.pct * 100).toFixed(1)}%)`;
    ctx.fillText(valStr, W - 20, y);
  }

  // Total
  const totalY = legendY + slices.length * lineH + 12;
  const total = slices.reduce((s, r) => s + r.value, 0);
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Total", legendX + 16, totalY);
  ctx.textAlign = "right";
  ctx.fillText(formatMoney(total, currency), W - 20, totalY);
}

export function PieChartModal({
  positions,
  quotes,
  currency,
  fxRates,
  onClose,
}: {
  positions: Position[];
  quotes: Record<string, PriceQuote>;
  currency: Currency;
  fxRates: Record<string, number>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const slices = buildSlices(positions, quotes, currency, fxRates);

  useEffect(() => {
    if (canvasRef.current && slices.length > 0) {
      drawPie(canvasRef.current, slices, currency, t("dashboard.pieTitle"));
    }
  }, [slices, currency, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleDownload = useCallback(() => {
    if (!canvasRef.current) return;
    const link = document.createElement("a");
    link.download = "portfolio-chart.png";
    link.href = canvasRef.current.toDataURL("image/png");
    link.click();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-[780px] w-full mx-4 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-slate-400 hover:text-slate-700 text-2xl leading-none"
        >
          &times;
        </button>

        {slices.length > 0 ? (
          <>
            <canvas ref={canvasRef} className="mx-auto block" />
            <div className="flex justify-center mt-4">
              <button
                onClick={handleDownload}
                className="btn-ghost text-sm px-4 py-2 flex items-center gap-2"
              >
                <span>&#8681;</span> {t("dashboard.pieDownload")}
              </button>
            </div>
          </>
        ) : (
          <p className="text-center text-slate-500 py-12">
            {t("dashboard.pieEmpty")}
          </p>
        )}
      </div>
    </div>
  );
}
