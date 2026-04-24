"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateClientStage } from "./actions";
import type { ClientStage } from "./constants";

const STAGES: { value: ClientStage; label: string }[] = [
  { value: "discovery", label: "Discovery" },
  { value: "proposal", label: "Proposal" },
  { value: "contract", label: "Contract" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "churned", label: "Churned" },
];

export function StageCell({
  clientId,
  stage,
}: {
  clientId: string;
  stage: ClientStage;
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(next: string) {
    if (next === stage) return;
    startTransition(async () => {
      const result = await updateClientStage(clientId, next as ClientStage);
      if (result.ok) {
        toast.success("Stage updated");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Select value={stage} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="w-[140px] h-8">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGES.map((s) => (
          <SelectItem key={s.value} value={s.value}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
