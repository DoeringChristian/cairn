// Types mirroring the Cairn server's response shapes.
// Keep loose: these are what the frontend needs, not full schema validation.

export type RunStatus = "running" | "completed" | "failed" | "killed" | "archived";

export interface Health {
  status: string;
  version: string;
  uptime_sec: number;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  description: string | null;
  tags: string | null;
  run_count: number;
  active_run_count: number;
  last_run_at: string | null;
}

export interface Run {
  id: string;
  project_id: string;
  display_name: string | null;
  created_at: string;
  ended_at: string | null;
  status: RunStatus;
  exit_code: number | null;
  git_sha: string | null;
  git_dirty: boolean | null;
  git_branch: string | null;
  cli_args: string | null; // stored as JSON string
  env_snapshot: string | null; // JSON string
  hostname: string | null;
  user: string | null;
  tags: string | null; // JSON string
  notes: string | null;
}

export interface Param {
  key: string;
  value: string; // JSON string
  value_type: string;
}

export interface SequenceMeta {
  name: string;
  object_type: string;
  context: string | null;
  context_hash: string;
  min_step: number;
  max_step: number;
  count: number;
}

export interface SequencePoint {
  step: number;
  wall_time: string;
  scalar_value: number | null;
  artifact_hash: string | null;
  /** MIME type of the artifact (null for scalar rows). */
  artifact_mime?: string | null;
  /** Byte size of the artifact (null for scalar rows). */
  artifact_size?: number | null;
  /** JSON-stringified handler-specific metadata (null for scalar rows). */
  artifact_metadata?: string | null;
  context: string | null;
  object_type: string;
}

export interface SequenceResponse {
  run_id: string;
  name: string;
  points: SequencePoint[];
}

export interface RunDetailResponse {
  run: Run;
  params: Param[];
}

export interface RunsListResponse {
  runs: Run[];
  total: number;
  limit: number;
  offset: number;
}

export interface ArtifactSummary {
  name: string;
  hash: string;
  step: number | null;
  created_at?: string;
  mime_type: string;
  size_bytes: number;
  metadata: string | null;
  object_type?: string;
}

export interface ArtifactsResponse {
  named: ArtifactSummary[];
  from_sequences: ArtifactSummary[];
}

export interface LogLine {
  stream: "stdout" | "stderr";
  wall_time: string;
  line_no: number;
  content: string;
}

export interface LogsResponse {
  lines: LogLine[];
  total: number;
  offset: number;
  limit: number;
}

export interface SourceTreeFile {
  path: string;
  size: number;
  sha256: string;
}

export interface SourceTreeResponse {
  root: string;
  captured_at: string;
  files: SourceTreeFile[];
  skipped: Array<{ path: string; reason: string }>;
  marker?: string | null;
}

export interface SourceFileResponse {
  path: string;
  encoding: "utf-8" | "base64";
  content: string;
}

export interface ArtifactFamily {
  id: string;
  project_id: string;
  name: string;
  type: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  latest_version: number | null;
  total_versions: number;
  total_size_bytes: number;
  aliases: Array<{ alias: string; version: number }>;
}

export interface ArtifactVersionInfo {
  id: string;
  family_id: string;
  version: number;
  hash: string;
  size_bytes: number;
  metadata: string | null;
  created_at: string;
  created_by_run: string | null;
}

export interface ArtifactFamilyDetail extends ArtifactFamily {
  versions: ArtifactVersionInfo[];
}

export interface LineageNode {
  id: string;
  type: "artifact_version" | "run";
  label: string;
  metadata: Record<string, unknown>;
}

export interface LineageEdge {
  source: string;
  target: string;
  type: "produced" | "consumed";
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface RunArtifactInput {
  artifact_version_id: string;
  family_id: string;
  family_name: string;
  version: number;
  role: string | null;
}

export interface RunArtifactOutput {
  artifact_version_id: string;
  family_id: string;
  family_name: string;
  version: number;
}
