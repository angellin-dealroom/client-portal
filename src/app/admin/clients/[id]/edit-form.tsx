"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveClient } from "../../actions";
import {
  LINK_TYPES,
  type ClientStage,
  type LinkStatus,
  type LinkType,
} from "../../constants";

const STAGES: { value: ClientStage; label: string }[] = [
  { value: "discovery", label: "Discovery" },
  { value: "proposal", label: "Proposal" },
  { value: "contract", label: "Contract" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "churned", label: "Churned" },
];

const STATUSES: { value: LinkStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "viewed", label: "Viewed" },
  { value: "completed", label: "Completed" },
];

const LINK_LABELS: Record<LinkType, string> = {
  proposal: "Proposal",
  contract: "Contract",
  payment: "Payment",
  kickoff: "Kickoff call",
  onboarding: "Onboarding form",
};

type LinkState = { url: string | null; status: LinkStatus };

export function EditClientForm({
  client,
  links,
}: {
  client: {
    id: string;
    name: string;
    email: string;
    company: string | null;
    stage: ClientStage;
  };
  links: Partial<Record<LinkType, LinkState>>;
}) {
  const [stage, setStage] = useState<ClientStage>(client.stage);
  const [statuses, setStatuses] = useState<Record<LinkType, LinkStatus>>(() =>
    Object.fromEntries(
      LINK_TYPES.map((t) => [t, links[t]?.status ?? "pending"])
    ) as Record<LinkType, LinkStatus>
  );
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    fd.set("stage", stage);
    for (const t of LINK_TYPES) {
      fd.set(`${t}_status`, statuses[t]);
    }

    startTransition(async () => {
      const result = await saveClient(client.id, fd);
      if (result.ok) {
        toast.success("Changes saved");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={client.name}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={client.email}
              readOnly
              disabled
              title="Email is the client's login identifier — changing it would break their magic-link access."
            />
            <p className="text-xs text-muted-foreground">
              Email is read-only because it&apos;s the login identifier.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company">Company</Label>
            <Input
              id="company"
              name="company"
              defaultValue={client.company ?? ""}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stage">Stage</Label>
            <Select
              value={stage}
              onValueChange={(v) => setStage(v as ClientStage)}
              disabled={pending}
            >
              <SelectTrigger id="stage" className="w-[200px]">
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {LINK_TYPES.map((type) => (
            <div
              key={type}
              className="grid grid-cols-1 md:grid-cols-[140px_1fr_160px] gap-3 md:items-end"
            >
              <div className="space-y-2">
                <Label>{LINK_LABELS[type]}</Label>
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor={`${type}_url`}
                  className="text-xs text-muted-foreground"
                >
                  URL
                </Label>
                <Input
                  id={`${type}_url`}
                  name={`${type}_url`}
                  type="url"
                  placeholder="https://…"
                  defaultValue={links[type]?.url ?? ""}
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor={`${type}_status_trigger`}
                  className="text-xs text-muted-foreground"
                >
                  Status
                </Label>
                <Select
                  value={statuses[type]}
                  onValueChange={(v) =>
                    setStatuses({ ...statuses, [type]: v as LinkStatus })
                  }
                  disabled={pending}
                >
                  <SelectTrigger id={`${type}_status_trigger`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
