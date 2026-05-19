import { useEffect, useRef } from "react";

/**
 * useTableResize
 * - No upfront width locking: table stays auto-layout so columns fit content naturally
 * - On first drag: snapshot actual rendered widths → lock into colgroup → fixed layout
 * - Only the dragged column changes width; table total width updates accordingly
 * - Blue ghost line during drag
 */
export function useTableResize() {
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const container = table.parentElement!;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    const ghost = document.createElement("div");
    ghost.style.cssText =
      "position:absolute;top:0;width:2px;background:#2563eb;opacity:0;pointer-events:none;z-index:100;transition:opacity .08s";
    container.appendChild(ghost);

    let locked = false;

    function getCols() {
      let cg = table!.querySelector("colgroup");
      if (!cg) { cg = document.createElement("colgroup"); table!.prepend(cg); }
      const ths = Array.from(table!.querySelectorAll("thead th")) as HTMLTableCellElement[];
      while (cg.children.length < ths.length) cg.appendChild(document.createElement("col"));
      while (cg.children.length > ths.length) cg.removeChild(cg.lastChild!);
      return { cols: Array.from(cg.children) as HTMLElement[], ths };
    }

    function lock() {
      if (locked) return;
      locked = true;
      const { cols, ths } = getCols();
      // Snapshot natural rendered widths (table is still auto-layout here)
      ths.forEach((th, i) => { cols[i].style.width = th.offsetWidth + "px"; });
      table!.style.tableLayout = "fixed";
      table!.style.width = cols.reduce((s, c) => s + parseInt(c.style.width || "0"), 0) + "px";
    }

    function totalWidth() {
      const cols = Array.from(table!.querySelectorAll("colgroup col")) as HTMLElement[];
      return cols.reduce((s, c) => s + parseInt(c.style.width || "0"), 0);
    }

    function init() {
      const ths = Array.from(table!.querySelectorAll("thead th")) as HTMLTableCellElement[];
      if (!ths.length) return;

      ths.forEach((th, i) => {
        if (th.dataset.resizable) return;
        th.dataset.resizable = "1";
        th.style.position = "relative";
        th.style.overflow = "hidden";
        th.style.whiteSpace = "nowrap";
        th.style.textOverflow = "ellipsis";

        const handle = document.createElement("div");
        handle.style.cssText =
          "position:absolute;right:0;top:0;bottom:0;width:8px;cursor:col-resize;z-index:10";
        const line = document.createElement("div");
        line.style.cssText =
          "position:absolute;right:2px;top:20%;bottom:20%;width:1px;background:#d1d5db";
        handle.appendChild(line);
        th.appendChild(handle);

        handle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();

          // Lock on first drag — snapshot content-fitted widths
          lock();

          const cols = Array.from(table!.querySelectorAll("colgroup col")) as HTMLElement[];
          const startX   = e.clientX;
          const startW   = th.offsetWidth;
          const contRect = container.getBoundingClientRect();

          ghost.style.height  = table!.offsetHeight + "px";
          ghost.style.left    = (e.clientX - contRect.left + container.scrollLeft) + "px";
          ghost.style.opacity = "1";
          document.body.style.cursor     = "col-resize";
          document.body.style.userSelect = "none";

          function onMove(ev: MouseEvent) {
            const newW = Math.max(40, startW + ev.clientX - startX);
            cols[i].style.width = newW + "px";
            table!.style.width  = totalWidth() + "px";
            ghost.style.left    = (ev.clientX - contRect.left + container.scrollLeft) + "px";
          }

          function onUp() {
            ghost.style.opacity            = "0";
            document.body.style.cursor     = "";
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
      // Data loaded into tbody → reset lock so columns re-fit content on next drag
      locked = false;
      table!.style.tableLayout = "";
      table!.style.width = "";
      const cg = table!.querySelector("colgroup");
      if (cg) Array.from(cg.children).forEach((c) => ((c as HTMLElement).style.width = ""));
      Array.from(table!.querySelectorAll("thead th")).forEach(
        (th) => delete (th as HTMLElement).dataset.resizable
      );
      init();
    });
    const tbody = table.querySelector("tbody");
    if (tbody) observer.observe(tbody, { childList: true });

    return () => { observer.disconnect(); ghost.remove(); };
  }, []);

  return tableRef;
}
