import { changeBoard, createBoardDependencies, getBoard } from "@/lib/server/publish/board-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getBoard(request, createBoardDependencies());
}

export async function POST(request: Request): Promise<Response> {
  return changeBoard(request, createBoardDependencies(), "add");
}

export async function DELETE(request: Request): Promise<Response> {
  return changeBoard(request, createBoardDependencies(), "remove");
}
