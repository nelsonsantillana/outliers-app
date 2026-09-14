import { AssembledError, getDirectory } from "@/lib/assembled";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const directory = await getDirectory(url.searchParams.get("refresh") === "true");
    return Response.json(directory, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const assembledError =
      error instanceof AssembledError
        ? error
        : new AssembledError("The Assembled directory could not be loaded.");

    return Response.json(
      { error: assembledError.message, code: assembledError.code },
      {
        status: assembledError.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
