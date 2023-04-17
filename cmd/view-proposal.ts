#!/usr/bin/env node

import {OptionValues, program} from "commander";
import {getDexCalcs, getMarketDataWithCalcs, getSafetyModuleCalcs, printPropsalSummary} from "./generate-proposal";
import {MipConfig, REWARD_TYPE} from "../src/types";
import {BigNumber} from "bignumber.js";
import {formatNumber, govRewardSpeeds} from "../src/lib";
import chalk from "chalk";
import {getMarkdownFunctions} from "../src/markdown";

if (require.main === module) {
    (async () => {
        program
            .name("Moonwell Market Adjuster Proposal Viewer")
            .version(require('../package.json').version, '-v, --vers', 'Print the current version')

        program.parse(process.argv)

        if (program.args.length === 0){
            console.log("Please specify the github URL of a config (i.e. https://github.com/moonwell-fi/market-reward-adjustments/blob/master/configs/MIP-27.json")
            process.exit(1)
        } else if (program.args.length > 1){
            console.log("Please only specify a single config file to print")
            process.exit(1)
        }

        const url = program.args[0].replace('/blob/', '/raw/')
        const result = await fetch(url)

        if (result.status !== 200){
            throw new Error(`Could not resolve URL ${url} - ${result.status} ${result.statusText}`)
        }

        const mipConfig: MipConfig = await result.json()

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

        await printPropsalSummary(
            mipConfig,
            globalRenderFunctions,
            smCalcs,
            dexCalcs,
            marketDataWithCalcs
        )
    })();
}
