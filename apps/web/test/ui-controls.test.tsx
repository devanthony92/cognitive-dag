import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, describe, expect, it } from 'vitest';
import { Alert, AlertDescription, AlertTitle } from '../src/components/ui/alert';
import { Button } from '../src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '../src/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../src/components/ui/form';
import { Input } from '../src/components/ui/input';
import { NativeSelect } from '../src/components/ui/native-select';
import { PasswordInput } from '../src/components/ui/password-input';
import { EmptyState } from '../src/components/ui/empty-state';
import { PageHeader } from '../src/components/ui/page-header';
import { Skeleton } from '../src/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../src/components/ui/table';
import { Textarea } from '../src/components/ui/textarea';

afterEach(cleanup);

/** Test helper: how many primary (inverted-ink) buttons a view shows. The One Action Rule says one. */
export function countPrimaryButtons(root: ParentNode): number {
  return root.querySelectorAll('button[data-variant="primary"], a[data-variant="primary"]').length;
}

const classesOf = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/);

describe('Button', () => {
  it('is 44 px tall with an 8 px radius, whatever the size', () => {
    render(
      <>
        <Button>Guardar</Button>
        <Button size="sm">Pequeño</Button>
        <Button size="icon" aria-label="Cerrar">
          x
        </Button>
      </>,
    );
    for (const name of ['Guardar', 'Pequeño', 'Cerrar']) {
      const classes = classesOf(screen.getByRole('button', { name }));
      expect(classes).toContain('rounded-md');
      expect(classes.some((c) => c === 'h-11' || c === 'size-11')).toBe(true);
    }
  });

  it('defaults to the primary variant in inverted ink and marks it for the one-action check', () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole('button', { name: 'Guardar' });
    expect(button.getAttribute('data-variant')).toBe('primary');
    expect(classesOf(button)).toContain('bg-action');
    expect(classesOf(button)).toContain('text-on-action');
  });

  it('has one primary per view in a well-formed view', () => {
    const { container } = render(
      <div>
        <Button>Guardar</Button>
        <Button variant="secondary">Cancelar</Button>
        <Button variant="danger">Eliminar workflow</Button>
      </div>,
    );
    expect(countPrimaryButtons(container)).toBe(1);
  });

  it('draws danger as an outline in the failed token, never filled', () => {
    render(<Button variant="danger">Eliminar</Button>);
    const classes = classesOf(screen.getByRole('button', { name: 'Eliminar' }));
    expect(classes).toContain('text-state-failed');
    expect(classes).toContain('border-state-failed');
    expect(classes).not.toContain('bg-state-failed');
  });

  it('dims a disabled button to 45 % and shows not-allowed', () => {
    render(<Button disabled>Guardar</Button>);
    const classes = classesOf(screen.getByRole('button', { name: 'Guardar' }));
    expect(classes).toContain('disabled:opacity-45');
    expect(classes).toContain('disabled:cursor-not-allowed');
    expect(classes).not.toContain('disabled:pointer-events-none');
  });
});

describe('fields', () => {
  it('are 44 px tall and at least 16 px on mobile', () => {
    render(
      <>
        <Input aria-label="Nombre" />
        <NativeSelect aria-label="Rol">
          <option>Editor</option>
        </NativeSelect>
        <PasswordInput aria-label="Contraseña" />
      </>,
    );
    for (const element of [
      screen.getByLabelText('Nombre'),
      screen.getByLabelText('Rol'),
      screen.getByLabelText('Contraseña'),
    ]) {
      const classes = classesOf(element);
      expect(classes).toContain('h-11');
      expect(classes).toContain('text-base');
      expect(classes).toContain('rounded-md');
    }
    expect(classesOf(screen.getByLabelText('Nombre'))).toContain('border-line-strong');
  });

  it('keeps the show-password toggle at 44 px', () => {
    render(<PasswordInput aria-label="Contraseña" />);
    const toggle = screen.getByRole('button', { name: 'Mostrar contraseña' });
    expect(classesOf(toggle)).toContain('size-11');
  });

  it('lets a textarea grow from 44 px', () => {
    render(<Textarea aria-label="Notas" />);
    expect(classesOf(screen.getByLabelText('Notas'))).toContain('min-h-11');
  });
});

function Sample({ withError }: { withError: boolean }) {
  const form = useForm<{ name: string }>({ defaultValues: { name: '' } });
  return (
    <Form {...form}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (withError) form.setError('name', { message: 'El nombre es obligatorio' });
        }}
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Cómo se verá en la lista.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Enviar</Button>
      </form>
    </Form>
  );
}

describe('form field', () => {
  it('shows a visible label and a help text tied to the field', () => {
    render(<Sample withError={false} />);
    const field = screen.getByLabelText('Nombre');
    const help = screen.getByText('Cómo se verá en la lista.');
    expect(field.getAttribute('aria-describedby')).toContain(help.id);
    expect(classesOf(help)).toContain('text-body-sm');
    expect(field.getAttribute('aria-invalid')).toBe('false');
  });

  it('shows an error with an icon and text, not colour alone', async () => {
    render(<Sample withError />);
    await userEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    const message = await screen.findByText('El nombre es obligatorio');
    const field = screen.getByLabelText('Nombre');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain(message.id);
    expect(message.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(classesOf(message)).toContain('text-state-failed');
  });
});

describe('Alert', () => {
  it('pairs every tone with a glyph and keeps the text', () => {
    for (const variant of ['default', 'destructive', 'success', 'warning'] as const) {
      const { container, unmount } = render(
        <Alert variant={variant}>
          <AlertTitle>Título</AlertTitle>
          <AlertDescription>Detalle</AlertDescription>
        </Alert>,
      );
      expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(screen.getByRole('alert').textContent).toContain('Detalle');
      unmount();
    }
  });
});

describe('Dialog', () => {
  function Sample() {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <Button>Abrir</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirmar</DialogTitle>
          <DialogDescription>¿Seguro?</DialogDescription>
          <Button variant="secondary">Cancelar</Button>
          <Button>Aceptar</Button>
        </DialogContent>
      </Dialog>
    );
  }

  it('traps focus, closes with Esc and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Sample />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar' });

    for (let index = 0; index < 6; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('floats on the shadow token with a 44 px close button', async () => {
    const user = userEvent.setup();
    render(<Sample />);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = await screen.findByRole('dialog');
    expect(classesOf(dialog)).toContain('shadow-float');
    expect(classesOf(dialog)).toContain('bg-raised');
    expect(classesOf(screen.getByRole('button', { name: 'Cerrar' }))).toContain('size-11');
  });
});

describe('Table', () => {
  it('has 52 px rows, a Label header, tabular figures and contains its own overflow', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Estado</TableHead>
            <TableHead numeric>Duración</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>En curso</TableCell>
            <TableCell numeric>3,2 s</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(classesOf(container.querySelector('tbody tr') as Element)).toContain('h-13');
    const head = screen.getByRole('columnheader', { name: 'Duración' });
    expect(classesOf(head)).toEqual(
      expect.arrayContaining(['text-label', 'uppercase', 'tabular-nums']),
    );
    expect(classesOf(screen.getByRole('cell', { name: '3,2 s' }))).toContain('tabular-nums');
    const wrapper = container.firstElementChild as Element;
    expect(classesOf(wrapper)).toEqual(expect.arrayContaining(['overflow-x-auto', 'max-w-full']));
  });
});

describe('PageHeader, EmptyState and Skeleton', () => {
  it('renders exactly one h1 and the primary action', () => {
    const { container } = render(
      <PageHeader
        title="Workflows"
        description="Todos los de la organización"
        action={<Button>Nuevo</Button>}
      />,
    );
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(countPrimaryButtons(container)).toBe(1);
  });

  it('shows plain text and one action when a list is empty', () => {
    render(<EmptyState title="Aún no hay ejecuciones" action={<Button>Ejecutar</Button>} />);
    expect(screen.getByRole('heading', { name: 'Aún no hay ejecuciones' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeDefined();
  });

  it('pulses only when motion is allowed', () => {
    const { container } = render(<Skeleton className="h-8" />);
    const classes = classesOf(container.firstElementChild as Element);
    expect(classes).toContain('motion-safe:animate-pulse');
    expect(classes.filter((name) => /^animate-/.test(name))).toEqual([]);
  });
});
