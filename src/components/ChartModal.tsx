import { useEffect } from "react";
import { useTranslation } from "react-i18next";

// The overlay any chart card gets enlarged into. Lives on its own because
// three places now open one — the statements grid, the forecast pair and the
// rating charts, on two different pages — and a chart is worth reading big.
//
// Takes children rather than a chart config: the cards it has to enlarge are
// different components with different props, and the modal's job is the
// overlay, the escape key and the backdrop click, none of which care what is
// inside.
export function ChartModal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-3xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-9 right-0 text-2xl leading-none text-white/80 hover:text-white"
          aria-label={t("common.close")}
        >
          &times;
        </button>
        {children}
      </div>
    </div>
  );
}
