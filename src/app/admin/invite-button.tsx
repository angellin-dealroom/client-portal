"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendClientInvite } from "./actions";

export function InviteButton({
  clientId,
  clientEmail,
  variant = "ghost",
  size = "sm",
}: {
  clientId: string;
  clientEmail: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg";
}) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await sendClientInvite(clientId);
      if (result.ok) {
        toast.success(`Invite sent to ${clientEmail}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={pending}
    >
      {pending ? "Sending…" : "Send invite"}
    </Button>
  );
}
