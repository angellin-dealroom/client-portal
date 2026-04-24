"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type LinkMeta = {
  label: string;
  description: string;
};

export type ProjectLink = {
  id: string;
  link_type: "proposal" | "contract" | "payment" | "kickoff" | "onboarding";
  url: string | null;
  status: "pending" | "viewed" | "completed";
};

function statusBadge(status: ProjectLink["status"]) {
  switch (status) {
    case "completed":
      return <Badge>Completed</Badge>;
    case "viewed":
      return <Badge variant="secondary">Viewed</Badge>;
    case "pending":
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

export function LinkCard({
  meta,
  link,
}: {
  meta: LinkMeta;
  link: ProjectLink | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const available = !!link?.url;

  async function handleOpen() {
    if (!link?.url) return;

    // Open the URL first, inside the synchronous click context so
    // popup blockers allow it.
    window.open(link.url, "_blank", "noopener,noreferrer");

    setPending(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("record_link_click", {
      p_link_id: link.id,
    });
    setPending(false);

    if (error) {
      console.error("record_link_click failed:", error);
      return;
    }

    router.refresh();
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{meta.label}</CardTitle>
          {link ? (
            statusBadge(link.status)
          ) : (
            <Badge variant="outline">Not yet available</Badge>
          )}
        </div>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto pt-2">
        <Button
          variant="outline"
          className="w-full"
          disabled={!available || pending}
          onClick={handleOpen}
          title={available ? link?.url ?? undefined : undefined}
        >
          {available ? "Open" : "Not yet available"}
        </Button>
      </CardContent>
    </Card>
  );
}
