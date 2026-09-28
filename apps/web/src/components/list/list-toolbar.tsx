import * as React from "react";

/** Row above a list: search + filters on the left, page actions on the right. Stacks on phones. */
export function ListToolbar({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
