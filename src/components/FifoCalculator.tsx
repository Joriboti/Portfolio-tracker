import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type OpType = "buy" | "sell";

interface Op {
  id: number;
  type: OpType;
  shares: string;
  price: string;
}

interface Lot {
  shares: number;
  price: number;
}

interface Computed {
  // FIFO realized result for a sell op (null for buys / invalid rows).
  result: number | null;
  oversold: boolean;
}

let nextId = 1;
function makeOp(type: OpType): Op {
  return { id: nextId++, type, shares: "", price: "" };
}

/**
 * Small FIFO realized-P&L helper. The user enters buys and sells in
 * chronological order (top to bottom); for each sell we consume the earliest
 * open lots first and compute the realized result — exactly the value that goes
 * in the Excel "Resultat" column. Also reports the leftover position and its
 * average cost so a partially-closed holding is easy to carry forward.
 */
export function FifoCalculator() {
  const { t } = useTranslation();
  const [ops, setOps] = useState<Op[]>(() => [makeOp("buy"), makeOp("sell")]);

  const { rows, remainingShares, remainingCost, totalRealized } = useMemo(() => {
    const lots: Lot[] = [];
    const rows: Computed[] = [];
    let totalRealized = 0;

    for (const op of ops) {
      const shares = Number(op.shares);
      const price = Number(op.price);
      const valid =
        op.shares !== "" &&
        op.price !== "" &&
        Number.isFinite(shares) &&
        Number.isFinite(price) &&
        shares > 0;

      if (!valid) {
        rows.push({ result: null, oversold: false });
        continue;
      }

      if (op.type === "buy") {
        lots.push({ shares, price });
        rows.push({ result: null, oversold: false });
        continue;
      }

      // Sell: consume earliest lots first (FIFO).
      let toSell = shares;
      let result = 0;
      while (toSell > 0 && lots.length > 0) {
        const lot = lots[0];
        const take = Math.min(toSell, lot.shares);
        result += take * (price - lot.price);
        lot.shares -= take;
        toSell -= take;
        if (lot.shares <= 1e-9) lots.shift();
      }
      totalRealized += result;
      rows.push({ result, oversold: toSell > 1e-9 });
    }

    const remainingShares = lots.reduce((s, l) => s + l.shares, 0);
    const remainingValue = lots.reduce((s, l) => s + l.shares * l.price, 0);
    const remainingCost = remainingShares > 0 ? remainingValue / remainingShares : 0;

    return { rows, remainingShares, remainingCost, totalRealized };
  }, [ops]);

  function update(id: number, patch: Partial<Op>) {
    setOps((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }
  function addRow() {
    setOps((prev) => [...prev, makeOp("buy")]);
  }
  function removeRow(id: number) {
    setOps((prev) => prev.filter((o) => o.id !== id));
  }
  function reset() {
    setOps([makeOp("buy"), makeOp("sell")]);
  }

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section className="card">
      <p className="text-sm text-slate-600">{t("fifo.intro")}</p>

      <div className="mt-4 overflow-x-auto">
        <table className="table-base">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left">{t("fifo.opType")}</th>
              <th className="text-left">{t("fifo.shares")}</th>
              <th className="text-left">{t("fifo.price")}</th>
              <th className="text-right">{t("fifo.result")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ops.map((op, i) => {
              const c = rows[i];
              return (
                <tr key={op.id}>
                  <td>
                    <select
                      value={op.type}
                      onChange={(e) =>
                        update(op.id, { type: e.target.value as OpType })
                      }
                      className="rounded-md border border-slate-200 px-2 py-1 text-sm bg-white"
                    >
                      <option value="buy">{t("fifo.buy")}</option>
                      <option value="sell">{t("fifo.sell")}</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={op.shares}
                      onChange={(e) => update(op.id, { shares: e.target.value })}
                      className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={op.price}
                      onChange={(e) => update(op.id, { price: e.target.value })}
                      className="w-24 rounded-md border border-slate-200 px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="text-right tabular-nums">
                    {op.type === "sell" && c?.oversold ? (
                      <span className="text-rose-600 text-xs">
                        {t("fifo.oversold")}
                      </span>
                    ) : c?.result != null ? (
                      <span
                        className={
                          c.result >= 0 ? "text-emerald-600" : "text-rose-600"
                        }
                      >
                        {fmt(c.result)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => removeRow(op.id)}
                      className="text-slate-400 hover:text-rose-600 text-sm px-1"
                      aria-label={t("fifo.remove")}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex gap-3">
        <button onClick={addRow} className="btn-ghost text-xs px-3 py-1.5">
          + {t("fifo.addRow")}
        </button>
        <button onClick={reset} className="btn-ghost text-xs px-3 py-1.5">
          {t("fifo.reset")}
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t("fifo.remaining")} value={fmt(remainingShares)} />
        <Stat label={t("fifo.remainingCost")} value={fmt(remainingCost)} />
        <Stat
          label={t("fifo.totalRealized")}
          value={fmt(totalRealized)}
          tone={totalRealized >= 0 ? "pos" : "neg"}
        />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "pos"
            ? "text-emerald-600"
            : tone === "neg"
              ? "text-rose-600"
              : "text-slate-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
