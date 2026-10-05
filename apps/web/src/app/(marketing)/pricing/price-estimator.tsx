"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Input } from "@educore/ui/input";
import { Label } from "@educore/ui/label";

interface EstimatorPlan {
  code: string;
  name: string;
  priceMinor: number;
  maxStudents: number | null;
}

const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });

/** "How much would my school pay?" — students × price per plan, per month and per term (about 4 months). */
export function PriceEstimator({ plans }: { plans: EstimatorPlan[] }) {
  const t = useTranslations("marketing.pricing.estimator");
  const [raw, setRaw] = React.useState("250");
  const students = Math.max(0, Math.min(100_000, Math.floor(Number(raw.replace(/[^\d]/g, "")) || 0)));
  return (
    <section aria-labelledby="estimate" className="mx-auto mt-16 max-w-3xl rounded-lg border bg-muted/30 p-6">
      <h2 id="estimate" className="text-xl font-semibold">{t("title")}</h2>
      <div className="mt-4 max-w-xs space-y-2">
        <Label htmlFor="est-students">{t("students")}</Label>
        <Input id="est-students" inputMode="numeric" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </div>
      <table className="mt-6 w-full text-sm">
        <caption className="sr-only">{t("title")}</caption>
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th scope="col" className="py-2 font-medium">{t("plan")}</th>
            <th scope="col" className="py-2 text-right font-medium">{t("month")}</th>
            <th scope="col" className="py-2 text-right font-medium">{t("term")}</th>
          </tr>
        </thead>
        <tbody aria-live="polite">
          {plans.map((p) => {
            const over = p.maxStudents !== null && students > p.maxStudents;
            const month = (Math.max(1, students) * p.priceMinor) / 100;
            return (
              <tr key={p.code} className="border-b last:border-0">
                <th scope="row" className="py-2 text-left font-medium">{p.name}</th>
                <td className="py-2 text-right tabular-nums">{over ? t("overLimit") : naira.format(month)}</td>
                <td className="py-2 text-right tabular-nums">{over ? "—" : naira.format(month * 4)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted-foreground">{t("note")}</p>
    </section>
  );
}
