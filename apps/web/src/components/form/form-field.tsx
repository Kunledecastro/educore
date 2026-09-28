import * as React from "react";
import { Label } from "@educore/ui/label";
import { cn } from "@educore/ui/utils";

/**
 * Label + control + hint + inline error, wired for screen readers:
 * the control gets `aria-invalid` and `aria-describedby` automatically.
 * Pass exactly one form control as the child (Input, Select, Textarea).
 */
export function FormField({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactElement;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children, {
    id: htmlFor,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required || undefined,
    className: cn((children.props as { className?: string }).className, error && "border-destructive focus-visible:ring-destructive"),
  } as Record<string, unknown>);

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {control}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
