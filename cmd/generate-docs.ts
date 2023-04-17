#!/usr/bin/env node

import {program} from "commander";
import {getDexCalcs, getMarketDataWithCalcs, getSafetyModuleCalcs} from "./generate-proposal";
import {MipConfig, REWARD_TYPE} from "../src/types";
import {BigNumber} from "bignumber.js";
import {formatNumber, govRewardSpeeds} from "../src/lib";
import chalk from "chalk";
import {generateProposalMarkdown, getMarkdownFunctions} from "../src/markdown";
import {omit} from "lodash";
import fs from "fs";
import path from "path";

if (require.main === module) {
    (async () => {
        program
            .name("Moonwell Market Adjuster Proposal Docs Generator")
            .version(require('../package.json').version, '-v, --vers', 'Print the current version')

        const configs = fs.readdirSync(
            path.join(__dirname, '../configs/')
        ).filter(i => i.endsWith('.json'))

        fs.mkdirSync(path.join(__dirname, '../docs/mips/apollo/'), {recursive: true})
        fs.mkdirSync(path.join(__dirname, '../docs/mips/artemis/'), {recursive: true})

        const artemisMips = []
        const apolloMips = []

        for (const config of configs){
            const mipConfig: MipConfig = require(path.join('../configs/', config))

            const globalRenderFunctions = { BigNumber, formatNumber, govRewardSpeeds, chalk }

            const govTokenAmountToEmit = mipConfig.responses.emissionAmounts[REWARD_TYPE.GOV_TOKEN]
            const nativeTokenAmountToEmit = mipConfig.responses.emissionAmounts[REWARD_TYPE.NATIVE_TOKEN]

            const smCalcs = await getSafetyModuleCalcs(mipConfig, govTokenAmountToEmit)
            const dexCalcs = await getDexCalcs(mipConfig, govTokenAmountToEmit)
            const markdownFunctions = await getMarkdownFunctions(mipConfig)

            const marketDataWithCalcs = getMarketDataWithCalcs(
                mipConfig,
                govTokenAmountToEmit,
                nativeTokenAmountToEmit,
                markdownFunctions.marketsMarkdown,
                globalRenderFunctions,
            )

            const configToHash = JSON.stringify(omit(mipConfig, '_meta'), null, 2)
            const configHash = require('crypto').createHash('sha256').update(configToHash).digest('hex')

            let renderedMarkdown = generateProposalMarkdown(
                mipConfig,
                globalRenderFunctions,
                markdownFunctions,
                smCalcs, dexCalcs, marketDataWithCalcs, configHash
            )

            let folder
            if (mipConfig.config.networkName === 'Moonbeam'){
                folder = 'artemis'
                artemisMips.push(mipConfig)
            } else {
                folder = 'apollo'
                apolloMips.push(mipConfig)
            }

            renderedMarkdown = `
            ---
            pageClass: mip
            ---
            `.trim().replace(/^\s{12}/gm, '') + "\n" + renderedMarkdown

            fs.writeFileSync(
                path.join(__dirname, '../docs/mips/', folder, config.replace('.json', '.md')),
                renderedMarkdown
            )

            // console.log(stuff)
        }

        let index = fs.readFileSync(path.join(__dirname, '../src/templates/docs/top-level.md'), 'utf-8')

        index += '\n'
        index += `## Moonwell Artemis MIPs`
        index += '\n'
        index += artemisMips.map(config => renderLink(config)).join('\n')
        index += '\n'
        index += `## Moonwell Apollo MIPs`
        index += '\n'
        index += apolloMips.map(config => renderLink(config)).join('\n')

        fs.writeFileSync(path.join(__dirname, '../docs/README.md'), index)

    })();
}

function renderLink(config: MipConfig){
    const mipNumber = `MIP-${config.responses.mipNumber}`
    const mipCategory = config.config.networkName === 'Moonbeam' ? 'artemis' : 'apollo'
    return `
- [${mipNumber} - Generated @ ${config._meta.generatedAt}](./mips/${mipCategory}/${mipNumber}.html)
    `.trim()
}
