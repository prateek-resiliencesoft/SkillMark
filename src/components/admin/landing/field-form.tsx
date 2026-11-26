"use client";

import { emptyItem, emptyValue, type Field } from "@landing/shared/fields";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { MediaPickerButton } from "./media-picker";

type Values = Record<string, unknown>;

export function FieldForm({
  fields,
  values,
  onChange,
  className,
}: {
  fields: Field[];
  values: Values;
  onChange: (next: Values) => void;
  className?: string;
}) {
  function set(key: string, value: unknown) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className={cn("space-y-4", className)}>
      {fields.map((field) => (
        <FieldControl
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(v) => set(field.key, v)}
        />
      ))}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <div className="space-y-0.5">
      <Label className="text-xs font-medium">{field.label}</Label>
      {field.help ? <p className="text-[11px] text-muted-foreground">{field.help}</p> : null}
    </div>
  );

  switch (field.kind) {
    case "text":
    case "icon":
    case "url":
    case "color":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            value={String(value ?? "")}
            type={field.kind === "color" && String(value ?? "").startsWith("#") ? "text" : "text"}
            placeholder={field.kind === "color" ? "#5944f6" : undefined}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
      );
    case "textarea":
    case "html":
    case "css":
      return (
        <div className="space-y-1.5">
          {label}
          <Textarea
            value={String(value ?? "")}
            rows={field.kind === "html" || field.kind === "css" ? 8 : 4}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-xs"
          />
        </div>
      );
    case "number":
      return (
        <div className="space-y-1.5">
          {label}
          <Input
            type="number"
            value={value === undefined || value === null ? "" : String(value)}
            min={field.min}
            max={field.max}
            onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
            className="h-9 text-sm"
          />
        </div>
      );
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
          {label}
          <Switch checked={Boolean(value)} onCheckedChange={(v) => onChange(v)} />
        </div>
      );
    case "select":
      return (
        <div className="space-y-1.5">
          {label}
          <Select
            value={value === "" || value == null ? "__empty" : String(value)}
            onValueChange={(v) => onChange(v === "__empty" ? "" : v)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((o) => (
                <SelectItem key={o.value || "__empty"} value={o.value || "__empty"}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    case "image":
      return (
        <div className="space-y-1.5">
          {label}
          <div className="flex gap-2">
            <Input
              value={String(value ?? "")}
              onChange={(e) => onChange(e.target.value)}
              placeholder="/screenshots/… or https://…"
              className="h-9 flex-1 text-sm"
            />
            <MediaPickerButton onPick={(url) => onChange(url)} />
          </div>
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={String(value)} alt="" className="mt-1 h-16 rounded border object-cover" />
          ) : null}
        </div>
      );
    case "stringList": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-2">
          {label}
          {list.map((item, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={item}
                onChange={(e) => {
                  const next = [...list];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                className="h-9 flex-1 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => onChange(list.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={list.length >= (field.max ?? 50)}
            onClick={() => onChange([...list, ""])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add {field.itemLabel ?? "item"}
          </Button>
        </div>
      );
    }
    case "list": {
      const list = Array.isArray(value) ? (value as Values[]) : [];
      return (
        <div className="space-y-3">
          {label}
          {list.map((item, i) => {
            const titleKey = field.titleKey;
            const title = titleKey ? String(item[titleKey] ?? `${field.itemLabel} ${i + 1}`) : `${field.itemLabel} ${i + 1}`;
            return (
              <div key={i} className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{title || field.itemLabel}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onChange(list.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <FieldForm
                  fields={field.fields}
                  values={item}
                  onChange={(next) => {
                    const copy = [...list];
                    copy[i] = next;
                    onChange(copy);
                  }}
                />
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={list.length >= (field.max ?? 50)}
            onClick={() => onChange([...list, emptyItem(field.fields)])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add {field.itemLabel}
          </Button>
        </div>
      );
    }
    case "group": {
      const group = (value && typeof value === "object" ? value : emptyValue(field)) as Values;
      return (
        <div className="space-y-3 rounded-lg border border-border/70 p-3">
          {label}
          <FieldForm fields={field.fields} values={group} onChange={onChange} />
        </div>
      );
    }
    default:
      return null;
  }
}
