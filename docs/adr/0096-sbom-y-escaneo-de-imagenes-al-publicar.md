---
status: accepted
date: 2026-11-09
decision-makers: autor
---

# SBOM y escaneo de imágenes solo al publicar

## Contexto y problema

ADR-0088 dejó sin SBOM ni escaneo de imágenes (A03, issue #64). Hace falta saber qué lleva cada imagen publicada y no publicar una con vulnerabilidades graves ya corregibles, sin cambiar el job `images` ni los 6 checks requeridos.

## Opciones consideradas

- Escanear en el job `images` de cada pull request: bloquea el merge, pero lo alarga y cambia lo que ya protege la rama.
- Un check requerido nuevo: cambia las reglas de la rama.
- Solo al publicar (elegida, D11C): un hallazgo bloquea la publicación y por tanto el despliegue, pero no un pull request.

## Decisión

- **Dónde:** en el trabajo `publish` de `release.yml` (`scripts/ci/publish-image.sh`), antes de subir nada: una imagen bloqueada no llega al registro.
- **Escaneo:** Grype sobre el diseño OCI de cada arquitectura, solo con corrección disponible (`--only-fixed`). Falla la publicación ante severidad alta o crítica con corrección (`scripts/ci/check-image-scan.ts`).
- **Excepciones:** `.github/image-scan-exceptions.json`, versionado y revisado en pull request. Cada una lleva `id`, `reason`, `owner`, `date` (alta) y `expires`; vencida, deja de aplicar y el hallazgo vuelve a bloquear. Puede limitarse a un paquete (`package`) y a una imagen (`image`). Una excepción con `image` solo aplica a esa imagen. Vigentes: `GO-2026-6860` (`golang.org/x/net`) y `GO-2026-6865` (`klauspost/compress`) en `edge`, dentro del binario de Caddy 2.11.9, que es la última versión oficial; vencen el 2026-12-09 y se retiran al subir Caddy a una versión que las corrija. Una prueba exige que toda excepción dure como máximo 30 días y nombre su imagen.
- **SBOM:** Syft genera CycloneDX JSON por imagen y arquitectura; ORAS lo adjunta al manifiesto publicado (consultable con `oras discover`) y se conserva 90 días como artefacto `published-<imagen>` junto con los informes de escaneo.
- **Herramientas:** Grype, Syft, crane y ORAS como imágenes fijadas por digest en el script. Renovate no las actualiza (no son un `FROM` ni una acción): se revisan a mano. Se evitó la acción de terceros del escáner para no sumar otra dependencia de cadena de suministro.

## Consecuencias

- Bueno: los 6 checks no cambian; el SBOM describe lo que de verdad se publica.
- Malo: un problema se descubre tras el merge, con el código ya en `main`; la publicación se detiene hasta actualizar la base o registrar una excepción con dueño y fecha. Los falsos positivos de la base Debian se gestionan con esa lista.

## Confirmación

`scripts/test/unit/check-image-scan.test.ts` (bloqueo, excepciones, vencimiento y formato del archivo) y `workflows-permissions.test.ts` (el escaneo precede al primer `push`; herramientas por digest).

## Enlaces

- Decisión D11C; ADR-0088 (issue #64), ADR-0089.
