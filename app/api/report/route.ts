import { AssembledError, getAuxiliaryReport } from "@/lib/assembled";

type ReportRequest = {
  agentId?: string;
  activityTypeId?: string;
  start?: string;
  end?: string;
  teamId?: string;
  queueId?: string;
};

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as ReportRequest;

    if (!input.agentId || !input.activityTypeId || !input.start || !input.end) {
      throw new AssembledError(
        "Select an agent, auxiliary, start time, and end time.",
        400,
        "MISSING_FILTERS",
      );
    }

    const report = await getAuxiliaryReport({
      agentId: input.agentId,
      activityTypeId: input.activityTypeId,
      start: input.start,
      end: input.end,
      teamId: input.teamId,
      queueId: input.queueId,
    });

    return Response.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const assembledError =
      error instanceof AssembledError
        ? error
        : new AssembledError("The auxiliary report could not be calculated.");

    return Response.json(
      { error: assembledError.message, code: assembledError.code },
      {
        status: assembledError.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
