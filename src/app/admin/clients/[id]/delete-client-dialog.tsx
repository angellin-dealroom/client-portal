"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteClient } from "../../actions";

export function DeleteClientDialog({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const confirmed = typed.trim() === clientName;

  function handleDelete() {
    if (!confirmed) return;
    startTransition(async () => {
      const result = await deleteClient(clientId);
      if (result.ok) {
        toast.success(`${clientName} deleted`);
        router.push("/admin");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-base text-destructive">Danger zone</CardTitle>
        <CardDescription>
          Deleting a client removes their record, their project links, and all
          activity log entries. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setTyped("");
          }}
        >
          <DialogTrigger asChild>
            <Button variant="destructive">Delete client</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {clientName}?</DialogTitle>
              <DialogDescription>
                This permanently removes the client, their 5 project links, and
                their activity log entries. Type{" "}
                <span className="font-semibold text-foreground">
                  {clientName}
                </span>{" "}
                below to confirm.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="confirm-name">Client name</Label>
              <Input
                id="confirm-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={clientName}
                autoComplete="off"
                disabled={pending}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                disabled={!confirmed || pending}
              >
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
