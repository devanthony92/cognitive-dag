import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { ProblemAlert } from '../auth/ProblemAlert';

interface Props {
  open: boolean;
  pending: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onPublish: (note: string) => void;
}

export function PublishDialog({ open, pending, error, onOpenChange, onPublish }: Props) {
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publicar versión</DialogTitle>
          <DialogDescription>
            Se crea una versión inmutable con el borrador actual y queda como la versión activa.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="publish-note">Nota (opcional)</Label>
          <Textarea
            id="publish-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        {error !== undefined && error !== null && <ProblemAlert error={error} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button disabled={pending} onClick={() => onPublish(note)}>
            Publicar versión
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
