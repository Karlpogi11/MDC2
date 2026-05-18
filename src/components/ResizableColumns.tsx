import { useEffect, useRef, useCallback, useState } from "react";

/**
 * useTableResize — Notion/Linear/GitHub pattern:
 * - Drag handle on right edge of each <th>
 * - Blue ghost line spans full table height during drag
 * - Only dragged column resizes; table grows freely (scroll container handles overflow)
 * - Widths locked from actual rendered widths on first init
 */
export function useTableResize() {
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    // Ghost line — positioned relative to scroll container
    const ghost = document.createElement("div");
    ghost.style.cssText = [
      "position:absolute", "top:0", "width:2px", "background:#2563eb",
      "opacity:0", "pointer-events:none", "z-index:100", "transition:opacity .08s",
    ].join(";");
    const container = table.parentElement!;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.appendChild(ghost);

    function init() {
      const ths = Array.from(table!.querySelectorAll("thead th")) as HTMLTableCellElement[];
      if (!ths.length) return;

      // Build colgroup if missing
      let cg = table!.querySelector("colgroup");
      if (!cg) { cg = document.createElement("colgroup"); table!.prepend(cg); }
      while (cg.children.length < ths.length) cg.appendChild(document.createElement("col"));
      while (cg.children.length > ths.length) cg.removeChild(cg.lastChild!);
      const cols = Array.from(cg.children) as HTMLElement[];

      // Snapshot actual rendered widths → lock into cols → enable fixed layout
      ths.forEach((th, i) => { if (!cols[i].style.width) cols[i].style.width = th.offsetWidth + "px"; });
      table!.style.tableLayout = "fixed";

      ths.forEach((th, i) => {
        if (th.dataset.resizable) return;
        th.dataset.resizable = "1";
        th.style.position = "relative";
        th.style.overflow = "hidden";
        th.style.whiteSpace = "nowrap";

        const handle = document.createElement("div");
        handle.style.cssText = "position:absolute;right:0;top:0;bottom:0;width:8px;cursor:col-resize;z-index:10";
        // Visual indicator line on the handle
        const line = document.createElement("div");
        line.style.cssText = "position:absolute;right:2px;top:20%;bottom:20%;width:1px;background:#d1d5db";
        handle.appendChild(line);
        th.appendChild(handle);

        handle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX   = e.clientX;
          const startW   = th.offsetWidth;
          const contRect = container.getBoundingClientRect();

          // Show ghost at current position
          ghost.style.height  = table!.offsetHeight + "px";
          ghost.style.left    = (e.clientX - contRect.left + container.scrollLeft) + "px";
          ghost.style.opacity = "1";
          document.body.style.cursor = "col-resize";
          document.body.style.userSelect = "none";

          function onMove(ev: MouseEvent) {
            const delta = ev.clientX - startX;
            const newW  = Math.max(60, startW + delta);
            cols[i].style.width = newW + "px";
            ghost.style.left = (ev.clientX - contRect.left + container.scrollLeft) + "px";
          }

          function onUp() {
            ghost.style.opacity = "0";
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          }

          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        });
      });
    }

    init();

    const observer = new MutationObserver(() => {
      const uninit = Array.from(table.querySelectorAll("thead th"))
        .some((th) => !(th as HTMLElement).dataset.resizable);
      if (uninit) init();
    });
    observer.observe(table, { childList: true, subtree: false });

    return () => { observer.disconnect(); ghost.remove(); };
  }, []);

  return tableRef;
}

export { ResizableTh } from "./ResizableTh";

export function useResizableColumns(initial: (number | null)[]) {
  const [widths, setWidths] = useState<(number | null)[]>(initial);
  const dragging = useRef<{ idx: number; startX: number; startW: number } | null>(null);

  const onResizeStart = useCallback((idx: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const th = (e.currentTarget as HTMLElement).parentElement!;
    dragging.current = { idx, startX: e.clientX, startW: th.offsetWidth };
    function onMove(ev: MouseEvent) {
      if (!dragging.current) return;
      const newW = Math.max(60, dragging.current.startW + ev.clientX - dragging.current.startX);
      setWidths(prev => prev.map((w, i) => i === dragging.current!.idx ? newW : w));
    }
    function onUp() {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return { widths, onResizeStart };
}
