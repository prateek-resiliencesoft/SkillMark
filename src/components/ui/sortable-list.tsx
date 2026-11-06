"use client";

import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";
import { Reorder, useDragControls, type DragControls } from "motion/react";
import type { ReactNode } from "react";

type Handle = ReactNode;

function Row<T>({
  item,
  disabled,
  className,
  children,
}: {
  item: T;
  disabled?: boolean;
  className?: string;
  children: (handle: Handle, controls: DragControls) => ReactNode;
}) {
  const controls = useDragControls();
  const handle = disabled ? null : (
    <button
      type="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      onPointerDown={(e) => controls.start(e)}
      className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className={cn("list-none", className)}
      whileDrag={{ scale: 1.015, boxShadow: "0 8px 24px rgb(0 0 0 / 0.14)", zIndex: 10 }}
      transition={{ type: "spring", stiffness: 500, damping: 40 }}
    >
      {children(handle, controls)}
    </Reorder.Item>
  );
}

/** Vertical drag-to-reorder list. Rows get a grip `handle` to place wherever they like. */
export function SortableList<T>({
  items,
  onReorder,
  getKey,
  disabled,
  className,
  itemClassName,
  children,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  getKey: (item: T) => string;
  disabled?: boolean;
  className?: string;
  itemClassName?: string;
  children: (item: T, index: number, handle: Handle) => ReactNode;
}) {
  return (
    <Reorder.Group axis="y" values={items} onReorder={onReorder} className={cn("space-y-1.5", className)}>
      {items.map((item, index) => (
        <Row key={getKey(item)} item={item} disabled={disabled} className={itemClassName}>
          {(handle) => children(item, index, handle)}
        </Row>
      ))}
    </Reorder.Group>
  );
}
