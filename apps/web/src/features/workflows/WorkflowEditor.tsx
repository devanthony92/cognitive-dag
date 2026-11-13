import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from '@tanstack/react-router';
import {
  Cable,
  Download,
  Network,
  Plus,
  Save,
  Send,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { WorkflowBody } from '@cognitive-dag/contracts';
import {
  DEFAULT_LIMITS,
  NODE_CATALOG,
  type DagDefinition,
  type DagLimits,
  type NodeType,
  type RetrySetting,
} from '@cognitive-dag/dag-schema';
import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../components/ui/sheet';
import { Toast } from '../../components/ui/toast';
import { CANVAS_ARIA_LABELS } from '../../components/station/a11y';
import { CanvasZoom } from '../../components/station/CanvasZoom';
import { PHONE_QUERY, useMediaQuery } from '../../lib/media';
import { cn } from '../../lib/utils';
import { ProblemAlert } from '../auth/ProblemAlert';
import { RunButton } from '../runs/RunButton';
import { ScheduleStatus } from '../schedules/ScheduleStatus';
import { WebhookPanel } from '../webhooks/WebhookPanel';
import { sessionQuery } from '../session/session';
import {
  limitsQuery,
  publishVersion,
  saveDraft,
  versionQuery,
  versionsKey,
  versionsQuery,
  workflowKey,
  workflowQuery,
  workflowsKey,
} from './api';
import { ConfigForm } from './ConfigForm';
import { downloadDefinition, exportFileName } from './export';
import { autoLayout } from './layout';
import { checkRename, renameNodeId } from './references';
import {
  buildEdges,
  createNodeBuilder,
  EDGE_TYPES,
  HANDLE_LABELS,
  NODE_TYPES,
  type FlowEdge,
  type FlowNode,
} from './flow';
import {
  addNode,
  canonicalJson,
  connect,
  groupErrors,
  moveNode,
  removeEdges,
  removeNodes,
  toEditableDefinition,
  updateNode,
  type Position,
} from './model';
import { Palette, PALETTE_DRAG_TYPE } from './Palette';
import { ProblemsList } from './ProblemsList';
import { PublishDialog } from './PublishDialog';
import { useLiveValidation } from './useLiveValidation';
import { VersionsPanel } from './VersionsPanel';

const NO_SELECTION: ReadonlySet<string> = new Set();

interface Props {
  organizationId: string;
  workflowId: string;
}

/** Loads the workflow and the session, then hands the draft to the editor. */
export function WorkflowEditor({ organizationId, workflowId }: Props) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const workflow = useQuery(workflowQuery(organizationId, workflowId));
  // Bumping it remounts the editor, which restarts from whatever draft the cache holds.
  const [generation, setGeneration] = useState(0);

  const role = session.data?.organizations.find((item) => item.id === organizationId)?.role;

  if (workflow.isError) {
    return (
      <div className="mx-auto w-full max-w-page-narrow p-6">
        <ProblemAlert error={workflow.error} />
      </div>
    );
  }
  if (!workflow.data || !session.data) {
    return (
      <p role="status" className="p-6 text-ink-muted">
        Cargando el workflow…
      </p>
    );
  }

  return (
    <ReactFlowProvider>
      <EditorSession
        key={generation}
        organizationId={organizationId}
        workflowId={workflowId}
        workflow={workflow.data}
        canWrite={role === 'owner' || role === 'editor'}
        onReload={() => {
          void workflow.refetch().then(() => setGeneration((value) => value + 1));
        }}
        onDraftReplaced={(replaced) => {
          queryClient.setQueryData(workflowKey(organizationId, workflowId), replaced);
          void queryClient.invalidateQueries({ queryKey: workflowsKey(organizationId) });
          setGeneration((value) => value + 1);
        }}
      />
    </ReactFlowProvider>
  );
}

interface SessionProps extends Props {
  workflow: WorkflowBody;
  canWrite: boolean;
  onReload: () => void;
  onDraftReplaced: (workflow: WorkflowBody) => void;
}

type Size = { width: number; height: number };

function EditorSession({
  organizationId,
  workflowId,
  workflow,
  canWrite,
  onReload,
  onDraftReplaced,
}: SessionProps) {
  const queryClient = useQueryClient();
  const readOnly = !canWrite;
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const phone = useMediaQuery(PHONE_QUERY);
  const canvas = useRef<HTMLDivElement>(null);

  const initial = useMemo(() => toEditableDefinition(workflow.draft), [workflow.draft]);
  const [definition, setDefinition] = useState<DagDefinition>(initial.definition);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initial.definition));
  const [revision, setRevision] = useState(workflow.draftRevision);
  const [savedAt, setSavedAt] = useState<Date | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const closeNotice = useCallback(() => setNotice(undefined), []);
  const [publishedNow, setPublishedNow] = useState<{ number: number; canonical: string }>();
  const [tab, setTab] = useState<'node' | 'versions'>('node');
  const [publishOpen, setPublishOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  // A new dialog (and an empty note) for every publication.
  const [published, setPublished] = useState(0);
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [selectedEdges, setSelectedEdges] = useState<ReadonlySet<string>>(NO_SELECTION);
  const [measured, setMeasured] = useState<ReadonlyMap<string, Size>>(new Map());
  const buildNodes = useMemo(createNodeBuilder, []);
  const [announcement, setAnnouncement] = useState('');
  const [connectFrom, setConnectFrom] = useState<string | undefined>();
  const [addOpen, setAddOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'node' | 'edge'; id: string; name: string } | undefined
  >();
  const panelRef = useRef<HTMLDivElement>(null);

  const limitsData = useQuery(limitsQuery(organizationId)).data;
  const limits = useMemo<DagLimits>(
    () =>
      limitsData
        ? {
            maxNodes: limitsData.maxNodes,
            maxEdges: limitsData.maxEdges,
            maxDefinitionBytes: limitsData.maxDefinitionBytes,
          }
        : DEFAULT_LIMITS,
    [limitsData],
  );

  const { result, pending: validating } = useLiveValidation(definition, limits);
  const errors = useMemo(() => groupErrors(result.errors), [result.errors]);
  const labels = useMemo(
    () => new Map(definition.nodes.map((node) => [node.id, node.label])),
    [definition.nodes],
  );

  const dirty = useMemo(() => JSON.stringify(definition) !== savedJson, [definition, savedJson]);

  // The published draft is the active version until the server says otherwise, so Publish stays
  // blocked while nothing changed since then.
  const savedCanonical = useMemo(() => canonicalJson(JSON.parse(savedJson)), [savedJson]);
  const versions = useQuery(versionsQuery(organizationId, workflowId)).data;
  const activeNumber = versions?.find((version) => version.active)?.number;
  const activeVersion = useQuery({
    ...versionQuery(organizationId, workflowId, activeNumber ?? 0),
    enabled: activeNumber !== undefined,
  }).data;
  const activeCanonical = useMemo(
    () =>
      activeVersion
        ? canonicalJson(toEditableDefinition(activeVersion.definition).definition)
        : undefined,
    [activeVersion],
  );
  const bridged =
    publishedNow !== undefined &&
    savedCanonical === publishedNow.canonical &&
    !(activeVersion && activeVersion.number >= publishedNow.number);
  const unchanged =
    bridged || (activeCanonical !== undefined && savedCanonical === activeCanonical);

  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  // ---- Persistence ----------------------------------------------------------------------------

  const save = useMutation({
    mutationFn: () => saveDraft(organizationId, workflowId, revision, definition),
    onSuccess: (saved) => {
      setRevision(saved.revision);
      setSavedJson(JSON.stringify(definition));
      setSavedAt(new Date());
      void queryClient.invalidateQueries({ queryKey: workflowsKey(organizationId) });
    },
    // Someone saved a newer draft: the dialog explains it and offers to load theirs (US5).
    onError: (error) => {
      if (error instanceof ApiProblemError && error.problem.status === 409) setConflictOpen(true);
    },
  });

  // Publishing needs a saved draft, so the revision sent is always one the server holds.
  const publish = useMutation({
    mutationFn: (note: string) => publishVersion(organizationId, workflowId, revision, note),
    onSuccess: async (version) => {
      setPublishedNow({ number: version.number, canonical: savedCanonical });
      setPublishOpen(false);
      setPublished((count) => count + 1);
      setNotice(`Versión ${version.number} publicada y activa.`);
      await queryClient.invalidateQueries({ queryKey: versionsKey(organizationId, workflowId) });
      await queryClient.invalidateQueries({ queryKey: workflowsKey(organizationId) });
    },
  });

  // ---- Canvas ---------------------------------------------------------------------------------

  const nodes = useMemo(
    () => buildNodes(definition, errors, selectedNodes, measured, readOnly),
    [buildNodes, definition, errors, selectedNodes, measured, readOnly],
  );
  const edges = useMemo(
    () => buildEdges(definition, errors, selectedEdges, readOnly),
    [definition, errors, selectedEdges, readOnly],
  );

  const selectNode = useCallback((id: string) => {
    setSelectedNodes(new Set([id]));
    setSelectedEdges(NO_SELECTION);
    setTab('node');
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      const moves = new Map<string, Position>();
      const removed: string[] = [];
      const selection = new Map<string, boolean>();
      const sizes = new Map<string, Size>();
      for (const change of changes) {
        if (change.type === 'position' && change.position) moves.set(change.id, change.position);
        else if (change.type === 'remove') removed.push(change.id);
        else if (change.type === 'select') selection.set(change.id, change.selected);
        else if (change.type === 'dimensions' && change.dimensions) {
          sizes.set(change.id, change.dimensions);
        }
      }
      if (!readOnly && (moves.size > 0 || removed.length > 0)) {
        setDefinition((current) => {
          let next = current;
          for (const [id, position] of moves) next = moveNode(next, id, position);
          return removed.length > 0 ? removeNodes(next, removed) : next;
        });
      }
      if (selection.size > 0 || removed.length > 0) {
        setSelectedNodes((current) => {
          const next = new Set(current);
          for (const [id, selected] of selection) {
            if (selected) next.add(id);
            else next.delete(id);
          }
          for (const id of removed) next.delete(id);
          return next;
        });
        if ([...selection.values()].some(Boolean)) setTab('node');
      }
      if (sizes.size > 0) {
        setMeasured((current) => {
          let next: Map<string, Size> | undefined;
          for (const [id, size] of sizes) {
            const known = current.get(id);
            if (known?.width !== size.width || known.height !== size.height) {
              next ??= new Map(current);
              next.set(id, { width: size.width, height: size.height });
            }
          }
          return next ?? current;
        });
      }
    },
    [readOnly],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed: string[] = [];
      const selection = new Map<string, boolean>();
      for (const change of changes) {
        if (change.type === 'remove') removed.push(change.id);
        else if (change.type === 'select') selection.set(change.id, change.selected);
      }
      if (!readOnly && removed.length > 0)
        setDefinition((current) => removeEdges(current, removed));
      if (selection.size > 0 || removed.length > 0) {
        setSelectedEdges((current) => {
          const next = new Set(current);
          for (const [id, selected] of selection) {
            if (selected) next.add(id);
            else next.delete(id);
          }
          for (const id of removed) next.delete(id);
          return next;
        });
      }
    },
    [readOnly],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly || !connection.sourceHandle) return;
      setDefinition((current) =>
        connect(current, {
          source: connection.source,
          sourceHandle: connection.sourceHandle as string,
          target: connection.target,
        }),
      );
    },
    [readOnly],
  );

  const place = (type: NodeType, position: Position) => {
    const added = addNode(definition, type, position);
    setDefinition(added.definition);
    selectNode(added.id);
  };

  const addFromPalette = (type: NodeType) => {
    const rect = canvas.current?.getBoundingClientRect();
    const center = flow.screenToFlowPosition({
      x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
      y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
    });
    // New nodes fill a grid around the center of the view, so they never stack.
    const slot = definition.nodes.length % 12;
    place(type, {
      x: center.x - 80 + ((slot % 3) - 1) * 220,
      y: center.y - 30 + (Math.floor(slot / 3) - 1) * 90,
    });
  };

  const selectedId = selectedNodes.values().next().value;
  const selectedNode = definition.nodes.find((node) => node.id === selectedId);

  const onNodeChange = useCallback(
    (patch: { label?: string; config?: unknown; retry?: RetrySetting | undefined }) => {
      if (selectedId === undefined) return;
      setDefinition((current) => updateNode(current, selectedId, patch));
    },
    [selectedId],
  );

  const renameSelected = useCallback(
    (to: string): string | undefined => {
      if (selectedId === undefined) return undefined;
      const why = checkRename(definition, selectedId, to);
      if (why) return why;
      setDefinition((current) => renameNodeId(current, selectedId, to));
      setSelectedNodes(new Set([to]));
      setMeasured((current) => {
        const next = new Map(current);
        const size = next.get(selectedId);
        next.delete(selectedId);
        if (size && to !== selectedId) next.set(to, size);
        return next;
      });
      return undefined;
    },
    [definition, selectedId],
  );

  const nameOf = (id: string) => definition.nodes.find((item) => item.id === id)?.label ?? id;

  /** Connect mode: pick a source, then a destination, without dragging (WCAG 2.5.7). */
  const startConnect = () => {
    if (readOnly) return;
    if (!selectedNode) {
      setAnnouncement('Selecciona primero la estación de origen.');
      return;
    }
    setConnectFrom(selectedNode.id);
    setAnnouncement(`Conectando desde «${selectedNode.label}». Elige la estación de destino.`);
  };
  const finishConnect = (targetId: string) => {
    const from = connectFrom ? definition.nodes.find((item) => item.id === connectFrom) : undefined;
    const to = definition.nodes.find((item) => item.id === targetId);
    if (!from || !to) return;
    setConnectFrom(undefined);
    if (from.id === to.id || !NODE_CATALOG[to.type].acceptsInput) {
      setAnnouncement(`«${to.label}» no puede ser el destino. Conexión cancelada.`);
      return;
    }
    const handles = NODE_CATALOG[from.type].handles;
    const used = new Set(
      definition.edges.filter((item) => item.source === from.id).map((item) => item.sourceHandle),
    );
    const handle = handles.find((name) => !used.has(name)) ?? handles[0];
    if (!handle) return;
    setDefinition((current) =>
      connect(current, { source: from.id, sourceHandle: handle, target: to.id }),
    );
    const branch = handles.length > 1 ? ` (${HANDLE_LABELS[handle] ?? handle})` : '';
    setAnnouncement(`Conectadas «${from.label}»${branch} y «${to.label}».`);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setDefinition((current) =>
      pendingDelete.kind === 'node'
        ? removeNodes(current, [pendingDelete.id])
        : removeEdges(current, [pendingDelete.id]),
    );
    setSelectedNodes(NO_SELECTION);
    setSelectedEdges(NO_SELECTION);
    setAnnouncement(`«${pendingDelete.name}» eliminada.`);
    setPendingDelete(undefined);
  };

  const onEditorKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && connectFrom !== undefined) {
      setConnectFrom(undefined);
      setAnnouncement('Conexión cancelada.');
      return;
    }
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>('.react-flow__node, .react-flow__edge');
    if (!item || item !== target) return;
    const id = item.getAttribute('data-id');
    if (!id) return;
    const isNode = item.classList.contains('react-flow__node');
    if (event.key === 'Enter' || event.key === ' ') {
      if (isNode && connectFrom !== undefined) {
        finishConnect(id);
      } else if (isNode && event.key === 'Enter' && selectedNodes.has(id)) {
        // Second Enter on a selected station: into its configuration.
        if (phone) setConfigOpen(true);
        else
          panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
      } else if (isNode) {
        setAnnouncement(`«${nameOf(id)}» seleccionada. Intro otra vez abre su configuración.`);
      }
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
      event.preventDefault();
      if (isNode) setPendingDelete({ kind: 'node', id, name: nameOf(id) });
      else {
        const found = definition.edges.find((edge) => edge.id === id);
        if (found) {
          setPendingDelete({
            kind: 'edge',
            id,
            name: `${nameOf(found.source)} → ${nameOf(found.target)}`,
          });
        }
      }
    }
  };

  const arrange = () => {
    setDefinition((current) => autoLayout(current, measured));
    requestAnimationFrame(() => void flow.fitView({ maxZoom: 1, duration: 200 }));
  };

  const exportJson = () => downloadDefinition(definition, exportFileName(workflow.name));

  const conflict =
    save.error instanceof ApiProblemError && save.error.problem.status === 409
      ? save.error
      : undefined;
  const publishBlock = dirty
    ? 'Guarda los cambios antes de publicar'
    : !result.valid
      ? 'Corrige los problemas antes de publicar'
      : unchanged
        ? 'No hay cambios desde la versión activa'
        : undefined;
  const canPublish =
    publishBlock === undefined && !validating && !save.isPending && !publish.isPending;

  return (
    <div
      onKeyDown={onEditorKeyDown}
      className="flex h-[calc(100dvh-var(--header-height)-var(--bottom-bar-height))] min-h-[32rem] w-full flex-col bg-ground md:h-[calc(100dvh-var(--header-height))]"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2">
        <Link
          to="/orgs/$organizationId/workflows"
          params={{ organizationId }}
          className="text-sm underline"
        >
          Workflows
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">{workflow.name}</h1>
            {readOnly && (
              <span className="shrink-0 rounded-station border px-2 py-0.5 text-xs font-medium">
                Solo lectura
              </span>
            )}
            {dirty && (
              <span className="shrink-0 rounded-station border border-line-strong bg-raised px-2 py-0.5 text-xs font-semibold text-ink">
                Sin guardar
              </span>
            )}
          </div>
          <p className="truncate text-xs text-ink-muted">
            {savedAt
              ? `Guardado a las ${savedAt.toLocaleTimeString('es')}`
              : `Último guardado: ${new Date(workflow.draftUpdatedAt).toLocaleString('es')}`}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-sm">
          {canWrite && (
            <Button
              variant="secondary"
              size="icon"
              disabled={definition.nodes.length === 0}
              onClick={arrange}
              aria-label="Ordenar"
              title="Ordenar: coloca los nodos en capas de izquierda a derecha, sin cambiar la lógica"
            >
              <Network aria-hidden />
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            onClick={exportJson}
            aria-label="Exportar JSON"
            title="Exportar JSON: descarga la definición como archivo"
          >
            <Download aria-hidden />
          </Button>
          {canWrite && (
            <Button asChild variant="secondary">
              <Link
                to="/orgs/$organizationId/workflows/new"
                params={{ organizationId }}
                search={{ workflowId }}
                title="Regenerar borrador: describe de nuevo el flujo y reemplaza el borrador tras revisar la vista previa"
              >
                <Sparkles aria-hidden />
                Regenerar borrador
              </Link>
            </Button>
          )}
          <RunButton
            showHistory
            organizationId={organizationId}
            workflowId={workflowId}
            workflowName={workflow.name}
          />
          {canWrite && (
            <>
              <Button
                variant="secondary"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate()}
              >
                <Save aria-hidden />
                Guardar
              </Button>
              <span title={publishBlock}>
                <Button
                  disabled={!canPublish}
                  onClick={() => {
                    publish.reset();
                    setPublishOpen(true);
                  }}
                >
                  <Send aria-hidden />
                  Publicar
                </Button>
              </span>
            </>
          )}
        </div>
      </div>

      {(save.isError || initial.skipped > 0) && (
        <div className="grid gap-2 px-4 py-2" role="status">
          {save.isError && <ProblemAlert error={save.error} />}
          {conflict && (
            <div>
              <Button variant="secondary" size="sm" onClick={onReload}>
                Recargar
              </Button>
              <span className="ml-2 text-sm text-ink-muted">
                Descarta tus cambios sin guardar y carga la última revisión.
              </span>
            </div>
          )}
          {initial.skipped > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                El borrador tenía {initial.skipped} elementos que el editor no reconoce y no se
                muestran.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {canWrite && !phone && <Palette onAdd={addFromPalette} />}

        <div
          ref={canvas}
          className="relative min-w-0 flex-1"
          onDragOver={(event) => {
            if (readOnly) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(event) => {
            if (readOnly) return;
            const type = event.dataTransfer.getData(PALETTE_DRAG_TYPE);
            if (!type) return;
            event.preventDefault();
            place(
              type as NodeType,
              flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
            );
          }}
        >
          <ReactFlow<FlowNode, FlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, clicked) => {
              if (connectFrom !== undefined) finishConnect(clicked.id);
            }}
            edgeTypes={EDGE_TYPES}
            className="station-canvas"
            ariaLabelConfig={CANVAS_ARIA_LABELS}
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ maxZoom: 1 }}
            minZoom={0.2}
            colorMode="system"
          >
            <Background />
            <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1 }} />
            <CanvasZoom />
            <Panel position="top-left" className="flex flex-wrap gap-2">
              {phone && canWrite && (
                <Button variant="secondary" onClick={() => setAddOpen(true)}>
                  <Plus aria-hidden />
                  Añadir nodo
                </Button>
              )}
              {canWrite && (
                <Button
                  variant={connectFrom === undefined ? 'secondary' : 'primary'}
                  aria-pressed={connectFrom !== undefined}
                  onClick={startConnect}
                >
                  <Cable aria-hidden />
                  Conectar
                </Button>
              )}
              {phone && (
                <Button
                  variant="secondary"
                  disabled={!selectedNode}
                  onClick={() => setConfigOpen(true)}
                >
                  <SlidersHorizontal aria-hidden />
                  Configurar
                </Button>
              )}
            </Panel>
          </ReactFlow>
        </div>

        {!phone && (
          <aside
            ref={panelRef}
            aria-label="Panel lateral"
            className="w-80 shrink-0 overflow-y-auto border-l border-line bg-surface"
          >
            <div role="tablist" className="flex border-b">
              {(
                [
                  ['node', 'Nodo'],
                  ['versions', 'Versiones'],
                ] as const
              ).map(([id, title]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex-1 border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-focus/50',
                    tab === id ? 'border-ink' : 'border-transparent text-ink-muted hover:text-ink',
                  )}
                >
                  {title}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="p-4">
              {tab === 'node' ? (
                selectedNode ? (
                  <>
                    <ConfigForm
                      key={selectedNode.id}
                      node={selectedNode}
                      definition={definition}
                      readOnly={readOnly}
                      errors={errors}
                      onChange={onNodeChange}
                      onRename={renameSelected}
                    />
                    {selectedNode.type === 'trigger.webhook' && (
                      <WebhookPanel
                        organizationId={organizationId}
                        workflowId={workflowId}
                        canWrite={canWrite}
                      />
                    )}
                    {selectedNode.type === 'trigger.schedule' && (
                      <ScheduleStatus organizationId={organizationId} workflowId={workflowId} />
                    )}
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">
                    Selecciona un nodo del lienzo para ver su configuración.
                  </p>
                )
              ) : (
                <VersionsPanel
                  organizationId={organizationId}
                  workflowId={workflowId}
                  canWrite={canWrite}
                  workflowName={workflow.name}
                  revision={revision}
                  onDraftReplaced={onDraftReplaced}
                  onReload={onReload}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      <div role="status" aria-label="Avisos del editor" className="sr-only">
        {announcement}
      </div>

      {phone && canWrite && (
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetContent aria-describedby={undefined}>
            <SheetTitle>Añadir nodo</SheetTitle>
            <Palette
              onAdd={(type) => {
                addFromPalette(type);
                setAddOpen(false);
              }}
            />
          </SheetContent>
        </Sheet>
      )}
      {phone && (
        <Sheet open={configOpen} onOpenChange={setConfigOpen}>
          <SheetContent>
            <SheetTitle>Configurar nodo</SheetTitle>
            <SheetDescription className="sr-only">
              Configuración del nodo seleccionado y versiones del workflow.
            </SheetDescription>
            <div ref={panelRef}>
              <div role="tablist" className="flex border-b">
                {(
                  [
                    ['node', 'Nodo'],
                    ['versions', 'Versiones'],
                  ] as const
                ).map(([id, title]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                    className={cn(
                      'flex-1 border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-focus/50',
                      tab === id
                        ? 'border-ink'
                        : 'border-transparent text-ink-muted hover:text-ink',
                    )}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <div role="tabpanel" className="p-4">
                {tab === 'node' ? (
                  selectedNode ? (
                    <>
                      <ConfigForm
                        key={selectedNode.id}
                        node={selectedNode}
                        definition={definition}
                        readOnly={readOnly}
                        errors={errors}
                        onChange={onNodeChange}
                        onRename={renameSelected}
                      />
                      {selectedNode.type === 'trigger.webhook' && (
                        <WebhookPanel
                          organizationId={organizationId}
                          workflowId={workflowId}
                          canWrite={canWrite}
                        />
                      )}
                      {selectedNode.type === 'trigger.schedule' && (
                        <ScheduleStatus organizationId={organizationId} workflowId={workflowId} />
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-ink-muted">
                      Selecciona un nodo del lienzo para ver su configuración.
                    </p>
                  )
                ) : (
                  <VersionsPanel
                    organizationId={organizationId}
                    workflowId={workflowId}
                    canWrite={canWrite}
                    workflowName={workflow.name}
                    revision={revision}
                    onDraftReplaced={onDraftReplaced}
                    onReload={onReload}
                  />
                )}
              </div>

              <Button className="mt-4 w-full" onClick={() => setConfigOpen(false)}>
                Listo
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      <Dialog
        open={pendingDelete !== undefined}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`¿Eliminar «${pendingDelete?.name ?? ''}»?`}</DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === 'node'
                ? 'Se elimina la estación y sus conexiones. Aún no se guarda: puedes recargar para descartar.'
                : 'Se elimina la conexión. Aún no se guarda.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPendingDelete(undefined)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProblemsList errors={result.errors} labels={labels} onSelectNode={selectNode} />

      {notice && <Toast message={notice} onClose={closeNotice} />}

      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>El borrador cambió en otra sesión</DialogTitle>
            <DialogDescription>
              Alguien guardó el borrador después de que lo abrieras, y tu guardado no se aplicó para
              no pisar su trabajo. Recarga para ver lo que guardó: perderás los cambios que no están
              guardados aquí. Si quieres conservarlos, exporta el JSON antes de recargar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={exportJson}>
              Exportar mis cambios
            </Button>
            <Button variant="secondary" onClick={() => setConflictOpen(false)}>
              Seguir editando
            </Button>
            <Button
              onClick={() => {
                setConflictOpen(false);
                onReload();
              }}
            >
              Recargar borrador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PublishDialog
        key={published}
        open={publishOpen}
        pending={publish.isPending}
        error={publish.error}
        onOpenChange={setPublishOpen}
        onPublish={(note) => publish.mutate(note)}
      />

      <Dialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hay cambios sin guardar</DialogTitle>
            <DialogDescription>
              Si sales ahora perderás los cambios sin guardar de este workflow.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              Seguir editando
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Salir sin guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
