import "server-only";
import { serverEnv } from "@/lib/config/env.server";
import { recreationAllowed } from "./engine";

/** Whether «Hacer magia» of this workspace builds a new sheet with the recreation engine (server's switch). */
export const recreationEnabledFor = (workspaceId: string): boolean => recreationAllowed(serverEnv(), workspaceId);
