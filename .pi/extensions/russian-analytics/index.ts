import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMacro } from "./macro";
import { registerNews } from "./news";
import { registerFundamental } from "./fundamental";
import { registerTechnical } from "./technical";
import { registerBond } from "./bond";
import { registerEtf } from "./etf";
import { registerRnd } from "./rnd";
import { registerPortfolio } from "./portfolio";
import { registerTax } from "./tax";
import { registerQa } from "./qa";
import { registerLookup } from "./lookup";
import { registerPipeline } from "./pipeline";
import * as fs from "fs";

export default function (pi: ExtensionAPI) {
    pi.on("agent_end", (_event: any, ctx: any) => {
        const sessionName = ctx.sessionManager.getSessionName();
        const sessionId = ctx.sessionManager.getSessionId();
        if (sessionName) {
            const logFile = `sessionLogs/${sessionName}_${sessionId}.json`
            fs.appendFileSync(logFile, `${JSON.stringify(_event.messages)}\n`);
        }
    });
    
    registerPipeline(pi);
    registerLookup(pi);
    registerMacro(pi);
    registerNews(pi);
    registerFundamental(pi);
    registerTechnical(pi);
    registerBond(pi);
    registerEtf(pi);
    registerRnd(pi);
    registerPortfolio(pi);
    registerTax(pi);
    registerQa(pi);
}