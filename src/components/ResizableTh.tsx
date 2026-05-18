export function ResizableTh({ children, width, onResizeStart, className, style }: {
  children?: React.ReactNode;
  width: number | null;
  onResizeStart: (e: React.MouseEvent) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <th className={className} style={{ ...style, width: width ?? undefined, position: "relative", userSelect: "none", paddingRight: 18 }}>
      {children}
      <span onMouseDown={onResizeStart} className="col-resize-handle" />
    </th>
  );
}
