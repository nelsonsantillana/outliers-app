import { env } from "cloudflare:workers";

const API_BASE_URL = "https://api.assembledhq.com/v0";
const API_VERSION = "2025-04-15";
const DIRECTORY_CACHE_MS = 5 * 60 * 1000;
const MAX_PEOPLE_PAGES = 20;
const MAX_STATE_PAGES = 50;

export type DirectoryAgent = {
  id: string;
  agentId: string;
  name: string;
  teamIds: string[];
  queueIds: string[];
};

export type DirectoryOption = {
  id: string;
  name: string;
};

export type DirectoryActivityType = DirectoryOption & {
  value: string;
  shortName: string;
  importId: string;
  productive: boolean;
  timeoff: boolean;
};

export type DirectoryData = {
  agents: DirectoryAgent[];
  teams: DirectoryOption[];
  queues: DirectoryOption[];
  auxiliaries: DirectoryActivityType[];
  loadedAt: string;
};

export type ReportInterval = {
  start: string;
  end: string;
  durationSeconds: number;
};

export type ActualSession = ReportInterval & {
  states: string[];
  platforms: string[];
};

export type AuxiliaryReport = {
  agent: DirectoryAgent;
  auxiliary: DirectoryActivityType;
  start: string;
  end: string;
  scheduledTimeSeconds: number;
  actualTimeSeconds: number;
  timesUsed: number;
  averageTimeSeconds: number;
  longestTimeSeconds: number;
  scheduledBlocks: ReportInterval[];
  sessions: ActualSession[];
  unmatchedStates: string[];
  generatedAt: string;
};

type AssembledPerson = {
  id?: string;
  agent_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  teams?: string[];
  queues?: string[];
  deleted?: boolean;
  staffable?: boolean;
};

type AssembledFilter = {
  id?: string;
  name?: string;
};

type AssembledActivityType = AssembledFilter & {
  value?: string;
  short_name?: string;
  import_id?: string | null;
  productive?: boolean;
  timeoff?: boolean;
};

type AssembledActivity = {
  id?: string;
  id_with_timestamps?: string;
  agent_id?: string;
  type_id?: string;
  start_time?: number;
  end_time?: number;
};

type AssembledAgentState = {
  platform?: string;
  start_time?: number;
  end_time?: number;
  state?: string;
  external_id?: string;
  type_id?: string;
  activity_type_id?: string;
  activity_type?: string | { id?: string; name?: string; value?: string };
};

type PeopleResponse = {
  people?: Record<string, AssembledPerson> | AssembledPerson[];
  total?: number;
};

type FiltersResponse = {
  teams?: Record<string, AssembledFilter> | AssembledFilter[];
  queues?: Record<string, AssembledFilter> | AssembledFilter[];
  activity_types?:
    | Record<string, AssembledActivityType>
    | AssembledActivityType[];
};

type ActivitiesResponse = {
  activities?: Record<string, AssembledActivity> | AssembledActivity[];
};

type StatesResponse = {
  agent_states?: AssembledAgentState[];
  next_page_token?: string;
};

type CachedDirectory = {
  value: DirectoryData;
  expiresAt: number;
};

let directoryCache: CachedDirectory | null = null;

export class AssembledError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = "ASSEMBLED_ERROR") {
    super(message);
    this.name = "AssembledError";
    this.status = status;
    this.code = code;
  }
}

function getApiKey() {
  const key = env.ASSEMBLED_API_KEY?.trim();

  if (!key) {
    throw new AssembledError(
      "The Assembled connection has not been configured yet.",
      503,
      "ASSEMBLED_NOT_CONFIGURED",
    );
  }

  if (!key.startsWith("sk_live_")) {
    throw new AssembledError(
      "The configured Assembled API key has an unexpected format.",
      503,
      "ASSEMBLED_KEY_INVALID",
    );
  }

  return key;
}

function valuesOf<T>(value: Record<string, T> | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

async function assembledGet<T>(
  path: string,
  parameters: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);

  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`${getApiKey()}:`)}`,
      "API-Version": API_VERSION,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new AssembledError(
        "Assembled rejected the API key. Confirm the key is active and try again.",
        502,
        "ASSEMBLED_UNAUTHORIZED",
      );
    }

    if (response.status === 403) {
      throw new AssembledError(
        "This Assembled API key does not have access to the requested data.",
        502,
        "ASSEMBLED_FORBIDDEN",
      );
    }

    if (response.status === 429) {
      throw new AssembledError(
        "Assembled is receiving too many requests. Wait a moment and try again.",
        503,
        "ASSEMBLED_RATE_LIMITED",
      );
    }

    let detail = "";
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      detail = body.error ?? body.message ?? "";
    } catch {
      detail = "";
    }

    throw new AssembledError(
      detail
        ? `Assembled could not complete the request: ${detail}`
        : `Assembled could not complete the request (${response.status}).`,
      502,
      "ASSEMBLED_REQUEST_FAILED",
    );
  }

  return (await response.json()) as T;
}

async function getAllPeople() {
  const people: AssembledPerson[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PEOPLE_PAGES; page += 1) {
    const response = await assembledGet<PeopleResponse>("/people", {
      limit: 500,
      offset,
      sort_by: "first_name",
      sort_direction: "ascending",
    });
    const batch = valuesOf(response.people);
    people.push(...batch);
    offset += batch.length;

    if (
      batch.length === 0 ||
      batch.length < 500 ||
      (typeof response.total === "number" && offset >= response.total)
    ) {
      break;
    }
  }

  return people;
}

function nameForPerson(person: AssembledPerson) {
  const fullName = [person.first_name, person.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || person.email?.trim() || "Unnamed agent";
}

function mapFilterOptions(filters: AssembledFilter[]) {
  return filters
    .filter((item): item is Required<Pick<AssembledFilter, "id" | "name">> =>
      Boolean(item.id && item.name),
    )
    .map((item) => ({ id: item.id, name: item.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getDirectory(forceRefresh = false): Promise<DirectoryData> {
  if (!forceRefresh && directoryCache && directoryCache.expiresAt > Date.now()) {
    return directoryCache.value;
  }

  const [people, teamsResponse, queuesResponse, activityTypesResponse] =
    await Promise.all([
      getAllPeople(),
      assembledGet<FiltersResponse>("/teams"),
      assembledGet<FiltersResponse>("/queues"),
      assembledGet<FiltersResponse>("/activity_types"),
    ]);

  const agents = people
    .filter(
      (person) =>
        !person.deleted &&
        person.staffable !== false &&
        Boolean(person.agent_id || person.id),
    )
    .map((person) => ({
      id: person.id ?? person.agent_id ?? "",
      agentId: person.agent_id ?? person.id ?? "",
      name: nameForPerson(person),
      teamIds: person.teams ?? [],
      queueIds: person.queues ?? [],
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const allActivityTypes = valuesOf(activityTypesResponse.activity_types)
    .filter(
      (item): item is AssembledActivityType & { id: string; name: string } =>
        Boolean(item.id && item.name),
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      value: item.value ?? "",
      shortName: item.short_name ?? "",
      importId: item.import_id ?? "",
      productive: Boolean(item.productive),
      timeoff: Boolean(item.timeoff),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const nonProductive = allActivityTypes.filter(
    (activityType) => !activityType.productive && !activityType.timeoff,
  );

  const value: DirectoryData = {
    agents,
    teams: mapFilterOptions(valuesOf(teamsResponse.teams)),
    queues: mapFilterOptions(valuesOf(queuesResponse.queues)),
    auxiliaries: nonProductive.length > 0 ? nonProductive : allActivityTypes,
    loadedAt: new Date().toISOString(),
  };

  directoryCache = {
    value,
    expiresAt: Date.now() + DIRECTORY_CACHE_MS,
  };

  return value;
}

function normalizeLabel(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function configuredAliases(activityType: DirectoryActivityType) {
  const raw = env.ASSEMBLED_AUX_STATE_ALIASES?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const candidates = [activityType.id, activityType.name, activityType.value];
    for (const candidate of candidates) {
      const aliases = parsed[candidate];
      if (Array.isArray(aliases)) {
        return aliases.filter((alias): alias is string => typeof alias === "string");
      }
    }
  } catch {
    return [];
  }

  return [];
}

function stateMatchesActivityType(
  state: AssembledAgentState,
  activityType: DirectoryActivityType,
) {
  if (
    state.type_id === activityType.id ||
    state.activity_type_id === activityType.id
  ) {
    return true;
  }

  if (typeof state.activity_type === "object" && state.activity_type) {
    if (state.activity_type.id === activityType.id) return true;
  }

  const stateLabels = [
    state.state,
    typeof state.activity_type === "string" ? state.activity_type : undefined,
    typeof state.activity_type === "object" ? state.activity_type?.name : undefined,
    typeof state.activity_type === "object" ? state.activity_type?.value : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeLabel)
    .filter(Boolean);

  const exactKeys = [
    activityType.name,
    activityType.value,
    activityType.importId,
    ...configuredAliases(activityType),
  ]
    .map(normalizeLabel)
    .filter((value) => value.length >= 3);

  if (stateLabels.some((label) => exactKeys.includes(label))) return true;

  const activityName = normalizeLabel(activityType.name);
  if (activityName.length < 6) return false;

  return stateLabels.some(
    (label) =>
      label.startsWith(`${activityName} `) ||
      label.endsWith(` ${activityName}`) ||
      activityName.startsWith(`${label} `) ||
      activityName.endsWith(` ${label}`),
  );
}

function clipInterval(
  startTime: number | undefined,
  endTime: number | undefined,
  rangeStart: number,
  rangeEnd: number,
): ReportInterval | null {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  const start = Math.max(startTime ?? 0, rangeStart);
  const end = Math.min(endTime ?? 0, rangeEnd);
  if (end <= start) return null;

  return {
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
    durationSeconds: end - start,
  };
}

function mergeActualSessions(
  states: AssembledAgentState[],
  activityType: DirectoryActivityType,
  rangeStart: number,
  rangeEnd: number,
) {
  const matching = states
    .filter((state) => stateMatchesActivityType(state, activityType))
    .map((state) => {
      const interval = clipInterval(
        state.start_time,
        state.end_time,
        rangeStart,
        rangeEnd,
      );
      if (!interval) return null;
      return {
        startSeconds: Date.parse(interval.start) / 1000,
        endSeconds: Date.parse(interval.end) / 1000,
        states: new Set(state.state ? [state.state] : []),
        platforms: new Set(state.platform ? [state.platform] : []),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => left.startSeconds - right.startSeconds);

  const merged: typeof matching = [];

  matching.forEach((interval) => {
    const previous = merged.at(-1);
    if (previous && interval.startSeconds <= previous.endSeconds + 1) {
      previous.endSeconds = Math.max(previous.endSeconds, interval.endSeconds);
      interval.states.forEach((state) => previous.states.add(state));
      interval.platforms.forEach((platform) => previous.platforms.add(platform));
      return;
    }
    merged.push(interval);
  });

  return merged.map((interval): ActualSession => ({
    start: new Date(interval.startSeconds * 1000).toISOString(),
    end: new Date(interval.endSeconds * 1000).toISOString(),
    durationSeconds: interval.endSeconds - interval.startSeconds,
    states: [...interval.states].sort(),
    platforms: [...interval.platforms].sort(),
  }));
}

async function getAgentStates(
  agentId: string,
  startTime: number,
  endTime: number,
) {
  const states: AssembledAgentState[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_STATE_PAGES; page += 1) {
    const response = await assembledGet<StatesResponse>(
      `/agents/states/${encodeURIComponent(agentId)}`,
      {
        start_time: startTime,
        end_time: endTime,
        limit: 10000,
        page_token: pageToken,
      },
    );
    states.push(...(response.agent_states ?? []));
    pageToken = response.next_page_token;
    if (!pageToken) break;
  }

  return states;
}

export async function getAuxiliaryReport(input: {
  agentId: string;
  activityTypeId: string;
  start: string;
  end: string;
  teamId?: string;
  queueId?: string;
}): Promise<AuxiliaryReport> {
  const startMilliseconds = Date.parse(input.start);
  const endMilliseconds = Date.parse(input.end);

  if (!Number.isFinite(startMilliseconds) || !Number.isFinite(endMilliseconds)) {
    throw new AssembledError(
      "Choose a valid start and end date and time.",
      400,
      "INVALID_TIME_RANGE",
    );
  }

  if (endMilliseconds <= startMilliseconds) {
    throw new AssembledError(
      "The end date and time must be later than the start.",
      400,
      "INVALID_TIME_RANGE",
    );
  }

  const rangeSeconds = Math.ceil((endMilliseconds - startMilliseconds) / 1000);
  if (rangeSeconds > 62 * 24 * 60 * 60) {
    throw new AssembledError(
      "The selected time range cannot be longer than 62 days.",
      400,
      "TIME_RANGE_TOO_LONG",
    );
  }

  const directory = await getDirectory();
  const agent = directory.agents.find((item) => item.agentId === input.agentId);
  const auxiliary = directory.auxiliaries.find(
    (item) => item.id === input.activityTypeId,
  );

  if (!agent || !auxiliary) {
    throw new AssembledError(
      "The selected agent or auxiliary is no longer available.",
      400,
      "SELECTION_NOT_FOUND",
    );
  }

  if (input.teamId && input.teamId !== "all" && !agent.teamIds.includes(input.teamId)) {
    throw new AssembledError(
      "The selected agent is not assigned to that team.",
      400,
      "AGENT_FILTER_MISMATCH",
    );
  }

  if (
    input.queueId &&
    input.queueId !== "all" &&
    !agent.queueIds.includes(input.queueId)
  ) {
    throw new AssembledError(
      "The selected agent is not assigned to that queue.",
      400,
      "AGENT_FILTER_MISMATCH",
    );
  }

  const startTime = Math.floor(startMilliseconds / 1000);
  const endTime = Math.ceil(endMilliseconds / 1000);
  const [activitiesResponse, states] = await Promise.all([
    assembledGet<ActivitiesResponse>("/activities", {
      start_time: startTime,
      end_time: endTime,
      agents: agent.agentId,
      types: auxiliary.id,
      return_full_schedule: false,
    }),
    getAgentStates(agent.agentId, startTime, endTime),
  ]);

  const scheduledBlocks = valuesOf(activitiesResponse.activities)
    .filter(
      (activity) =>
        activity.agent_id === agent.agentId && activity.type_id === auxiliary.id,
    )
    .map((activity) =>
      clipInterval(activity.start_time, activity.end_time, startTime, endTime),
    )
    .filter((interval): interval is ReportInterval => Boolean(interval))
    .sort((left, right) => left.start.localeCompare(right.start));

  const sessions = mergeActualSessions(states, auxiliary, startTime, endTime);
  const scheduledTimeSeconds = scheduledBlocks.reduce(
    (total, interval) => total + interval.durationSeconds,
    0,
  );
  const actualTimeSeconds = sessions.reduce(
    (total, session) => total + session.durationSeconds,
    0,
  );
  const stateTotals = new Map<string, number>();

  states.forEach((state) => {
    if (!state.state || stateMatchesActivityType(state, auxiliary)) return;
    const interval = clipInterval(state.start_time, state.end_time, startTime, endTime);
    if (!interval) return;
    stateTotals.set(
      state.state,
      (stateTotals.get(state.state) ?? 0) + interval.durationSeconds,
    );
  });

  const unmatchedStates = [...stateTotals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([state]) => state);

  return {
    agent,
    auxiliary,
    start: new Date(startMilliseconds).toISOString(),
    end: new Date(endMilliseconds).toISOString(),
    scheduledTimeSeconds,
    actualTimeSeconds,
    timesUsed: sessions.length,
    averageTimeSeconds: sessions.length > 0 ? Math.round(actualTimeSeconds / sessions.length) : 0,
    longestTimeSeconds: sessions.reduce(
      (longest, session) => Math.max(longest, session.durationSeconds),
      0,
    ),
    scheduledBlocks,
    sessions,
    unmatchedStates,
    generatedAt: new Date().toISOString(),
  };
}
