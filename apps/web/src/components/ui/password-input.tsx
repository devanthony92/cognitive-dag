import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import type * as React from 'react';
import { cn } from '../../lib/utils';
import { Input } from './input';

/** A password field with a 44 px button that shows or hides what was typed. */
function PasswordInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-12', className)} />
      <button
        type="button"
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 flex size-11 items-center justify-center rounded-md text-ink-muted outline-none hover:text-ink [&_svg]:size-4"
      >
        <Icon aria-hidden />
      </button>
    </div>
  );
}

export { PasswordInput };
