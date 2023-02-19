import {template} from "lodash";
import {loadTemplate} from "./lib";
import {MipConfig} from "./types";

export async function getMarkdownFunctions(mipConfig: any, ){
    // Intro stuff
    const introMarkdown = template(loadTemplate('intro.md.ejs'))

    // Safety Module stuff
    const safetyModuleMarkdown = template(loadTemplate('safety-module.md.ejs'))

    // Dex rewarder stuff
    const dexRewarderMarkdown = template(loadTemplate('dex-rewarder.md.ejs'))

    // Markets stuff
    const marketTopperMarkdown = template(loadTemplate('market-topper.md.ejs'))
    const marketsMarkdown = template(loadTemplate('market.md.ejs'))

    // Definitions section
    const definitionMarkdown = mipConfig.config.networkName === 'Moonbeam' ?
        template(loadTemplate('definitions.artemis.md.ejs')) :
        template(loadTemplate('definitions.apollo.md.ejs'))

    return {
        introMarkdown,
        safetyModuleMarkdown,
        dexRewarderMarkdown,
        marketTopperMarkdown,
        marketsMarkdown,
        definitionMarkdown,
    }
}

export function generateProposalMarkdown(
    mipConfig: MipConfig,
    globalRenderFunctions: any,
    markdownFunctions: any,
    smCalcs: any, dexCalcs: any, marketDataWithCalcs: any,
    configHash: string
) {
    const proposalContent = [
        markdownFunctions.introMarkdown(mipConfig),
        // Safety Module
        markdownFunctions.safetyModuleMarkdown({ smCalcs, ...globalRenderFunctions, ...mipConfig }),

        // Dex Rewarder
        markdownFunctions.dexRewarderMarkdown({ dexCalcs, ...globalRenderFunctions, ...mipConfig }),

        // Markets
        markdownFunctions.marketTopperMarkdown({ ...globalRenderFunctions, ...mipConfig }),
        Object.values(marketDataWithCalcs).map((marketData: any) => marketData.rendered ).join('\n'),

        // Definitions
        markdownFunctions.definitionMarkdown(),
    ]

    let formattedProposal = proposalContent.join('\n') + "\n"

    const rawConfigData = JSON.stringify(mipConfig, null, 2)

    formattedProposal += '---\n'
    formattedProposal += `Config Hash: \`${configHash}\`\n`
    formattedProposal += `<details> <summary>Proposal Config</summary> <pre>${rawConfigData}</pre> </details>`

    return formattedProposal
}
