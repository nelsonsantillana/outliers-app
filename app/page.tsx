"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Layers3,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Search,
  TimerReset,
  UserRound,
  Users,
  Wifi,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ActualSession,
  AuxiliaryReport,
  DirectoryAgent,
  DirectoryData,
  ReportInterval,
} from "@/lib/assembled";

type ApiError = {
  error?: string;
  code?: string;
};

type DailyRow = {
  key: string;
  date: Date;
  actualSeconds: number;
  scheduledSeconds: number;
};

const ALL_FILTERS = "all";

function toDateTimeInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createDefaultRange() {
  const end = new Date();
  end.setSeconds(0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return {
    start: toDateTimeInputValue(start),
    end: toDateTimeInputValue(end),
  };
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatCompactDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatPlatform(platform: string) {
  return platform
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function localDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function addIntervalToDays(
  totals: Map<string, { date: Date; seconds: number }>,
  interval: ReportInterval,
) {
  let cursor = new Date(interval.start);
  const end = new Date(interval.end);

  while (cursor < end) {
    const key = localDateKey(cursor);
    const nextDay = new Date(cursor);
    nextDay.setHours(24, 0, 0, 0);
    const segmentEnd = nextDay < end ? nextDay : end;
    const seconds = Math.max(0, (segmentEnd.getTime() - cursor.getTime()) / 1000);
    const previous = totals.get(key);
    totals.set(key, {
      date: new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 12),
      seconds: (previous?.seconds ?? 0) + seconds,
    });
    cursor = segmentEnd;
  }
}

function buildDailyRows(report: AuxiliaryReport | null): DailyRow[] {
  if (!report) return [];
  const actualTotals = new Map<string, { date: Date; seconds: number }>();
  const scheduledTotals = new Map<string, { date: Date; seconds: number }>();
  report.sessions.forEach((session) => addIntervalToDays(actualTotals, session));
  report.scheduledBlocks.forEach((block) => addIntervalToDays(scheduledTotals, block));

  return [...new Set([...actualTotals.keys(), ...scheduledTotals.keys()])]
    .sort()
    .map((key) => ({
      key,
      date: actualTotals.get(key)?.date ?? scheduledTotals.get(key)!.date,
      actualSeconds: actualTotals.get(key)?.seconds ?? 0,
      scheduledSeconds: scheduledTotals.get(key)?.seconds ?? 0,
    }))
    .slice(-14);
}

function FilterLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="filter-label">
      {icon}
      {children}
    </span>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "teal" | "blue" | "navy";
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon metric-icon-${tone}`} aria-hidden="true">
        {icon}
      </span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

export default function Home() {
  const [directory, setDirectory] = useState<DirectoryData | null>(null);
  const [directoryError, setDirectoryError] = useState<ApiError | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [teamId, setTeamId] = useState(ALL_FILTERS);
  const [queueId, setQueueId] = useState(ALL_FILTERS);
  const [agentId, setAgentId] = useState("");
  const [activityTypeId, setActivityTypeId] = useState("");
  const [startValue, setStartValue] = useState("");
  const [endValue, setEndValue] = useState("");
  const [report, setReport] = useState<AuxiliaryReport | null>(null);
  const [reportError, setReportError] = useState<ApiError | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const reportAbortController = useRef<AbortController | null>(null);
  const lastRequestKey = useRef("");

  useEffect(() => {
    const range = createDefaultRange();
    setStartValue(range.start);
    setEndValue(range.end);
  }, []);

  const loadDirectory = useCallback(async (refresh = false) => {
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const response = await fetch(`/api/bootstrap${refresh ? "?refresh=true" : ""}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as DirectoryData & ApiError;
      if (!response.ok) throw body;
      setDirectory(body);
      setAgentId((current) =>
        body.agents.some((agent) => agent.agentId === current)
          ? current
          : (body.agents[0]?.agentId ?? ""),
      );
      setActivityTypeId((current) => {
        if (body.auxiliaries.some((item) => item.id === current)) return current;
        const preferred = body.auxiliaries.find((item) =>
          item.name.toLowerCase().includes("bio break"),
        );
        return preferred?.id ?? body.auxiliaries[0]?.id ?? "";
      });
    } catch (error) {
      const apiError = error as ApiError;
      setDirectory(null);
      setDirectoryError({
        error: apiError.error ?? "The Assembled directory could not be loaded.",
        code: apiError.code,
      });
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const visibleAgents = useMemo(() => {
    if (!directory) return [];
    return directory.agents.filter((agent) => {
      const teamMatches = teamId === ALL_FILTERS || agent.teamIds.includes(teamId);
      const queueMatches = queueId === ALL_FILTERS || agent.queueIds.includes(queueId);
      return teamMatches && queueMatches;
    });
  }, [directory, queueId, teamId]);

  useEffect(() => {
    if (visibleAgents.length === 0) {
      setAgentId("");
      return;
    }
    if (!visibleAgents.some((agent) => agent.agentId === agentId)) {
      setAgentId(visibleAgents[0].agentId);
    }
  }, [agentId, visibleAgents]);

  const runReport = useCallback(
    async (force = false) => {
      if (!agentId || !activityTypeId || !startValue || !endValue) return;

      const startDate = new Date(startValue);
      const endDate = new Date(endValue);
      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime()) ||
        startDate >= endDate
      ) {
        setReportError({ error: "The end date and time must be later than the start." });
        return;
      }

      const requestBody = {
        agentId,
        activityTypeId,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        teamId,
        queueId,
      };
      const requestKey = JSON.stringify(requestBody);
      if (!force && requestKey === lastRequestKey.current) return;
      lastRequestKey.current = requestKey;

      reportAbortController.current?.abort();
      const controller = new AbortController();
      reportAbortController.current = controller;
      setReportLoading(true);
      setReportError(null);

      try {
        const response = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: requestKey,
          signal: controller.signal,
        });
        const body = (await response.json()) as AuxiliaryReport & ApiError;
        if (!response.ok) throw body;
        setReport(body);
      } catch (error) {
        if (controller.signal.aborted) return;
        const apiError = error as ApiError;
        setReport(null);
        setReportError({
          error: apiError.error ?? "The auxiliary report could not be calculated.",
          code: apiError.code,
        });
      } finally {
        if (!controller.signal.aborted) setReportLoading(false);
      }
    }, [activityTypeId, agentId, endValue, queueId, startValue, teamId],
  );

  useEffect(() => {
    if (!directory || directoryError) return;
    const timer = window.setTimeout(() => void runReport(), 650);
    return () => window.clearTimeout(timer);
  }, [directory, directoryError, runReport]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runReport(true);
  };

  const resetFilters = () => {
    const range = createDefaultRange();
    setTeamId(ALL_FILTERS);
    setQueueId(ALL_FILTERS);
    setAgentId(directory?.agents[0]?.agentId ?? "");
    const preferred = directory?.auxiliaries.find((item) =>
      item.name.toLowerCase().includes("bio break"),
    );
    setActivityTypeId(preferred?.id ?? directory?.auxiliaries[0]?.id ?? "");
    setStartValue(range.start);
    setEndValue(range.end);
    lastRequestKey.current = "";
  };

  const selectedTeam = directory?.teams.find((team) => team.id === teamId)?.name;
  const selectedQueue = directory?.queues.find((queue) => queue.id === queueId)?.name;
  const dailyRows = useMemo(() => buildDailyRows(report), [report]);
  const dailyMaximum = Math.max(
    1,
    ...dailyRows.flatMap((row) => [row.actualSeconds, row.scheduledSeconds]),
  );
  const comparisonMaximum = Math.max(
    1,
    report?.actualTimeSeconds ?? 0,
    report?.scheduledTimeSeconds ?? 0,
  );
  const dateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [],
  );
  const dayFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }),
    [],
  );
  const sessionDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [],
  );
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }),
    [],
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#report-workspace">
        Skip to report
      </a>

      <aside className="sidebar" aria-label="Application navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Activity />
          </span>
          <span>
            <strong>Outlier</strong>
            <small>WFM reports</small>
          </span>
        </div>

        <nav className="primary-nav" aria-label="Report areas">
          <a className="nav-item nav-item-active" href="#report-workspace" aria-current="page">
            <BarChart3 />
            Auxiliary usage
          </a>
          <span className="nav-item nav-item-disabled" aria-disabled="true">
            <Activity />
            Trend analysis
            <small>Stage 2</small>
          </span>
          <span className="nav-item nav-item-disabled" aria-disabled="true">
            <ListChecks />
            Saved reports
            <small>Later</small>
          </span>
        </nav>

        <div className={`connection-card ${directoryError ? "connection-card-error" : ""}`}>
          <span className="connection-title">
            {directoryLoading ? (
              <RefreshCw className="spin" />
            ) : directoryError ? (
              <AlertTriangle />
            ) : (
              <Wifi />
            )}
            {directoryLoading
              ? "Connecting…"
              : directoryError
                ? "Setup required"
                : "Assembled connected"}
          </span>
          <small>
            {directoryError
              ? "Add the private API key to continue."
              : directory
                ? `${directory.agents.length} staffable agents available`
                : "Loading your WFM directory"}
          </small>
        </div>
      </aside>

      <main className="main-content" id="report-workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">WORKFORCE MANAGEMENT · STAGE 1</p>
            <h1>Auxiliary usage</h1>
            <p className="page-intro">
              Compare an agent&apos;s scheduled auxiliary time with their actual usage in Assembled.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="refresh-button"
            disabled={directoryLoading}
            onClick={() => void loadDirectory(true)}
          >
            <RefreshCw className={directoryLoading ? "spin" : ""} />
            Refresh data
          </Button>
        </header>

        {directoryError ? (
          <section className="setup-panel" role="alert">
            <span className="setup-icon"><AlertTriangle /></span>
            <div>
              <h2>Assembled is ready to connect</h2>
              <p>{directoryError.error}</p>
              <p className="setup-code">
                Store the key as <code>ASSEMBLED_API_KEY</code>, then refresh this page.
              </p>
            </div>
          </section>
        ) : null}

        <section className="panel filter-panel" aria-labelledby="filters-title">
          <div className="section-heading">
            <div>
              <h2 id="filters-title">Build your report</h2>
              <p>Filters update the results automatically once every required field is selected.</p>
            </div>
            <span className="live-pill">
              <span aria-hidden="true" />
              Live Assembled data
            </span>
          </div>

          {directoryLoading ? (
            <div className="filter-skeleton" aria-label="Loading report filters">
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <div key={item}>
                  <Skeleton className="mb-2 h-4 w-24" />
                  <Skeleton className="h-11 w-full rounded-[10px]" />
                </div>
              ))}
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="filter-grid">
                <div className="field">
                  <FilterLabel icon={<Users />}>Team</FilterLabel>
                  <Select value={teamId} onValueChange={setTeamId} disabled={!directory}>
                    <SelectTrigger className="filter-control" aria-label="Team">
                      <SelectValue placeholder="Select team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTERS}>All teams</SelectItem>
                      {directory?.teams.map((team) => (
                        <SelectItem value={team.id} key={team.id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="field">
                  <FilterLabel icon={<Layers3 />}>Queue assignment</FilterLabel>
                  <Select value={queueId} onValueChange={setQueueId} disabled={!directory}>
                    <SelectTrigger className="filter-control" aria-label="Queue assignment">
                      <SelectValue placeholder="Select queue" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_FILTERS}>All queues</SelectItem>
                      {directory?.queues.map((queue) => (
                        <SelectItem value={queue.id} key={queue.id}>{queue.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="field">
                  <FilterLabel icon={<UserRound />}>Agent name</FilterLabel>
                  <Select value={agentId} onValueChange={setAgentId} disabled={visibleAgents.length === 0}>
                    <SelectTrigger className="filter-control" aria-label="Agent name">
                      <SelectValue placeholder={visibleAgents.length === 0 ? "No matching agents" : "Select agent"} />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleAgents.map((agent: DirectoryAgent) => (
                        <SelectItem value={agent.agentId} key={agent.agentId}>{agent.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="field">
                  <FilterLabel icon={<Clock3 />}>Auxiliary of interest</FilterLabel>
                  <Select value={activityTypeId} onValueChange={setActivityTypeId} disabled={!directory}>
                    <SelectTrigger className="filter-control" aria-label="Auxiliary of interest">
                      <SelectValue placeholder="Select auxiliary" />
                    </SelectTrigger>
                    <SelectContent>
                      {directory?.auxiliaries.map((activityType) => (
                        <SelectItem value={activityType.id} key={activityType.id}>
                          {activityType.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="field field-time">
                  <FilterLabel icon={<CalendarDays />}>From</FilterLabel>
                  <Input
                    type="datetime-local"
                    className="filter-control"
                    value={startValue}
                    max={endValue || undefined}
                    onChange={(event) => setStartValue(event.target.value)}
                    aria-label="Start date and time"
                    required
                  />
                </div>

                <div className="field field-time">
                  <FilterLabel icon={<CalendarDays />}>To</FilterLabel>
                  <Input
                    type="datetime-local"
                    className="filter-control"
                    value={endValue}
                    min={startValue || undefined}
                    onChange={(event) => setEndValue(event.target.value)}
                    aria-label="End date and time"
                    required
                  />
                </div>
              </div>

              <div className="filter-footer">
                <p>
                  Team and queue narrow the agent list using current assignments. Reports can cover up to 62 days.
                </p>
                <div className="filter-actions">
                  <Button type="button" variant="outline" onClick={resetFilters}>
                    <RotateCcw /> Reset
                  </Button>
                  <Button type="submit" className="run-button" disabled={!agentId || !activityTypeId || reportLoading}>
                    {reportLoading ? <RefreshCw className="spin" /> : <Search />}
                    {reportLoading ? "Updating…" : "Run report"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </section>

        {reportError ? (
          <div className="report-error" role="alert">
            <AlertTriangle />
            <span>{reportError.error}</span>
          </div>
        ) : null}

        <section className="results-section" aria-labelledby="results-title" aria-busy={reportLoading}>
          <div className="results-heading">
            <div>
              <div className="results-title-row">
                <h2 id="results-title">Report results</h2>
                {report ? (
                  <span className="calculated-pill"><CheckCircle2 /> Calculated</span>
                ) : null}
              </div>
              <p>
                {report
                  ? `${report.agent.name} · ${report.auxiliary.name}${selectedTeam ? ` · ${selectedTeam}` : ""}${selectedQueue ? ` · ${selectedQueue}` : ""}`
                  : "Choose your filters to calculate the auxiliary report."}
              </p>
            </div>
            {report ? (
              <time dateTime={report.generatedAt}>
                {dateTimeFormatter.format(new Date(report.start))} – {dateTimeFormatter.format(new Date(report.end))}
              </time>
            ) : null}
          </div>

          <div className="metric-grid" aria-live="polite">
            <MetricCard
              icon={<CalendarDays />}
              label="Scheduled time"
              value={report ? formatDuration(report.scheduledTimeSeconds) : "—"}
              detail={report ? `${report.scheduledBlocks.length} scheduled block${report.scheduledBlocks.length === 1 ? "" : "s"}` : "Selected auxiliary"}
              tone="navy"
            />
            <MetricCard
              icon={<ListChecks />}
              label="Times used"
              value={report ? String(report.timesUsed) : "—"}
              detail="Distinct actual sessions"
              tone="blue"
            />
            <MetricCard
              icon={<TimerReset />}
              label="Time accumulated"
              value={report ? formatDuration(report.actualTimeSeconds) : "—"}
              detail={report ? `Average ${formatDuration(report.averageTimeSeconds)} per use` : "Actual auxiliary time"}
              tone="teal"
            />
          </div>
        </section>

        {report && report.timesUsed === 0 && report.unmatchedStates.length > 0 ? (
          <aside className="mapping-note" role="status">
            <AlertTriangle />
            <div>
              <strong>No actual state matched “{report.auxiliary.name}”.</strong>
              <p>
                Assembled returned these state names in the same period: {report.unmatchedStates.join(", ")}.
                If your upstream label is different, it can be added as a secure alias.
              </p>
            </div>
          </aside>
        ) : null}

        <section className="insight-grid">
          <article className="panel comparison-panel" aria-labelledby="comparison-title">
            <div className="section-heading compact-heading">
              <div>
                <h2 id="comparison-title">Scheduled vs. actual</h2>
                <p>Direct comparison for the selected auxiliary</p>
              </div>
            </div>
            {report ? (
              <div className="comparison-bars">
                <div className="comparison-row">
                  <span>Scheduled</span>
                  <div className="bar-track"><span className="bar scheduled-bar" style={{ width: `${(report.scheduledTimeSeconds / comparisonMaximum) * 100}%` }} /></div>
                  <strong>{formatDuration(report.scheduledTimeSeconds)}</strong>
                </div>
                <div className="comparison-row">
                  <span>Actual</span>
                  <div className="bar-track"><span className="bar actual-bar" style={{ width: `${(report.actualTimeSeconds / comparisonMaximum) * 100}%` }} /></div>
                  <strong>{formatDuration(report.actualTimeSeconds)}</strong>
                </div>
                <div className="variance-line">
                  <span>Difference</span>
                  <strong className={report.actualTimeSeconds > report.scheduledTimeSeconds ? "variance-over" : ""}>
                    {report.actualTimeSeconds >= report.scheduledTimeSeconds ? "+" : "−"}
                    {formatDuration(Math.abs(report.actualTimeSeconds - report.scheduledTimeSeconds))}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="panel-empty"><BarChart3 /><p>Your comparison will appear here.</p></div>
            )}
          </article>

          <article className="panel daily-panel" aria-labelledby="daily-title">
            <div className="section-heading compact-heading">
              <div>
                <h2 id="daily-title">Daily auxiliary time</h2>
                <p>{dailyRows.length > 0 ? "Last 14 active days in the selected range" : "Scheduled and actual time by day"}</p>
              </div>
              <div className="chart-legend"><span className="legend-scheduled" />Scheduled <span className="legend-actual" />Actual</div>
            </div>
            {dailyRows.length > 0 ? (
              <div className="daily-chart">
                {dailyRows.map((row) => (
                  <div className="daily-row" key={row.key}>
                    <span>{dayFormatter.format(row.date)}</span>
                    <div className="daily-tracks">
                      <div className="daily-track"><span className="daily-scheduled" style={{ width: `${Math.max(row.scheduledSeconds ? 2 : 0, (row.scheduledSeconds / dailyMaximum) * 100)}%` }} /></div>
                      <div className="daily-track"><span className="daily-actual" style={{ width: `${Math.max(row.actualSeconds ? 2 : 0, (row.actualSeconds / dailyMaximum) * 100)}%` }} /></div>
                    </div>
                    <strong>{formatCompactDuration(row.actualSeconds)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="panel-empty"><Activity /><p>No daily activity to display.</p></div>
            )}
          </article>
        </section>

        <section className="panel sessions-panel" aria-labelledby="sessions-title">
          <div className="section-heading table-heading">
            <div>
              <h2 id="sessions-title">Actual auxiliary sessions</h2>
              <p>
                {report
                  ? `${report.sessions.length} matched session${report.sessions.length === 1 ? "" : "s"}`
                  : "A detailed log will appear after the report runs."}
              </p>
            </div>
            <span className="timezone-note">Times shown in your computer&apos;s timezone</span>
          </div>

          {report && report.sessions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Ended</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Actual state</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.sessions.map((session: ActualSession, index) => {
                  const start = new Date(session.start);
                  const end = new Date(session.end);
                  return (
                    <TableRow key={`${session.start}-${session.end}-${index}`}>
                      <TableCell>{sessionDateFormatter.format(start)}</TableCell>
                      <TableCell>{timeFormatter.format(start)}</TableCell>
                      <TableCell>{timeFormatter.format(end)}</TableCell>
                      <TableCell><span className="duration-pill">{formatDuration(session.durationSeconds)}</span></TableCell>
                      <TableCell>{session.states.join(", ") || report.auxiliary.name}</TableCell>
                      <TableCell>{session.platforms.map(formatPlatform).join(", ") || "Assembled"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="table-empty">
              <Search />
              <h3>{report ? "No matching sessions found" : "No report selected"}</h3>
              <p>{report ? "Try a different auxiliary or time range." : "Complete the filters above to view actual sessions."}</p>
            </div>
          )}
        </section>

        <footer className="page-footer">
          Read-only report · Data retrieved securely from Assembled
        </footer>
      </main>
    </div>
  );
}
