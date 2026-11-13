import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { NativeSelect } from '../../components/ui/native-select';
import { credentialsQuery } from './api';

/**
 * Picks the credential an `http.request` node authenticates with. Only the id goes into the
 * definition; the name is just what the person recognizes it by. A viewer cannot list credentials,
 * so there the current choice is kept and shown as an id.
 */
export function CredentialSelect({
  id,
  value,
  invalid,
  onChange,
  onBlur,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const { organizationId } = useParams({ strict: false });
  const credentials = useQuery({
    ...credentialsQuery(organizationId ?? ''),
    enabled: organizationId !== undefined,
  });
  const items = credentials.data ?? [];
  const known = items.some((credential) => credential.id === value);

  return (
    <div className="grid gap-1">
      <NativeSelect
        id={id}
        value={value}
        aria-invalid={invalid}
        disabled={credentials.isPending}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Sin credencial</option>
        {items.map((credential) => (
          <option key={credential.id} value={credential.id}>
            {credential.name}
          </option>
        ))}
        {value !== '' && !known && !credentials.isPending && (
          <option value={value}>Credencial no disponible ({value.slice(0, 8)}…)</option>
        )}
      </NativeSelect>
      {credentials.isError && (
        <p className="text-body-sm text-ink-muted">
          No se pudo leer la lista de credenciales (puede que tu rol no lo permita).
        </p>
      )}
      {credentials.isSuccess && items.length === 0 && (
        <p className="text-body-sm text-ink-muted">
          Aún no hay credenciales. Un owner las crea en «Conexiones».
        </p>
      )}
    </div>
  );
}
